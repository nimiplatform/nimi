import { createNimiClientId } from '@nimiplatform/sdk';
import { invokeChecked } from './invoke';

export type DesktopAvatarLaunchHandoffInput = {
  agentId: string;
  avatarInstanceId?: string | null;
  launchSource?: string | null;
  sourceSurface?: string | null;
};

export type DesktopAvatarLaunchHandoffResult = {
  opened: boolean;
  handoffUri: string;
};

export type DesktopAvatarCloseHandoffInput = {
  avatarInstanceId: string;
  closedBy?: string;
  sourceSurface?: string;
};

export type DesktopAvatarCloseHandoffResult = {
  opened: boolean;
  handoffUri: string;
};

export type DesktopAvatarLaunchHandoffPayload = {
  agentId: string;
  avatarInstanceId?: string;
  launchSource?: string;
};

const FORBIDDEN_LAUNCH_INPUT_FIELDS = [
  'ownerUserId',
  'owner_user_id',
  'realmAgentId',
  'realm_agent_id',
  'localAgentRef',
  'local_agent_ref',
  'conversationAnchorId',
  'conversation_anchor_id',
  'avatarPackage',
  'avatar_package',
  'avatarPackageKind',
  'avatar_package_kind',
  'avatarPackageId',
  'avatar_package_id',
  'avatarPackageRef',
  'avatar_package_ref',
  'avatarPackageSchemaVersion',
  'avatar_package_schema_version',
  'localAvatarAssetRef',
  'local_avatar_asset_ref',
  'backendCapabilityProfileRef',
  'backend_capability_profile_ref',
  'materializationRef',
  'materialization_ref',
  'localMaterializationRef',
  'local_materialization_ref',
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
  'accountId',
  'account_id',
  'userId',
  'user_id',
  'subjectUserId',
  'subject_user_id',
  'agentCenterAccountId',
  'agent_center_account_id',
  'realmBaseUrl',
  'realm_base_url',
  'realmUrl',
  'realm_url',
  'accessToken',
  'access_token',
  'accountAccessToken',
  'account_access_token',
  'refreshToken',
  'refresh_token',
  'jwt',
  'rawJwt',
  'raw_jwt',
  'sharedAuth',
  'shared_auth',
  'sharedAuthSession',
  'shared_auth_session',
] as const;

const LOCAL_AGENT_REF_PREFIX = 'local-agent:';

export type DesktopAvatarLaunchHandoffDeps = {
  invokeLaunchHandoff?: (payload: DesktopAvatarLaunchHandoffPayload) => Promise<DesktopAvatarLaunchHandoffResult>;
};

export type DesktopAvatarCloseHandoffDeps = {
  invokeCloseHandoff?: (payload: {
    avatarInstanceId: string;
    closedBy: string;
    sourceSurface: string;
  }) => Promise<DesktopAvatarCloseHandoffResult>;
};

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeRequiredString(value: string, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`desktop avatar handoff requires ${field}`);
  }
  return normalized;
}

function normalizeRequiredPayloadString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`desktop avatar handoff returned invalid ${field}`);
  }
  return normalizeRequiredString(value, field);
}

function normalizeRequiredPayloadBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`desktop avatar handoff returned invalid ${field}`);
  }
  return value;
}

function normalizeRequiredLocalAgentRef(value: string, field: string): string {
  const normalized = normalizeRequiredString(value, field);
  const rest = normalized.startsWith(LOCAL_AGENT_REF_PREFIX)
    ? normalized.slice(LOCAL_AGENT_REF_PREFIX.length)
    : '';
  const separatorIndex = rest.indexOf(':');
  const ownerUserId = separatorIndex >= 0 ? rest.slice(0, separatorIndex).trim() : '';
  const realmAgentId = separatorIndex >= 0 ? rest.slice(separatorIndex + 1).trim() : '';
  if (!ownerUserId || !realmAgentId) {
    throw new Error(`desktop avatar handoff requires ${field} to be a local-agent ref`);
  }
  return normalized;
}

