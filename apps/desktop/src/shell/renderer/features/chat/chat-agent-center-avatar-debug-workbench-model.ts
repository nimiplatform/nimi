import { type NimiRuntimeAgentCompanionParticipationProjection, type NimiRuntimeAgentCompanionParticipationSurfaceKind } from '@nimiplatform/sdk/runtime';
import type { AgentCenterAvatarAssetModule } from './chat-agent-center-avatar-config-types';

export const AvatarDebugProbeKind = {
  UNSPECIFIED: 0,
  PACKAGE_VALIDATION: 1,
  LAUNCH_READINESS: 2,
  BACKEND_LOAD: 3,
  CAPABILITY_PROFILE: 4,
  ROUTE_SUPPORT_MATRIX: 5,
  GENERATED_MOTION: 6,
  EMOTION_EXPRESSION: 7,
  SPEECH_LIPSYNC: 8,
  WINDOW_HIT_REGION: 9,
} as const;

export type AvatarDebugProbeKind = typeof AvatarDebugProbeKind[keyof typeof AvatarDebugProbeKind];

export const AvatarDebugProbeStatus = {
  UNSPECIFIED: 0,
  PASSED: 1,
  FAILED: 2,
  UNSUPPORTED: 3,
  BLOCKED: 4,
  INVALID: 5,
} as const;

export type AvatarDebugProbeStatus = typeof AvatarDebugProbeStatus[keyof typeof AvatarDebugProbeStatus];

export type AvatarDebugProbeResultEnvelope = {
  probeId: string;
  agentId?: string;
  conversationAnchorId?: string;
  probeKind: AvatarDebugProbeKind;
  status: AvatarDebugProbeStatus;
  evidenceRefs?: readonly string[];
  reasonCode?: string;
  resultId?: string;
};

export type AvatarDebugReplayRef = {
  probeId: string;
  replayRef?: string | null;
  redactionState?: number;
  visibility?: number;
};

export type AvatarDebugWorkbenchProbeKind = AvatarDebugProbeKind | 'runtime_replay';

export type AvatarDebugWorkbenchProbe = {
  kind: AvatarDebugWorkbenchProbeKind;
  runtimeProbeKind?: AvatarDebugProbeKind;
  label: string;
  summary: string;
};

export type AvatarDebugWorkbenchLaunchHealth = {
  status: 'ready' | 'checking' | 'needs_package' | 'needs_anchor' | 'runtime_unavailable';
  label: string;
  detail: string;
};

export type AvatarDebugWorkbenchDiagnostics = {
  backendKind: string;
  localAssetRefState: 'linked' | 'missing';
  profileRefState: 'linked' | 'pending';
  generatedMotionPolicy: string;
  debugProfile: string;
};

export type DesktopCompanionParticipationProjectionRequest = {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  surfaceKind: NimiRuntimeAgentCompanionParticipationSurfaceKind;
  triggerSource: 'user_explicit';
};

const PROBES: readonly AvatarDebugWorkbenchProbe[] = [
  {
    kind: AvatarDebugProbeKind.PACKAGE_VALIDATION,
    runtimeProbeKind: AvatarDebugProbeKind.PACKAGE_VALIDATION,
    label: 'Local asset',
    summary: 'Validate the selected local Avatar asset record.',
  },
  {
    kind: AvatarDebugProbeKind.LAUNCH_READINESS,
    runtimeProbeKind: AvatarDebugProbeKind.LAUNCH_READINESS,
    label: 'Launch',
    summary: 'Check readiness for the current conversation anchor.',
  },
  {
    kind: AvatarDebugProbeKind.BACKEND_LOAD,
    runtimeProbeKind: AvatarDebugProbeKind.BACKEND_LOAD,
    label: 'Backend',
    summary: 'Ask Runtime for backend load evidence.',
  },
  {
    kind: AvatarDebugProbeKind.CAPABILITY_PROFILE,
    runtimeProbeKind: AvatarDebugProbeKind.CAPABILITY_PROFILE,
    label: 'Profile',
    summary: 'Inspect capability profile evidence.',
  },
  {
    kind: AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
    runtimeProbeKind: AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX,
    label: 'Routes',
    summary: 'Inspect route support for this backend.',
  },
  {
    kind: AvatarDebugProbeKind.GENERATED_MOTION,
    runtimeProbeKind: AvatarDebugProbeKind.GENERATED_MOTION,
    label: 'Motion',
    summary: 'Check generated motion support.',
  },
  {
    kind: AvatarDebugProbeKind.EMOTION_EXPRESSION,
    runtimeProbeKind: AvatarDebugProbeKind.EMOTION_EXPRESSION,
    label: 'Emotion',
    summary: 'Check emotion and expression support.',
  },
  {
    kind: AvatarDebugProbeKind.SPEECH_LIPSYNC,
    runtimeProbeKind: AvatarDebugProbeKind.SPEECH_LIPSYNC,
    label: 'Speech',
    summary: 'Check speech and lipsync support.',
  },
  {
    kind: AvatarDebugProbeKind.WINDOW_HIT_REGION,
    runtimeProbeKind: AvatarDebugProbeKind.WINDOW_HIT_REGION,
    label: 'Window',
    summary: 'Check carrier window diagnostics.',
  },
  {
    kind: 'runtime_replay',
    label: 'Replay',
    summary: 'Inspect Runtime replay evidence coverage for debug probes.',
  },
];

