import * as vscode from 'vscode';
import { commandLabel, executeMappedCommand, gestureLabel } from './commands';
import { SidebarState, WaveCodeSidebarProvider } from './sidebar';
import { EXTENSION_NAMESPACE, GestureId, GESTURE_METADATA, getSettings, updateSetting, WaveCodeSettings } from './settings';
import { BackendProcessManager, ConnectionState, GesturePrediction, GestureWebSocketClient } from './websocket';

class WaveCodeController implements vscode.Disposable {
  private settings: WaveCodeSettings = getSettings();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly outputChannel = vscode.window.createOutputChannel('WaveCode');
  private readonly statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly lastGestureExecution = new Map<GestureId, number>();
  private lastCommandExecutionAt = 0;
  private latchedGesture: GestureId | undefined;
  private readonly sidebar: WaveCodeSidebarProvider;
  private readonly backendProcess: BackendProcessManager;
  private readonly websocketClient: GestureWebSocketClient;
  private reconnectAfterExit = true;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sidebar = new WaveCodeSidebarProvider(context.extensionUri, {
      onToggleEnabled: async (enabled) => {
        await updateSetting('enabled', enabled);
      },
      onThresholdChanged: async (threshold) => {
        await updateSetting('recognitionThreshold', threshold);
      },
      onReconnect: () => {
        this.websocketClient.reconnect(this.settings);
      },
      onRestartBackend: () => {
        void this.restartBackend();
      },
      onOpenSettings: () => {
        void vscode.commands.executeCommand('workbench.action.openSettings', `${EXTENSION_NAMESPACE}.`);
      },
    });

    this.backendProcess = new BackendProcessManager(context.extensionUri, this.outputChannel, () => {
      if (this.reconnectAfterExit && this.settings.enabled && this.settings.autoStartBackend) {
        setTimeout(() => {
          void this.startRuntime();
        }, 1500);
      }
    });

