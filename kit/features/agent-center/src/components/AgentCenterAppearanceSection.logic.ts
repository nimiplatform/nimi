import type {
  AgentCenterAppearanceCopy,
  AgentCenterAppearanceProjection,
} from '../types.js';
export type EvidenceState = 'ready' | 'pending' | 'missing' | 'blocked';
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
  readonly id: 'preview_artifact' | 'model_framing' | 'render_policy' | 'expression_inventory' | 'adapter_manifest';
  readonly label: string;
  readonly detail: string;
  readonly status: Live2dEvidenceStatus;
  readonly evidenceRef?: string | null;
};

const DEFAULT_APPEARANCE_COPY: Required<AgentCenterAppearanceCopy> = {
  appearanceTitle: 'Appearance',
  appearanceDescription: 'Configure this partner avatar and chat background.',
  avatarCardTitle: 'Partner avatar',
  avatarUnsetTitle: 'Avatar is not set',
  avatarUnsetDescription: 'Import Live2D or VRM to show the partner preview here.',
  importLive2dButton: 'Import Live2D',
  importVrmButton: 'Import VRM',
  supportedFormatsLabel: 'Supports model3.json + textures, or .vrm files',
  viewSupportedFormats: 'View supported formats',
  currentAvatarPrefix: 'Current avatar',
  assetImported: 'Asset imported',
  avatarReadyHint: '1 step left before it can appear in chat.',
  avatarSetupHint: 'Import an avatar asset to show it in chat.',
  avatarMissingTitle: 'No avatar imported',
  avatarImportPrimary: 'Import avatar asset',
  blockedScopeTitle: 'Select a local partner before configuring appearance.',
  blockedScopeDescription: 'Appearance imports are scoped to one local partner, so choose a partner first.',
  blockedScopeHint: 'Live2D and VRM import controls will appear after the partner scope is available.',
  blockedBridgeTitle: 'Appearance configuration is unavailable.',
  blockedBridgeDescription: 'The local configuration bridge is not connected, so avatar imports cannot be written.',
  blockedBridgeHint: 'Restore the desktop runtime bridge before changing this partner appearance.',
  blockedGenericTitle: 'Appearance configuration is unavailable.',
  blockedGenericDescription: 'This state cannot safely write avatar configuration yet.',
  blockedGenericHint: 'Try again after selecting a ready local partner.',
  continueSetup: 'Continue setup',
  changeAvatar: 'Change avatar',
  progressTitle: 'Make the avatar visible',
  progressCompleteLabel: 'Complete',
  stepAssetTitle: 'Avatar asset imported',
  stepAssetReady: 'Live2D resource has been imported.',
  stepAssetMissing: 'Choose a Live2D folder or VRM file.',
  stepValidationTitle: 'File format verified',
  stepValidationReady: 'Model and config file format look correct.',
  stepValidationMissing: 'Validation will run after an avatar is selected.',
  stepSidecarTitle: 'Choose Live2D sidecar config',
  stepSidecarReady: 'Sidecar config is linked.',
  stepSidecarPending: 'Choose a sidecar file to enable the avatar.',
  stepDisplayTitle: 'Enable chat display',
  stepDisplayReady: 'Avatar can appear in chat.',
  stepDisplayPending: 'Enable after setup is complete.',
  doneLabel: 'Done',
  pendingLabel: 'Pending',
  notStartedLabel: 'Not started',
  selectSidecar: 'Select sidecar file',
  assetManagementTitle: 'Avatar management',
  importLive2dTitle: 'Import Live2D folder',
  importLive2dSubtitle: 'Supports model3.json + textures',
  live2dImported: 'Currently imported',
  importVrmTitle: 'Import VRM file',
  importVrmSubtitle: 'Supports a single .vrm file',
  importOtherFormat: 'Import another format',
  removeAvatar: 'Remove current avatar',
  chatBackgroundTitle: 'Chat background',
  chatBackgroundDescription: 'Set a dedicated background for this partner to make chat feel fresher.',
  backgroundUnset: 'Not set',
  backgroundReady: 'Ready',
  uploadBackground: 'Import background image',
  chooseRecommendedBackground: 'Choose recommended background',
  technicalDetailsTitle: 'Technical details',
  technicalDetailsDescription: 'View avatar resources, config, and diagnostic information.',
  diagnosticsEvidenceTitle: 'Evidence',
  selectedAssetLabel: 'Selected asset',
  validationLabel: 'Validation',
  capabilityProfileLabel: 'Capability profile',
  live2dManifestLabel: 'Live2D adapter manifest',
  linkedLabel: 'Linked',
  pendingEvidenceLabel: 'Pending evidence',
  missingLabel: 'Missing',
  avatarAutoplayLabel: 'Avatar autoplay',
  avatarAutoplayDescription: 'Launch handoff uses Runtime appearance projection.',
  enableLabel: 'Enable',
  disableLabel: 'Disable',
  voiceArtifactsLabel: 'Generated voice artifacts',
  voiceArtifactsDescription: 'Cleanup remains a typed Runtime/Avatar maintenance action.',
  cleanupLabel: 'Cleanup',
  cleaningLabel: 'Cleaning...',
  appearanceUpdateFailed: 'Runtime appearance update failed.',
  live2dStatusProbeRequired: 'Probe required',
  live2dStatusNotAdmitted: 'Not admitted',
  live2dStatusEffectPending: 'Effect pending',
  live2dStatusChecking: 'Checking',
  live2dStatusReady: 'Ready',
  live2dStatusPending: 'Pending',
  live2dStatusMissing: 'Missing',
  live2dStatusBlocked: 'Blocked',
  live2dPreviewArtifactLabel: 'Preview artifact',
  live2dModelFramingLabel: 'Model framing',
  live2dRenderPolicyLabel: 'Render policy',
  live2dExpressionInventoryLabel: 'Expression inventory',
  live2dAdapterManifestEvidenceLabel: 'Adapter manifest',
  live2dEvidenceRequired: 'Local asset and backend capability evidence are required.',
  live2dPreviewReadyDetail: 'Review through Runtime backend or window probe evidence.',
  live2dCalibrationPendingDetail: 'Calibration ref is projected as evidence; Avatar effect waits for payload/effect projection.',
  live2dEmotionReadyDetail: 'Review through Runtime emotion probe evidence.',
  live2dBackendRequiredDetail: 'Backend capability profile evidence is required.',
  live2dExternalSidecarSelected: 'External sidecar ref is selected.',
  live2dEmbeddedManifestSelected: 'Embedded creator manifest is selected.',
  live2dNoAdapterManifestSelected: 'No adapter manifest is selected.',
  evidenceRefLabel: 'Evidence ref',
  calibrationRefLabel: 'Calibration ref',
  custodyNotice: 'Kit stores opaque Avatar/Runtime refs only. Avatar and Runtime own model digest, framing, scale, FPS, expression inventory, preview refs, and effect materialization.',
  adapterUnavailableFormat: '{{label}} adapter unavailable.',
};

