import type { ReactNode } from 'react';
import { Button, SearchField, SelectField, StatusBadge, Surface, cn } from '@nimiplatform/kit/ui';
import type { UseModelPickerResult } from '../hooks/use-model-picker.js';
import type { ModelPickerCopy } from '../types.js';
import { modelPickerBadgeTone } from './badge-tone.js';

export type ModelPickerProps<TCandidate> = {
  readonly state: UseModelPickerResult<TCandidate>;
  readonly className?: string;
  readonly copy?: ModelPickerCopy;
  readonly renderItemActions?: (candidate: TCandidate) => ReactNode;
};

const DEFAULT_COPY = {
  searchPlaceholder: 'Search choices',
  capabilityFilterLabel: 'Capability',
  sourceFilterLabel: 'Source',
  allLabel: 'All',
  loadingLabel: 'Loading choices…',
  emptyLabel: 'No choices match the current filters.',
  retryLabel: 'Retry',
} as const;

function sourceTone(source: string) {
  if (source === 'custom') return 'success' as const;
  if (source === 'overridden') return 'warning' as const;
  return 'neutral' as const;
}

export function ModelPicker<TCandidate>({ state, className, copy, renderItemActions }: ModelPickerProps<TCandidate>) {
  const labels = { ...DEFAULT_COPY, ...copy };
  const groups = state.groupedCandidates.filter((group) => group.candidates.length > 0);
  const capabilityFilter = state.capabilityOptions.length > 0;
  const sourceFilter = state.sourceOptions.length > 0;

  return (
    <div className={className} data-nimi-model-picker="true">
      <div className={cn(
        'grid gap-2',
        capabilityFilter && sourceFilter
          ? 'md:grid-cols-[minmax(0,1fr)_160px_160px]'
          : capabilityFilter || sourceFilter ? 'md:grid-cols-[minmax(0,1fr)_160px]' : undefined,
      )}>
        <SearchField
          value={state.searchQuery}
          onChange={(event) => state.setSearchQuery(event.currentTarget.value)}
          placeholder={labels.searchPlaceholder}
        />
        {capabilityFilter ? (
          <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nimi-text-muted)]">
            <span>{labels.capabilityFilterLabel}</span>
            <SelectField
              aria-label={labels.capabilityFilterLabel}
              value={state.capabilityFilter}
              onValueChange={state.setCapabilityFilter}
              options={[
                { value: 'all', label: labels.allLabel },
                ...state.capabilityOptions.map((value) => ({ value, label: value })),
              ]}
            />
          </label>
        ) : null}
        {sourceFilter ? (
          <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nimi-text-muted)]">
            <span>{labels.sourceFilterLabel}</span>
            <SelectField
              aria-label={labels.sourceFilterLabel}
              value={state.sourceFilter}
              onValueChange={state.setSourceFilter}
              options={[
                { value: 'all', label: labels.allLabel },
                ...state.sourceOptions.map((value) => ({ value, label: value })),
              ]}
            />
          </label>
        ) : null}
      </div>

      {state.isLoading ? (
        <Surface tone="card" className="mt-3 p-3 text-sm text-[var(--nimi-text-secondary)]">
          {labels.loadingLabel}
        </Surface>
      ) : null}
      {state.error ? (
        <Surface tone="card" className="mt-3 flex items-center justify-between gap-3 p-3 text-sm text-[var(--nimi-status-danger)]">
          <span>{state.error}</span>
          <Button size="sm" tone="secondary" onClick={() => { void state.refresh(); }}>{labels.retryLabel}</Button>
        </Surface>
      ) : null}
      {!state.isLoading && !state.error ? (
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              {state.adapter.getGroupKey ? (
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">{group.label}</h3>
                  <span className="text-[11px] text-[var(--nimi-text-muted)]">{group.candidates.length}</span>
                </div>
              ) : null}
              <div className="grid gap-2 md:grid-cols-2">
                {group.candidates.map((candidate) => {
                  const id = state.adapter.getId(candidate);
                  const selected = state.selectedId === id;
                  const source = state.adapter.getSource?.(candidate)?.trim();
                  const capabilities = state.adapter.getCapabilities?.(candidate) || [];
                  const badges = state.adapter.getBadges?.(candidate) || [];
                  return (
                    <Surface
                      as="div"
                      key={id}
                      tone="card"
                      className={cn(
                        'rounded-[var(--nimi-radius-md)] border p-3 transition-colors',
                        selected
                          ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))]'
                          : 'border-[var(--nimi-border-subtle)] hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,var(--nimi-border-subtle))]',
                      )}
                    >
                      <button type="button" className="w-full text-left" onClick={() => state.selectCandidate(id)}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{state.adapter.getTitle(candidate)}</p>
                            {state.adapter.getDescription?.(candidate) ? (
                              <p className="m-0 mt-1 line-clamp-2 text-xs text-[var(--nimi-text-secondary)]">{state.adapter.getDescription(candidate)}</p>
                            ) : null}
                          </div>
                          {source ? <StatusBadge tone={sourceTone(source)}>{source}</StatusBadge> : null}
                        </div>
                        {capabilities.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {capabilities.map((capability) => (
                              <span key={`${id}-${capability}`} className="rounded-[var(--nimi-radius-full)] bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">{capability}</span>
                            ))}
                          </div>
                        ) : null}
                        {badges.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {badges.map((badge) => (
                              <StatusBadge key={`${id}-${badge.label}`} tone={modelPickerBadgeTone(badge.tone)} className="text-[10px]">{badge.label}</StatusBadge>
                            ))}
                          </div>
                        ) : null}
                      </button>
                      {renderItemActions ? <div className="mt-3 flex justify-end">{renderItemActions(candidate)}</div> : null}
                    </Surface>
                  );
                })}
              </div>
            </section>
          ))}
          {state.filteredCandidates.length === 0 ? (
            <Surface tone="card" className="border border-dashed border-[var(--nimi-border-subtle)] p-4 text-sm text-[var(--nimi-text-secondary)]">
              {labels.emptyLabel}
            </Surface>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