    this.websocketClient = new GestureWebSocketClient(
      this.outputChannel,
      (prediction) => {
        void this.handlePrediction(prediction);
      },
      (status) => {
        if (!status.handDetected || status.message === 'Gesture not recognized') {
          this.resetGestureLatch();
        }
        this.sidebar.updateState({
          cameraStatus: status.cameraConnected ? '🟢 Camera Connected' : '🔴 Camera Offline',
          statusMessage: status.message ?? (status.handDetected ? 'Listening...' : 'No hand detected'),
        });
      },
      (state) => {
        this.handleConnectionState(state);
      },
    );
  }

  public async activate(): Promise<void> {
    this.statusBarItem.command = 'wavecode.toggleDetection';
    this.statusBarItem.tooltip = 'Toggle WaveCode detection';
    this.statusBarItem.show();
    this.refreshSidebarState();
    this.updateStatusBar('Idle');

    this.disposables.push(
      vscode.window.registerWebviewViewProvider(WaveCodeSidebarProvider.viewType, this.sidebar, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
      vscode.commands.registerCommand('wavecode.toggleDetection', async () => {
        await updateSetting('enabled', !this.settings.enabled);
      }),
      vscode.commands.registerCommand('wavecode.reconnectBackend', () => {
        this.websocketClient.reconnect(this.settings);
      }),
      vscode.commands.registerCommand('wavecode.restartBackend', async () => {
        await this.restartBackend();
      }),
      vscode.commands.registerCommand('wavecode.openSettings', async () => {
        await vscode.commands.executeCommand('workbench.action.openSettings', `${EXTENSION_NAMESPACE}.`);
      }),
      vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration(EXTENSION_NAMESPACE)) {
          return;
        }

        const previousSettings = this.settings;
        this.settings = getSettings();
        this.refreshSidebarState();

        if (!this.settings.enabled) {
          await this.stopRuntime();
          return;
        }

        const backendChanged =
          previousSettings.backendHost !== this.settings.backendHost ||
          previousSettings.backendPort !== this.settings.backendPort ||
          previousSettings.pythonPath !== this.settings.pythonPath ||
          previousSettings.autoStartBackend !== this.settings.autoStartBackend;

        if (backendChanged) {
          await this.restartBackend();
          return;
        }

        if (!previousSettings.enabled && this.settings.enabled) {
          await this.startRuntime();
          return;
        }
      }),
    );

    if (this.settings.enabled) {
      await this.startRuntime();
    }
  }

  public dispose(): void {
    this.reconnectAfterExit = false;
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
    this.websocketClient.dispose();
    this.backendProcess.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async startRuntime(): Promise<void> {
    if (this.settings.autoStartBackend) {
      await this.backendProcess.ensureRunning(this.settings);
    }

    this.websocketClient.connect(this.settings);
    this.sidebar.updateState({
      statusMessage: 'Connecting...',
      cameraStatus: this.settings.autoStartBackend ? 'Starting camera...' : 'Waiting for backend...',
    });
  }

  private async stopRuntime(): Promise<void> {
    this.websocketClient.disconnect();
    await this.backendProcess.stop();
    this.resetGestureLatch();
    this.sidebar.updateState({
      statusMessage: 'Detection disabled',
      connectionStatus: 'Disconnected',
      cameraStatus: 'Paused',
      currentGesture: 'Detection disabled',
      confidence: '0%',
      mappedAction: 'None',
    });
    this.updateStatusBar('Disabled');
  }

  private async restartBackend(): Promise<void> {
    this.sidebar.updateState({
      statusMessage: 'Restarting backend...',
      cameraStatus: 'Restarting...',
    });
    await this.backendProcess.restart(this.settings);
    this.websocketClient.reconnect(this.settings);
  }

  private handleConnectionState(state: ConnectionState): void {
    const labelMap: Record<ConnectionState, string> = {
      connected: 'Connected',
      connecting: 'Connecting',
      disconnected: 'Disconnected',
      reconnecting: 'Reconnecting',
    };

    const cameraStatusMap: Record<ConnectionState, string> = {
      connected: '🟢 Camera Connected',
      connecting: 'Starting camera...',
      disconnected: '🔴 Camera Offline',
      reconnecting: 'Reconnecting camera...',
    };

    if (state !== 'connected') {
      this.resetGestureLatch();
    }

    this.sidebar.updateState({
      cameraStatus: cameraStatusMap[state],
      connectionStatus: labelMap[state],
      statusMessage: state === 'connected' ? 'Listening...' : labelMap[state],
    });
    this.updateStatusBar(labelMap[state]);
  }

  private async handlePrediction(prediction: GesturePrediction): Promise<void> {
    const metadata = GESTURE_METADATA[prediction.gesture];
    const mappedCommand = this.settings.gestureMappings[prediction.gesture];
    const mappedActionLabel = commandLabel(mappedCommand);

    this.sidebar.updateState({
      cameraStatus: '🟢 Camera Connected',
      currentGesture: `${metadata.emoji} ${metadata.label}`,
      confidence: `${Math.round(prediction.confidence * 100)}%`,
      mappedAction: mappedActionLabel,
      statusMessage: prediction.handDetected ? 'Listening...' : 'No hand detected',
    });

    if (!this.settings.enabled) {
      this.resetGestureLatch();
      this.updateStatusBar('Disabled');
      return;
    }

    if (prediction.confidence < this.settings.recognitionThreshold) {
      this.resetGestureLatch(prediction.gesture);
      this.sidebar.updateState({
        statusMessage: `Below threshold (${Math.round(this.settings.recognitionThreshold * 100)}%)`,
      });
      this.updateStatusBar('Low confidence');
      return;
    }

    if (this.latchedGesture === prediction.gesture) {
      this.sidebar.updateState({
        statusMessage: 'Release gesture to retrigger',
      });
      this.updateStatusBar('Gesture latched');
      return;
    }

    const lastExecution = this.lastGestureExecution.get(prediction.gesture) ?? 0;
    const now = Date.now();
    const globalCooldownRemaining = now - this.lastCommandExecutionAt < this.settings.cooldownMs;
    if (now - lastExecution < this.settings.cooldownMs || globalCooldownRemaining) {
      this.sidebar.updateState({
        statusMessage: 'Gesture cooling down',
      });
      this.updateStatusBar('Cooling down');
      return;
    }

    this.lastGestureExecution.set(prediction.gesture, now);
    this.lastCommandExecutionAt = now;
    this.latchedGesture = prediction.gesture;

    try {
      const actionLabel = await executeMappedCommand(prediction.gesture, this.settings);
      this.sidebar.pushRecentActivity(`${gestureLabel(prediction.gesture)} -> ${actionLabel}`);
      this.sidebar.updateState({
        mappedAction: actionLabel,
        statusMessage: 'Action executed',
      });
      this.updateStatusBar(actionLabel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[WaveCode] Command execution failed: ${message}`);
      this.sidebar.updateState({
        statusMessage: 'Command execution failed',
      });
      void vscode.window.showWarningMessage(`WaveCode could not execute "${mappedActionLabel}". See output for details.`);
      this.updateStatusBar('Command failed');
    }
  }

  private refreshSidebarState(): void {
    const state: Partial<SidebarState> = {
      enabled: this.settings.enabled,
      threshold: this.settings.recognitionThreshold,
      mappedAction: 'None',
      connectionStatus: this.settings.enabled ? 'Connecting' : 'Disconnected',
      currentGesture: this.settings.enabled ? 'Waiting for hand' : 'Detection disabled',
      cameraStatus: this.settings.enabled ? 'Starting...' : 'Paused',
      statusMessage: this.settings.enabled ? 'Idle' : 'Detection disabled',
      confidence: '0%',
    };
    this.sidebar.updateState(state);
  }

  private updateStatusBar(status: string): void {
    this.statusBarItem.text = this.settings.enabled ? `$(radio-tower) WaveCode: ${status}` : '$(circle-slash) WaveCode Off';
  }

  private resetGestureLatch(gesture?: GestureId): void {
    if (!gesture || this.latchedGesture === gesture) {
      this.latchedGesture = undefined;
    }
  }
}

let controller: WaveCodeController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  controller = new WaveCodeController(context);
  context.subscriptions.push(controller);
  await controller.activate();
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