export function normalizeError(error: unknown, copy: Required<AgentCenterAppearanceCopy>): string {
  return error instanceof Error && error.message ? error.message : copy.appearanceUpdateFailed;
}

export function resolveCopy(copy: AgentCenterAppearanceCopy | undefined): Required<AgentCenterAppearanceCopy> {
  return {
    ...DEFAULT_APPEARANCE_COPY,
    ...(copy || {}),
  };
}

export function backendKind(appearance: AgentCenterAppearanceProjection): string {
  return (appearance.backendKind || 'live2d').toString().trim().toLowerCase() || 'live2d';
}

export function backendLabel(appearance: AgentCenterAppearanceProjection): string {
  return backendKind(appearance).toUpperCase();
}

export function blockedSetupReason(appearance: AgentCenterAppearanceProjection): AppearanceSetupBlockedReason | null {
  const disabledReason = (appearance.disabledReason || '').trim();
  if (appearance.avatarAssetRef || !appearance.avatarImportDisabled || !disabledReason) {
    return null;
  }
  if (disabledReason.includes('local-config-scope-required')) {
    return 'scope-required';
  }
  if (disabledReason.includes('local-config-bridge-unavailable')) {
    return 'bridge-unavailable';
  }
  return 'configuration-unavailable';
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
  const disabledReason = (appearance.disabledReason || '').trim();
  if (!disabledReason) {
    return null;
  }
  if (!appearance.avatarAssetRef && disabledReason === 'Avatar asset is not configured.') {
    return null;
  }
  if (disabledReason.startsWith('zhiyu-agent-center-')) {
    return null;
  }
  return disabledReason;
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
  if (appearance.previewState === 'ready' && appearance.previewTier === 'avatar_preview_service' && appearance.previewArtifactRef) {
    return 'ready';
  }
  if (appearance.previewState === 'failed') return 'blocked';
  if (appearance.previewState === 'loading') return 'checking';
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
  const previewReady = Boolean(
    appearance.previewState === 'ready'
      && appearance.previewTier === 'avatar_preview_service'
      && appearance.previewArtifactRef,
  );
  const evidenceRequired = labels.live2dEvidenceRequired;
  return [
    {
      id: 'preview_artifact',
      label: labels.live2dPreviewArtifactLabel,
      detail: previewReady ? labels.live2dPreviewReadyDetail : appearance.previewFailureReason || (launchEvidenceReady ? labels.live2dPreviewReadyDetail : evidenceRequired),
      status: live2dProbeStatus(appearance),
      evidenceRef: previewReady ? `avatar_preview_service:live2d:${appearance.previewArtifactRef}` : null,
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
  const avatarReady = Boolean(appearance.avatarAssetRef && appearance.avatarAssetValid);
  const validationReady = avatarReady && assetStatus(appearance) === 'ready';
  const sidecarReady = backendKind(appearance) !== 'live2d' || live2dManifestStatus(appearance) === 'ready';
  const sidecarActive = avatarReady && !sidecarReady;
  const displayReady = avatarReady && sidecarReady && appearance.status === 'ready';
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
