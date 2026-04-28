import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';

export type DesktopAvatarLiveInstanceRecord = {
  avatarInstanceId: string;
  agentId: string;
  conversationAnchorId: string | null;
  anchorMode: 'existing' | 'open_new';
  scopedBinding: {
    bindingId: string;
  } | null;
  launchedBy: string;
  sourceSurface: string | null;
};

function requireTauri(commandName: string) {
  if (!hasTauriInvoke()) {
    throw new Error(`${commandName} requires Tauri runtime`);
  }
}

export function desktopAvatarInstanceRegistryQueryKey(agentId: string) {
  return ['desktop-avatar-instance-registry', agentId] as const;
}

function parseAnchorMode(value: unknown): DesktopAvatarLiveInstanceRecord['anchorMode'] {
  const normalized = parseRequiredString(value, 'anchorMode', 'desktop avatar instance registry');
  if (normalized !== 'existing' && normalized !== 'open_new') {
    throw new Error('desktop avatar instance registry: anchorMode is invalid');
  }
  return normalized;
}

export function parseDesktopAvatarLiveInstanceRecord(value: unknown): DesktopAvatarLiveInstanceRecord {
  const record = assertRecord(value, 'desktop avatar instance registry is invalid');
  const scopedBindingRecord = record.scopedBinding && typeof record.scopedBinding === 'object'
    ? record.scopedBinding as Record<string, unknown>
    : null;
  const bindingId = scopedBindingRecord
    ? parseOptionalString(scopedBindingRecord.bindingId)
    : null;
  return {
    avatarInstanceId: parseRequiredString(record.avatarInstanceId, 'avatarInstanceId', 'desktop avatar instance registry'),
    agentId: parseRequiredString(record.agentId, 'agentId', 'desktop avatar instance registry'),
    conversationAnchorId: parseOptionalString(record.conversationAnchorId) || null,
    anchorMode: parseAnchorMode(record.anchorMode),
    scopedBinding: bindingId ? { bindingId } : null,
    launchedBy: parseRequiredString(record.launchedBy, 'launchedBy', 'desktop avatar instance registry'),
    sourceSurface: parseOptionalString(record.sourceSurface) || null,
  };
}

function parseDesktopAvatarLiveInstanceList(value: unknown): DesktopAvatarLiveInstanceRecord[] {
  if (!Array.isArray(value)) {
    throw new Error('desktop avatar instance registry list is invalid');
  }
  return value.map(parseDesktopAvatarLiveInstanceRecord);
}

export async function listDesktopAvatarLiveInstances(
  agentId: string,
): Promise<DesktopAvatarLiveInstanceRecord[]> {
  requireTauri('desktop_avatar_instance_registry_list');
  return invokeChecked('desktop_avatar_instance_registry_list', {
    payload: { agentId },
  }, parseDesktopAvatarLiveInstanceList);
}
