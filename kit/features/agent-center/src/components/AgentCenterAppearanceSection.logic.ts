import type {
  AgentCenterAppearanceCopy,
  AgentCenterAppearanceProjection,
} from '../types.js';
import { isAgentCenterCommittedAppearanceReady } from '../appearance-render-readiness.js';
import { getAgentCenterCatalogRecord } from '../locales/index.js';
export type EvidenceState = 'ready' | 'pending' | 'missing' | 'blocked';
export type AgentCenterResolvedAppearanceBackendKind = 'live2d' | 'vrm' | 'nimi2d' | 'unknown';
type SetupStepState = 'ready' | 'active' | 'idle' | 'blocked';

export type SetupStep = {
  readonly label: string;
  readonly detail: string;
  readonly state: SetupStepState;
  readonly statusLabel: string;
};

export type AppearanceSetupBlockedReason = 'scope-required' | 'bridge-unavailable' | 'configuration-unavailable';

export type Live2dEvidenceStatus =
  | EvidenceState
  | 'checking'
  | 'probe_required'
  | 'not_admitted'
  | 'effect_projection_pending';

export type Live2dEvidenceItem = {
  readonly id: 'preview_output' | 'model_framing' | 'render_policy' | 'expression_inventory' | 'adapter_manifest';
  readonly label: string;
  readonly detail: string;
  readonly status: Live2dEvidenceStatus;
  readonly evidenceRef?: string | null;
};

const DEFAULT_APPEARANCE_COPY = getAgentCenterCatalogRecord('AgentCenter.appearance.') as Required<AgentCenterAppearanceCopy>;

export function normalizeError(error: unknown, copy: Required<AgentCenterAppearanceCopy>): string {
  return error instanceof Error && error.message ? error.message : copy.appearanceUpdateFailed;
}

export function resolveCopy(copy: AgentCenterAppearanceCopy | undefined): Required<AgentCenterAppearanceCopy> {
  return {
    ...DEFAULT_APPEARANCE_COPY,
    ...(copy || {}),
  };
}

export function backendKind(
  appearance: AgentCenterAppearanceProjection,
): AgentCenterResolvedAppearanceBackendKind {
  const normalized = (appearance.backendKind ?? '').toString().trim().toLowerCase();
  if (normalized === 'live2d' || normalized === 'vrm' || normalized === 'nimi2d') {
    return normalized;
  }
  return 'unknown';
}

export function backendLabel(appearance: AgentCenterAppearanceProjection): string {
  return backendKind(appearance).toUpperCase();
}

export function blockedSetupReason(appearance: AgentCenterAppearanceProjection): AppearanceSetupBlockedReason | null {
  if (appearance.avatarAssetRef || !appearance.avatarImportDisabled) {
    return null;
  }
  switch (appearance.disabledReasonCode) {
    case 'scope-required':
      return 'scope-required';
    case 'bridge-unavailable':
      return 'bridge-unavailable';
    case 'configuration-unavailable':
    case 'validation-unavailable':
      return 'configuration-unavailable';
    default:
      return null;
  }
}

export function blockedSetupCopy(
  reason: AppearanceSetupBlockedReason,
  labels: Required<AgentCenterAppearanceCopy>,
): { readonly title: string; readonly description: string; readonly hint: string } {
  if (reason === 'scope-required') {
    return {
      title: labels.blockedScopeTitle,
      description: labels.blockedScopeDescription,
      hint: labels.blockedScopeHint,
    };
  }
  if (reason === 'bridge-unavailable') {
    return {
      title: labels.blockedBridgeTitle,
      description: labels.blockedBridgeDescription,
      hint: labels.blockedBridgeHint,
    };
  }
  return {
    title: labels.blockedGenericTitle,
    description: labels.blockedGenericDescription,
    hint: labels.blockedGenericHint,
  };
}

export function visibleDisabledReason(appearance: AgentCenterAppearanceProjection): string | null {
  if (!appearance.disabledReasonCode || appearance.disabledReasonCode === 'avatar-not-configured') {
    return null;
  }
  const message = appearance.disabledReason?.trim();
  return message || null;
}

export function evidenceTone(state: EvidenceState): string {
  if (state === 'ready') return 'border-emerald-100 bg-emerald-50/70 text-emerald-700';
  if (state === 'pending') return 'border-amber-100 bg-amber-50/80 text-amber-700';
  if (state === 'blocked') return 'border-rose-100 bg-rose-50/80 text-rose-700';
  return 'border-slate-100 bg-slate-50 text-slate-500';
}

