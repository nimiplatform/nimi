import React from 'react';
import { useTranslation } from 'react-i18next';
import { VoiceAssetStatus, VoiceWorkflowType } from '@nimiplatform/sdk/runtime';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import type { CapabilityState, VoiceAssetSelection } from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { listTesterVoiceAssets, type TesterVoiceAsset } from '../tester-voice-assets';
import { VoiceClonePanel, VoiceDesignPanel } from './panel-voice-stubs.js';

const CHEVRON_DOWN = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function useDismissable(open: boolean, onDismiss: () => void) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        onDismiss();
      }
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onDismiss]);
  return wrapperRef;
}

export type VoiceAssetMode = 'clone' | 'design';

export type VoiceAssetPanelProps = {
  mode: VoiceAssetMode;
  onModeChange: (mode: VoiceAssetMode) => void;
  cloneState: CapabilityState;
  onCloneStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
  designState: CapabilityState;
  onDesignStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
  selectedVoiceAssetId?: string;
  onUseVoiceAsset?: (asset: VoiceAssetSelection) => void;
  onVoiceAssetCreated?: (voiceAssetId: string) => void;
};

const VOICE_WAVE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10v4" />
    <path d="M7 6v12" />
    <path d="M12 3v18" />
    <path d="M17 6v12" />
    <path d="M21 10v4" />
  </svg>
);

