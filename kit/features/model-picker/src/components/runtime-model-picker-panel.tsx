import type { ReactNode } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import type {
  RuntimeCatalogModelDetail,
  RuntimeCatalogModelSummary,
  UseRuntimeModelPickerPanelResult,
} from '../runtime.js';
import { ModelPicker, type ModelPickerProps } from './model-picker.js';
import { ModelPickerDetail } from './model-picker-detail.js';

export type RuntimeModelPickerPanelProps = {
  state: UseRuntimeModelPickerPanelResult;
  className?: string;
  pickerClassName?: string;
  detailClassName?: string;
  loadingDetailMessage?: ReactNode;
  emptyDetailMessage?: ReactNode;
  renderItemActions?: ModelPickerProps<RuntimeCatalogModelSummary>['renderItemActions'];
  renderDetailActions?: (model: RuntimeCatalogModelSummary) => ReactNode;
  renderDetailContent?: (detail: RuntimeCatalogModelDetail) => ReactNode;
};

function DetailBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">{title}</p>
      <p className="mt-2 break-all text-sm text-[color:var(--nimi-text-primary)]">{value}</p>
    </div>
  );
}

function DefaultRuntimeModelDetail({ detail }: { detail: RuntimeCatalogModelDetail }) {
  return (
    <div className="space-y-4">
      {detail.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {detail.warnings.map((warning) => warning.message).join(' ')}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailBlock title="Capabilities" value={detail.capabilities.join(', ') || '-'} />
        <DetailBlock title="Source" value={detail.sourceRef.url || '-'} />
        <DetailBlock title="Pricing" value={`${detail.pricing.unit || '-'} · in ${detail.pricing.input || '-'} · out ${detail.pricing.output || '-'}`} />
        <DetailBlock title="Source Retrieved" value={detail.sourceRef.retrievedAt || '-'} />
        <DetailBlock title="Voice Set" value={detail.voiceSetId || '-'} />
        <DetailBlock title="Voice Discovery" value={detail.voiceDiscoveryMode || '-'} />
      </div>

      {detail.voices.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">Voices</p>
          <div className="grid gap-2 md:grid-cols-2">
            {detail.voices.map((voice) => (
              <div
                key={`${voice.voiceSetId}-${voice.voiceId}`}
                className="rounded-2xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] p-3"
              >
                <p className="text-sm font-medium text-[color:var(--nimi-text-primary)]">{voice.name || voice.voiceId}</p>
                <p className="mt-1 text-xs text-[color:var(--nimi-text-secondary)]">
                  {voice.voiceId} · {voice.langs.join(', ') || '-'}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {detail.videoGeneration ? (
        <pre className="overflow-x-auto rounded-2xl border border-[color:var(--nimi-border-subtle)] bg-slate-950 p-3 text-xs text-slate-100">
          {JSON.stringify(detail.videoGeneration, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export function RuntimeModelPickerPanel({
  state,
  className,
  pickerClassName,
  detailClassName,
  loadingDetailMessage = 'Loading model detail...',
  emptyDetailMessage = 'Select a model to inspect pricing, source, voices, and workflow bindings.',
  renderItemActions,
  renderDetailActions,
  renderDetailContent,
}: RuntimeModelPickerPanelProps) {
  return (
    <div className={className}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Surface tone="card" className={pickerClassName}>
          <ModelPicker
            state={state.pickerState}
            loadingMessage="Loading models..."
            emptyMessage="No models match the current filter."
            renderItemActions={renderItemActions}
          />
        </Surface>

        {state.isDetailLoading ? (
          <Surface tone="card" className={detailClassName}>
            <p className="text-sm text-[color:var(--nimi-text-secondary)]">{loadingDetailMessage}</p>
          </Surface>
        ) : state.detailError ? (
          <Surface tone="card" className={detailClassName}>
            <p className="text-sm text-[color:var(--nimi-status-danger)]">{state.detailError}</p>
          </Surface>
        ) : state.detail ? (
          <Surface tone="card" className={detailClassName}>
            <div className="space-y-4">
              <ModelPickerDetail
                state={state.pickerState}
                className="border-0 bg-transparent p-0 shadow-none"
                renderActions={renderDetailActions}
              />
              {renderDetailContent
                ? renderDetailContent(state.detail)
                : <DefaultRuntimeModelDetail detail={state.detail} />}
            </div>
          </Surface>
        ) : (
          <Surface tone="card" className={detailClassName}>
            <p className="text-sm text-[color:var(--nimi-text-secondary)]">{emptyDetailMessage}</p>
          </Surface>
        )}
      </div>
    </div>
  );
}