export function assetStatus(appearance: AgentCenterAppearanceProjection): EvidenceState {
  if (appearance.avatarAssetValid) return 'ready';
  if (appearance.avatarAssetChecking) return 'pending';
  return appearance.avatarAssetRef ? 'blocked' : 'missing';
}

export function capabilityStatus(appearance: AgentCenterAppearanceProjection): EvidenceState {
  if (appearance.backendCapabilityProfileRef) return 'ready';
  return appearance.avatarAssetRef ? 'pending' : 'missing';
}

export function live2dManifestStatus(appearance: AgentCenterAppearanceProjection): EvidenceState {
  return appearance.live2dAdapterManifestSource && appearance.live2dAdapterManifestSource !== 'none'
    ? 'ready'
    : appearance.avatarAssetRef
      ? 'missing'
      : 'missing';
}

export function backgroundStatus(appearance: AgentCenterAppearanceProjection): EvidenceState {
  if (appearance.backgroundValid) return 'ready';
  if (appearance.backgroundChecking) return 'pending';
  return appearance.backgroundRef ? 'blocked' : 'missing';
}

export function live2dStatusTone(status: Live2dEvidenceStatus): string {
  if (status === 'ready') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (status === 'blocked') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (status === 'probe_required' || status === 'checking' || status === 'pending') return 'border-amber-100 bg-amber-50 text-amber-700';
  if (status === 'not_admitted' || status === 'effect_projection_pending') return 'border-sky-100 bg-sky-50 text-sky-700';
  return 'border-slate-100 bg-slate-50 text-slate-500';
}

export function live2dStatusLabel(
  status: Live2dEvidenceStatus,
  labels: Required<AgentCenterAppearanceCopy>,
): string {
  if (status === 'probe_required') return labels.live2dStatusProbeRequired;
  if (status === 'not_admitted') return labels.live2dStatusNotAdmitted;
  if (status === 'effect_projection_pending') return labels.live2dStatusEffectPending;
  if (status === 'checking') return labels.live2dStatusChecking;
  if (status === 'ready') return labels.live2dStatusReady;
  if (status === 'pending') return labels.live2dStatusPending;
  if (status === 'missing') return labels.live2dStatusMissing;
  if (status === 'blocked') return labels.live2dStatusBlocked;
  return status;
}

function live2dProbeStatus(appearance: AgentCenterAppearanceProjection): Live2dEvidenceStatus {
  if (appearance.avatarAssetChecking) return 'checking';
  if (!appearance.avatarAssetRef || !appearance.avatarAssetValid || !appearance.backendCapabilityProfileRef) return 'blocked';
  if (isAgentCenterCommittedAppearanceReady(appearance)) {
    return 'ready';
  }
  if (appearance.renderState === 'failed') return 'blocked';
  if (appearance.renderState === 'loading') return 'checking';
  return 'probe_required';
}

function live2dCalibrationStatus(appearance: AgentCenterAppearanceProjection): Live2dEvidenceStatus {
  if (appearance.avatarAssetChecking) return 'checking';
  if (!appearance.avatarAssetRef || !appearance.avatarAssetValid) return 'blocked';
  return 'effect_projection_pending';
}

function live2dAdapterEvidenceStatus(appearance: AgentCenterAppearanceProjection): Live2dEvidenceStatus {
  if (appearance.live2dAdapterManifestSource === 'external_sidecar_manifest') {
    return appearance.live2dAdapterManifestRef ? 'ready' : 'blocked';
  }
  if (appearance.live2dAdapterManifestSource === 'embedded_creator_manifest') return 'ready';
  return 'missing';
}

