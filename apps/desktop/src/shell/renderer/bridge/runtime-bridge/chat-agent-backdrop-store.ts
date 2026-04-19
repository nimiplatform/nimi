import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseDesktopAgentBackdropBindingRecord,
  parseDesktopAgentBackdropImportInput,
} from './chat-agent-backdrop-parsers.js';
import type {
  DesktopAgentBackdropBindingRecord,
  DesktopAgentBackdropImportInput,
} from './chat-agent-backdrop-types.js';

function requireTauri(commandName: string) {
  if (!hasTauriInvoke()) {
    throw new Error(`${commandName} requires Tauri runtime`);
  }
}

function parseOptionalPath(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('desktop backdrop picker returned invalid payload');
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function desktopAgentBackdropBindingQueryKey(agentId: string) {
  return ['desktop-agent-backdrop-binding', agentId] as const;
}

export async function pickDesktopAgentBackdropImageSourcePath(): Promise<string | null> {
  requireTauri('desktop_agent_backdrop_pick_image');
  return invokeChecked('desktop_agent_backdrop_pick_image', {}, parseOptionalPath);
}

export async function getDesktopAgentBackdropBinding(agentId: string): Promise<DesktopAgentBackdropBindingRecord | null> {
  requireTauri('desktop_agent_backdrop_get_binding');
  return invokeChecked('desktop_agent_backdrop_get_binding', {
    payload: { agentId },
  }, (value) => (value == null ? null : parseDesktopAgentBackdropBindingRecord(value)));
}

export async function importDesktopAgentBackdrop(
  input: DesktopAgentBackdropImportInput,
): Promise<DesktopAgentBackdropBindingRecord> {
  requireTauri('desktop_agent_backdrop_import');
  return invokeChecked('desktop_agent_backdrop_import', {
    payload: parseDesktopAgentBackdropImportInput(input),
  }, parseDesktopAgentBackdropBindingRecord);
}

export async function clearDesktopAgentBackdropBinding(agentId: string): Promise<boolean> {
  requireTauri('desktop_agent_backdrop_clear');
  return invokeChecked('desktop_agent_backdrop_clear', {
    payload: { agentId },
  }, (value) => Boolean(value));
}
