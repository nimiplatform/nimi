import type { ReactNode } from 'react';
import { StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type { UseModelPickerResult } from '../hooks/use-model-picker.js';
import { modelPickerBadgeTone } from './badge-tone.js';

export type ModelPickerDetailProps<TCandidate> = {
  readonly state: UseModelPickerResult<TCandidate>;
  readonly className?: string;
  readonly emptyMessage?: string;
  readonly renderActions?: (candidate: TCandidate) => ReactNode;
};

export function ModelPickerDetail<TCandidate>({ state, className, emptyMessage = 'Select a choice to inspect its details.', renderActions }: ModelPickerDetailProps<TCandidate>) {
  const candidate = state.selectedCandidate;
  if (!candidate) {
    return <Surface tone="card" className={className}><p className="m-0 text-sm text-[var(--nimi-text-secondary)]">{emptyMessage}</p></Surface>;
  }
  const title = state.adapter.getTitle(candidate);
  const rows = state.adapter.getDetailRows?.(candidate) || [];
  const badges = state.adapter.getBadges?.(candidate) || [];
  return (
    <Surface tone="card" className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 truncate text-base font-semibold text-[var(--nimi-text-primary)]">{title}</h3>
          {state.adapter.getDescription?.(candidate) ? <p className="m-0 mt-1 text-sm text-[var(--nimi-text-secondary)]">{state.adapter.getDescription(candidate)}</p> : null}
        </div>
        {renderActions ? renderActions(candidate) : null}
      </div>
      {badges.length > 0 ? <div className="mt-3 flex flex-wrap gap-1">{badges.map((badge) => <StatusBadge key={`${title}-${badge.label}`} tone={modelPickerBadgeTone(badge.tone)}>{badge.label}</StatusBadge>)}</div> : null}
      {rows.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={`${title}-${row.label}`} className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">{row.label}</p>
              <p className="m-0 mt-1 break-all text-sm text-[var(--nimi-text-primary)]">{row.value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Surface>
  );
}
