import {
  AlertCircle,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  Settings2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceConfigPatch,
  AgentCenterAppearanceCopy,
  AgentCenterAppearanceProjection,
  AgentCenterState,
} from '../types.js';
import {
  AgentButton,
  Card,
  Notice,
  SectionHeader,
  SectionShell,
  agentCenterSelectClassName,
  cnAgentCenter,
} from './AgentCenterPrimitives.js';

export interface AgentCenterAppearanceSectionProps {
  readonly state: AgentCenterState;
  readonly appearanceAdapter?: AgentCenterAppearanceAdapter | null;
  readonly copy?: AgentCenterAppearanceCopy;
}

type EvidenceState = 'ready' | 'pending' | 'missing' | 'blocked';
type SetupStepState = 'ready' | 'active' | 'idle' | 'blocked';

type SetupStep = {
  readonly label: string;
  readonly detail: string;
  readonly state: SetupStepState;
  readonly statusLabel: string;
};

type AppearanceSetupBlockedReason = 'scope-required' | 'bridge-unavailable' | 'configuration-unavailable';

type Live2dWorkbenchStatus =
  | EvidenceState
  | 'checking'
  | 'probe_required'
  | 'not_admitted'
  | 'effect_projection_pending';

type Live2dWorkbenchItem = {
  readonly id: 'preview_artifact' | 'model_framing' | 'render_policy' | 'expression_inventory' | 'adapter_manifest';
  readonly label: string;
  readonly detail: string;
  readonly status: Live2dWorkbenchStatus;
  readonly evidenceRef?: string | null;
};

const LIVE2D_DEBUG_SHORTCUTS = ['Backend', 'Profile', 'Routes', 'Motion', 'Emotion', 'Speech', 'Window'] as const;

const DEFAULT_APPEARANCE_COPY: Required<AgentCenterAppearanceCopy> = {
  appearanceTitle: 'Appearance',
  appearanceDescription: 'Configure this partner avatar, background, and dynamic effects.',
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
  instancePolicyLabel: 'Instance policy',
  generatedMotionLabel: 'Generated motion',
  launchModeLabel: 'Launch mode',
  debugProfileLabel: 'Debug profile',
};

function normalizeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Runtime appearance update failed.';
}

function resolveCopy(copy: AgentCenterAppearanceCopy | undefined): Required<AgentCenterAppearanceCopy> {
  return {
    ...DEFAULT_APPEARANCE_COPY,
    ...(copy || {}),
  };
}

function backendKind(appearance: AgentCenterAppearanceProjection): string {
  return (appearance.backendKind || 'live2d').toString().trim().toLowerCase() || 'live2d';
}

function backendLabel(appearance: AgentCenterAppearanceProjection): string {
  return backendKind(appearance).toUpperCase();
}

