import { isRuntimeLocalAgentRef } from '@nimiplatform/sdk/runtime';
import { invokeAvatarHostCommand } from '../app-shell/avatar-host-bridge.js';

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

export type AvatarLaunchContext = {
  agentId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  avatarInstanceId: string | null;
  launchSource: string | null;
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

function normalizeRequiredLocalAgentRef(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field);
  if (!isRuntimeLocalAgentRef(normalized)) {
    throw new Error(`avatar launch context requires ${field} to be a local-agent ref`);
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
  const agentId = normalizeRequiredLocalAgentRef(record.agentId ?? record.agent_id, 'agentId');
  const ownerUserId = normalizeRequiredString(record.ownerUserId ?? record.owner_user_id, 'ownerUserId');
  const runtimeSourceRef = normalizeRequiredString(record.runtimeSourceRef ?? record.runtime_source_ref, 'runtimeSourceRef');
  const localAgentRef = normalizeRequiredLocalAgentRef(record.localAgentRef ?? record.local_agent_ref, 'localAgentRef');
  if (agentId !== localAgentRef) {
    throw new Error('avatar launch context requires agentId to equal localAgentRef');
  }
  if (localAgentRef === runtimeSourceRef) {
    throw new Error('avatar launch context requires localAgentRef to be Runtime-owned');
  }
  return {
    agentId,
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    avatarInstanceId: normalizeOptionalString(record.avatarInstanceId ?? record.avatar_instance_id),
    launchSource,
  };
}

export async function getAvatarLaunchContext(): Promise<AvatarLaunchContext> {
  const payload = await invokeAvatarHostCommand('nimi_avatar_get_launch_context');
  return parseAvatarLaunchContext(payload);
}
