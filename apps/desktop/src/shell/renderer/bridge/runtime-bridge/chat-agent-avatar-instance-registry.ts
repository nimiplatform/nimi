import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';

export type DesktopAvatarLiveInstanceRecord = {
  avatarInstanceId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  launchSource: string | null;
};

export type DesktopAvatarLiveInstanceIdentityInput = {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
};

const FORBIDDEN_LIVE_INSTANCE_FIELDS = new Set([
  'conversationAnchorId',
  'avatarPackage',
  'avatarPackageKind',
  'avatarPackageId',
  'avatarPackageRef',
  'avatarPackageSchemaVersion',
  'avatar_package',
  'avatar_package_kind',
  'avatar_package_id',
  'avatar_package_ref',
  'avatar_package_schema_version',
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
  'agentId',
]);

function requireTauri(commandName: string) {
  if (!hasTauriInvoke()) {
    throw new Error(`${commandName} requires Tauri runtime`);
  }
}

export function desktopAvatarInstanceRegistryQueryKey(localAgentRef: string) {
  return ['desktop-avatar-instance-registry', localAgentRef] as const;
}

function validateLocalAgentRef(ownerUserId: string, realmAgentId: string, localAgentRef: string): void {
  if (localAgentRef === realmAgentId) {
    throw new Error('desktop avatar instance registry localAgentRef must not be a bare realmAgentId');
  }
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error('desktop avatar instance registry localAgentRef must start with local-agent:');
  }
  const expected = `local-agent:${ownerUserId}:${realmAgentId}`;
  if (localAgentRef !== expected) {
    throw new Error('desktop avatar instance registry localAgentRef must equal local-agent:${ownerUserId}:${realmAgentId}');
  }
}

export function parseDesktopAvatarLiveInstanceRecord(value: unknown): DesktopAvatarLiveInstanceRecord {
  const record = assertRecord(value, 'desktop avatar instance registry is invalid');
  for (const field of FORBIDDEN_LIVE_INSTANCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(`desktop avatar instance registry contains forbidden authority field: ${field}`);
    }
  }
  const ownerUserId = parseRequiredString(record.ownerUserId, 'ownerUserId', 'desktop avatar instance registry');
  const realmAgentId = parseRequiredString(record.realmAgentId, 'realmAgentId', 'desktop avatar instance registry');
  const localAgentRef = parseRequiredString(record.localAgentRef, 'localAgentRef', 'desktop avatar instance registry');
  validateLocalAgentRef(ownerUserId, realmAgentId, localAgentRef);
  return {
    avatarInstanceId: parseRequiredString(record.avatarInstanceId, 'avatarInstanceId', 'desktop avatar instance registry'),
    ownerUserId,
    realmAgentId,
    localAgentRef,
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
  input: DesktopAvatarLiveInstanceIdentityInput,
): Promise<DesktopAvatarLiveInstanceRecord[]> {
  validateLocalAgentRef(input.ownerUserId, input.realmAgentId, input.localAgentRef);
  requireTauri('desktop_avatar_instance_registry_list');
  return invokeChecked('desktop_avatar_instance_registry_list', {
    payload: input,
  }, parseDesktopAvatarLiveInstanceList);
}
