import * as vscode from 'vscode';

export interface SidebarState {
  cameraStatus: string;
  currentGesture: string;
  confidence: string;
  mappedAction: string;
  connectionStatus: string;
  enabled: boolean;
  threshold: number;
  recentActivity: string[];
  statusMessage: string;
}

interface SidebarCallbacks {
  onToggleEnabled: (enabled: boolean) => Promise<void>;
  onThresholdChanged: (threshold: number) => Promise<void>;
  onReconnect: () => void;
  onRestartBackend: () => void;
  onOpenSettings: () => void;
}

const INITIAL_STATE: SidebarState = {
  cameraStatus: 'Starting...',
  currentGesture: 'Waiting for hand',
  confidence: '0%',
  mappedAction: 'None',
  connectionStatus: 'Disconnected',
  enabled: true,
  threshold: 0.8,
  recentActivity: [],
  statusMessage: 'Idle',
};

export class WaveCodeSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'wavecode.sidebar';

  private view: vscode.WebviewView | undefined;
  private state: SidebarState = INITIAL_STATE;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: SidebarCallbacks,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'toggleEnabled':
          await this.callbacks.onToggleEnabled(Boolean(message.value));
          break;
        case 'changeThreshold':
          await this.callbacks.onThresholdChanged(Number(message.value));
          break;
        case 'reconnect':
          this.callbacks.onReconnect();
          break;
        case 'restartBackend':
          this.callbacks.onRestartBackend();
          break;
        case 'openSettings':
          this.callbacks.onOpenSettings();
          break;
        default:
          break;
      }
    });

    this.postState();
  }

  public updateState(partialState: Partial<SidebarState>): void {
    this.state = {
      ...this.state,
      ...partialState,
    };
    this.postState();
  }

  public pushRecentActivity(activity: string): void {
    this.state = {
      ...this.state,
      recentActivity: [activity, ...this.state.recentActivity].slice(0, 6),
    };
    this.postState();
  }

  private postState(): void {
    this.view?.webview.postMessage({
      type: 'state',
      value: this.state,
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WaveCode</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 12px;
    }

    .panel {
      border: 1px solid var(--vscode-sideBarSectionHeader-border);
      border-radius: 8px;
      background: var(--vscode-editor-background);
      margin-bottom: 12px;
      padding: 12px;
    }

    .title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 8px 0;
    }

    .label {
      font-size: 0.85rem;
      color: var(--vscode-descriptionForeground);
    }

    .value {
      font-weight: 600;
      text-align: right;
    }

    .toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    input[type="range"] {
      width: 100%;
    }

    button {
      width: 100%;
      margin-top: 8px;
      padding: 8px 10px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 6px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
    }

    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    ul {
      list-style: none;
      padding: 0;
      margin: 8px 0 0;
    }

    li {
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    }

    li:last-child {
      border-bottom: none;
    }

    .muted {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="title">WaveCode</div>
    <div class="row"><span class="label">Camera Status</span><span id="cameraStatus" class="value"></span></div>
    <div class="row"><span class="label">Current Gesture</span><span id="currentGesture" class="value"></span></div>
    <div class="row"><span class="label">Confidence</span><span id="confidence" class="value"></span></div>
    <div class="row"><span class="label">Mapped Action</span><span id="mappedAction" class="value"></span></div>
    <div class="row"><span class="label">Connection Status</span><span id="connectionStatus" class="value"></span></div>
    <div class="row"><span class="label">Status</span><span id="statusMessage" class="value"></span></div>
  </div>

  <div class="panel">
    <div class="title">Controls</div>
    <label class="toggle">
      <input id="enabled" type="checkbox" />
      <span>Enable Detection</span>
    </label>
    <div style="margin-top: 12px;">
      <div class="row"><span class="label">Recognition Threshold</span><span id="thresholdValue" class="value"></span></div>
      <input id="threshold" type="range" min="0.5" max="0.99" step="0.01" />
    </div>
    <button id="reconnect" class="secondary">Reconnect Backend</button>
    <button id="restartBackend" class="secondary">Restart Backend</button>
    <button id="openSettings">Open Settings</button>
  </div>

  <div class="panel">
    <div class="title">Recent Gesture History</div>
    <ul id="recentActivity"></ul>
    <div id="emptyState" class="muted">No actions executed yet.</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const elements = {
      cameraStatus: document.getElementById('cameraStatus'),
      currentGesture: document.getElementById('currentGesture'),
      confidence: document.getElementById('confidence'),
      mappedAction: document.getElementById('mappedAction'),
      connectionStatus: document.getElementById('connectionStatus'),
      statusMessage: document.getElementById('statusMessage'),
      enabled: document.getElementById('enabled'),
      threshold: document.getElementById('threshold'),
      thresholdValue: document.getElementById('thresholdValue'),
      recentActivity: document.getElementById('recentActivity'),
      emptyState: document.getElementById('emptyState'),
    };

    document.getElementById('enabled').addEventListener('change', (event) => {
      vscode.postMessage({ type: 'toggleEnabled', value: event.target.checked });
    });

    document.getElementById('threshold').addEventListener('input', (event) => {
      vscode.postMessage({ type: 'changeThreshold', value: event.target.value });
    });

    document.getElementById('reconnect').addEventListener('click', () => vscode.postMessage({ type: 'reconnect' }));
    document.getElementById('restartBackend').addEventListener('click', () => vscode.postMessage({ type: 'restartBackend' }));
    document.getElementById('openSettings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type !== 'state') {
        return;
      }

      const state = message.value;
      elements.cameraStatus.textContent = state.cameraStatus;
      elements.currentGesture.textContent = state.currentGesture;
      elements.confidence.textContent = state.confidence;
      elements.mappedAction.textContent = state.mappedAction;
      elements.connectionStatus.textContent = state.connectionStatus;
      elements.statusMessage.textContent = state.statusMessage;
      elements.enabled.checked = state.enabled;
      elements.threshold.value = String(state.threshold);
      elements.thresholdValue.textContent = Math.round(state.threshold * 100) + '%';

      elements.recentActivity.innerHTML = '';
      if (state.recentActivity.length === 0) {
        elements.emptyState.style.display = 'block';
      } else {
        elements.emptyState.style.display = 'none';
        for (const item of state.recentActivity) {
          const li = document.createElement('li');
          li.textContent = item;
          elements.recentActivity.appendChild(li);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let index = 0; index < 32; index += 1) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return result;
}