export const AVATAR_DEBUG_WORKBENCH_PROBES = PROBES;

const REQUIRED_EVIDENCE_REFS_BY_PROBE_KIND: Partial<Record<AvatarDebugProbeKind, readonly string[]>> = {
  [AvatarDebugProbeKind.PACKAGE_VALIDATION]: ['local_avatar_asset_ref', 'import_validation_ref'],
  [AvatarDebugProbeKind.LAUNCH_READINESS]: ['runtime_authorization_ref', 'avatar_launch_payload_shape'],
  [AvatarDebugProbeKind.BACKEND_LOAD]: [
    'avatar_debug_session_id',
    'backend_load_evidence_ref',
    'avatar_carrier_visual_ref',
    'avatar_preview_artifact_ref',
  ],
  [AvatarDebugProbeKind.CAPABILITY_PROFILE]: ['backend_capability_profile_ref', 'profile_validation_evidence_ref'],
  [AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX]: ['generated_motion_routes_ref', 'backend_capability_profile_ref'],
  [AvatarDebugProbeKind.GENERATED_MOTION]: ['runtime_probe_id', 'avatar_backend_evidence_ref'],
  [AvatarDebugProbeKind.EMOTION_EXPRESSION]: ['runtime_probe_id', 'avatar_backend_evidence_ref'],
  [AvatarDebugProbeKind.SPEECH_LIPSYNC]: ['runtime_probe_id', 'avatar_backend_evidence_ref'],
  [AvatarDebugProbeKind.WINDOW_HIT_REGION]: [
    'avatar_carrier_diagnostics_ref',
    'avatar_carrier_visual_ref',
    'avatar_preview_artifact_ref',
  ],
};

export function buildAvatarDebugWorkbenchLaunchHealth(input: {
  avatarAssetValid: boolean;
  avatarAssetChecking: boolean;
  conversationAnchorId: string | null;
  routeReady: boolean;
}): AvatarDebugWorkbenchLaunchHealth {
  if (!input.conversationAnchorId) {
    return {
      status: 'needs_anchor',
      label: 'Needs anchor',
      detail: 'Open an agent conversation before running avatar debug probes.',
    };
  }
  if (input.avatarAssetChecking) {
    return {
      status: 'checking',
      label: 'Checking',
      detail: 'Desktop is validating the current local Avatar asset record.',
    };
  }
  if (!input.avatarAssetValid) {
    return {
      status: 'needs_package',
      label: 'Needs asset',
      detail: 'A selected local Avatar asset and backend evidence are required before probe execution.',
    };
  }
  if (!input.routeReady) {
    return {
      status: 'runtime_unavailable',
      label: 'Runtime pending',
      detail: 'Runtime route is not ready for avatar debug requests.',
    };
  }
  return {
    status: 'ready',
    label: 'Ready',
    detail: 'Runtime avatar debug probes can run through the typed SDK surface.',
  };
}

export function buildAvatarDebugWorkbenchDiagnostics(
  config: AgentCenterAvatarAssetModule | null,
): AvatarDebugWorkbenchDiagnostics {
  const backendKind = config?.backend_kind || 'live2d';
  return {
    backendKind,
    localAssetRefState: config?.local_avatar_asset_ref ? 'linked' : 'missing',
    profileRefState: config?.backend_capability_profile_ref ? 'linked' : 'pending',
    generatedMotionPolicy: config?.generated_motion_provider_policy || 'require_profile_support',
    debugProfile: config?.debug_profile || 'standard',
  };
}

export function avatarDebugProbeStatusLabel(status: AvatarDebugProbeStatus | undefined): string {
  switch (status) {
    case AvatarDebugProbeStatus.PASSED:
      return 'Passed';
    case AvatarDebugProbeStatus.FAILED:
      return 'Failed';
    case AvatarDebugProbeStatus.UNSUPPORTED:
      return 'Unsupported';
    case AvatarDebugProbeStatus.BLOCKED:
      return 'Blocked';
    case AvatarDebugProbeStatus.INVALID:
      return 'Invalid';
    default:
      return 'Pending';
  }
}

function normalizedEvidenceRefs(result: AvatarDebugProbeResultEnvelope | null | undefined): string[] {
  return Array.isArray(result?.evidenceRefs)
    ? result.evidenceRefs.filter((ref) => ref.trim().length > 0)
    : [];
}

