import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
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

export type DesktopAvatarLiveInstanceIdentityInput = {
  agentId: string;
};

const FORBIDDEN_LIVE_INSTANCE_FIELDS = [
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

export function desktopAvatarInstanceRegistryQueryKey(agentId: string) {
  return ['desktop-avatar-instance-registry', agentId] as const;
}

function validateAgentId(value: unknown): string {
  const agentId = parseRequiredString(value, 'agentId', 'desktop avatar instance registry');
  if (!agentId.startsWith('local-agent:')) {
    throw new Error('desktop avatar instance registry agentId must be a local-agent ref');
  }
  return agentId;
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
    agentId: validateAgentId(record.agentId),
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
  const agentId = validateAgentId(input.agentId);
  requireShellHost('desktop_avatar_instance_registry_list');
  return invokeChecked('desktop_avatar_instance_registry_list', {
    payload: { agentId },
  }, parseDesktopAvatarLiveInstanceList);
}
