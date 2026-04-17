import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseDesktopAgentAvatarResourceAssetPayload,
  parseDesktopAgentAvatarBindingRecord,
  parseDesktopAgentAvatarBindingSetInput,
  parseDesktopAgentAvatarImportLive2dInput,
  parseDesktopAgentAvatarImportResult,
  parseDesktopAgentAvatarImportVrmInput,
  parseDesktopAgentAvatarResourceRecords,
} from './chat-agent-avatar-parsers.js';
import type {
  DesktopAgentAvatarResourceAssetPayload,
  DesktopAgentAvatarBindingRecord,
  DesktopAgentAvatarBindingSetInput,
  DesktopAgentAvatarImportLive2dInput,
  DesktopAgentAvatarImportResult,
  DesktopAgentAvatarResourceRelativeReadInput,
  DesktopAgentAvatarImportVrmInput,
  DesktopAgentAvatarResourceRecord,
} from './chat-agent-avatar-types.js';

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
    throw new Error('desktop avatar picker returned invalid payload');
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function desktopAgentAvatarResourcesQueryKey() {
  return ['desktop-agent-avatar-resources'] as const;
}

export function desktopAgentAvatarBindingQueryKey(agentId: string) {
  return ['desktop-agent-avatar-binding', agentId] as const;
}

export async function pickDesktopAgentAvatarVrmSourcePath(): Promise<string | null> {
  requireTauri('desktop_agent_avatar_resource_pick_vrm');
  return invokeChecked('desktop_agent_avatar_resource_pick_vrm', {}, parseOptionalPath);
}

export async function pickDesktopAgentAvatarLive2dSourcePath(): Promise<string | null> {
  requireTauri('desktop_agent_avatar_resource_pick_live2d');
  return invokeChecked('desktop_agent_avatar_resource_pick_live2d', {}, parseOptionalPath);
}

export async function importDesktopAgentAvatarVrm(
  input: DesktopAgentAvatarImportVrmInput,
): Promise<DesktopAgentAvatarImportResult> {
  requireTauri('desktop_agent_avatar_resource_import_vrm');
  return invokeChecked('desktop_agent_avatar_resource_import_vrm', {
    payload: parseDesktopAgentAvatarImportVrmInput(input),
  }, parseDesktopAgentAvatarImportResult);
}

export async function importDesktopAgentAvatarLive2d(
  input: DesktopAgentAvatarImportLive2dInput,
): Promise<DesktopAgentAvatarImportResult> {
  requireTauri('desktop_agent_avatar_resource_import_live2d');
  return invokeChecked('desktop_agent_avatar_resource_import_live2d', {
    payload: parseDesktopAgentAvatarImportLive2dInput(input),
  }, parseDesktopAgentAvatarImportResult);
}

export async function listDesktopAgentAvatarResources(): Promise<DesktopAgentAvatarResourceRecord[]> {
  requireTauri('desktop_agent_avatar_resource_list');
  return invokeChecked('desktop_agent_avatar_resource_list', {}, parseDesktopAgentAvatarResourceRecords);
}

export async function deleteDesktopAgentAvatarResource(resourceId: string): Promise<boolean> {
  requireTauri('desktop_agent_avatar_resource_delete');
  return invokeChecked('desktop_agent_avatar_resource_delete', {
    payload: { resourceId },
  }, (value) => Boolean(value));
}

export async function readDesktopAgentAvatarResourceAsset(resourceId: string): Promise<DesktopAgentAvatarResourceAssetPayload> {
  requireTauri('desktop_agent_avatar_resource_read_asset');
  return invokeChecked('desktop_agent_avatar_resource_read_asset', {
    payload: { resourceId },
  }, parseDesktopAgentAvatarResourceAssetPayload);
}

export async function readDesktopAgentAvatarResourceRelativeAsset(
  input: DesktopAgentAvatarResourceRelativeReadInput,
): Promise<DesktopAgentAvatarResourceAssetPayload> {
  requireTauri('desktop_agent_avatar_resource_read_relative_asset');
  return invokeChecked('desktop_agent_avatar_resource_read_relative_asset', {
    payload: {
      resourceId: input.resourceId,
      relativePath: input.relativePath,
    },
  }, parseDesktopAgentAvatarResourceAssetPayload);
}

export async function getDesktopAgentAvatarBinding(agentId: string): Promise<DesktopAgentAvatarBindingRecord | null> {
  requireTauri('desktop_agent_avatar_binding_get');
  return invokeChecked('desktop_agent_avatar_binding_get', {
    payload: { agentId },
  }, (value) => (value == null ? null : parseDesktopAgentAvatarBindingRecord(value)));
}

export async function setDesktopAgentAvatarBinding(
  input: DesktopAgentAvatarBindingSetInput,
): Promise<DesktopAgentAvatarBindingRecord> {
  requireTauri('desktop_agent_avatar_binding_set');
  return invokeChecked('desktop_agent_avatar_binding_set', {
    payload: parseDesktopAgentAvatarBindingSetInput(input),
  }, parseDesktopAgentAvatarBindingRecord);
}

export async function clearDesktopAgentAvatarBinding(agentId: string): Promise<boolean> {
  requireTauri('desktop_agent_avatar_binding_clear');
  return invokeChecked('desktop_agent_avatar_binding_clear', {
    payload: { agentId },
  }, (value) => Boolean(value));
}