function VoiceModeChip(props: { mode: VoiceAssetMode; onChange: (next: VoiceAssetMode) => void }) {
  const { t } = useTranslation();
  const { mode, onChange } = props;
  const [open, setOpen] = React.useState(false);
  const wrapperRef = useDismissable(open, () => setOpen(false));

  const cloneTitle = t('Tester.voiceAsset.modeClone', { defaultValue: 'Clone' });
  const designTitle = t('Tester.voiceAsset.modeDesign', { defaultValue: 'Design' });
  const cloneDesc = t('Tester.voiceAsset.modeCloneDesc', { defaultValue: 'Replicate a voice from a reference audio' });
  const designDesc = t('Tester.voiceAsset.modeDesignDesc', { defaultValue: 'Create a voice from a text description' });
  const shortLabel = mode === 'clone' ? cloneTitle : designTitle;

  const options: Array<{ value: VoiceAssetMode; title: string; desc: string }> = [
    { value: 'clone', title: cloneTitle, desc: cloneDesc },
    { value: 'design', title: designTitle, desc: designDesc },
  ];

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('Tester.voiceAsset.modeToggleLabel', { defaultValue: 'Voice mode' })}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--nimi-action-primary-bg)] transition-colors hover:border-[var(--nimi-border-strong)]"
      >
        <span>{VOICE_WAVE_ICON}</span>
        <span>{shortLabel}</span>
        {CHEVRON_DOWN}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t('Tester.voiceAsset.modeToggleLabel', { defaultValue: 'Voice mode' })}
          className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[260px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex flex-col gap-1">
            {options.map((opt) => {
              const active = opt.value === mode;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex items-start justify-between gap-2 rounded-[var(--nimi-radius-sm)] px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'bg-[var(--nimi-action-primary-bg)]/10'
                      : 'hover:bg-[var(--nimi-surface-canvas)]'
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className={`text-[12px] font-medium ${active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>
                      {opt.title}
                    </span>
                    <span className="text-[10px] leading-snug text-[var(--nimi-text-muted)]">
                      {opt.desc}
                    </span>
                  </div>
                  {active ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-[var(--nimi-action-primary-bg)]">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type VoiceAssetRow = {
  voiceAssetId: string;
  providerVoiceRef: string;
  preferredName: string;
  workflowType: string;
  modelId: string;
  targetModelId: string;
};

function VoiceAssetInventory(props: {
  state: CapabilityState;
  refreshRevision: number;
  recentCreatedVoiceAssetId: string;
  selectedVoiceAssetId: string;
  onUseVoiceAsset?: (asset: VoiceAssetSelection) => void;
}) {
  const { t } = useTranslation();
  const [assets, setAssets] = React.useState<VoiceAssetRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    const effectiveBinding = resolveEffectiveBinding(props.state.snapshot, props.state.binding);
    if (!effectiveBinding) {
      setAssets([]);
      setError('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const modClient = createModRuntimeClient('core:runtime');
        const response = await listTesterVoiceAssets(modClient, {
          modelId: '',
          targetModelId: '',
          workflowType: VoiceWorkflowType.UNSPECIFIED,
          status: VoiceAssetStatus.ACTIVE,
          pageSize: 100,
          pageToken: '',
          connectorId: asString(effectiveBinding.connectorId),
        });
        if (cancelled) return;
        setAssets((response.assets || [])
          .map((asset: TesterVoiceAsset) => ({
            voiceAssetId: asString(asset.voiceAssetId),
            providerVoiceRef: asString(asset.providerVoiceRef),
            preferredName: asString(asset.providerVoiceRef) || asString(asset.voiceAssetId),
            workflowType: asString(asset.workflowType),
            modelId: asString(asset.modelId),
            targetModelId: asString(asset.targetModelId),
          }))
          .filter((asset) => asset.voiceAssetId));
      } catch (err) {
        if (cancelled) return;
        setAssets([]);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [props.refreshRevision, props.state.binding, props.state.snapshot]);

  return (
    <div className="rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
          {t('Tester.voiceAsset.assetsTitle', { defaultValue: 'Voice assets' })}
        </div>
        {loading ? (
          <div className="text-[11px] text-[var(--nimi-text-muted)]">
            {t('Tester.status.loading', { defaultValue: 'Loading' })}
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-accent-danger)]/30 bg-[var(--nimi-accent-danger)]/5 px-2 py-1.5 text-[11px] text-[var(--nimi-accent-danger)]">
          {error}
        </div>
      ) : null}
      {!error && assets.length === 0 ? (
        <div className="rounded-[var(--nimi-radius-sm)] border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-[12px] text-[var(--nimi-text-muted)]">
          {t('Tester.voiceAsset.noAssets', { defaultValue: 'No custom voice assets' })}
        </div>
      ) : null}
      {assets.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {assets.map((asset) => {
            const selected = asset.voiceAssetId === props.selectedVoiceAssetId;
            const recent = asset.voiceAssetId === props.recentCreatedVoiceAssetId;
            return (
              <div
                key={asset.voiceAssetId}
                className={`flex items-center gap-2 rounded-[var(--nimi-radius-md)] border px-2.5 py-2 ${
                  selected
                    ? 'border-[var(--nimi-action-primary-bg)]/40 bg-[var(--nimi-action-primary-bg)]/8'
                    : recent
                      ? 'border-[var(--nimi-action-primary-bg)]/25 bg-[var(--nimi-surface-canvas)]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-[var(--nimi-text-primary)]">
                    {asset.preferredName}
                  </div>
                  <div className="truncate font-mono text-[10px] text-[var(--nimi-text-muted)]">
                    {asset.voiceAssetId}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={selected}
                  onClick={() => props.onUseVoiceAsset?.(asset)}
                  className={`shrink-0 rounded-[var(--nimi-radius-sm)] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    selected
                      ? 'cursor-default border-[var(--nimi-action-primary-bg)]/30 bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-action-primary-bg)]/40 hover:text-[var(--nimi-action-primary-bg)]'
                  }`}
                >
                  {selected
                    ? t('Tester.voiceAsset.selectedForTts', { defaultValue: 'Selected for TTS' })
                    : t('Tester.voiceAsset.useInTts', { defaultValue: 'Use in TTS' })}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function VoiceAssetPanel(props: VoiceAssetPanelProps) {
  const {
    mode,
    onModeChange,
    cloneState,
    onCloneStateChange,
    designState,
    onDesignStateChange,
    selectedVoiceAssetId = '',
    onUseVoiceAsset,
    onVoiceAssetCreated,
  } = props;
  const [refreshRevision, setRefreshRevision] = React.useState(0);
  const [recentCreatedVoiceAssetId, setRecentCreatedVoiceAssetId] = React.useState('');
  const modeChip = <VoiceModeChip mode={mode} onChange={onModeChange} />;
  const activeState = mode === 'clone' ? cloneState : designState;
  const handleVoiceAssetCreated = React.useCallback((voiceAssetId: string) => {
    setRecentCreatedVoiceAssetId(voiceAssetId);
    setRefreshRevision((value) => value + 1);
    onVoiceAssetCreated?.(voiceAssetId);
  }, [onVoiceAssetCreated]);
  return (
    <div data-testid={E2E_IDS.testerPanel('voice_workflow.asset')} className="flex flex-col gap-3">
      {mode === 'clone' ? (
        <VoiceClonePanel
          state={cloneState}
          onStateChange={onCloneStateChange}
          onVoiceAssetCreated={handleVoiceAssetCreated}
          modeChip={modeChip}
        />
      ) : (
        <VoiceDesignPanel
          state={designState}
          onStateChange={onDesignStateChange}
          onVoiceAssetCreated={handleVoiceAssetCreated}
          modeChip={modeChip}
        />
      )}
      <VoiceAssetInventory
        state={activeState}
        refreshRevision={refreshRevision}
        recentCreatedVoiceAssetId={recentCreatedVoiceAssetId}
        selectedVoiceAssetId={selectedVoiceAssetId}
        onUseVoiceAsset={onUseVoiceAsset}
      />
    </div>
  );
}