export function parseDesktopAvatarLaunchHandoffResult(value: unknown): DesktopAvatarLaunchHandoffResult {
  if (!value || typeof value !== 'object') {
    throw new Error('desktop avatar handoff returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  return {
    opened: normalizeRequiredPayloadBoolean(record.opened, 'opened'),
    handoffUri: normalizeRequiredPayloadString(record.handoffUri, 'handoffUri'),
  };
}

export function parseDesktopAvatarCloseHandoffResult(value: unknown): DesktopAvatarCloseHandoffResult {
  if (!value || typeof value !== 'object') {
    throw new Error('desktop avatar close handoff returned invalid payload');
  }
  const record = value as Record<string, unknown>;
  return {
    opened: normalizeRequiredPayloadBoolean(record.opened, 'opened'),
    handoffUri: normalizeRequiredPayloadString(record.handoffUri, 'handoffUri'),
  };
}

export function buildDesktopAvatarLaunchHandoffPayload(
  input: DesktopAvatarLaunchHandoffInput,
): DesktopAvatarLaunchHandoffPayload {
  const record = input as Record<string, unknown>;
  for (const field of FORBIDDEN_LAUNCH_INPUT_FIELDS) {
    if (field in record) {
      throw new Error(`desktop avatar handoff contains forbidden field: ${field}`);
    }
  }
  const agentId = normalizeRequiredLocalAgentRef(input.agentId, 'agentId');
  const avatarInstanceId = normalizeOptionalString(input.avatarInstanceId);
  const launchSource = normalizeOptionalString(input.launchSource) ?? normalizeOptionalString(input.sourceSurface);
  return {
    agentId,
    ...(avatarInstanceId ? { avatarInstanceId } : {}),
    ...(launchSource ? { launchSource } : {}),
  };
}

export async function prepareDesktopAvatarLaunchHandoffPayload(
  input: DesktopAvatarLaunchHandoffInput,
  _deps: DesktopAvatarLaunchHandoffDeps = {},
): Promise<DesktopAvatarLaunchHandoffPayload> {
  return buildDesktopAvatarLaunchHandoffPayload(input);
}

export async function launchDesktopAvatarHandoff(
  input: DesktopAvatarLaunchHandoffInput,
  deps: DesktopAvatarLaunchHandoffDeps = {},
): Promise<DesktopAvatarLaunchHandoffResult> {
  const payload = await prepareDesktopAvatarLaunchHandoffPayload(input, deps);
  if (deps.invokeLaunchHandoff) {
    return deps.invokeLaunchHandoff(payload);
  }
  return invokeChecked('desktop_avatar_launch_handoff', { payload }, parseDesktopAvatarLaunchHandoffResult);
}

export async function closeDesktopAvatarHandoff(
  input: DesktopAvatarCloseHandoffInput,
  deps: DesktopAvatarCloseHandoffDeps = {},
): Promise<DesktopAvatarCloseHandoffResult> {
  const payload = {
    avatarInstanceId: normalizeRequiredString(input.avatarInstanceId, 'avatarInstanceId'),
    closedBy: input.closedBy || 'desktop',
    sourceSurface: input.sourceSurface || 'desktop-agent-chat',
  };
  if (deps.invokeCloseHandoff) {
    return deps.invokeCloseHandoff(payload);
  }
  return invokeChecked('desktop_avatar_close_handoff', { payload }, parseDesktopAvatarCloseHandoffResult);
}

function sanitizeInstanceSegment(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  const collapsed = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return collapsed || 'unknown';
}

export function buildDesktopAvatarInstanceId(input: {
  localAgentRef: string;
  threadId?: string | null;
}): string {
  const record = input as Record<string, unknown>;
  if ('conversationAnchorId' in record) {
    throw new Error('desktop avatar instance id must not depend on conversationAnchorId');
  }
  const agentSegment = sanitizeInstanceSegment(input.localAgentRef);
  const continuitySegment = sanitizeInstanceSegment(input.threadId || 'default');
  return `desktop-avatar-${agentSegment}-${continuitySegment}`;
}

export function buildDesktopAvatarEphemeralInstanceId(input: {
  localAgentRef: string;
  threadId?: string | null;
  nonce?: string | null;
}): string {
  const baseId = buildDesktopAvatarInstanceId(input);
  const nonce = sanitizeInstanceSegment(
    input.nonce || createNimiClientId('avatar-nonce'),
  );
  return `${baseId}-${nonce}`;
}
