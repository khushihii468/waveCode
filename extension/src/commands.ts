import * as vscode from 'vscode';
import { DEFAULT_GESTURE_MAPPINGS, GESTURE_METADATA, GestureId, WaveCodeSettings } from './settings';

const COMMAND_LABELS: Record<string, string> = {
  'workbench.action.files.save': 'Save File',
  'workbench.action.terminal.toggleTerminal': 'Toggle Terminal',
  'workbench.action.showCommands': 'Open Command Palette',
  'workbench.action.nextEditor': 'Next Editor Tab',
  'workbench.action.toggleSidebarVisibility': 'Toggle Sidebar',
};

export function commandLabel(commandId: string): string {
  return COMMAND_LABELS[commandId] ?? commandId;
}

export function gestureLabel(gestureId: GestureId): string {
  const metadata = GESTURE_METADATA[gestureId];
  return `${metadata.emoji} ${metadata.label}`;
}

export async function executeMappedCommand(gestureId: GestureId, settings: WaveCodeSettings): Promise<string> {
  const commandId = settings.gestureMappings[gestureId] ?? DEFAULT_GESTURE_MAPPINGS[gestureId];
  await vscode.commands.executeCommand(commandId);
  return commandLabel(commandId);
}

