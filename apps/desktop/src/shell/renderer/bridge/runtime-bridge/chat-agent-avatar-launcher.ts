import { createNimiClientId } from '@nimiplatform/sdk';
import {
  buildAvatarHostHandoffRequest,
  parseAvatarHostHandoffResult,
  type AvatarHostHandoffRequest,
} from '@nimiplatform/kit/features/avatar/headless';
import { invokeAvatarHostHandoffMechanic } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

export type DesktopAvatarLaunchHandoffInput = {
  agentHandle: string;
  conversationAnchorId?: string | null;
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
  agentHandle: string;
  conversationAnchorId: string | null;
  avatarInstanceId?: string;
  launchSource?: string;
};

const FORBIDDEN_LAUNCH_INPUT_FIELDS = [
  'agentId',
  'agent_id',
  'ownerUserId',
  'owner_user_id',
  'runtimeSourceRef',
  'runtime_source_ref',
  'localAgentRef',
  'local_agent_ref',
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
  'compatibilityTier',
  'compatibility_tier',
  'avatarCompatibilityDiagnostics',
  'avatar_compatibility_diagnostics',
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

export type DesktopAvatarLaunchHandoffDeps = {
  invokeLaunchHandoff?: (request: AvatarHostHandoffRequest) => Promise<unknown>;
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

function isRetiredSelectionField(field: string): boolean {
  const normalized = field.replace(/_/g, '').toLowerCase();
  return (
    (normalized.includes('avatarasset') && normalized.endsWith('ref'))
    || (normalized.includes('backendcapability') && normalized.endsWith('ref'))
  );
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

// @nimi-authority: definition.nimi.desktop.agent-projection.avatar-surface
// @nimi-authority: rule.nimi.desktop.agent-projection.r016
// @nimi-authority: rule.nimi.desktop.agent-projection.r199
export function buildDesktopAvatarLaunchHandoffPayload(
  input: DesktopAvatarLaunchHandoffInput,
): DesktopAvatarLaunchHandoffPayload {
  const record = input as Record<string, unknown>;
  for (const field of Object.keys(record)) {
    if ((FORBIDDEN_LAUNCH_INPUT_FIELDS as readonly string[]).includes(field) || isRetiredSelectionField(field)) {
      throw new Error(`desktop avatar handoff contains forbidden field: ${field}`);
    }
  }
  const agentHandle = normalizeRequiredAgentHandle(input.agentHandle);
  const conversationAnchorId = normalizeOptionalString(input.conversationAnchorId);
  const avatarInstanceId = normalizeOptionalString(input.avatarInstanceId);
  const launchSource = normalizeOptionalString(input.launchSource) ?? normalizeOptionalString(input.sourceSurface);
  return {
    agentHandle,
    conversationAnchorId,
    ...(avatarInstanceId ? { avatarInstanceId } : {}),
    ...(launchSource ? { launchSource } : {}),
  };
}

function normalizeRequiredAgentHandle(value: unknown): string {
  const handle = normalizeRequiredPayloadString(value, 'agentHandle');
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(handle)) {
    throw new Error('desktop avatar handoff requires a canonical agentHandle');
  }
  return handle;
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
  const request = buildAvatarHostHandoffRequest({
    command: 'launch',
    target: {
      agentHandle: payload.agentHandle,
      conversationAnchorId: payload.conversationAnchorId,
      avatarInstanceId: payload.avatarInstanceId ?? null,
      launchSource: payload.launchSource ?? null,
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    },
  });
  const result = parseAvatarHostHandoffResult(
    await (deps.invokeLaunchHandoff
      ? deps.invokeLaunchHandoff(request)
      : invokeAvatarHostHandoffMechanic(request)),
    'launch',
  );
  return {
    opened: result.state === 'present' || result.state === 'focused',
    handoffUri: result.avatarInstanceRef ?? '',
  };
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
  agentHandle: string;
  threadId?: string | null;
}): string {
  const record = input as Record<string, unknown>;
  if ('conversationAnchorId' in record) {
    throw new Error('desktop avatar instance id must not depend on conversationAnchorId');
  }
  const agentSegment = sanitizeInstanceSegment(
    normalizeRequiredAgentHandle(input.agentHandle),
  );
  const continuitySegment = sanitizeInstanceSegment(input.threadId || 'default');
  return `desktop-avatar-${agentSegment}-${continuitySegment}`;
}

export function buildDesktopAvatarEphemeralInstanceId(input: {
  agentHandle: string;
  threadId?: string | null;
  nonce?: string | null;
}): string {
  const baseId = buildDesktopAvatarInstanceId(input);
  const nonce = sanitizeInstanceSegment(
    input.nonce || createNimiClientId('avatar-nonce'),
  );
  return `${baseId}-${nonce}`;
}
