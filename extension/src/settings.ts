import * as vscode from 'vscode';

export const EXTENSION_NAMESPACE = 'wavecode';

export const SUPPORTED_GESTURES = [
  'thumbs_up',
  'peace',
  'fist',
  'point',
  'open_palm',
] as const;

export type GestureId = typeof SUPPORTED_GESTURES[number];

export type GestureMappings = Record<GestureId, string>;

export interface WaveCodeSettings {
  enabled: boolean;
  recognitionThreshold: number;
  cooldownMs: number;
  autoStartBackend: boolean;
  pythonPath: string;
  backendHost: string;
  backendPort: number;
  gestureMappings: GestureMappings;
}

export const DEFAULT_GESTURE_MAPPINGS: GestureMappings = {
  thumbs_up: 'workbench.action.files.save',
  peace: 'workbench.action.terminal.toggleTerminal',
  fist: 'workbench.action.showCommands',
  point: 'workbench.action.nextEditor',
  open_palm: 'workbench.action.toggleSidebarVisibility',
};

export const GESTURE_METADATA: Record<GestureId, { label: string; emoji: string }> = {
  thumbs_up: { label: 'Thumbs Up', emoji: '👍' },
  peace: { label: 'Peace', emoji: '✌️' },
  fist: { label: 'Fist', emoji: '✊' },
  point: { label: 'Point', emoji: '☝️' },
  open_palm: { label: 'Open Palm', emoji: '🖐️' },
};

export function getSettings(): WaveCodeSettings {
  const config = vscode.workspace.getConfiguration(EXTENSION_NAMESPACE);
  const configuredMappings = config.get<Partial<Record<GestureId, string>>>('gestureMappings', {});

  const gestureMappings = SUPPORTED_GESTURES.reduce((mappings, gestureId) => {
    mappings[gestureId] = configuredMappings[gestureId] ?? DEFAULT_GESTURE_MAPPINGS[gestureId];
    return mappings;
  }, {} as GestureMappings);

  return {
    enabled: config.get<boolean>('enabled', true),
    recognitionThreshold: clamp(config.get<number>('recognitionThreshold', 0.8), 0.5, 0.99),
    cooldownMs: Math.max(250, config.get<number>('cooldownMs', 1000)),
    autoStartBackend: config.get<boolean>('autoStartBackend', true),
    pythonPath: config.get<string>('pythonPath', 'python3').trim() || 'python3',
    backendHost: config.get<string>('backendHost', '127.0.0.1').trim() || '127.0.0.1',
    backendPort: config.get<number>('backendPort', 8765),
    gestureMappings,
  };
}

export async function updateSetting<T>(key: string, value: T): Promise<void> {
  await vscode.workspace.getConfiguration(EXTENSION_NAMESPACE).update(key, value, vscode.ConfigurationTarget.Global);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

