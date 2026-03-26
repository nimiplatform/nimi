import type { ReactNode } from 'react';
import {
  SearchField,
  SelectField,
  StatusBadge,
  Surface,
} from '@nimiplatform/nimi-kit/ui';
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
  if (source === 'overridden') return 'warning' as const;
  if (source === 'custom') return 'success' as const;
  return 'neutral' as const;
}

function badgeTone(tone: ModelPickerBadge['tone']) {
  if (tone === 'accent') return 'info' as const;
  if (tone === 'success') return 'success' as const;
  if (tone === 'warning') return 'warning' as const;
  return 'neutral' as const;
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
          <SelectField
            value={state.capabilityFilter}
            onValueChange={state.setCapabilityFilter}
            options={[
              { value: 'all', label: 'All' },
              ...state.capabilityOptions.map((capability) => ({
                value: capability,
                label: capability,
              })),
            ]}
            selectClassName="font-normal"
          />
        </label>
        <label className="flex min-h-11 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--nimi-text-muted)]">
          <span>Source</span>
          <SelectField
            value={state.sourceFilter}
            onValueChange={state.setSourceFilter}
            options={[
              { value: 'all', label: 'All' },
              ...state.sourceOptions.map((source) => ({
                value: source,
                label: source,
              })),
            ]}
            selectClassName="font-normal"
          />
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
      className={selected
        ? 'rounded-2xl border border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] transition-colors'
        : 'rounded-2xl border border-[color:var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,var(--nimi-border-subtle))] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_4%,var(--nimi-surface-card))]'
      }
    >
      <button type="button" onClick={() => state.selectModel(id)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{state.adapter.getTitle(model)}</p>
            {description ? <p className="mt-1 text-xs text-[color:var(--nimi-text-secondary)]">{description}</p> : null}
          </div>
          <StatusBadge tone={sourceTone(source)}>{source}</StatusBadge>
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
              <StatusBadge key={`${id}-${badge.label}`} tone={badgeTone(badge.tone)} className="text-[10px]">
                {badge.label}
              </StatusBadge>
            ))}
          </div>
        ) : null}
      </button>
      {renderItemActions ? <div className="mt-3 flex items-center justify-end">{renderItemActions(model)}</div> : null}
    </Surface>
  );
}
