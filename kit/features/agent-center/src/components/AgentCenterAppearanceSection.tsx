import { useEffect, useState } from 'react';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceConfigPatch,
  AgentCenterAppearanceProjection,
  AgentCenterState,
} from '../types.js';
import {
  AgentButton,
  Card,
  Notice,
  SectionHeader,
  SectionShell,
  StatusPill,
  agentCenterSelectClassName,
  cnAgentCenter,
} from './AgentCenterPrimitives.js';

export interface AgentCenterAppearanceSectionProps {
  readonly state: AgentCenterState;
  readonly appearanceAdapter?: AgentCenterAppearanceAdapter | null;
}

type EvidenceState = 'ready' | 'pending' | 'missing' | 'blocked';

function normalizeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Runtime appearance update failed.';
}

function evidenceTone(state: EvidenceState): string {
  if (state === 'ready') return 'border-emerald-100 bg-emerald-50/70 text-emerald-700';
  if (state === 'pending') return 'border-amber-100 bg-amber-50/80 text-amber-700';
  if (state === 'blocked') return 'border-rose-100 bg-rose-50/80 text-rose-700';
  return 'border-slate-100 bg-slate-50 text-slate-500';
}

function UploadGlyph(props: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={props.className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

function EvidenceRow(props: {
  readonly label: string;
  readonly value: string;
  readonly state: EvidenceState;
}) {
  return (
    <div className="flex min-h-[44px] items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2">
      <span className={cnAgentCenter(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
        evidenceTone(props.state),
      )}>
        {props.state === 'ready' ? 'OK' : props.state === 'pending' ? '...' : props.state === 'blocked' ? '!' : '-'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-slate-800">{props.label}</div>
        <div className="truncate text-[10px] leading-4 text-slate-500">{props.value}</div>
      </div>
    </div>
  );
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

function AgentCenterLive2dWorkbench({ appearance }: { readonly appearance: AgentCenterAppearanceProjection }) {
  if ((appearance.backendKind || 'live2d') !== 'live2d') {
    return null;
  }
  const launchEvidenceReady = Boolean(
    appearance.avatarAssetRef
      && appearance.avatarAssetValid
      && appearance.backendCapabilityProfileRef,
  );
  const adapterSourceLabel = appearance.live2dAdapterManifestSource === 'external_sidecar_manifest'
    ? 'External sidecar linked'
    : appearance.live2dAdapterManifestSource === 'embedded_creator_manifest'
      ? 'Embedded'
      : 'Not selected';
  const reviewItems = buildLive2dWorkbenchItems(appearance);
  return (
    <Card className="border-sky-100 bg-sky-50/35 p-3">
      <div
        className="flex flex-wrap items-start justify-between gap-3"
        data-agent-center-live2d-workbench="true"
        data-testid="agent-center-live2d-calibration-workbench"
      >
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-950">Live2D workbench</div>
          <div className="mt-1 text-[11px] leading-4 text-slate-500">
            Asset {appearance.avatarAssetRef || 'Missing'} · {adapterSourceLabel}
          </div>
        </div>
        <span className={cnAgentCenter(
          'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold',
          launchEvidenceReady ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
        )}>
          {launchEvidenceReady ? 'Evidence ready' : 'Evidence pending'}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {reviewItems.map((item) => (
          <div className="rounded-lg border border-slate-100 bg-white px-3 py-2" key={item.id}>
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

      <div className="mt-3 rounded-lg border border-white/70 bg-white/70 px-3 py-2">
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

      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] leading-4 text-slate-600">
        {appearance.live2dCalibrationRef ? (
          <div className="mb-1 truncate text-[10px] font-semibold text-slate-500">
            Calibration ref: {appearance.live2dCalibrationRef}
          </div>
        ) : null}
        Kit stores and renders only opaque Live2D calibration refs. Avatar/Runtime own model digest, framing, scale, FPS, expression inventory, preview refs, and effect materialization.
      </div>
    </Card>
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
    <label className="block rounded-lg border border-slate-100 bg-white px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
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

export function AgentCenterAppearanceSection({ state, appearanceAdapter }: AgentCenterAppearanceSectionProps) {
  const [appearance, setAppearance] = useState(state.appearance);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setAppearance(state.appearance);
  }, [state.appearance]);
  const avatarImportDisabled = Boolean(appearance.avatarImportDisabled || !appearanceAdapter?.importAvatarAsset);
  const live2dManifestDisabled = Boolean(
    avatarImportDisabled
      || !appearance.avatarAssetRef
      || appearance.backendKind !== 'live2d'
      || !appearanceAdapter?.linkLive2dAdapterManifest,
  );
  const clearAvatarDisabled = Boolean(!appearance.avatarAssetRef || !appearanceAdapter?.clearAvatarAsset);
  const backgroundImportDisabled = Boolean(appearance.backgroundImportDisabled || !appearanceAdapter?.importBackground);
  const clearBackgroundDisabled = Boolean(!appearance.backgroundRef || !appearanceAdapter?.clearBackground);
  const avatarConfigDisabled = Boolean(appearance.avatarConfigPending || !appearanceAdapter?.updateAvatarConfig);

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

  const updateAvatarConfig = (patch: AgentCenterAppearanceConfigPatch) => {
    run(
      'Saving avatar policy',
      appearanceAdapter?.updateAvatarConfig ? () => appearanceAdapter.updateAvatarConfig?.(patch) as Promise<AgentCenterAppearanceProjection> : undefined,
      () => 'Saved avatar policy.',
    );
  };

  const toggleAutoplay = () => {
    run(
      'Saving avatar autoplay',
      appearanceAdapter?.setAvatarAutoplay ? () => appearanceAdapter.setAvatarAutoplay?.(!appearance.avatarAutoplay) as Promise<AgentCenterAppearanceProjection> : undefined,
      (projection) => `Saved autoplay ${projection.avatarAutoplay ? 'enabled' : 'disabled'}.`,
    );
  };

  const adapterDisplay = appearance.live2dAdapterManifestSource === 'external_sidecar_manifest'
    ? 'External sidecar linked'
    : appearance.live2dAdapterManifestSource === 'embedded_creator_manifest'
      ? 'Embedded'
      : 'Not selected';

  const launchReadinessTone = appearance.avatarAssetValid
    ? 'border-emerald-100 bg-emerald-50/80 text-emerald-800'
    : appearance.avatarAssetChecking
      ? 'border-slate-200 bg-slate-50 text-slate-600'
      : 'border-amber-200 bg-amber-50 text-amber-800';

  return (
    <SectionShell labelledBy="agent-center-appearance-title">
      <SectionHeader
        description="Avatar, background, and launch appearance are managed through typed Runtime/Avatar projection."
        id="agent-center-appearance-title"
        right={<StatusPill label={appearance.status} tone={appearance.status === 'ready' ? 'ready' : 'warn'} />}
        title="Appearance"
      />

      <Card className={cnAgentCenter(
        'p-3',
        appearance.avatarAssetValid ? 'border-emerald-100 bg-emerald-50/60' : 'bg-white/85',
      )}>
        <div className="flex items-center gap-3">
          <div className={cnAgentCenter(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-[12px] font-bold',
            appearance.avatarAssetValid
              ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
              : 'border-slate-100 bg-slate-50 text-slate-400',
          )}>
            {appearance.avatarAssetValid ? 'OK' : appearance.backendKind === 'vrm' ? '3D' : '2D'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-xs font-semibold text-slate-950">
                {appearance.avatarAssetRef ? 'Selected Avatar asset' : 'Avatar asset'}
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {(appearance.backendKind || 'live2d').toUpperCase()}
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] leading-4 text-slate-500">
              {appearance.avatarAssetRef || 'Missing'}
            </div>
          </div>
          <StatusPill
            label={appearance.avatarAssetValid ? 'Ready' : appearance.avatarAssetChecking ? 'Checking' : 'Needs setup'}
            tone={appearance.avatarAssetValid ? 'ready' : appearance.avatarAssetChecking ? 'checking' : 'warn'}
          />
        </div>
      </Card>

      {appearance.disabledReason ? <Notice tone="warn">{appearance.disabledReason}</Notice> : null}
      {appearance.avatarImportError ? <Notice tone="warn">{appearance.avatarImportError}</Notice> : null}

      <Card className="p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold text-slate-950">Import source</div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            Avatar-owned evidence
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className="group flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-4 text-center text-xs font-semibold text-emerald-800 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-emerald-200 disabled:hover:bg-emerald-50/40 disabled:hover:shadow-none"
            disabled={avatarImportDisabled}
            onClick={() => run(
              'Importing Live2D folder',
              appearanceAdapter?.importAvatarAsset ? () => appearanceAdapter.importAvatarAsset?.('live2d') as Promise<AgentCenterAppearanceProjection> : undefined,
              () => 'Imported Live2D avatar asset.',
            )}
            type="button"
          >
            <UploadGlyph className="h-4 w-4 text-emerald-500" />
            <span>{appearance.avatarImportPending ? 'Importing...' : 'Import Live2D folder'}</span>
            <span className="text-[10px] font-medium leading-3 text-emerald-700/70">model3.json + textures</span>
          </button>
          <button
            className="group flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-violet-200 bg-violet-50/30 px-3 py-4 text-center text-xs font-semibold text-violet-800 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-violet-400 hover:bg-violet-50 hover:shadow-[0_8px_20px_rgba(139,92,246,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-violet-200 disabled:hover:bg-violet-50/30 disabled:hover:shadow-none"
            disabled={avatarImportDisabled}
            onClick={() => run(
              'Importing VRM file',
              appearanceAdapter?.importAvatarAsset ? () => appearanceAdapter.importAvatarAsset?.('vrm') as Promise<AgentCenterAppearanceProjection> : undefined,
              () => 'Imported VRM avatar asset.',
            )}
            type="button"
          >
            <UploadGlyph className="h-4 w-4 text-violet-500" />
            <span>{appearance.avatarImportPending ? 'Importing...' : 'Import VRM file'}</span>
            <span className="text-[10px] font-medium leading-3 text-violet-700/70">.vrm - single file</span>
          </button>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={live2dManifestDisabled}
            onClick={() => run(
              'Linking Live2D adapter manifest',
              appearanceAdapter?.linkLive2dAdapterManifest ? () => appearanceAdapter.linkLive2dAdapterManifest?.() as Promise<AgentCenterAppearanceProjection> : undefined,
              () => 'Linked Live2D adapter manifest.',
            )}
            type="button"
          >
            {appearance.live2dAdapterImportPending ? 'Linking...' : 'Link Live2D adapter manifest'}
          </button>
          <button
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={clearAvatarDisabled}
            onClick={() => run(
              'Removing Avatar asset',
              appearanceAdapter?.clearAvatarAsset ? () => appearanceAdapter.clearAvatarAsset?.() as Promise<AgentCenterAppearanceProjection> : undefined,
              () => 'Removed Avatar asset.',
            )}
            type="button"
          >
            {appearance.clearAvatarPending ? 'Removing...' : 'Remove Avatar asset'}
          </button>
        </div>
      </Card>

      <Card className="space-y-2 p-3">
        <div className="text-xs font-semibold text-slate-950">Evidence</div>
        <EvidenceRow
          label="Selected asset"
          state={appearance.avatarAssetRef ? 'ready' : 'missing'}
          value={appearance.avatarAssetRef || 'Missing'}
        />
        <EvidenceRow
          label="Validation"
          state={assetStatus(appearance)}
          value={(appearance.validationStatus || (appearance.avatarAssetRef ? 'unchecked' : 'selection_missing')).replaceAll('_', ' ')}
        />
        <EvidenceRow
          label="Capability profile"
          state={capabilityStatus(appearance)}
          value={appearance.backendCapabilityProfileRef ? 'Linked' : 'Pending evidence'}
        />
        {appearance.backendKind === 'live2d' ? (
          <EvidenceRow
            label="Live2D adapter manifest"
            state={live2dManifestStatus(appearance)}
            value={adapterDisplay}
          />
        ) : null}
        {appearance.validationIssueRows && appearance.validationIssueRows.length > 0 ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-600">
            {appearance.validationIssueRows.map((issue) => (
              <div className="break-words" key={issue}>{issue}</div>
            ))}
          </div>
        ) : null}
      </Card>

      <AgentCenterLive2dWorkbench appearance={appearance} />

      <Card className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-950">Background</div>
            <div className="mt-1 text-[11px] leading-4 text-slate-500">
              {appearance.backgroundValid
                ? 'A local background is selected for this agent.'
                : appearance.backgroundRef
                  ? 'The selected local background needs attention.'
                  : 'Import a png, jpeg, or webp image for this agent.'}
            </div>
          </div>
          <StatusPill
            label={appearance.backgroundValid ? 'Ready' : appearance.backgroundChecking ? 'Checking' : 'Needs setup'}
            tone={appearance.backgroundValid ? 'ready' : appearance.backgroundChecking ? 'checking' : 'warn'}
          />
        </div>
        {appearance.backgroundValidationMessage ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
            {appearance.backgroundValidationMessage}
          </div>
        ) : null}
        {appearance.backgroundImportError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">
            {appearance.backgroundImportError}
          </div>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            className="group flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-center text-xs font-semibold text-slate-700 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-emerald-400 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-[0_8px_20px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:border-slate-300 disabled:hover:bg-white/70 disabled:hover:text-slate-700 disabled:hover:shadow-none"
            disabled={backgroundImportDisabled}
            onClick={() => run(
              'Importing background image',
              appearanceAdapter?.importBackground ? () => appearanceAdapter.importBackground?.() as Promise<AgentCenterAppearanceProjection> : undefined,
              () => 'Imported background image.',
            )}
            type="button"
          >
            <UploadGlyph className="h-4 w-4 text-slate-400 transition-colors group-hover:text-emerald-500" />
            <span>{appearance.backgroundImportPending ? 'Importing...' : 'Import background image'}</span>
          </button>
          <button
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={clearBackgroundDisabled}
            onClick={() => run(
              'Removing background',
              appearanceAdapter?.clearBackground ? () => appearanceAdapter.clearBackground?.() as Promise<AgentCenterAppearanceProjection> : undefined,
              () => 'Removed background.',
            )}
            type="button"
          >
            {appearance.clearBackgroundPending ? 'Clearing...' : 'Remove background'}
          </button>
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-[12px] bg-slate-50 px-3 py-2.5">
          <div className="grid min-w-0 gap-0.5">
            <span className="text-[13px] font-semibold text-slate-950">Avatar autoplay</span>
            <span className="text-[12px] text-slate-600">Launch handoff uses Runtime appearance projection.</span>
          </div>
          <AgentButton
            dataAttrs={{ 'data-agent-center-avatar-autoplay': 'true' }}
            disabled={!appearanceAdapter?.setAvatarAutoplay}
            onClick={toggleAutoplay}
            variant={appearance.avatarAutoplay ? 'accent' : 'default'}
          >
            {appearance.avatarAutoplay ? 'Disable' : 'Enable'}
          </AgentButton>
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-between gap-3 rounded-[12px] bg-slate-50 px-3 py-2.5">
          <div className="grid min-w-0 gap-0.5">
            <span className="text-[13px] font-semibold text-slate-950">Generated voice artifacts</span>
            <span className="text-[12px] text-slate-600">Cleanup remains a typed Runtime/Avatar maintenance action.</span>
          </div>
          <AgentButton
            disabled={!appearanceAdapter?.cleanupGeneratedVoiceArtifacts || appearance.voiceCleanupPending}
            onClick={() => run(
              'Cleaning generated voice artifacts',
              appearanceAdapter?.cleanupGeneratedVoiceArtifacts ? () => appearanceAdapter.cleanupGeneratedVoiceArtifacts?.() as Promise<AgentCenterAppearanceProjection> : undefined,
              () => 'Cleaned generated voice artifacts.',
            )}
            variant="default"
          >
            {appearance.voiceCleanupPending ? 'Cleaning...' : 'Cleanup'}
          </AgentButton>
        </div>
        {appearance.voiceCleanupError ? <Notice tone="warn">{appearance.voiceCleanupError}</Notice> : null}
      </Card>

      <Card className={cnAgentCenter('p-3', launchReadinessTone)}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 text-[11px] font-bold">
            {appearance.avatarAssetValid ? 'OK' : appearance.avatarAssetChecking ? '...' : '!'}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold">
              {appearance.avatarAssetValid ? 'Ready to launch' : appearance.avatarAssetChecking ? 'Checking' : 'Needs setup'}
            </div>
            <div className="mt-1 text-[11px] leading-4">
              {appearance.avatarAssetValid
                ? 'Local asset and backend evidence are ready for launch from the composer.'
                : appearance.validationMessage || 'Avatar launch requires Avatar-owned package evidence before opening.'}
            </div>
          </div>
        </div>
      </Card>

      <details className="group rounded-xl border border-slate-100 bg-white/85 px-3 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-slate-900">
          <span>Diagnostics</span>
          <span className="text-[10px] font-semibold text-slate-400 group-open:hidden">Advanced collapsed</span>
          <span className="hidden text-[10px] font-semibold text-slate-400 group-open:inline">Advanced open</span>
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <SelectControl
            disabled={avatarConfigDisabled}
            label="Instance policy"
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
            label="Generated motion"
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
            label="Launch mode"
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
            label="Debug profile"
            onChange={(debug_profile) => updateAvatarConfig({ debug_profile })}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'strict_backend_evidence', label: 'Strict backend evidence' },
              { value: 'route_matrix', label: 'Route matrix' },
            ]}
            value={(appearance.debugProfile || 'standard') as 'standard' | 'strict_backend_evidence' | 'route_matrix'}
          />
        </div>
      </details>

      {status ? <Notice>{status}</Notice> : null}
    </SectionShell>
  );
}