function evidenceRefMatchesRequiredIdentity(ref: string, requiredIdentity: string): boolean {
  const normalized = ref.trim();
  return normalized === requiredIdentity || normalized.startsWith(`${requiredIdentity}:`);
}

export function avatarDebugProbeFailClosedReason(
  result: AvatarDebugProbeResultEnvelope | null | undefined,
  replayRef?: AvatarDebugReplayRef | null,
): string | null {
  if (result?.status !== AvatarDebugProbeStatus.PASSED) {
    return null;
  }
  const evidenceRefs = normalizedEvidenceRefs(result);
  const requiredEvidenceRefs = REQUIRED_EVIDENCE_REFS_BY_PROBE_KIND[result.probeKind] ?? [];
  if (
    requiredEvidenceRefs.length === 0
    || requiredEvidenceRefs.some((requiredIdentity) => (
      !evidenceRefs.some((ref) => evidenceRefMatchesRequiredIdentity(ref, requiredIdentity))
    ))
  ) {
    return 'required_probe_evidence_missing';
  }
  if (!replayRef?.replayRef?.trim()) {
    return 'runtime_replay_missing';
  }
  if (replayRef.probeId !== result.probeId) {
    return 'runtime_replay_probe_mismatch';
  }
  return null;
}

export function avatarDebugProbePresentationStatus(
  result: AvatarDebugProbeResultEnvelope | null | undefined,
  replayRef?: AvatarDebugReplayRef | null,
): AvatarDebugProbeStatus | undefined {
  return avatarDebugProbeFailClosedReason(result, replayRef)
    ? AvatarDebugProbeStatus.FAILED
    : result?.status;
}

export function avatarDebugProbePresentationStatusLabel(
  result: AvatarDebugProbeResultEnvelope | null | undefined,
  replayRef?: AvatarDebugReplayRef | null,
): string {
  return avatarDebugProbeStatusLabel(avatarDebugProbePresentationStatus(result, replayRef));
}

export function avatarDebugProbeRemediation(
  result: AvatarDebugProbeResultEnvelope | null | undefined,
  replayRef?: AvatarDebugReplayRef | null,
): string {
  const failClosedReason = avatarDebugProbeFailClosedReason(result, replayRef);
  if (failClosedReason === 'required_probe_evidence_missing') {
    return 'Required probe evidence is missing. Treat this probe as failed until Runtime returns every required evidence ref.';
  }
  if (failClosedReason === 'runtime_replay_missing') {
    return 'runtime_replay_missing: Runtime replay evidence is missing. Treat this probe as failed until Runtime returns a replay ref.';
  }
  if (failClosedReason === 'runtime_replay_probe_mismatch') {
    return 'runtime_replay_probe_mismatch: Runtime replay evidence belongs to a different probe. Treat this probe as failed until Runtime returns the matching replay ref.';
  }
  switch (result?.status) {
    case AvatarDebugProbeStatus.PASSED:
      return 'Evidence is linked and this probe is ready.';
    case AvatarDebugProbeStatus.UNSUPPORTED:
      return 'Select a backend/profile that supports this route, or disable the related capability policy.';
    case AvatarDebugProbeStatus.BLOCKED:
      return 'Runtime policy blocked this probe. Review approval, scope, and local asset validation state.';
    case AvatarDebugProbeStatus.INVALID:
      return 'The probe request was invalid. Refresh the conversation anchor and retry.';
    case AvatarDebugProbeStatus.FAILED:
      return 'Inspect local asset validation, backend load state, and capability profile evidence.';
    default:
      return 'Run a probe to produce Runtime-owned evidence and replay links.';
  }
}

export function buildDesktopCompanionParticipationProjectionRequest(input: {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  surfaceKind?: NimiRuntimeAgentCompanionParticipationSurfaceKind;
}): DesktopCompanionParticipationProjectionRequest {
  return {
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    surfaceKind: input.surfaceKind || 'avatar_debug_workbench',
    triggerSource: 'user_explicit',
  };
}

export function desktopCompanionParticipationStatusLabel(
  projection: NimiRuntimeAgentCompanionParticipationProjection | null | undefined,
): string {
  if (!projection) return 'Not requested';
  switch (projection.status) {
    case 'idle':
      return 'Idle';
    case 'admission_pending':
      return 'Admission pending';
    case 'blocked':
      return 'Blocked';
    case 'running':
      return 'Running';
    case 'candidate_ready':
      return 'Candidate ready';
    case 'committed_by_owner':
      return 'Committed';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    default:
      return 'Invalid';
  }
}

export function desktopCompanionParticipationRemediation(
  projection: NimiRuntimeAgentCompanionParticipationProjection | null | undefined,
): string {
  if (!projection) {
    return 'Refresh participation projection before treating this debug surface as ready.';
  }
  if (projection.status === 'blocked' || projection.status === 'failed' || projection.status === 'canceled') {
    return projection.refusalReason || `Runtime companion participation is ${projection.status}.`;
  }
  return 'Runtime companion participation projection is typed and visible to Desktop.';
}
