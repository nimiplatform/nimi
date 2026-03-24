import type { ReactNode } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { UseModelPickerResult } from '../hooks/use-model-picker.js';
import type { ModelPickerBadge } from '../types.js';

function badgeTone(tone: ModelPickerBadge['tone']) {
  if (tone === 'accent') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] text-[color:var(--nimi-text-secondary)]';
}

export type ModelPickerDetailProps<TModel> = {
  state: UseModelPickerResult<TModel>;
  className?: string;
  emptyMessage?: string;
  renderActions?: (model: TModel) => ReactNode;
};

export function ModelPickerDetail<TModel>({
  state,
  className,
  emptyMessage = 'Select a model to inspect its summary.',
  renderActions,
}: ModelPickerDetailProps<TModel>) {
  if (!state.selectedModel) {
    return (
      <Surface tone="card" className={className}>
        <p className="text-sm text-[color:var(--nimi-text-secondary)]">{emptyMessage}</p>
      </Surface>
    );
  }

  const model = state.selectedModel;
  const title = state.adapter.getTitle(model);
  const description = state.adapter.getDescription?.(model);
  const capabilities = state.adapter.getCapabilities?.(model) || [];
  const badges = state.adapter.getBadges?.(model) || [];
  const detailRows = state.adapter.getDetailRows?.(model) || [];
  const source = state.adapter.getSource?.(model);

  return (
    <Surface tone="card" className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[color:var(--nimi-text-primary)]">{title}</h3>
          {description ? <p className="mt-1 text-sm text-[color:var(--nimi-text-secondary)]">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {renderActions ? renderActions(model) : null}
          {source ? <span className="rounded-full border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--nimi-text-secondary)]">{source}</span> : null}
        </div>
      </div>

      {capabilities.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {capabilities.map((capability) => (
            <span key={`${title}-${capability}`} className="rounded-full bg-[color:var(--nimi-surface-card)] px-2 py-0.5 text-[10px] text-[color:var(--nimi-text-secondary)]">
              {capability}
            </span>
          ))}
        </div>
      ) : null}

      {badges.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.map((badge) => (
            <span key={`${title}-${badge.label}`} className={`rounded-full border px-2 py-0.5 text-[10px] ${badgeTone(badge.tone)}`}>
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}

      {detailRows.length > 0 ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {detailRows.map((row) => (
            <div key={`${title}-${row.label}`} className="rounded-2xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">{row.label}</p>
              <p className="mt-2 text-sm break-all text-[color:var(--nimi-text-primary)]">{row.value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Surface>
  );
}
