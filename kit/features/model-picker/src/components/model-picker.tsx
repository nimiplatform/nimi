import type { ReactNode } from 'react';
import { SearchField, Surface } from '@nimiplatform/nimi-kit/ui';
import type { UseModelPickerResult } from '../hooks/use-model-picker.js';
import type { ModelPickerBadge } from '../types.js';

export type ModelPickerProps<TModel> = {
  state: UseModelPickerResult<TModel>;
  className?: string;
  loadingMessage?: ReactNode;
  emptyMessage?: ReactNode;
  renderItemActions?: (model: TModel) => ReactNode;
};

type ModelPickerItemCardProps<TModel> = {
  state: UseModelPickerResult<TModel>;
  model: TModel;
  renderItemActions?: (model: TModel) => ReactNode;
};

function sourceTone(source: string) {
  if (source === 'overridden') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (source === 'custom') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] text-[color:var(--nimi-text-secondary)]';
}

function badgeTone(tone: ModelPickerBadge['tone']) {
  if (tone === 'accent') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] text-[color:var(--nimi-text-secondary)]';
}

export function ModelPicker<TModel>({
  state,
  className,
  loadingMessage = 'Loading models...',
  emptyMessage = 'No models match the current filter.',
  renderItemActions,
}: ModelPickerProps<TModel>) {
  const sections = state.groupedModels.filter((group) => group.models.length > 0);

  return (
    <div className={className}>
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px]">
        <SearchField
          value={state.searchQuery}
          onChange={(event) => state.setSearchQuery(event.target.value)}
          placeholder="Search models"
        />
        <label className="flex min-h-11 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">
          <span>Capability</span>
          <select
            value={state.capabilityFilter}
            onChange={(event) => state.setCapabilityFilter(event.target.value)}
            className="rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] px-3 py-2 text-sm font-normal text-[color:var(--nimi-text-primary)] outline-none focus:border-[color:var(--nimi-field-focus)]"
          >
            <option value="all">All</option>
            {state.capabilityOptions.map((capability) => (
              <option key={capability} value={capability}>{capability}</option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">
          <span>Source</span>
          <select
            value={state.sourceFilter}
            onChange={(event) => state.setSourceFilter(event.target.value)}
            className="rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] px-3 py-2 text-sm font-normal text-[color:var(--nimi-text-primary)] outline-none focus:border-[color:var(--nimi-field-focus)]"
          >
            <option value="all">All</option>
            {state.sourceOptions.map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
        </label>
      </div>

      {state.isLoading ? (
        <Surface tone="card" className="mt-3 text-sm text-[color:var(--nimi-text-secondary)]">{loadingMessage}</Surface>
      ) : null}

      {state.error ? (
        <Surface tone="card" className="mt-3 text-sm text-[color:var(--nimi-status-danger)]">{state.error}</Surface>
      ) : null}

      {!state.isLoading && !state.error ? (
        <div className="mt-3 space-y-4">
          {sections.map((group) => (
            <section key={group.key} className="space-y-2">
              {state.adapter.getGroupKey ? (
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">
                    {group.label}
                  </h3>
                  <span className="text-[11px] text-[color:var(--nimi-text-muted)]">
                    {group.models.length}
                  </span>
                </div>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-2">
                {group.models.map((model) => (
                  <ModelPickerItemCard
                    key={state.adapter.getId(model)}
                    state={state}
                    model={model}
                    renderItemActions={renderItemActions}
                  />
                ))}
              </div>
            </section>
          ))}
          {state.filteredModels.length === 0 ? (
            <Surface tone="card" className="rounded-2xl border border-dashed border-[color:var(--nimi-border-subtle)] text-sm text-[color:var(--nimi-text-secondary)]">
              {emptyMessage}
            </Surface>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ModelPickerItemCard<TModel>({
  state,
  model,
  renderItemActions,
}: ModelPickerItemCardProps<TModel>) {
  const id = state.adapter.getId(model);
  const source = state.adapter.getSource?.(model) || 'builtin';
  const capabilities = state.adapter.getCapabilities?.(model) || [];
  const badges = state.adapter.getBadges?.(model) || [];
  const description = state.adapter.getDescription?.(model);
  const selected = state.selectedId === id;

  return (
    <Surface
      as="div"
      tone="card"
      padding="md"
      className={`rounded-2xl border transition-colors ${selected ? 'border-emerald-400 bg-emerald-50/70' : 'border-[color:var(--nimi-border-subtle)] bg-white hover:border-emerald-200 hover:bg-emerald-50/30'}`}
    >
      <button type="button" onClick={() => state.selectModel(id)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{state.adapter.getTitle(model)}</p>
            {description ? <p className="mt-1 text-xs text-[color:var(--nimi-text-secondary)]">{description}</p> : null}
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceTone(source)}`}>{source}</span>
        </div>
        {capabilities.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {capabilities.map((capability) => (
              <span key={`${id}-${capability}`} className="rounded-full bg-[color:var(--nimi-surface-card)] px-2 py-0.5 text-[10px] text-[color:var(--nimi-text-secondary)]">
                {capability}
              </span>
            ))}
          </div>
        ) : null}
        {badges.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {badges.map((badge) => (
              <span key={`${id}-${badge.label}`} className={`rounded-full border px-2 py-0.5 text-[10px] ${badgeTone(badge.tone)}`}>
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </button>
      {renderItemActions ? <div className="mt-3 flex items-center justify-end">{renderItemActions(model)}</div> : null}
    </Surface>
  );
}
