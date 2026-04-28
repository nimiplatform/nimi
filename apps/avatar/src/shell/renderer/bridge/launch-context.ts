import { invoke } from '@tauri-apps/api/core';

const AVATAR_BINDING_PURPOSE = 'avatar.interaction.consume';
const ALLOWED_BINDING_SCOPES = new Set([
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.presentation.read',
  'runtime.agent.state.read',
]);
const FORBIDDEN_LAUNCH_FIELDS = [
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
  'anchorMode',
  'anchor_mode',
] as const;

export type AvatarLaunchContext = {
  agentId: string;
  avatarPackageKind: 'live2d' | 'vrm';
  avatarPackageId: string;
  avatarPackageSchemaVersion: 1;
  avatarInstanceId: string;
  conversationAnchorId: string;
  launchedBy: string;
  runtimeAppId?: string | null;
  sourceSurface: string | null;
  worldId?: string | null;
  scopedBinding: AvatarScopedBindingProjection;
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
  purpose: typeof AVATAR_BINDING_PURPOSE;
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

function parseAvatarPackageKind(value: unknown): 'live2d' | 'vrm' {
  if (value === 'live2d' || value === 'vrm') {
    return value;
  }
  throw new Error('avatar launch context is missing a valid avatarPackageKind');
}

function parseAvatarPackageId(value: unknown, kind: 'live2d' | 'vrm'): string {
  const normalized = normalizeRequiredString(value, 'avatarPackageId');
  const pattern = kind === 'live2d' ? /^live2d_[a-f0-9]{12}$/u : /^vrm_[a-f0-9]{12}$/u;
  if (!pattern.test(normalized)) {
    throw new Error('avatar launch context avatarPackageId must match avatarPackageKind');
  }
  return normalized;
}

function parseAvatarPackageSchemaVersion(value: unknown): 1 {
  if (value === 1) {
    return 1;
  }
  throw new Error('avatar launch context requires avatarPackageSchemaVersion=1');
}

function parseBindingScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('avatar launch context requires scopedBinding.scopes');
  }
  const scopes = value.map((scope) => normalizeRequiredString(scope, 'scopedBinding.scopes'));
  if (!scopes.includes('runtime.agent.turn.read')
    || !scopes.includes('runtime.agent.presentation.read')
    || !scopes.includes('runtime.agent.state.read')) {
    throw new Error('avatar launch context scopedBinding is missing required read scopes');
  }
  for (const scope of scopes) {
    if (!ALLOWED_BINDING_SCOPES.has(scope)) {
      throw new Error(`avatar launch context scopedBinding contains forbidden scope: ${scope}`);
    }
  }
  return scopes;
}

function parseScopedBindingProjection(
  value: unknown,
  relation: {
    runtimeAppId: string | null;
    avatarInstanceId: string;
    agentId: string;
    conversationAnchorId: string;
    worldId: string | null;
  },
): AvatarScopedBindingProjection {
  if (!value || typeof value !== 'object') {
    throw new Error('avatar launch context requires scopedBinding');
  }
  const record = value as Record<string, unknown>;
  assertNoForbiddenFields(record, 'avatar launch scopedBinding');
  const scopedBinding: AvatarScopedBindingProjection = {
    bindingId: normalizeRequiredString(record.bindingId, 'scopedBinding.bindingId'),
    bindingHandle: normalizeOptionalString(record.bindingHandle),
    runtimeAppId: normalizeRequiredString(record.runtimeAppId, 'scopedBinding.runtimeAppId'),
    appInstanceId: normalizeRequiredString(record.appInstanceId, 'scopedBinding.appInstanceId'),
    windowId: normalizeRequiredString(record.windowId, 'scopedBinding.windowId'),
    avatarInstanceId: normalizeRequiredString(record.avatarInstanceId, 'scopedBinding.avatarInstanceId'),
    agentId: normalizeRequiredString(record.agentId, 'scopedBinding.agentId'),
    conversationAnchorId: normalizeRequiredString(record.conversationAnchorId, 'scopedBinding.conversationAnchorId'),
    worldId: normalizeOptionalString(record.worldId),
    purpose: normalizeRequiredString(record.purpose, 'scopedBinding.purpose') as typeof AVATAR_BINDING_PURPOSE,
    scopes: parseBindingScopes(record.scopes),
    issuedAt: normalizeOptionalString(record.issuedAt),
    expiresAt: normalizeOptionalString(record.expiresAt),
    state: normalizeRequiredString(record.state, 'scopedBinding.state'),
    reasonCode: normalizeRequiredString(record.reasonCode, 'scopedBinding.reasonCode'),
  };
  if (scopedBinding.purpose !== AVATAR_BINDING_PURPOSE) {
    throw new Error('avatar launch context scopedBinding purpose must be avatar.interaction.consume');
  }
  if (
    scopedBinding.runtimeAppId !== relation.runtimeAppId
    || scopedBinding.avatarInstanceId !== relation.avatarInstanceId
    || scopedBinding.agentId !== relation.agentId
    || scopedBinding.conversationAnchorId !== relation.conversationAnchorId
    || (relation.worldId && scopedBinding.worldId !== relation.worldId)
  ) {
    throw new Error('avatar launch context scopedBinding relation does not match launch target');
  }
  return scopedBinding;
}

export function parseAvatarLaunchContext(value: unknown): AvatarLaunchContext {
  if (!value || typeof value !== 'object') {
    throw new Error('avatar launch context returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  assertNoForbiddenFields(record, 'avatar launch context');
  const avatarPackageKind = parseAvatarPackageKind(record.avatarPackageKind);
  const runtimeAppId = normalizeOptionalString(record.runtimeAppId);
  const avatarInstanceId = normalizeRequiredString(record.avatarInstanceId, 'avatarInstanceId');
  const agentId = normalizeRequiredString(record.agentId, 'agentId');
  const conversationAnchorId = normalizeRequiredString(record.conversationAnchorId, 'conversationAnchorId');
  const worldId = normalizeOptionalString(record.worldId);
  const scopedBinding = parseScopedBindingProjection(record.scopedBinding, {
    runtimeAppId,
    avatarInstanceId,
    agentId,
    conversationAnchorId,
    worldId,
  });
  return {
    agentId,
    avatarPackageKind,
    avatarPackageId: parseAvatarPackageId(record.avatarPackageId, avatarPackageKind),
    avatarPackageSchemaVersion: parseAvatarPackageSchemaVersion(record.avatarPackageSchemaVersion),
    avatarInstanceId,
    conversationAnchorId,
    launchedBy: normalizeRequiredString(record.launchedBy, 'launchedBy'),
    runtimeAppId,
    sourceSurface: normalizeOptionalString(record.sourceSurface),
    worldId,
    scopedBinding,
  };
}

export async function getAvatarLaunchContext(): Promise<AvatarLaunchContext> {
  const payload = await invoke('nimi_avatar_get_launch_context');
  return parseAvatarLaunchContext(payload);
}
