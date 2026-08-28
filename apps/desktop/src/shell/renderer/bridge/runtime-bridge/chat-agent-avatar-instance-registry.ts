import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';
import {
  assertRecord,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';

export type DesktopAvatarLiveInstanceRecord = {
  avatarInstanceId: string;
  agentHandle: string;
  launchSource: string | null;
};

export type DesktopAvatarLiveInstanceIdentityInput = {
  agentHandle: string;
};

const FORBIDDEN_LIVE_INSTANCE_FIELDS = [
  'agentId',
  'agent_id',
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
  'ownerUserId',
  'runtimeSourceRef',
  'localAgentRef',
] as const;

function requireShellHost(commandName: string) {
  if (!hasElectronInvoke()) {
    throw new Error(`${commandName} requires the Desktop shell host`);
  }
}

export function desktopAvatarInstanceRegistryQueryKey(agentHandle: string) {
  return ['desktop-avatar-instance-registry', agentHandle] as const;
}

function validateAgentHandle(value: unknown): string {
  const agentHandle = parseRequiredString(value, 'agentHandle', 'desktop avatar instance registry');
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(agentHandle)) {
    throw new Error('desktop avatar instance registry requires a canonical agentHandle');
  }
  return agentHandle;
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
    agentHandle: validateAgentHandle(record.agentHandle),
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
  const agentHandle = validateAgentHandle(input.agentHandle);
  requireShellHost('desktop_avatar_instance_registry_list');
  return invokeChecked('desktop_avatar_instance_registry_list', {
    payload: { agentHandle },
  }, parseDesktopAvatarLiveInstanceList);
}
