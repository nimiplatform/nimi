const FORBIDDEN_LAUNCH_FIELDS = [
  'agentId',
  'agent_id',
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
  'ownerUserId',
  'owner_user_id',
  'runtimeSourceRef',
  'runtime_source_ref',
  'localAgentRef',
  'local_agent_ref',
] as const;

export type AvatarLaunchHandoffPayload = {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
  readonly avatarInstanceId: string | null;
  readonly launchSource: string | null;
};

/**
 * Renderer-safe projection of the Desktop-owned launch record. The Host keeps
 * the private LocalAgent identity needed by native custody; App Product Plane
 * code receives only the canonical handle and Conversation anchor.
 */
export type AvatarRendererLaunchContext = {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
  readonly avatarInstanceId: string | null;
  readonly launchSource: string | null;
};

export type AvatarLaunchHandoffPayloadInput = {
  readonly agentHandle: unknown;
  readonly conversationAnchorId: unknown;
  readonly avatarInstanceId?: unknown;
  readonly sourceSurface?: unknown;
  readonly launchSource?: unknown;
};

export type AvatarLaunchInstanceIdInput = {
  readonly agentHandle: unknown;
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
  const agentHandle = requireAgentHandle(input.agentHandle);
  const sourceSurface = sanitizeIdentifier(optionalText(input.sourceSurface) || 'avatar');
  return `${sourceSurface}-avatar-${sanitizeIdentifier(agentHandle)}`;
}

export function buildAvatarLaunchHandoffPayload(
  input: AvatarLaunchHandoffPayloadInput,
): AvatarLaunchHandoffPayload {
  if (!isRecord(input)) {
    throw new Error('avatar launch handoff returned invalid payload');
  }
  assertNoForbiddenFields(input, 'avatar launch handoff');
  return parseAvatarLaunchHandoffPayload({
    agentHandle: input.agentHandle,
    conversationAnchorId: input.conversationAnchorId,
    avatarInstanceId: optionalText(input.avatarInstanceId),
    launchSource: optionalText(input.launchSource) || optionalText(input.sourceSurface),
  });
}

export function parseAvatarLaunchHandoffPayload(value: unknown): AvatarLaunchHandoffPayload {
  return parseAvatarRendererLaunchContext(value);
}

export function parseAvatarRendererLaunchContext(value: unknown): AvatarRendererLaunchContext {
  if (!isRecord(value)) {
    throw new Error('avatar renderer launch context returned invalid payload');
  }
  const allowed = new Set([
    'agentHandle',
    'conversationAnchorId',
    'avatarInstanceId',
    'launchSource',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`avatar renderer launch context contains forbidden field: ${key}`);
    }
  }
  return {
    agentHandle: requireAgentHandle(value.agentHandle),
    conversationAnchorId: requireText(value.conversationAnchorId, 'conversationAnchorId'),
    avatarInstanceId: optionalText(value.avatarInstanceId),
    launchSource: optionalText(value.launchSource),
  };
}

function requireAgentHandle(value: unknown): string {
  const handle = requireText(value, 'agentHandle');
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(handle)) {
    throw new Error('avatar launch handoff requires a canonical agentHandle');
  }
  return handle;
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
