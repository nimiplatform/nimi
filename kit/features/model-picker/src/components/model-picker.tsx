import React, { type ReactNode } from 'react';
import { Button, EmptyState, SearchField, SegmentedControl, SelectField, StatusBadge, Surface, cn } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
import type { UseModelPickerResult } from '../hooks/use-model-picker.js';
import type { ModelPickerCopy, ModelPickerPresentation } from '../types.js';
import { modelPickerBadgeTone } from './badge-tone.js';

export type ModelPickerProps<TCandidate> = {
  readonly state: UseModelPickerResult<TCandidate>;
  readonly className?: string;
  readonly copy?: ModelPickerCopy;
  readonly presentation?: ModelPickerPresentation;
  readonly renderItemActions?: (candidate: TCandidate) => ReactNode;
  readonly sourceControls?: ReactNode;
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

type ResolvedModelPickerCopy = ModelPickerCopy & {
  readonly searchPlaceholder: string;
  readonly capabilityFilterLabel: string;
  readonly sourceFilterLabel: string;
  readonly allLabel: string;
  readonly loadingLabel: ReactNode;
  readonly emptyLabel: ReactNode;
  readonly retryLabel: string;
};

const LOCAL_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const CLOUD_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10l4 4 8-8" />
  </svg>
);

function sourceTone(source: string) {
  if (source === 'custom') return 'success' as const;
  if (source === 'overridden') return 'warning' as const;
  return 'neutral' as const;
}

/**
 * Shared loading/error/empty feedback for both presentations. Only the outer
 * layout container changes: route renders bare blocks inside the dialog list
 * area, browser renders card surfaces; empty states always use the kit
 * EmptyState primitive.
 */
function PickerFeedback(props: {
  readonly presentation: ModelPickerPresentation;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly isEmpty: boolean;
  readonly loadingLabel: ReactNode;
  readonly emptyLabel: ReactNode;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}) {
  if (props.isLoading) {
    const content = <p className="m-0 text-center text-sm text-[var(--nimi-text-muted)]">{props.loadingLabel}</p>;
    return props.presentation === 'route'
      ? <div className="px-4 py-8">{content}</div>
      : <Surface tone="card" className="mt-3 p-3">{content}</Surface>;
  }
  if (props.error) {
    const content = (
      <div className="flex items-center justify-between gap-3 text-sm text-[var(--nimi-status-danger)]">
        <span>{props.error}</span>
        <Button size="sm" tone="secondary" onClick={props.onRetry}>{props.retryLabel}</Button>
      </div>
    );
    return props.presentation === 'route'
      ? <div className="px-4 py-4">{content}</div>
      : <Surface tone="card" className="mt-3 p-3">{content}</Surface>;
  }
  if (props.isEmpty) {
    return (
      <EmptyState
        title={props.emptyLabel}
        className={props.presentation === 'route' ? 'mx-4 my-3' : 'mt-3 border-dashed'}
      />
    );
  }
  return null;
}

