const LOCAL_AGENT_REF_PREFIX = 'local-agent:';

const FORBIDDEN_LAUNCH_FIELDS = [
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
  'avatarAsset',
  'avatar_asset',
  'avatarAssetKind',
  'avatar_asset_kind',
  'avatarAssetId',
  'avatar_asset_id',
  'avatarAssetSchemaVersion',
  'avatar_asset_schema_version',
  'localAvatarAssetRef',
  'local_avatar_asset_ref',
  'backendCapabilityProfileRef',
  'backend_capability_profile_ref',
  'materializationRef',
  'materialization_ref',
  'localMaterializationRef',
  'local_materialization_ref',
  'live2dCalibrationRef',
  'live2d_calibration_ref',
  'live2dCalibration',
  'live2d_calibration',
  'modelDigest',
  'model_digest',
  'avatarInstanceCalibration',
  'avatar_instance_calibration',
  'previewArtifactRef',
  'preview_artifact_ref',
  'framingCalibration',
  'framing_calibration',
  'renderScale',
  'render_scale',
  'targetFps',
  'target_fps',
  'performancePolicy',
  'performance_policy',
  'expressionInventory',
  'expression_inventory',
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
  'conversationAnchorId',
  'conversation_anchor_id',
] as const;

export type AvatarLaunchHandoffPayload = {
  readonly agentId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly avatarInstanceId: string | null;
  readonly launchSource: string | null;
};

export type AvatarLaunchHandoffPayloadInput = {
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly localAgentRef: unknown;
  readonly avatarInstanceId?: unknown;
  readonly sourceSurface?: unknown;
  readonly launchSource?: unknown;
};

export type AvatarLaunchInstanceIdInput = {
  readonly localAgentRef: unknown;
  readonly sourceSurface?: unknown;
};

export type AvatarLaunchHandoffResult = {
  readonly opened: true;
  readonly avatarInstanceId: string | null;
  readonly handoffUri: string | null;
  readonly launchSource: string | null;
  readonly pid: number | null;
};

export function buildAvatarLaunchInstanceId(input: AvatarLaunchInstanceIdInput): string {
  const localAgentRef = requireLocalAgentRef(input.localAgentRef, 'localAgentRef');
  const sourceSurface = sanitizeIdentifier(optionalText(input.sourceSurface) || 'avatar');
  return `${sourceSurface}-avatar-${sanitizeIdentifier(localAgentRef)}`;
}

export function buildAvatarLaunchHandoffPayload(
  input: AvatarLaunchHandoffPayloadInput,
): AvatarLaunchHandoffPayload {
  const localAgentRef = requireLocalAgentRef(input.localAgentRef, 'localAgentRef');
  return parseAvatarLaunchHandoffPayload({
    agentId: localAgentRef,
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef,
    avatarInstanceId: optionalText(input.avatarInstanceId),
    launchSource: optionalText(input.launchSource) || optionalText(input.sourceSurface),
  });
}

export function parseAvatarLaunchHandoffPayload(value: unknown): AvatarLaunchHandoffPayload {
  if (!isRecord(value)) {
    throw new Error('avatar launch handoff returned invalid payload');
  }
  assertNoForbiddenFields(value, 'avatar launch handoff');
  const launchSource = optionalText(value.launchSource)
    ?? optionalText(value.sourceSurface)
    ?? optionalText(value.source_surface)
    ?? optionalText(value.launch_source);
  const agentId = requireLocalAgentRef(value.agentId ?? value.agent_id, 'agentId');
  const ownerUserId = requireText(value.ownerUserId ?? value.owner_user_id, 'ownerUserId');
  const runtimeSourceRef = requireText(value.runtimeSourceRef ?? value.runtime_source_ref, 'runtimeSourceRef');
  const localAgentRef = requireLocalAgentRef(value.localAgentRef ?? value.local_agent_ref, 'localAgentRef');
  if (agentId !== localAgentRef) {
    throw new Error('avatar launch handoff requires agentId to equal localAgentRef');
  }
  if (localAgentRef === runtimeSourceRef) {
    throw new Error('avatar launch handoff requires localAgentRef to be Runtime-owned');
  }
  return {
    agentId,
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    avatarInstanceId: optionalText(value.avatarInstanceId ?? value.avatar_instance_id),
    launchSource,
  };
}

export function parseAvatarLaunchHandoffResult(value: unknown): AvatarLaunchHandoffResult {
  if (!isRecord(value)) {
    throw new Error('Avatar launch handoff result must be an object');
  }
  if (value.opened !== true) {
    const reasonCode = optionalText(value.reasonCode ?? value.reason_code) || 'unknown';
    throw new Error(`Avatar launch handoff did not open: ${reasonCode}`);
  }
  return {
    opened: true,
    avatarInstanceId: optionalText(value.avatarInstanceId ?? value.avatar_instance_id),
    handoffUri: optionalText(value.handoffUri ?? value.handoff_uri),
    launchSource: optionalText(value.launchSource ?? value.launch_source),
    pid: optionalInteger(value.pid),
  };
}

function assertNoForbiddenFields(record: Record<string, unknown>, context: string): void {
  for (const field of FORBIDDEN_LAUNCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw new Error(`${context} contains forbidden field: ${field}`);
    }
  }
}

function requireLocalAgentRef(value: unknown, field: string): string {
  const normalized = requireText(value, field);
  if (!normalized.startsWith(LOCAL_AGENT_REF_PREFIX)) {
    throw new Error(`avatar launch handoff requires ${field} to be a local-agent ref`);
  }
  return normalized;
}

function requireText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (!normalized) {
    throw new Error(`avatar launch handoff is missing ${field}`);
  }
  return normalized;
}

function optionalText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function optionalInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
