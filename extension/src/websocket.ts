import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import { GestureId, SUPPORTED_GESTURES, WaveCodeSettings } from './settings';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface GesturePrediction {
  gesture: GestureId;
  confidence: number;
  handDetected: boolean;
  fps?: number;
}

interface BackendStatusMessage {
  type: 'status';
  camera_connected?: boolean;
  hand_detected?: boolean;
  fps?: number;
  message?: string;
}

interface BackendPredictionMessage {
  type?: 'prediction';
  gesture: string;
  confidence: number;
  hand_detected?: boolean;
  fps?: number;
}

export class BackendProcessManager implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly onExit?: (code: number | null) => void,
  ) {}

  public async ensureRunning(settings: WaveCodeSettings): Promise<void> {
    if (this.process && !this.process.killed) {
      return;
    }

    const backendPath = this.resolveBackendPath();
    const args = [backendPath, '--host', settings.backendHost, '--port', String(settings.backendPort)];
    this.outputChannel.appendLine(`[WaveCode] Starting backend: ${settings.pythonPath} ${args.join(' ')}`);

    this.process = spawn(settings.pythonPath, args, {
      cwd: path.dirname(backendPath),
      env: process.env,
    });

    this.process.stdout.on('data', (chunk) => {
      this.outputChannel.append(chunk.toString());
    });

    this.process.stderr.on('data', (chunk) => {
      this.outputChannel.append(chunk.toString());
    });

    this.process.on('error', (error) => {
      this.outputChannel.appendLine(`[WaveCode] Failed to launch backend: ${error.message}`);
    });

    this.process.on('close', (code) => {
      this.outputChannel.appendLine(`[WaveCode] Backend exited with code ${code ?? 'null'}.`);
      this.process = undefined;
      this.onExit?.(code);
    });
  }

  public async stop(): Promise<void> {
    if (!this.process || this.process.killed) {
      this.process = undefined;
      return;
    }

    const processToStop = this.process;
    await new Promise<void>((resolve) => {
      processToStop.once('close', () => resolve());
      processToStop.kill('SIGTERM');
      setTimeout(() => {
        if (processToStop.exitCode === null) {
          processToStop.kill('SIGKILL');
        }
      }, 2000);
    });
    this.process = undefined;
  }

  public async restart(settings: WaveCodeSettings): Promise<void> {
    await this.stop();
    await this.ensureRunning(settings);
  }

  public isRunning(): boolean {
    return Boolean(this.process && !this.process.killed);
  }

  public dispose(): void {
    void this.stop();
  }

  private resolveBackendPath(): string {
    const bundledPath = path.resolve(this.extensionUri.fsPath, 'vendor', 'backend', 'app.py');
    const localPath = path.resolve(this.extensionUri.fsPath, '..', 'backend', 'app.py');
    return existsSync(bundledPath) ? bundledPath : localPath;
  }
}

export class GestureWebSocketClient implements vscode.Disposable {
  private socket: WebSocket | undefined;
  private reconnectHandle: NodeJS.Timeout | undefined;
  private desiredConnection = false;
  private reconnectAttempt = 0;

  constructor(
    private readonly outputChannel: vscode.OutputChannel,
    private readonly onPrediction: (prediction: GesturePrediction) => void,
    private readonly onStatus: (status: { cameraConnected: boolean; handDetected: boolean; fps?: number; message?: string }) => void,
    private readonly onConnectionStateChange: (state: ConnectionState) => void,
  ) {}

  public connect(settings: WaveCodeSettings): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.desiredConnection = true;
    this.clearReconnectTimer();
    this.openSocket(settings, this.socket ? 'reconnecting' : 'connecting');
  }

  public disconnect(): void {
    this.desiredConnection = false;
    this.clearReconnectTimer();
    this.socket?.close();
    this.socket = undefined;
    this.onConnectionStateChange('disconnected');
  }

  public reconnect(settings: WaveCodeSettings): void {
    this.disconnect();
    this.connect(settings);
  }

  public dispose(): void {
    this.disconnect();
  }

  private openSocket(settings: WaveCodeSettings, state: ConnectionState): void {
    const url = `ws://${settings.backendHost}:${settings.backendPort}/ws`;
    this.onConnectionStateChange(state);
    this.outputChannel.appendLine(`[WaveCode] Connecting to ${url}`);

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectAttempt = 0;
      this.onConnectionStateChange('connected');
      this.outputChannel.appendLine('[WaveCode] Backend connection established.');
    });

    socket.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as BackendPredictionMessage | BackendStatusMessage;
        if ('gesture' in parsed && isGestureId(parsed.gesture)) {
          this.onPrediction({
            gesture: parsed.gesture,
            confidence: parsed.confidence,
            handDetected: parsed.hand_detected ?? true,
            fps: parsed.fps,
          });
          return;
        }

        if ('type' in parsed && parsed.type === 'status') {
          this.onStatus({
            cameraConnected: parsed.camera_connected ?? false,
            handDetected: parsed.hand_detected ?? false,
            fps: parsed.fps,
            message: parsed.message,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[WaveCode] Failed to parse backend message: ${message}`);
      }
    });

    socket.on('close', () => {
      this.outputChannel.appendLine('[WaveCode] Backend connection closed.');
      if (this.socket === socket) {
        this.socket = undefined;
      }
      if (this.desiredConnection) {
        this.scheduleReconnect(settings);
      } else {
        this.onConnectionStateChange('disconnected');
      }
    });

    socket.on('error', (error) => {
      this.outputChannel.appendLine(`[WaveCode] WebSocket error: ${error.message}`);
    });
  }

  private scheduleReconnect(settings: WaveCodeSettings): void {
    this.clearReconnectTimer();
    this.reconnectAttempt += 1;
    const delayMs = Math.min(5000, 500 * this.reconnectAttempt);
    this.onConnectionStateChange('reconnecting');
    this.reconnectHandle = setTimeout(() => {
      if (this.desiredConnection) {
        this.openSocket(settings, 'reconnecting');
      }
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectHandle) {
      clearTimeout(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
  }

}

function isGestureId(value: string): value is GestureId {
  return (SUPPORTED_GESTURES as readonly string[]).includes(value);
}