function blockedSetupReason(appearance: AgentCenterAppearanceProjection): AppearanceSetupBlockedReason | null {
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

function blockedSetupCopy(
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

function visibleDisabledReason(appearance: AgentCenterAppearanceProjection): string | null {
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

function evidenceTone(state: EvidenceState): string {
  if (state === 'ready') return 'border-emerald-100 bg-emerald-50/70 text-emerald-700';
  if (state === 'pending') return 'border-amber-100 bg-amber-50/80 text-amber-700';
  if (state === 'blocked') return 'border-rose-100 bg-rose-50/80 text-rose-700';
  return 'border-slate-100 bg-slate-50 text-slate-500';
}

function assetStatus(appearance: AgentCenterAppearanceProjection): EvidenceState {
  if (appearance.avatarAssetValid) return 'ready';
  if (appearance.avatarAssetChecking) return 'pending';
  return appearance.avatarAssetRef ? 'blocked' : 'missing';
}

function capabilityStatus(appearance: AgentCenterAppearanceProjection): EvidenceState {
  if (appearance.backendCapabilityProfileRef) return 'ready';
  return appearance.avatarAssetRef ? 'pending' : 'missing';
}

function live2dManifestStatus(appearance: AgentCenterAppearanceProjection): EvidenceState {
  return appearance.live2dAdapterManifestSource && appearance.live2dAdapterManifestSource !== 'none'
    ? 'ready'
    : appearance.avatarAssetRef
      ? 'missing'
      : 'missing';
}

function backgroundStatus(appearance: AgentCenterAppearanceProjection): EvidenceState {
  if (appearance.backgroundValid) return 'ready';
  if (appearance.backgroundChecking) return 'pending';
  return appearance.backgroundRef ? 'blocked' : 'missing';
}

function live2dStatusTone(status: Live2dWorkbenchStatus): string {
  if (status === 'ready') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (status === 'blocked') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (status === 'probe_required' || status === 'checking' || status === 'pending') return 'border-amber-100 bg-amber-50 text-amber-700';
  if (status === 'not_admitted' || status === 'effect_projection_pending') return 'border-sky-100 bg-sky-50 text-sky-700';
  return 'border-slate-100 bg-slate-50 text-slate-500';
}

function live2dStatusLabel(status: Live2dWorkbenchStatus): string {
  if (status === 'probe_required') return 'Probe required';
  if (status === 'not_admitted') return 'Not admitted';
  if (status === 'effect_projection_pending') return 'Effect pending';
  if (status === 'checking') return 'Checking';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function live2dProbeStatus(appearance: AgentCenterAppearanceProjection): Live2dWorkbenchStatus {
  if (appearance.avatarAssetChecking) return 'checking';
  if (!appearance.avatarAssetRef || !appearance.avatarAssetValid || !appearance.backendCapabilityProfileRef) return 'blocked';
  return 'probe_required';
}

function live2dCalibrationStatus(appearance: AgentCenterAppearanceProjection): Live2dWorkbenchStatus {
  if (appearance.avatarAssetChecking) return 'checking';
  if (!appearance.avatarAssetRef || !appearance.avatarAssetValid) return 'blocked';
  return 'effect_projection_pending';
}

function live2dAdapterWorkbenchStatus(appearance: AgentCenterAppearanceProjection): Live2dWorkbenchStatus {
  if (appearance.live2dAdapterManifestSource === 'external_sidecar_manifest') {
    return appearance.live2dAdapterManifestRef ? 'ready' : 'blocked';
  }
  if (appearance.live2dAdapterManifestSource === 'embedded_creator_manifest') return 'ready';
  return 'missing';
}

function buildLive2dWorkbenchItems(appearance: AgentCenterAppearanceProjection): readonly Live2dWorkbenchItem[] {
  const launchEvidenceReady = Boolean(
    appearance.avatarAssetRef
      && appearance.avatarAssetValid
      && appearance.backendCapabilityProfileRef,
  );
  const evidenceRequired = 'Local asset and backend capability evidence are required.';
  return [
    {
      id: 'preview_artifact',
      label: 'Preview artifact',
      detail: launchEvidenceReady ? 'Review through Runtime backend or window probe evidence.' : evidenceRequired,
      status: live2dProbeStatus(appearance),
    },
    {
      id: 'model_framing',
      label: 'Model framing',
      detail: launchEvidenceReady ? 'Calibration ref is projected as evidence; Avatar effect waits for payload/effect projection.' : evidenceRequired,
      status: live2dCalibrationStatus(appearance),
      evidenceRef: appearance.live2dCalibrationRef || null,
    },
    {
      id: 'render_policy',
      label: 'Render policy',
      detail: launchEvidenceReady ? 'Calibration ref is projected as evidence; Avatar effect waits for payload/effect projection.' : evidenceRequired,
      status: live2dCalibrationStatus(appearance),
      evidenceRef: appearance.live2dCalibrationRef || null,
    },
    {
      id: 'expression_inventory',
      label: 'Expression inventory',
      detail: appearance.backendCapabilityProfileRef ? 'Review through Runtime emotion probe evidence.' : 'Backend capability profile evidence is required.',
      status: live2dProbeStatus(appearance),
      evidenceRef: appearance.backendCapabilityProfileRef || null,
    },
    {
      id: 'adapter_manifest',
      label: 'Adapter manifest',
      detail: appearance.live2dAdapterManifestSource === 'external_sidecar_manifest'
        ? 'External sidecar ref is selected.'
        : appearance.live2dAdapterManifestSource === 'embedded_creator_manifest'
          ? 'Embedded creator manifest is selected.'
          : 'No adapter manifest is selected.',
      status: live2dAdapterWorkbenchStatus(appearance),
      evidenceRef: appearance.live2dAdapterManifestRef || null,
    },
  ];
}

function buildSetupSteps(
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

function EvidenceRow(props: {
  readonly label: string;
  readonly value: string;
  readonly state: EvidenceState;
}) {
  return (
    <div className="flex min-h-[42px] items-center gap-3 rounded-[10px] border border-slate-100 bg-white px-3 py-2">
      <span className={cnAgentCenter(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
        evidenceTone(props.state),
      )}>
        {props.state === 'ready' ? <Check className="h-3 w-3" /> : props.state === 'pending' ? '...' : props.state === 'blocked' ? '!' : '-'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-slate-800">{props.label}</div>
        <div className="truncate text-[10px] leading-4 text-slate-500">{props.value}</div>
      </div>
    </div>
  );
}

function SetupStepRow({ index, step }: { readonly index: number; readonly step: SetupStep }) {
  const markerClass = step.state === 'ready'
    ? 'border-emerald-100 bg-emerald-100 text-emerald-700'
    : step.state === 'active'
      ? 'border-amber-200 bg-amber-50 text-amber-600'
      : step.state === 'blocked'
        ? 'border-rose-100 bg-rose-50 text-rose-600'
        : 'border-slate-200 bg-slate-50 text-slate-500';
  return (
    <li className="flex min-w-0 items-start gap-3 border-t border-slate-100 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className={cnAgentCenter('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[12px] font-semibold tabular-nums', markerClass)}>
        {step.state === 'ready' ? <Check className="h-4 w-4" /> : index}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="min-w-0 text-[13px] font-semibold leading-5 text-slate-950">{step.label}</span>
        <span className="min-w-0 text-[11.5px] leading-5 text-slate-500">{step.detail}</span>
      </span>
      <span className={cnAgentCenter(
        'mt-1 shrink-0 text-[11px] font-semibold',
        step.state === 'ready' && 'text-emerald-600',
        step.state === 'active' && 'text-amber-500',
        step.state === 'blocked' && 'text-rose-500',
        step.state === 'idle' && 'text-slate-400',
      )}>
        {step.statusLabel}
      </span>
    </li>
  );
}

function SelectControl<TValue extends string>(props: {
  readonly label: string;
  readonly value: TValue;
  readonly disabled: boolean;
  readonly options: ReadonlyArray<{ readonly value: TValue; readonly label: string }>;
  readonly onChange: (value: TValue) => void;
}) {
  return (
    <label className="block rounded-[10px] border border-slate-100 bg-white px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase text-slate-500">
        {props.label}
      </span>
      <select
        className={cnAgentCenter(agentCenterSelectClassName, 'mt-1 w-full')}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value as TValue)}
        value={props.value}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function DiagnosticsWorkbench({ appearance }: { readonly appearance: AgentCenterAppearanceProjection }) {
  if (backendKind(appearance) !== 'live2d') {
    return null;
  }
  const reviewItems = buildLive2dWorkbenchItems(appearance);
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {reviewItems.map((item) => (
          <div className="rounded-[10px] border border-slate-100 bg-white px-3 py-2" key={item.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[11px] font-semibold text-slate-800">{item.label}</div>
                <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{item.detail}</div>
              </div>
              <span className={cnAgentCenter(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                live2dStatusTone(item.status),
              )}>
                {live2dStatusLabel(item.status)}
              </span>
            </div>
            {item.evidenceRef ? (
              <div className="mt-2 truncate text-[10px] leading-4 text-slate-400">
                Evidence ref: {item.evidenceRef}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="rounded-[10px] border border-slate-100 bg-slate-50 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase text-slate-500">Debug probe shortcuts</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LIVE2D_DEBUG_SHORTCUTS.map((shortcut) => (
            <span
              className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700"
              data-agent-center-live2d-debug-shortcut={shortcut.toLowerCase()}
              key={shortcut}
            >
              {shortcut}
            </span>
          ))}
        </div>
      </div>
      {appearance.live2dCalibrationRef ? (
        <div className="truncate rounded-[10px] border border-slate-100 bg-white px-3 py-2 text-[10px] font-semibold text-slate-500">
          Calibration ref: {appearance.live2dCalibrationRef}
        </div>
      ) : null}
    </div>
  );
}

export function AgentCenterAppearanceSection({ state, appearanceAdapter, copy }: AgentCenterAppearanceSectionProps) {
  const labels = useMemo(() => resolveCopy(copy), [copy]);
  const [appearance, setAppearance] = useState(state.appearance);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setAppearance(state.appearance);
  }, [state.appearance]);

  const avatarImportDisabled = Boolean(appearance.avatarImportDisabled || !appearanceAdapter?.importAvatarAsset);
  const live2dManifestDisabled = Boolean(
    avatarImportDisabled
      || !appearance.avatarAssetRef
      || backendKind(appearance) !== 'live2d'
      || !appearanceAdapter?.linkLive2dAdapterManifest,
  );
  const backgroundImportDisabled = Boolean(appearance.backgroundImportDisabled || !appearanceAdapter?.importBackground);
  const avatarConfigDisabled = Boolean(appearance.avatarConfigPending || !appearanceAdapter?.updateAvatarConfig);
  const avatarReady = Boolean(appearance.avatarAssetRef && appearance.avatarAssetValid);
  const sidecarReady = backendKind(appearance) !== 'live2d' || live2dManifestStatus(appearance) === 'ready';
  const setupSteps = buildSetupSteps(appearance, labels);
  const completedSteps = setupSteps.filter((step) => step.state === 'ready').length;
  const progressWidth = `${Math.round((completedSteps / setupSteps.length) * 100)}%`;
  const setupBlockedReason = blockedSetupReason(appearance);
  const readableDisabledReason = visibleDisabledReason(appearance);
  const adapterDisplay = appearance.live2dAdapterManifestSource === 'external_sidecar_manifest'
    ? 'External sidecar linked'
    : appearance.live2dAdapterManifestSource === 'embedded_creator_manifest'
      ? 'Embedded'
      : 'Not selected';
  const backgroundState = backgroundStatus(appearance);

  const run = (
    label: string,
    action: (() => Promise<AgentCenterAppearanceProjection>) | undefined,
    success: (projection: AgentCenterAppearanceProjection) => string,
  ) => {
    if (!action) {
      setStatus(`${label} adapter unavailable.`);
      return;
    }
    setStatus(`${label}...`);
    void action()
      .then((projection) => {
        setAppearance(projection);
        setStatus(success(projection));
      })
      .catch((error: unknown) => setStatus(normalizeError(error)));
  };

  const importAvatarAsset = (kind: 'live2d' | 'vrm') => {
    run(
      kind === 'live2d' ? labels.importLive2dTitle : labels.importVrmTitle,
      appearanceAdapter?.importAvatarAsset ? () => appearanceAdapter.importAvatarAsset?.(kind) as Promise<AgentCenterAppearanceProjection> : undefined,
      () => kind === 'live2d' ? labels.live2dImported : labels.importOtherFormat,
    );
  };

  const importBackground = () => {
    run(
      labels.uploadBackground,
      appearanceAdapter?.importBackground ? () => appearanceAdapter.importBackground?.() as Promise<AgentCenterAppearanceProjection> : undefined,
      () => labels.backgroundReady,
    );
  };

  const updateAvatarConfig = (patch: AgentCenterAppearanceConfigPatch) => {
    run(
      labels.technicalDetailsTitle,
      appearanceAdapter?.updateAvatarConfig ? () => appearanceAdapter.updateAvatarConfig?.(patch) as Promise<AgentCenterAppearanceProjection> : undefined,
      () => labels.doneLabel,
    );
  };

  const toggleAutoplay = () => {
    run(
      labels.avatarAutoplayLabel,
      appearanceAdapter?.setAvatarAutoplay ? () => appearanceAdapter.setAvatarAutoplay?.(!appearance.avatarAutoplay) as Promise<AgentCenterAppearanceProjection> : undefined,
      (projection) => projection.avatarAutoplay ? labels.enableLabel : labels.disableLabel,
    );
  };

  const continueSetup = () => {
    if (!appearance.avatarAssetRef) {
      importAvatarAsset('live2d');
      return;
    }
    run(
      labels.selectSidecar,
      appearanceAdapter?.linkLive2dAdapterManifest ? () => appearanceAdapter.linkLive2dAdapterManifest?.() as Promise<AgentCenterAppearanceProjection> : undefined,
      () => labels.doneLabel,
    );
  };

  const showSupportedFormats = () => {
    setStatus(labels.supportedFormatsLabel);
  };

  const renderAvatarPreview = (configured: boolean) => {
    const kindLabel = backendKind(appearance) === 'vrm' ? '3D' : '2D';
    return (
      <div
        className={cnAgentCenter(
          'relative grid min-h-[184px] place-items-center overflow-hidden rounded-[14px] border bg-gradient-to-br from-white via-emerald-50/35 to-white text-emerald-700',
          configured ? 'border-emerald-200 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.08)]' : 'border-emerald-100',
        )}
        data-agent-center-appearance-avatar-preview={configured ? 'configured' : 'empty'}
      >
        <div className="grid h-[112px] w-[112px] place-items-center rounded-full border border-emerald-100 bg-white/80 shadow-[0_12px_28px_rgba(16,185,129,0.10)]">
          {configured ? (
            <span className="text-[34px] font-semibold leading-none">{kindLabel}</span>
          ) : (
            <ImageIcon aria-hidden="true" className="h-10 w-10 text-emerald-300" />
          )}
        </div>
        <span className="absolute bottom-5 text-[15px] font-semibold text-emerald-700/50">
          {kindLabel}
        </span>
      </div>
    );
  };

  const renderAvatarCard = (configured: boolean) => (
    <div data-agent-center-appearance-avatar-card="true">
      <Card className="border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <h3 className="m-0 text-[16px] font-semibold leading-6 text-slate-950">{labels.avatarCardTitle}</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(150px,0.78fr)_minmax(0,1fr)]">
          {renderAvatarPreview(configured)}

          <div className="flex min-w-0 flex-col justify-center gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[16px] font-semibold leading-6 text-slate-950">
                {configured ? (
                  <>
                    {labels.currentAvatarPrefix}: <span className="text-emerald-600">{backendLabel(appearance)}</span>
                  </>
                ) : labels.avatarUnsetTitle}
              </p>
              {configured ? (
                <div className="mt-3 flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-slate-600">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{labels.assetImported}</span>
                </div>
              ) : null}
              <p className="m-0 mt-2 text-[12.5px] leading-5 text-slate-600">
                {configured ? labels.avatarReadyHint : labels.avatarUnsetDescription}
              </p>
            </div>

            {configured ? (
              <div className="grid gap-2">
                <AgentButton
                  className="h-10 w-full rounded-[12px] border-emerald-500 bg-emerald-500 px-4 text-[13px] text-white shadow-[0_10px_20px_rgba(16,185,129,0.18)] hover:bg-emerald-600 disabled:border-emerald-200 disabled:bg-emerald-200 disabled:text-white/70 disabled:shadow-none"
                  dataAttrs={{ 'data-agent-center-appearance-primary-action': 'continue' }}
                  disabled={avatarReady && sidecarReady ? true : live2dManifestDisabled}
                  onClick={continueSetup}
                >
                  <FolderOpen aria-hidden="true" className="h-4 w-4" />
                  {labels.continueSetup}
                </AgentButton>
                <AgentButton
                  className="h-9 w-full rounded-[12px] px-4 text-[12.5px]"
                  dataAttrs={{ 'data-agent-center-appearance-secondary-action': 'change' }}
                  disabled={avatarImportDisabled}
                  onClick={() => importAvatarAsset(backendKind(appearance) === 'vrm' ? 'vrm' : 'live2d')}
                >
                  {labels.changeAvatar}
                </AgentButton>
              </div>
            ) : (
              <div className="grid gap-2">
                <AgentButton
                  className="h-11 w-full rounded-[12px] border-emerald-500 bg-emerald-500 px-4 text-[13px] text-white shadow-[0_10px_20px_rgba(16,185,129,0.18)] hover:bg-emerald-600 disabled:border-emerald-200 disabled:bg-emerald-200 disabled:text-white/70 disabled:shadow-none"
                  disabled={avatarImportDisabled}
                  onClick={() => importAvatarAsset('live2d')}
                >
                  <FolderOpen aria-hidden="true" className="h-4 w-4" />
                  {labels.importLive2dButton}
                </AgentButton>
                <AgentButton
                  className="h-10 w-full rounded-[12px] px-4 text-[13px]"
                  disabled={avatarImportDisabled}
                  onClick={() => importAvatarAsset('vrm')}
                >
                  <Box aria-hidden="true" className="h-4 w-4" />
                  {labels.importVrmButton}
                </AgentButton>
                <div className="mt-1 grid gap-1 text-[11.5px] leading-4 text-slate-500">
                  <span>{labels.supportedFormatsLabel}</span>
                  <button
                    className="inline-flex w-fit items-center gap-1 text-[11.5px] font-semibold text-emerald-700 transition-colors hover:text-emerald-800"
                    onClick={showSupportedFormats}
                    type="button"
                  >
                    {labels.viewSupportedFormats}
                    <ExternalLink aria-hidden="true" className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );

  if (setupBlockedReason) {
    const blocked = blockedSetupCopy(setupBlockedReason, labels);
    return (
      <SectionShell labelledBy="agent-center-appearance-title">
        <SectionHeader
          description={labels.appearanceDescription}
          id="agent-center-appearance-title"
          title={labels.appearanceTitle}
        />

        <div className="grid min-w-0 gap-3" data-agent-center-appearance-surface="blocked">
          <div data-agent-center-appearance-blocked={setupBlockedReason}>
          <Card className="border-amber-100 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
            <div className="flex min-w-0 gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-amber-50 text-amber-600">
                <AlertCircle aria-hidden="true" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[15px] font-semibold leading-6 text-slate-950">{blocked.title}</p>
                <p className="m-0 mt-1 text-[12.5px] leading-5 text-slate-600">{blocked.description}</p>
                <p className="m-0 mt-3 text-[12px] leading-5 text-slate-500">{blocked.hint}</p>
              </div>
            </div>
          </Card>
          </div>
          {status ? <Notice>{status}</Notice> : null}
        </div>
      </SectionShell>
    );
  }

  if (!appearance.avatarAssetRef) {
    return (
      <SectionShell labelledBy="agent-center-appearance-title">
        <SectionHeader
          description={labels.appearanceDescription}
          id="agent-center-appearance-title"
          title={labels.appearanceTitle}
        />

        <div className="grid min-w-0 gap-3" data-agent-center-appearance-surface="import-first">
          <div data-agent-center-appearance-hero="character-import">
            {renderAvatarCard(false)}
          </div>

          {readableDisabledReason ? <Notice tone="warn">{readableDisabledReason}</Notice> : null}
          {appearance.avatarImportError ? <Notice tone="warn">{appearance.avatarImportError}</Notice> : null}

          {status ? <Notice>{status}</Notice> : null}
        </div>
      </SectionShell>
    );
  }

  return (
    <SectionShell labelledBy="agent-center-appearance-title">
      <SectionHeader
        description={labels.appearanceDescription}
        id="agent-center-appearance-title"
        title={labels.appearanceTitle}
      />

      <div className="grid min-w-0 gap-3" data-agent-center-appearance-surface="visual-setup">
        <div data-agent-center-appearance-hero={avatarReady ? 'character-preview' : 'character-import'}>
          {renderAvatarCard(true)}
        </div>

        {readableDisabledReason ? <Notice tone="warn">{readableDisabledReason}</Notice> : null}
        {appearance.avatarImportError ? <Notice tone="warn">{appearance.avatarImportError}</Notice> : null}

        <div data-agent-center-appearance-progress="display-checklist">
        <Card className="border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">{labels.progressTitle}</h3>
            <span className="shrink-0 text-[12px] font-semibold text-slate-500">
              {labels.progressCompleteLabel} {completedSteps} / {setupSteps.length}
            </span>
          </div>
          <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
              data-agent-center-appearance-progress-bar="true"
              style={{ width: progressWidth }}
            />
          </div>
          <ol className="m-0 list-none p-0">
            {setupSteps.map((step, index) => (
              <SetupStepRow index={index + 1} key={step.label} step={step} />
            ))}
          </ol>
          <button
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-emerald-500 bg-emerald-500 px-4 text-[13px] font-semibold text-white shadow-[0_10px_20px_rgba(16,185,129,0.20)] transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:bg-emerald-200 disabled:text-white/70 disabled:shadow-none"
            disabled={live2dManifestDisabled || sidecarReady}
            onClick={continueSetup}
            type="button"
          >
            <FolderOpen aria-hidden="true" className="h-4 w-4" />
            {labels.selectSidecar}
          </button>
        </Card>
        </div>

        <div data-agent-center-appearance-background="chat-scene">
        <Card className="border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
            <div className="min-w-0">
              <h3 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">{labels.chatBackgroundTitle}</h3>
              <p className="m-0 mt-2 max-w-[230px] text-[12px] leading-5 text-slate-500">{labels.chatBackgroundDescription}</p>
              <span className={cnAgentCenter(
                'mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold',
                backgroundState === 'ready' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
              )}>
                {backgroundState === 'ready' ? labels.backgroundReady : labels.backgroundUnset}
              </span>
            </div>
            <div
              className="grid min-h-[102px] place-items-center overflow-hidden rounded-[12px] border border-emerald-100 bg-emerald-50/60 text-emerald-600"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.92), rgba(232,247,239,0.92))',
              }}
            >
              <ImageIcon aria-hidden="true" className="h-9 w-9 opacity-80" />
            </div>
          </div>
          {appearance.backgroundValidationMessage ? (
            <div className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
              {appearance.backgroundValidationMessage}
            </div>
          ) : null}
          {appearance.backgroundImportError ? (
            <div className="mt-3 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
              {appearance.backgroundImportError}
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 text-[12.5px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={backgroundImportDisabled}
              onClick={importBackground}
              type="button"
            >
              <ImagePlus aria-hidden="true" className="h-4 w-4" />
              {appearance.backgroundImportPending ? `${labels.uploadBackground}...` : labels.uploadBackground}
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
              disabled
              type="button"
            >
              <ImageIcon aria-hidden="true" className="h-4 w-4" />
              {labels.chooseRecommendedBackground}
            </button>
          </div>
        </Card>
        </div>

        <details
          className="group rounded-[14px] border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
          data-agent-center-appearance-diagnostics="collapsed"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold leading-6 text-slate-950">{labels.technicalDetailsTitle}</span>
              <span className="mt-1 block text-[12px] leading-5 text-slate-500">{labels.technicalDetailsDescription}</span>
            </span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-700 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3">
            <div className="grid gap-2">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-700">
                <Settings2 aria-hidden="true" className="h-4 w-4 text-slate-400" />
                {labels.diagnosticsEvidenceTitle}
              </div>
              <EvidenceRow
                label={labels.selectedAssetLabel}
                state={appearance.avatarAssetRef ? 'ready' : 'missing'}
                value={appearance.avatarAssetRef || labels.missingLabel}
              />
              <EvidenceRow
                label={labels.validationLabel}
                state={assetStatus(appearance)}
                value={(appearance.validationStatus || (appearance.avatarAssetRef ? 'unchecked' : 'selection_missing')).replaceAll('_', ' ')}
              />
              <EvidenceRow
                label={labels.capabilityProfileLabel}
                state={capabilityStatus(appearance)}
                value={appearance.backendCapabilityProfileRef ? labels.linkedLabel : labels.pendingEvidenceLabel}
              />
              {backendKind(appearance) === 'live2d' ? (
                <EvidenceRow
                  label={labels.live2dManifestLabel}
                  state={live2dManifestStatus(appearance)}
                  value={adapterDisplay}
                />
              ) : null}
            </div>

            {appearance.validationIssueRows && appearance.validationIssueRows.length > 0 ? (
              <div className="rounded-[10px] bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">
                {appearance.validationIssueRows.map((issue) => (
                  <div className="break-words" key={issue}>{issue}</div>
                ))}
              </div>
            ) : null}

            <DiagnosticsWorkbench appearance={appearance} />

            <div className="grid gap-2">
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-[12px] bg-slate-50 px-3 py-2.5">
                <div className="grid min-w-0 gap-0.5">
                  <span className="text-[13px] font-semibold text-slate-950">{labels.avatarAutoplayLabel}</span>
                  <span className="text-[12px] text-slate-600">{labels.avatarAutoplayDescription}</span>
                </div>
                <AgentButton
                  dataAttrs={{ 'data-agent-center-avatar-autoplay': 'true' }}
                  disabled={!appearanceAdapter?.setAvatarAutoplay}
                  onClick={toggleAutoplay}
                  variant={appearance.avatarAutoplay ? 'accent' : 'default'}
                >
                  {appearance.avatarAutoplay ? labels.disableLabel : labels.enableLabel}
                </AgentButton>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3 rounded-[12px] bg-slate-50 px-3 py-2.5">
                <div className="grid min-w-0 gap-0.5">
                  <span className="text-[13px] font-semibold text-slate-950">{labels.voiceArtifactsLabel}</span>
                  <span className="text-[12px] text-slate-600">{labels.voiceArtifactsDescription}</span>
                </div>
                <AgentButton
                  disabled={!appearanceAdapter?.cleanupGeneratedVoiceArtifacts || appearance.voiceCleanupPending}
                  onClick={() => run(
                    labels.voiceArtifactsLabel,
                    appearanceAdapter?.cleanupGeneratedVoiceArtifacts ? () => appearanceAdapter.cleanupGeneratedVoiceArtifacts?.() as Promise<AgentCenterAppearanceProjection> : undefined,
                    () => labels.doneLabel,
                  )}
                  variant="default"
                >
                  {appearance.voiceCleanupPending ? labels.cleaningLabel : labels.cleanupLabel}
                </AgentButton>
              </div>
              {appearance.voiceCleanupError ? <Notice tone="warn">{appearance.voiceCleanupError}</Notice> : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <SelectControl
                disabled={avatarConfigDisabled}
                label={labels.instancePolicyLabel}
                onChange={(avatar_instance_policy) => updateAvatarConfig({ avatar_instance_policy })}
                options={[
                  { value: 'reuse_active_instance', label: 'Reuse active' },
                  { value: 'launch_new_instance', label: 'Launch new' },
                  { value: 'require_user_selection', label: 'Ask every time' },
                ]}
                value={(appearance.avatarInstancePolicy || 'reuse_active_instance') as 'reuse_active_instance' | 'launch_new_instance' | 'require_user_selection'}
              />
              <SelectControl
                disabled={avatarConfigDisabled}
                label={labels.generatedMotionLabel}
                onChange={(generated_motion_provider_policy) => updateAvatarConfig({ generated_motion_provider_policy })}
                options={[
                  { value: 'require_profile_support', label: 'Require profile' },
                  { value: 'disable_generated_motion', label: 'Disabled' },
                  { value: 'debug_only', label: 'Debug only' },
                ]}
                value={(appearance.generatedMotionProviderPolicy || 'require_profile_support') as 'require_profile_support' | 'disable_generated_motion' | 'debug_only'}
              />
              <SelectControl
                disabled={avatarConfigDisabled}
                label={labels.launchModeLabel}
                onChange={(launch_mode) => updateAvatarConfig({ launch_mode })}
                options={[
                  { value: 'manual', label: 'Manual' },
                  { value: 'debug_session', label: 'Debug session' },
                  { value: 'start_with_chat', label: 'Start with chat' },
                ]}
                value={(appearance.launchMode || 'manual') as 'manual' | 'debug_session' | 'start_with_chat'}
              />
              <SelectControl
                disabled={avatarConfigDisabled || !appearance.developerModeEnabled}
                label={labels.debugProfileLabel}
                onChange={(debug_profile) => updateAvatarConfig({ debug_profile })}
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'strict_backend_evidence', label: 'Strict backend evidence' },
                  { value: 'route_matrix', label: 'Route matrix' },
                ]}
                value={(appearance.debugProfile || 'standard') as 'standard' | 'strict_backend_evidence' | 'route_matrix'}
              />
            </div>
            <div className="flex min-w-0 items-start gap-2 rounded-[10px] border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">
              <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0">
                Kit stores opaque Avatar/Runtime refs only. Avatar and Runtime own model digest, framing, scale, FPS, expression inventory, preview refs, and effect materialization.
              </span>
            </div>
          </div>
        </details>

        {status ? <Notice>{status}</Notice> : null}
      </div>
    </SectionShell>
  );
}
