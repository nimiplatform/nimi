import { AvatarDebugProbeKind } from '@nimiplatform/sdk/runtime/generated';
import { recordAvatarEvidenceEventually } from '../app-shell/avatar-evidence.js';
import type { BackendBranch } from '@nimiplatform/kit/features/avatar/headless';
import {
  isVrmGeneratedRouteId,
  type VrmGeneratedRouteId,
} from '@nimiplatform/kit/features/avatar/vrm';
import type { VrmCapabilityProfile } from '../vrm/vrm-capability-profile.js';

export type AvatarDebugBackendKind = 'vrm' | 'live2d' | 'future';

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

function supportedVrmRouteIds(input: AvatarDebugSessionInput): VrmGeneratedRouteId[] {
  if (input.vrmCapabilityProfile) {
    return [...input.vrmCapabilityProfile.generatedMotion.supportedRoutes];
  }
  return metadataStringList(backendMetadata(input), 'generated_motion_routes')
    .filter(isVrmGeneratedRouteId);
}

function unsupportedVrmRouteIds(input: AvatarDebugSessionInput): string[] {
  if (input.vrmCapabilityProfile) {
    return input.vrmCapabilityProfile.generatedMotion.unsupportedRoutes.map((route) => route.routeId);
  }
  return metadataStringList(backendMetadata(input), 'unsupported_generated_motion_routes');
}

function evaluateStatus(input: AvatarDebugSessionInput): {
  status: AvatarDebugEvidenceStatus;
  reasonCode: string | null;
} {
  if (!ADMITTED_PROBE_KINDS.has(input.runtimeProbe.probeKind)) {
    return { status: 'invalid', reasonCode: 'probe_kind_not_admitted' };
  }
  if (input.backendKind === 'future') {
    return { status: 'unsupported', reasonCode: 'future_backend_not_admitted' };
  }

  const resolved = input.resolverEvidence ?? null;
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
        return (profile?.backendKind === 'vrm' && profile.profileId.trim())
          || metadataString(meta, 'capability_profile_id')
          ? { status: 'passed', reasonCode: null }
          : { status: 'failed', reasonCode: 'vrm_capability_profile_missing' };
      }
      return hasBackend && hasProfileRef && metadataString(meta, 'compatibility_tier')
        ? { status: 'passed', reasonCode: null }
        : { status: 'unsupported', reasonCode: 'live2d_capability_profile_missing' };
    case AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX:
    case AvatarDebugProbeKind.GENERATED_MOTION:
      if (input.backendKind !== 'vrm') {
        return { status: 'unsupported', reasonCode: 'generated_motion_not_supported_by_backend' };
      }
      return supportedRoutes.length > 0
        ? { status: 'passed', reasonCode: null }
        : { status: 'unsupported', reasonCode: 'generated_motion_route_support_missing' };
    case AvatarDebugProbeKind.EMOTION_EXPRESSION:
      if (input.backendKind === 'vrm') {
        return profile?.expressionManagerPresent === true
          || metadataBoolean(meta, 'expression_manager_present')
          ? { status: 'passed', reasonCode: null }
          : { status: 'unsupported', reasonCode: 'expression_manager_missing' };
      }
      return hasBackend && metadataString(meta, 'adapter_id')
        ? { status: 'passed', reasonCode: null }
        : { status: 'unsupported', reasonCode: 'live2d_expression_adapter_missing' };
    case AvatarDebugProbeKind.SPEECH_LIPSYNC:
      return hasBackend && metadataBoolean(meta, 'lipsync_profile_present')
        ? { status: 'passed', reasonCode: null }
        : { status: 'unsupported', reasonCode: 'lipsync_profile_missing' };
    case AvatarDebugProbeKind.WINDOW_HIT_REGION:
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
    observedAt: optionalString(input.observedAt) ?? new Date().toISOString(),
  };
}

export function recordAvatarDebugSessionEvidence(session: AvatarDebugSession): void {
  recordAvatarEvidenceEventually({
    kind: 'avatar.debug.session-evidence',
    detail: {
      debug_session_id: session.debugSessionId,
      runtime_probe_id: session.runtimeProbeId,
      agent_id: session.agentId,
      avatar_instance_id: session.avatarInstanceId,
      backend_kind: session.backendKind,
      probe_kind: session.probeKind,
      evidence_id: session.evidence.evidenceId,
      evidence_kind: session.evidence.evidenceKind,
      status: session.evidence.status,
      source: session.evidence.source,
      reason_code: session.evidence.reasonCode,
      route_ids: session.evidence.refs.routeIds,
      unsupported_route_ids: session.evidence.refs.unsupportedRouteIds,
      observed_at: session.observedAt,
    },
  });
}