export function buildLive2dEvidenceItems(
  appearance: AgentCenterAppearanceProjection,
  labels: Required<AgentCenterAppearanceCopy>,
): readonly Live2dEvidenceItem[] {
  const launchEvidenceReady = Boolean(
    appearance.avatarAssetRef
      && appearance.avatarAssetValid
      && appearance.backendCapabilityProfileRef,
  );
  const renderReady = isAgentCenterCommittedAppearanceReady(appearance);
  const evidenceRequired = labels.live2dEvidenceRequired;
  return [
    {
      id: 'preview_output',
      label: labels.live2dPreviewOutputLabel,
      detail: renderReady ? labels.live2dPreviewReadyDetail : appearance.renderFailureReason || (launchEvidenceReady ? labels.live2dPreviewReadyDetail : evidenceRequired),
      status: live2dProbeStatus(appearance),
    },
    {
      id: 'model_framing',
      label: labels.live2dModelFramingLabel,
      detail: launchEvidenceReady ? labels.live2dCalibrationPendingDetail : evidenceRequired,
      status: live2dCalibrationStatus(appearance),
      evidenceRef: appearance.live2dCalibrationRef || null,
    },
    {
      id: 'render_policy',
      label: labels.live2dRenderPolicyLabel,
      detail: launchEvidenceReady ? labels.live2dCalibrationPendingDetail : evidenceRequired,
      status: live2dCalibrationStatus(appearance),
      evidenceRef: appearance.live2dCalibrationRef || null,
    },
    {
      id: 'expression_inventory',
      label: labels.live2dExpressionInventoryLabel,
      detail: appearance.backendCapabilityProfileRef ? labels.live2dEmotionReadyDetail : labels.live2dBackendRequiredDetail,
      status: live2dProbeStatus(appearance),
      evidenceRef: appearance.backendCapabilityProfileRef || null,
    },
    {
      id: 'adapter_manifest',
      label: labels.live2dAdapterManifestEvidenceLabel,
      detail: appearance.live2dAdapterManifestSource === 'external_sidecar_manifest'
        ? labels.live2dExternalSidecarSelected
        : appearance.live2dAdapterManifestSource === 'embedded_creator_manifest'
          ? labels.live2dEmbeddedManifestSelected
          : labels.live2dNoAdapterManifestSelected,
      status: live2dAdapterEvidenceStatus(appearance),
      evidenceRef: appearance.live2dAdapterManifestRef || null,
    },
  ];
}

export function buildSetupSteps(
  appearance: AgentCenterAppearanceProjection,
  copy: Required<AgentCenterAppearanceCopy>,
): readonly SetupStep[] {
  const resolvedBackendKind = backendKind(appearance);
  const backendConfigured = resolvedBackendKind !== 'unknown';
  const avatarReady = Boolean(backendConfigured && appearance.avatarAssetRef && appearance.avatarAssetValid);
  const validationReady = avatarReady && assetStatus(appearance) === 'ready';
  const sidecarReady = resolvedBackendKind === 'vrm'
    || resolvedBackendKind === 'nimi2d'
    || (resolvedBackendKind === 'live2d' && live2dManifestStatus(appearance) === 'ready');
  const sidecarActive = avatarReady && !sidecarReady;
  const displayReady = avatarReady && sidecarReady && isAgentCenterCommittedAppearanceReady(appearance);
  return [
    {
      label: copy.stepAssetTitle,
      detail: avatarReady ? copy.stepAssetReady : copy.stepAssetMissing,
      state: avatarReady ? 'ready' : appearance.avatarAssetChecking ? 'active' : 'idle',
      statusLabel: avatarReady ? copy.doneLabel : appearance.avatarAssetChecking ? copy.pendingLabel : copy.notStartedLabel,
    },
    {
      label: copy.stepValidationTitle,
      detail: validationReady ? copy.stepValidationReady : copy.stepValidationMissing,
      state: validationReady ? 'ready' : appearance.avatarAssetRef ? 'blocked' : 'idle',
      statusLabel: validationReady ? copy.doneLabel : appearance.avatarAssetRef ? copy.pendingLabel : copy.notStartedLabel,
    },
    {
      label: copy.stepSidecarTitle,
      detail: sidecarReady ? copy.stepSidecarReady : copy.stepSidecarPending,
      state: sidecarReady ? 'ready' : sidecarActive ? 'active' : 'idle',
      statusLabel: sidecarReady ? copy.doneLabel : sidecarActive ? copy.pendingLabel : copy.notStartedLabel,
    },
    {
      label: copy.stepDisplayTitle,
      detail: displayReady ? copy.stepDisplayReady : copy.stepDisplayPending,
      state: displayReady ? 'ready' : sidecarReady && avatarReady ? 'active' : 'idle',
      statusLabel: displayReady ? copy.doneLabel : sidecarReady && avatarReady ? copy.pendingLabel : copy.notStartedLabel,
    },
  ];
}
