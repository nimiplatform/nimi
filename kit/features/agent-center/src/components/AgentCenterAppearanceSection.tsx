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
  PlayCircle,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  AgentCenterAvatarPreview,
  resolveAgentCenterAvatarPreviewServiceResult,
} from '@nimiplatform/kit/features/avatar';
import type {
  AgentCenterAppearanceAdapter,
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
  cnAgentCenter,
} from './AgentCenterPrimitives.js';
import type { EvidenceState, SetupStep } from './AgentCenterAppearanceSection.logic.js';
import {
  assetStatus,
  backendKind,
  backendLabel,
  backgroundStatus,
  blockedSetupCopy,
  blockedSetupReason,
  buildLive2dEvidenceItems,
  buildSetupSteps,
  capabilityStatus,
  evidenceTone,
  live2dManifestStatus,
  live2dStatusLabel,
  live2dStatusTone,
  normalizeError,
  resolveCopy,
  visibleDisabledReason,
} from './AgentCenterAppearanceSection.logic.js';

export interface AgentCenterAppearanceSectionProps {
  readonly state: AgentCenterState;
  readonly appearanceAdapter?: AgentCenterAppearanceAdapter | null;
  readonly copy?: AgentCenterAppearanceCopy;
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

function DiagnosticsEvidencePanel({
  appearance,
  labels,
}: {
  readonly appearance: AgentCenterAppearanceProjection;
  readonly labels: Required<AgentCenterAppearanceCopy>;
}) {
  if (backendKind(appearance) !== 'live2d') {
    return null;
  }
  const reviewItems = buildLive2dEvidenceItems(appearance, labels);
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
                {live2dStatusLabel(item.status, labels)}
              </span>
            </div>
            {item.evidenceRef ? (
              <div className="mt-2 truncate text-[10px] leading-4 text-slate-400">
                {labels.evidenceRefLabel}: {item.evidenceRef}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {appearance.live2dCalibrationRef ? (
        <div className="truncate rounded-[10px] border border-slate-100 bg-white px-3 py-2 text-[10px] font-semibold text-slate-500">
          {labels.calibrationRefLabel}: {appearance.live2dCalibrationRef}
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
  const clearAvatarDisabled = Boolean(!appearance.avatarAssetRef || !appearanceAdapter?.clearAvatarAsset);
  const live2dManifestDisabled = Boolean(
    avatarImportDisabled
      || !appearance.avatarAssetRef
      || backendKind(appearance) !== 'live2d'
      || !appearanceAdapter?.linkLive2dAdapterManifest,
  );
  const backgroundImportDisabled = Boolean(appearance.backgroundImportDisabled || !appearanceAdapter?.importBackground);
  const avatarReady = Boolean(appearance.avatarAssetRef && appearance.avatarAssetValid);
  const sidecarReady = backendKind(appearance) !== 'live2d' || live2dManifestStatus(appearance) === 'ready';
  const setupSteps = buildSetupSteps(appearance, labels);
  const completedSteps = setupSteps.filter((step) => step.state === 'ready').length;
  const progressWidth = `${Math.round((completedSteps / setupSteps.length) * 100)}%`;
  const setupBlockedReason = blockedSetupReason(appearance);
  const readableDisabledReason = visibleDisabledReason(appearance);
  const adapterDisplay = appearance.live2dAdapterManifestSource === 'external_sidecar_manifest'
    ? labels.live2dExternalSidecarSelected
    : appearance.live2dAdapterManifestSource === 'embedded_creator_manifest'
      ? labels.live2dEmbeddedManifestSelected
      : labels.missingLabel;
  const backgroundState = backgroundStatus(appearance);

  const run = (
    label: string,
    action: (() => Promise<AgentCenterAppearanceProjection>) | undefined,
    success: (projection: AgentCenterAppearanceProjection) => string,
  ) => {
    if (!action) {
      setStatus(labels.adapterUnavailableFormat.replace('{{label}}', label));
      return;
    }
    setStatus(`${label}...`);
    void action()
      .then((projection) => {
        setAppearance(projection);
        setStatus(success(projection));
      })
      .catch((error: unknown) => setStatus(normalizeError(error, labels)));
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
    const previewResult = resolveAgentCenterAvatarPreviewServiceResult({
      previewState: appearance.previewState,
      previewTier: appearance.previewTier,
      backendKind: appearance.backendKind,
      avatarAssetRef: appearance.avatarAssetRef,
      previewArtifactRef: appearance.previewArtifactRef,
      previewImageRef: appearance.previewImageRef,
      previewFailureReason: appearance.previewFailureReason,
      previewWarnings: appearance.previewWarnings,
    });
    const previewFailureReason = previewResult.state === 'ready' ? '' : previewResult.reason;
    return (
      <div
        className={cnAgentCenter(
          'relative grid min-h-[184px] place-items-center overflow-hidden rounded-[14px] border bg-gradient-to-br from-white via-emerald-50/35 to-white text-emerald-700',
          configured ? 'border-emerald-200 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.08)]' : 'border-emerald-100',
        )}
        data-agent-center-appearance-avatar-preview={configured ? 'configured' : 'empty'}
      >
        {configured ? (
          <AgentCenterAvatarPreview
            className="grid min-h-[132px] min-w-[132px] place-items-center"
            fallback={(
              <div className="grid h-[112px] w-[112px] place-items-center rounded-full border border-amber-100 bg-white/80 text-center text-[11px] font-semibold leading-4 text-amber-700 shadow-[0_12px_28px_rgba(245,158,11,0.10)]">
                {previewFailureReason}
              </div>
            )}
            label={labels.avatarCardTitle}
            result={previewResult}
            size="md"
          />
        ) : (
          <div className="grid h-[112px] w-[112px] place-items-center rounded-full border border-emerald-100 bg-white/80 shadow-[0_12px_28px_rgba(16,185,129,0.10)]">
            <ImageIcon aria-hidden="true" className="h-10 w-10 text-emerald-300" />
          </div>
        )}
        <span className="absolute bottom-5 text-[15px] font-semibold text-emerald-700/50">
          {configured && previewResult.state === 'ready' ? previewResult.backendKind.toUpperCase() : kindLabel}
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

  const renderProgressChecklist = () => (
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
  );

  const renderAssetManagement = () => (
    <div data-agent-center-appearance-management="asset-import">
      <Card className="border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <h3 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">{labels.assetManagementTitle}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <button
            className="group grid min-h-[118px] place-items-center gap-2 rounded-[12px] border border-emerald-100 bg-emerald-50/40 px-3 py-4 text-center transition-colors hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={avatarImportDisabled}
            onClick={() => importAvatarAsset('live2d')}
            type="button"
          >
            <span className="relative grid h-11 w-11 place-items-center rounded-[12px] bg-white text-emerald-600 shadow-sm">
              <FolderOpen aria-hidden="true" className="h-6 w-6" />
              <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-emerald-700 ring-2 ring-white">
                <PlayCircle aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            </span>
            <span className="grid min-w-0 gap-1">
              <span className="text-[13px] font-semibold text-slate-700">
                {appearance.avatarImportPending ? `${labels.importLive2dTitle}...` : labels.importLive2dTitle}
              </span>
              <span className="text-[11.5px] leading-4 text-slate-500">{labels.importLive2dSubtitle}</span>
              <span className="text-[11px] font-semibold text-emerald-600">
                {avatarReady && backendKind(appearance) === 'live2d' ? labels.live2dImported : labels.importOtherFormat}
              </span>
            </span>
          </button>

          <button
            className="group grid min-h-[118px] place-items-center gap-2 rounded-[12px] border border-sky-100 bg-sky-50/20 px-3 py-4 text-center transition-colors hover:border-sky-200 hover:bg-sky-50/60 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={avatarImportDisabled}
            onClick={() => importAvatarAsset('vrm')}
            type="button"
          >
            <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-white text-sky-500 shadow-sm">
              <Box aria-hidden="true" className="h-6 w-6" />
            </span>
            <span className="grid min-w-0 gap-1">
              <span className="text-[13px] font-semibold text-slate-700">
                {appearance.avatarImportPending ? `${labels.importVrmTitle}...` : labels.importVrmTitle}
              </span>
              <span className="text-[11.5px] leading-4 text-slate-500">{labels.importVrmSubtitle}</span>
              <span className="text-[11px] font-semibold text-sky-600">
                {backendKind(appearance) === 'vrm' && avatarReady ? labels.live2dImported : labels.importOtherFormat}
              </span>
            </span>
          </button>
        </div>
        <div className="mt-4 flex min-w-0 items-center justify-between gap-3 border-t border-slate-100 pt-3 text-[12px] text-slate-500">
          <span>{labels.removeAvatar}</span>
          <button
            aria-label={labels.removeAvatar}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-slate-200 bg-white text-slate-400 transition-colors hover:border-rose-100 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={clearAvatarDisabled}
            onClick={() => run(
              labels.removeAvatar,
              appearanceAdapter?.clearAvatarAsset ? () => appearanceAdapter.clearAvatarAsset?.() as Promise<AgentCenterAppearanceProjection> : undefined,
              () => labels.doneLabel,
            )}
            type="button"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </Card>
    </div>
  );

  const renderChatBackground = () => (
    <div data-agent-center-appearance-background="chat-scene">
      <Card className="border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
          <div className="min-w-0">
            <h3 className="m-0 text-[15px] font-semibold leading-6 text-slate-950">{labels.chatBackgroundTitle}</h3>
            <p className="m-0 mt-2 max-w-[230px] text-[12px] leading-5 text-slate-500">{labels.chatBackgroundDescription}</p>
            {backgroundState === 'ready' ? (
              <span className="mt-3 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                {labels.backgroundReady}
              </span>
            ) : null}
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
  );

  const renderDiagnostics = () => (
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

        <DiagnosticsEvidencePanel appearance={appearance} labels={labels} />

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

        <div className="flex min-w-0 items-start gap-2 rounded-[10px] border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0">
            {labels.custodyNotice}
          </span>
        </div>
      </div>
    </details>
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

          {renderProgressChecklist()}
          {renderAssetManagement()}
          {renderChatBackground()}
          {renderDiagnostics()}

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

        {renderProgressChecklist()}
        {renderAssetManagement()}
        {renderChatBackground()}
        {renderDiagnostics()}

        {status ? <Notice>{status}</Notice> : null}
      </div>
    </SectionShell>
  );
}
