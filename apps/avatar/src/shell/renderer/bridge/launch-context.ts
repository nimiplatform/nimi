import { invoke } from '@tauri-apps/api/core';

const FORBIDDEN_LAUNCH_FIELDS = [
  'avatarPackage',
  'avatar_package',
  'avatarPackageKind',
  'avatar_package_kind',
  'avatarPackageId',
  'avatar_package_id',
  'avatarPackageSchemaVersion',
  'avatar_package_schema_version',
  'manifestPath',
  'manifest_path',
  'packagePath',
  'package_path',
  'sourcePath',
  'source_path',
  'configPath',
  'config_path',
  'anchorMode',
  'anchor_mode',
  'runtimeAppId',
  'runtime_app_id',
  'worldId',
  'world_id',
  'scopedBinding',
  'scoped_binding',
  'bindingId',
  'binding_id',
  'bindingHandle',
  'binding_handle',
  'bindingAppInstanceId',
  'binding_app_instance_id',
  'bindingWindowId',
  'binding_window_id',
  'bindingPurpose',
  'binding_purpose',
  'bindingScopes',
  'binding_scopes',
  'bindingState',
  'binding_state',
  'bindingReasonCode',
  'binding_reason_code',
  'scopes',
  'state',
  'reason',
  'reasonCode',
  'realmUrl',
  'realm_url',
  'realmBaseUrl',
  'realm_base_url',
  'accessToken',
  'access_token',
  'accountAccessToken',
  'account_access_token',
  'refreshToken',
  'refresh_token',
  'jwt',
  'rawJwt',
  'raw_jwt',
  'subjectUserId',
  'subject_user_id',
  'agentCenterAccountId',
  'agent_center_account_id',
  'accountId',
  'account_id',
  'userId',
  'user_id',
  'sharedAuth',
  'shared_auth',
  'sharedAuthSession',
  'shared_auth_session',
  'loginRoute',
  'login_route',
  'agentId',
  'agent_id',
] as const;

export type AvatarLaunchContext = {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  conversationAnchorId: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
};

export type AvatarScopedBindingProjection = {
  bindingId: string;
  bindingHandle: string | null;
  runtimeAppId: string;
  appInstanceId: string;
  windowId: string;
  avatarInstanceId: string;
  agentId: string;
  conversationAnchorId: string;
  worldId: string | null;
  purpose: string;
  scopes: string[];
  issuedAt: string | null;
  expiresAt: string | null;
  state: string;
  reasonCode: string;
};

function assertNoForbiddenFields(record: Record<string, unknown>, context: string) {
  for (const field of FORBIDDEN_LAUNCH_FIELDS) {
    if (field in record) {
      throw new Error(`${context} contains forbidden field: ${field}`);
    }
  }
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`avatar launch context is missing ${field}`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

export function parseAvatarLaunchContext(value: unknown): AvatarLaunchContext {
  if (!value || typeof value !== 'object') {
    throw new Error('avatar launch context returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  assertNoForbiddenFields(record, 'avatar launch context');
  const launchSource = normalizeOptionalString(record.launchSource)
    ?? normalizeOptionalString(record.sourceSurface)
    ?? normalizeOptionalString(record.source_surface)
    ?? normalizeOptionalString(record.launch_source);
  const ownerUserId = normalizeRequiredString(record.ownerUserId ?? record.owner_user_id, 'ownerUserId');
  const realmAgentId = normalizeRequiredString(record.realmAgentId ?? record.realm_agent_id, 'realmAgentId');
  const localAgentRef = normalizeRequiredString(record.localAgentRef ?? record.local_agent_ref, 'localAgentRef');
  const conversationAnchorId = normalizeRequiredString(
    record.conversationAnchorId ?? record.conversation_anchor_id,
    'conversationAnchorId',
  );
  if (localAgentRef === realmAgentId) {
    throw new Error('avatar launch context localAgentRef must not be a bare realmAgentId');
  }
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error('avatar launch context localAgentRef must start with local-agent:');
  }
  if (localAgentRef !== `local-agent:${ownerUserId}:${realmAgentId}`) {
    throw new Error('avatar launch context localAgentRef must equal local-agent:${ownerUserId}:${realmAgentId}');
  }
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef,
    conversationAnchorId,
    avatarInstanceId: normalizeOptionalString(record.avatarInstanceId ?? record.avatar_instance_id),
    launchSource,
  };
}

export async function getAvatarLaunchContext(): Promise<AvatarLaunchContext> {
  const payload = await invoke('nimi_avatar_get_launch_context');
  return parseAvatarLaunchContext(payload);
}