function RouteModelPicker<TCandidate>(props: {
  readonly state: UseModelPickerResult<TCandidate>;
  readonly className?: string;
  readonly copy: ResolvedModelPickerCopy;
  readonly renderItemActions?: (candidate: TCandidate) => ReactNode;
  readonly sourceControls?: ReactNode;
}) {
  const { state, copy } = props;
  return (
    <div className={props.className} data-nimi-model-picker="true" data-nimi-model-picker-presentation="route">
      {state.sourceOptions.length > 1 ? (
        <div className="border-b border-[var(--nimi-border-subtle)] px-4 pb-3">
          <SegmentedControl
            ariaLabel={copy.sourceFilterLabel}
            value={state.sourceFilter}
            onValueChange={state.setSourceFilter}
            size="sm"
            className="flex w-full [&>button]:flex-1"
            items={state.sourceOptions.map((source) => ({
              value: source,
              label: copy.sourceLabels?.[source] || source,
              icon: source === 'local' ? LOCAL_ICON : source === 'cloud' ? CLOUD_ICON : undefined,
            }))}
          />
        </div>
      ) : null}

      {props.sourceControls ? (
        <div className="border-b border-[var(--nimi-border-subtle)] px-4 py-3">
          {props.sourceControls}
        </div>
      ) : null}

      <div className="border-b border-[var(--nimi-border-subtle)] px-4 py-3">
        <SearchField
          value={state.searchQuery}
          onChange={(event) => state.setSearchQuery(event.currentTarget.value)}
          placeholder={copy.searchPlaceholder}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
        <PickerFeedback
          presentation="route"
          isLoading={state.isLoading}
          error={state.error}
          isEmpty={!state.isLoading && !state.error && state.filteredCandidates.length === 0}
          loadingLabel={copy.loadingLabel}
          emptyLabel={copy.emptyLabel}
          retryLabel={copy.retryLabel}
          onRetry={() => { void state.refresh(); }}
        />
        {!state.isLoading && !state.error ? state.filteredCandidates.map((candidate) => {
          const id = state.adapter.getId(candidate);
          const selected = state.selectedId === id;
          const description = state.adapter.getDescription?.(candidate);
          const badges = state.adapter.getBadges?.(candidate) || [];
          return (
            <div key={id} className={cn(selected ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]' : '')}>
              <button
                type="button"
                data-nimi-model-picker-candidate={id}
                data-nimi-model-picker-source={state.adapter.getSource?.(candidate) || undefined}
                aria-pressed={selected}
                onClick={() => state.selectCandidate(id)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  FOCUS_RING_CLASS_NAME,
                  selected
                    ? 'text-[var(--nimi-text-primary)]'
                    : 'text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-surface-panel)]',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[length:var(--nimi-type-body-sm-size)]', selected ? 'font-semibold' : 'font-medium')}>
                    {state.adapter.getTitle(candidate)}
                  </span>
                  {description ? <span className="mt-0.5 block truncate text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">{description}</span> : null}
                </span>
                {badges.slice(0, 1).map((badge) => (
                  <StatusBadge key={`${id}-${badge.label}`} tone={modelPickerBadgeTone(badge.tone)} className="shrink-0 text-[length:var(--nimi-type-overline-size)]">{badge.label}</StatusBadge>
                ))}
                {selected ? <span className="shrink-0 text-[var(--nimi-action-primary-bg)]">{CHECK_ICON}</span> : null}
              </button>
              {props.renderItemActions ? <div className="flex justify-end px-4 pb-2.5">{props.renderItemActions(candidate)}</div> : null}
            </div>
          );
        }) : null}
      </div>
    </div>
  );
}

export function ModelPicker<TCandidate>({ state, className, copy, presentation = 'browser', renderItemActions, sourceControls }: ModelPickerProps<TCandidate>) {
  const labels = { ...DEFAULT_COPY, ...copy };
  if (presentation === 'route') {
    return <RouteModelPicker state={state} className={className} copy={labels} renderItemActions={renderItemActions} sourceControls={sourceControls} />;
  }
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
          <label className="grid gap-1 nimi-type-overline uppercase text-[var(--nimi-text-muted)]">
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
          <label className="grid gap-1 nimi-type-overline uppercase text-[var(--nimi-text-muted)]">
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

      <PickerFeedback
        presentation="browser"
        isLoading={state.isLoading}
        error={state.error}
        isEmpty={!state.isLoading && !state.error && state.filteredCandidates.length === 0}
        loadingLabel={labels.loadingLabel}
        emptyLabel={labels.emptyLabel}
        retryLabel={labels.retryLabel}
        onRetry={() => { void state.refresh(); }}
      />
      {!state.isLoading && !state.error ? (
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              {state.adapter.getGroupKey ? (
                <div className="flex items-center justify-between gap-3">
                  <h3 className="nimi-type-overline uppercase text-[var(--nimi-text-muted)]">{group.label}</h3>
                  <span className="text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">{group.candidates.length}</span>
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
                      <button type="button" aria-pressed={selected} className={cn('w-full text-left', FOCUS_RING_CLASS_NAME)} onClick={() => state.selectCandidate(id)}>
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
                              <span key={`${id}-${capability}`} className="rounded-[var(--nimi-radius-full)] bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-secondary)]">{capability}</span>
                            ))}
                          </div>
                        ) : null}
                        {badges.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {badges.map((badge) => (
                              <StatusBadge key={`${id}-${badge.label}`} tone={modelPickerBadgeTone(badge.tone)} className="text-[length:var(--nimi-type-overline-size)]">{badge.label}</StatusBadge>
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
        </div>
      ) : null}
    </div>
  );
}
