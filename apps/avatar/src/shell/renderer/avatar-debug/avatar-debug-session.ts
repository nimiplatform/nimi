import { AvatarDebugProbeKind } from '@nimiplatform/sdk/runtime/wire-types';
import type { BackendBranch } from '../carrier/backend-branch.js';
import {
  isVrmGeneratedRouteId,
  type VrmGeneratedRouteId,
} from '../vrm/vrm-generated-motion-contract.js';
import type { VrmCapabilityProfile } from '../vrm/vrm-capability-profile.js';

export type AvatarDebugBackendKind = 'live2d' | 'vrm' | 'nimi2d';

export type AvatarDebugEvidenceKind =
  | 'package_descriptor_resolved'
  | 'backend_loaded'
  | 'capability_profile_validated'
  | 'route_support_checked'
  | 'generated_motion_checked'
  | 'emotion_expression_checked'
  | 'speech_lipsync_checked'
  | 'carrier_diagnostics_checked';

export type AvatarDebugEvidenceStatus = 'passed' | 'failed' | 'unsupported' | 'invalid';

export type RuntimeAvatarDebugProbeEnvelope = {
  probeId: string;
  agentId: string;
  probeKind: AvatarDebugProbeKind;
};

export type AvatarDebugResolverEvidence = {
  packageResolved: boolean;
  capabilityProfileResolved: boolean;
};

export type AvatarDebugSessionInput = {
  debugSessionId: string;
  runtimeProbe: RuntimeAvatarDebugProbeEnvelope;
  avatarInstanceId?: string | null;
  avatarPackageRef?: string | null;
  backendCapabilityProfileRef?: string | null;
  backendKind: AvatarDebugBackendKind;
  backend: BackendBranch | null;
  resolverEvidence?: AvatarDebugResolverEvidence | null;
  vrmCapabilityProfile?: VrmCapabilityProfile | null;
  observedAt?: string | null;
};

export type AvatarDebugEvidence = {
  evidenceId: string;
  evidenceKind: AvatarDebugEvidenceKind;
  status: AvatarDebugEvidenceStatus;
  source: string;
  reasonCode: string | null;
  refs: {
    routeIds: readonly VrmGeneratedRouteId[];
    unsupportedRouteIds: readonly string[];
    backendCapabilityProfileRef: string | null;
    avatarPackageRef: string | null;
    carrierVisualEvidenceRef: string | null;
    carrierPreviewArtifactRef: string | null;
    live2dExpressionInventoryRef: string | null;
    live2dBackendLoadRef: string | null;
    live2dCapabilityProfileRef: string | null;
    live2dRouteSupportRef: string | null;
    live2dLipsyncEvidenceRef: string | null;
    live2dHitRegionEvidenceRef: string | null;
    live2dParameterLaneDiagnosticsRef: string | null;
    live2dCalibrationRef: string | null;
  };
};

export type AvatarDebugSession = {
  debugSessionId: string;
  runtimeProbeId: string;
  agentId: string;
  avatarInstanceId: string | null;
  avatarPackageRef: string | null;
  backendCapabilityProfileRef: string | null;
  backendKind: AvatarDebugBackendKind;
  probeKind: AvatarDebugProbeKind;
  evidence: AvatarDebugEvidence;
  observedAt: string;
};

const FORBIDDEN_DEBUG_SESSION_FIELDS = Object.freeze([
  'package_descriptor_from_launch',
  'package_path_from_launch',
  'desktop_binding_id',
  'raw_apml',
  'raw_mcp',
  'raw_a2a',
  'raw_provider_output',
  'app_business_data',
  'token',
  'account_id',
  'user_id',
  'realm_url',
  'backend_command',
] as const);

const ADMITTED_PROBE_KINDS = new Set<AvatarDebugProbeKind>([
  AvatarDebugProbeKind.PACKAGE_VALIDATION,
  AvatarDebugProbeKind.LAUNCH_READINESS,
  AvatarDebugProbeKind.BACKEND_LOAD,
  AvatarDebugProbeKind.CAPABILITY_PROFILE,
  AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
  AvatarDebugProbeKind.GENERATED_MOTION,
  AvatarDebugProbeKind.EMOTION_EXPRESSION,
  AvatarDebugProbeKind.SPEECH_LIPSYNC,
  AvatarDebugProbeKind.WINDOW_HIT_REGION,
]);

function requiredString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`avatar debug session missing ${field}`);
  }
  return normalized;
}

