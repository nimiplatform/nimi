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
  launchSource: string | null;
};

const FORBIDDEN_LIVE_INSTANCE_FIELDS = new Set([
  'avatarPackage',
  'avatarPackageKind',
  'avatarPackageId',
  'avatarPackageSchemaVersion',
  'conversationAnchorId',
  'anchorMode',
  'runtimeAppId',
  'worldId',
  'scopedBinding',
  'bindingId',
  'bindingHandle',
  'bindingAppInstanceId',
  'bindingWindowId',
  'bindingPurpose',
  'bindingScopes',
  'bindingState',
  'bindingReason',
  'scopes',
  'state',
  'reason',
  'accountId',
  'userId',
  'subjectUserId',
  'auth',
  'realmBaseUrl',
  'realmUrl',
  'accessToken',
  'accountAccessToken',
  'refreshToken',
  'jwt',
]);

function requireTauri(commandName: string) {
  if (!hasTauriInvoke()) {
    throw new Error(`${commandName} requires Tauri runtime`);
  }
}

export function desktopAvatarInstanceRegistryQueryKey(agentId: string) {
  return ['desktop-avatar-instance-registry', agentId] as const;
}

export function parseDesktopAvatarLiveInstanceRecord(value: unknown): DesktopAvatarLiveInstanceRecord {
  const record = assertRecord(value, 'desktop avatar instance registry is invalid');
  for (const field of FORBIDDEN_LIVE_INSTANCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(`desktop avatar instance registry contains forbidden authority field: ${field}`);
    }
  }
  return {
    avatarInstanceId: parseRequiredString(record.avatarInstanceId, 'avatarInstanceId', 'desktop avatar instance registry'),
    agentId: parseRequiredString(record.agentId, 'agentId', 'desktop avatar instance registry'),
    launchSource: parseOptionalString(record.launchSource) || null,
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