function optionalString(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeObservedAt(value: string | null | undefined): string {
  const normalized = optionalString(value);
  if (!normalized) {
    return new Date().toISOString();
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error('avatar debug session observed_at is invalid');
  }
  return new Date(timestamp).toISOString();
}

function assertNoForbiddenFields(value: unknown, path = 'debug_session'): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`));
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if ((FORBIDDEN_DEBUG_SESSION_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`${path} contains forbidden field: ${key}`);
    }
    assertNoForbiddenFields(record[key], `${path}.${key}`);
  }
}

function evidenceKindForProbe(probeKind: AvatarDebugProbeKind): AvatarDebugEvidenceKind {
  switch (probeKind) {
    case AvatarDebugProbeKind.PACKAGE_VALIDATION:
      return 'package_descriptor_resolved';
    case AvatarDebugProbeKind.LAUNCH_READINESS:
    case AvatarDebugProbeKind.BACKEND_LOAD:
      return 'backend_loaded';
    case AvatarDebugProbeKind.CAPABILITY_PROFILE:
      return 'capability_profile_validated';
    case AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX:
      return 'route_support_checked';
    case AvatarDebugProbeKind.GENERATED_MOTION:
      return 'generated_motion_checked';
    case AvatarDebugProbeKind.EMOTION_EXPRESSION:
      return 'emotion_expression_checked';
    case AvatarDebugProbeKind.SPEECH_LIPSYNC:
      return 'speech_lipsync_checked';
    case AvatarDebugProbeKind.WINDOW_HIT_REGION:
      return 'carrier_diagnostics_checked';
    default:
      throw new Error(`avatar debug probe kind is not admitted: ${probeKind}`);
  }
}

function backendSource(input: AvatarDebugSessionInput): string {
  return `avatar.backend.${input.backendKind}`;
}

function backendMatches(input: AvatarDebugSessionInput): boolean {
  return input.backend !== null && input.backend.kind === input.backendKind;
}

function backendMetadata(input: AvatarDebugSessionInput): Record<string, unknown> {
  if (!input.backend) {
    return {};
  }
  return input.backend.metadata();
}

function hasValidBounds(input: AvatarDebugSessionInput): boolean {
  const bounds = input.backend?.nominalBounds;
  return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
}

function metadataString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  return typeof value === 'string' ? value.trim() : '';
}

function metadataBoolean(meta: Record<string, unknown>, key: string): boolean {
  return meta[key] === true;
}

function metadataStringList(meta: Record<string, unknown>, key: string): string[] {
  const value = meta[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function metadataRecord(meta: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = meta[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nimi2dLaneSupported(
  input: AvatarDebugSessionInput,
  lane: 'expression' | 'speech_mouth' | 'gesture_motion',
): boolean {
  return metadataString(metadataRecord(backendMetadata(input), 'live_action_lanes'), lane)
    === 'supported';
}

function isAdmittedCapabilityProfileId(value: string | null | undefined): value is string {
  const normalized = optionalString(value);
  if (!normalized) return false;
  const lowered = normalized.toLowerCase();
  return !(
    lowered.includes('placeholder')
    || lowered.includes('mock')
    || lowered.includes('fixture')
    || lowered.includes('todo')
    || lowered === 'unknown'
  );
}

function supportedVrmRouteIds(input: AvatarDebugSessionInput): VrmGeneratedRouteId[] {
  if (input.vrmCapabilityProfile) {
    return [...input.vrmCapabilityProfile.generatedMotion.supportedRoutes];
  }
  return metadataStringList(backendMetadata(input), 'generated_motion_routes')
    .filter(isVrmGeneratedRouteId);
}

function carrierVisualEvidenceRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'carrier_visual_evidence_ref'));
}

function carrierPreviewArtifactRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'carrier_preview_artifact_ref'));
}

function live2dExpressionInventoryRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'expression_inventory_ref'));
}

function live2dBackendLoadRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'backend_load_evidence_ref'));
}

function live2dCapabilityProfileRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'live2d_capability_profile_evidence_ref'));
}

function live2dRouteSupportRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'live2d_route_support_evidence_ref'));
}

function live2dLipsyncEvidenceRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'live2d_lipsync_evidence_ref'));
}

function live2dHitRegionEvidenceRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'live2d_hit_region_evidence_ref'));
}

function live2dParameterLaneDiagnosticsRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'carrier_visual_parameter_lane_diagnostics_ref'));
}

function live2dCalibrationRef(input: AvatarDebugSessionInput): string | null {
  return optionalString(metadataString(backendMetadata(input), 'live2d_calibration_ref'));
}

function unsupportedVrmRouteIds(input: AvatarDebugSessionInput): string[] {
  if (input.vrmCapabilityProfile) {
    return input.vrmCapabilityProfile.generatedMotion.unsupportedRoutes.map((route) => route.routeId);
  }
  return metadataStringList(backendMetadata(input), 'unsupported_generated_motion_routes');
}

function resolverFailureReason(input: AvatarDebugSessionInput): string | null {
  const resolved = input.resolverEvidence ?? null;
  if (!resolved?.packageResolved) {
    return 'package_descriptor_not_resolved';
  }
  const requiresCapabilityProfile =
    input.runtimeProbe.probeKind === AvatarDebugProbeKind.CAPABILITY_PROFILE
    || input.runtimeProbe.probeKind === AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX
    || input.runtimeProbe.probeKind === AvatarDebugProbeKind.GENERATED_MOTION
    || input.runtimeProbe.probeKind === AvatarDebugProbeKind.EMOTION_EXPRESSION
    || input.runtimeProbe.probeKind === AvatarDebugProbeKind.SPEECH_LIPSYNC;
  if (requiresCapabilityProfile && !resolved.capabilityProfileResolved) {
    return 'backend_capability_profile_not_resolved';
  }
  return null;
}

function evaluateStatus(input: AvatarDebugSessionInput): {
  status: AvatarDebugEvidenceStatus;
  reasonCode: string | null;
} {
  if (!ADMITTED_PROBE_KINDS.has(input.runtimeProbe.probeKind)) {
    return { status: 'invalid', reasonCode: 'probe_kind_not_admitted' };
  }

  const resolverFailure = resolverFailureReason(input);
  if (resolverFailure) {
    return { status: 'failed', reasonCode: resolverFailure };
  }

  const meta = backendMetadata(input);
  const profile = input.vrmCapabilityProfile ?? null;
  const hasBackend = backendMatches(input);
  const hasProfileRef = optionalString(input.backendCapabilityProfileRef) !== null;
  const supportedRoutes = supportedVrmRouteIds(input);

  switch (input.runtimeProbe.probeKind) {
    case AvatarDebugProbeKind.PACKAGE_VALIDATION:
      return { status: 'unsupported', reasonCode: 'avatar_package_projection_retired' };
    case AvatarDebugProbeKind.LAUNCH_READINESS:
    case AvatarDebugProbeKind.BACKEND_LOAD:
      return hasBackend
        ? { status: 'passed', reasonCode: null }
        : { status: 'failed', reasonCode: 'backend_not_loaded' };
    case AvatarDebugProbeKind.CAPABILITY_PROFILE:
      if (input.backendKind === 'vrm') {
        return profile?.backendKind === 'vrm'
          && isAdmittedCapabilityProfileId(profile.profileId)
          && hasProfileRef
          ? { status: 'passed', reasonCode: null }
          : { status: 'failed', reasonCode: 'vrm_capability_profile_missing' };
      }
      if (input.backendKind === 'nimi2d') {
        return hasBackend
          && hasProfileRef
          && metadataString(meta, 'capability_profile_ref')
            === optionalString(input.backendCapabilityProfileRef)
          ? { status: 'passed', reasonCode: null }
          : { status: 'failed', reasonCode: 'nimi2d_capability_profile_missing' };
      }
      return hasBackend
        && hasProfileRef
        && metadataString(meta, 'compatibility_tier')
        && live2dCapabilityProfileRef(input)
        ? { status: 'passed', reasonCode: null }
        : { status: 'unsupported', reasonCode: 'live2d_capability_profile_missing' };
    case AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX:
    case AvatarDebugProbeKind.GENERATED_MOTION:
      if (input.backendKind === 'vrm') {
        return supportedRoutes.length > 0
          ? { status: 'passed', reasonCode: null }
          : { status: 'unsupported', reasonCode: 'generated_motion_route_support_missing' };
      }
      if (input.backendKind === 'nimi2d') {
        return hasBackend && nimi2dLaneSupported(input, 'gesture_motion')
        ? { status: 'passed', reasonCode: null }
        : { status: 'unsupported', reasonCode: 'generated_motion_route_support_missing' };
      }
      return { status: 'unsupported', reasonCode: 'generated_motion_not_supported_by_backend' };
    case AvatarDebugProbeKind.EMOTION_EXPRESSION:
      if (input.backendKind === 'vrm') {
        return profile?.expressionManagerPresent === true
          || metadataBoolean(meta, 'expression_manager_present')
          ? { status: 'passed', reasonCode: null }
          : { status: 'unsupported', reasonCode: 'expression_manager_missing' };
      }
      if (input.backendKind === 'nimi2d') {
        return hasBackend && nimi2dLaneSupported(input, 'expression')
          ? { status: 'passed', reasonCode: null }
          : { status: 'unsupported', reasonCode: 'expression_lane_missing' };
      }
      return hasBackend
        && metadataString(meta, 'adapter_id')
        && metadataBoolean(meta, 'expression_stack_supported')
        && metadataString(meta, 'expression_inventory_ref')
        ? { status: 'passed', reasonCode: null }
        : { status: 'unsupported', reasonCode: 'live2d_expression_inventory_missing' };
    case AvatarDebugProbeKind.SPEECH_LIPSYNC:
      if (input.backendKind === 'live2d') {
        return hasBackend
          && metadataBoolean(meta, 'lipsync_profile_present')
          && live2dLipsyncEvidenceRef(input)
          ? { status: 'passed', reasonCode: null }
          : { status: 'unsupported', reasonCode: 'live2d_lipsync_evidence_missing' };
      }
      if (input.backendKind === 'nimi2d') {
        return hasBackend && nimi2dLaneSupported(input, 'speech_mouth')
          ? { status: 'passed', reasonCode: null }
          : { status: 'unsupported', reasonCode: 'lipsync_profile_missing' };
      }
      return hasBackend && metadataBoolean(meta, 'lipsync_profile_present')
        ? { status: 'passed', reasonCode: null }
        : { status: 'unsupported', reasonCode: 'lipsync_profile_missing' };
    case AvatarDebugProbeKind.WINDOW_HIT_REGION:
      if (input.backendKind === 'live2d') {
        return hasBackend
          && hasValidBounds(input)
          && carrierVisualEvidenceRef(input)
          && carrierPreviewArtifactRef(input)
          && live2dHitRegionEvidenceRef(input)
          ? { status: 'passed', reasonCode: null }
          : { status: 'failed', reasonCode: 'live2d_visual_hit_region_evidence_missing' };
      }
      return hasBackend && hasValidBounds(input)
        ? { status: 'passed', reasonCode: null }
        : { status: 'failed', reasonCode: 'carrier_hit_region_unavailable' };
    default:
      return { status: 'invalid', reasonCode: 'probe_kind_not_admitted' };
  }
}

function routeRefs(input: AvatarDebugSessionInput): AvatarDebugEvidence['refs'] {
  return {
    routeIds: supportedVrmRouteIds(input),
    unsupportedRouteIds: unsupportedVrmRouteIds(input),
    backendCapabilityProfileRef: null,
    avatarPackageRef: null,
    carrierVisualEvidenceRef: carrierVisualEvidenceRef(input),
    carrierPreviewArtifactRef: carrierPreviewArtifactRef(input),
    live2dExpressionInventoryRef: live2dExpressionInventoryRef(input),
    live2dBackendLoadRef: live2dBackendLoadRef(input),
    live2dCapabilityProfileRef: live2dCapabilityProfileRef(input),
    live2dRouteSupportRef: live2dRouteSupportRef(input),
    live2dLipsyncEvidenceRef: live2dLipsyncEvidenceRef(input),
    live2dHitRegionEvidenceRef: live2dHitRegionEvidenceRef(input),
    live2dParameterLaneDiagnosticsRef: live2dParameterLaneDiagnosticsRef(input),
    live2dCalibrationRef: live2dCalibrationRef(input),
  };
}

export function createAvatarDebugSession(input: AvatarDebugSessionInput): AvatarDebugSession {
  assertNoForbiddenFields(input);
  const debugSessionId = requiredString(input.debugSessionId, 'debug_session_id');
  const runtimeProbeId = requiredString(input.runtimeProbe.probeId, 'runtime_probe_id');
  const agentId = requiredString(input.runtimeProbe.agentId, 'agent_id');
  if (!ADMITTED_PROBE_KINDS.has(input.runtimeProbe.probeKind)) {
    throw new Error(`avatar debug probe kind is not admitted: ${input.runtimeProbe.probeKind}`);
  }
  const evidenceKind = evidenceKindForProbe(input.runtimeProbe.probeKind);
  const evaluation = evaluateStatus(input);
  const refs = routeRefs(input);
  const avatarPackageRef = optionalString(input.avatarPackageRef);
  const backendCapabilityProfileRef = optionalString(input.backendCapabilityProfileRef);
  const observedAt = normalizeObservedAt(input.observedAt);
  return {
    debugSessionId,
    runtimeProbeId,
    agentId,
    avatarInstanceId: optionalString(input.avatarInstanceId),
    avatarPackageRef,
    backendCapabilityProfileRef,
    backendKind: input.backendKind,
    probeKind: input.runtimeProbe.probeKind,
    evidence: {
      evidenceId: `${debugSessionId}:${evidenceKind}`,
      evidenceKind,
      status: evaluation.status,
      source: backendSource(input),
      reasonCode: evaluation.reasonCode,
      refs: {
        ...refs,
        avatarPackageRef,
        backendCapabilityProfileRef,
      },
    },
    observedAt,
  };
}

export function evidenceRefsForAvatarDebugSession(session: AvatarDebugSession): string[] {
  const evidenceRefByKind: Partial<Record<AvatarDebugEvidenceKind, string>> = {
    backend_loaded: `backend_load_evidence_ref:${session.evidence.evidenceId}`,
    capability_profile_validated: `profile_validation_evidence_ref:${session.evidence.evidenceId}`,
    route_support_checked: `generated_motion_routes_ref:${session.evidence.evidenceId}`,
    generated_motion_checked: `avatar_backend_evidence_ref:${session.evidence.evidenceId}`,
    emotion_expression_checked: `avatar_backend_evidence_ref:${session.evidence.evidenceId}`,
    speech_lipsync_checked: `avatar_backend_evidence_ref:${session.evidence.evidenceId}`,
    carrier_diagnostics_checked: `avatar_carrier_diagnostics_ref:${session.evidence.evidenceId}`,
  };
  return [
    `avatar_debug_session_id:${session.debugSessionId}`,
    `runtime_probe_id:${session.runtimeProbeId}`,
    evidenceRefByKind[session.evidence.evidenceKind] ?? '',
    `avatar_backend_evidence_ref:${session.evidence.evidenceId}`,
    `avatar.debug.session/${session.debugSessionId}`,
    `avatar.debug.session-evidence/${session.evidence.evidenceId}`,
    session.avatarPackageRef ? `avatar.debug.package/${session.avatarPackageRef}` : '',
    session.backendCapabilityProfileRef ? `backend_capability_profile_ref:${session.backendCapabilityProfileRef}` : '',
    session.backendCapabilityProfileRef ? `avatar.debug.capability-profile/${session.backendCapabilityProfileRef}` : '',
    session.evidence.refs.carrierVisualEvidenceRef ? `avatar_carrier_visual_ref:${session.evidence.refs.carrierVisualEvidenceRef}` : '',
    session.evidence.refs.carrierPreviewArtifactRef ? `avatar_preview_artifact_ref:${session.evidence.refs.carrierPreviewArtifactRef}` : '',
    session.evidence.refs.live2dExpressionInventoryRef ? `live2d_expression_inventory_ref:${session.evidence.refs.live2dExpressionInventoryRef}` : '',
    session.evidence.refs.live2dBackendLoadRef ? `live2d_backend_load_ref:${session.evidence.refs.live2dBackendLoadRef}` : '',
    session.evidence.refs.live2dCapabilityProfileRef ? `live2d_capability_profile_ref:${session.evidence.refs.live2dCapabilityProfileRef}` : '',
    session.evidence.refs.live2dRouteSupportRef ? `live2d_route_support_ref:${session.evidence.refs.live2dRouteSupportRef}` : '',
    session.evidence.refs.live2dLipsyncEvidenceRef ? `live2d_lipsync_evidence_ref:${session.evidence.refs.live2dLipsyncEvidenceRef}` : '',
    session.evidence.refs.live2dHitRegionEvidenceRef ? `live2d_hit_region_ref:${session.evidence.refs.live2dHitRegionEvidenceRef}` : '',
    session.evidence.refs.live2dParameterLaneDiagnosticsRef ? `live2d_parameter_lane_ref:${session.evidence.refs.live2dParameterLaneDiagnosticsRef}` : '',
    session.evidence.refs.live2dCalibrationRef ? `live2d_calibration_ref:${session.evidence.refs.live2dCalibrationRef}` : '',
    ...session.evidence.refs.routeIds.map((routeId) => `avatar.debug.route/${routeId}`),
    ...session.evidence.refs.unsupportedRouteIds.map((routeId) => `avatar.debug.unsupported-route/${routeId}`),
  ].filter((value) => value.trim().length > 0);
}
