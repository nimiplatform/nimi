import { AppCardSurface, Button, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import {
  capabilityPreparationState,
  type CapabilityInventory,
  type CapabilityPreparationState,
} from '../runtime-config/runtime-capability-inventory.js';
import {
  capabilityModelIdentity,
  groupCapabilities,
  modelDisplayTitle,
} from '../runtime-config/runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import type { RuntimeSetupTask } from '../runtime-config/runtime-setup-task-store.js';

export const DEFAULT_HOME_CAPABILITIES = [
  'text.generate',
  'text.annotate',
  'text.decide',
  'text.embed',
  'image.generate',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'music.generate',
] as const;

export type HomeCapabilityMatrixItem = Readonly<{
  capability: string;
  state: CapabilityPreparationState;
  modelLabel: string | null;
}>;

export type HomeCapabilityMatrixViewProps = {
  loading: boolean;
  failed: boolean;
  readyCount: number;
  items: readonly HomeCapabilityMatrixItem[];
  onSelectCapability: (capability: string) => void;
  onOpenProfiles: () => void;
  onOpenCloud: () => void;
  onOpenAllCapabilities: () => void;
};

const STATE_DOT: Record<CapabilityPreparationState, string> = {
  ready: 'bg-[var(--nimi-status-success)]',
  preparing: 'bg-[var(--nimi-status-info)]',
  attention: 'bg-[var(--nimi-status-warning)]',
  unset: 'bg-[var(--nimi-border-strong)]',
  unknown: 'bg-[var(--nimi-border-strong)]',
};

export function deriveHomeCapabilityMatrixItems(input: {
  capabilities?: readonly string[];
  inventory: CapabilityInventory | undefined;
  tasks: readonly RuntimeSetupTask[];
  unavailable: boolean;
}): HomeCapabilityMatrixItem[] {
  const sourceCapabilities = input.capabilities && input.capabilities.length > 0
    ? input.capabilities
    : DEFAULT_HOME_CAPABILITIES;
  const recipes = input.inventory?.recipes ?? [];
  return sourceCapabilities.map((capability) => {
    const prep = capabilityPreparationState({
      capability,
      inventory: input.inventory,
      tasks: input.tasks,
      unavailable: input.unavailable,
    });
    const selectedId = input.inventory?.aggregate.selections.find(
      (item) => item.capabilityContract === capability,
    )?.loadoutId;
    const loadout = selectedId
      ? input.inventory?.aggregate.loadouts.find((item) => item.loadoutId === selectedId)
      : undefined;
    const identity = capabilityModelIdentity(loadout, recipes);
    const modelLabel = identity.shortTitle || (loadout?.loadoutId ? modelDisplayTitle(loadout.loadoutId) : null);
    return {
      capability,
      state: prep.state,
      modelLabel,
    };
  });
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.shell-ui.r029
export function HomeCapabilityMatrixView({
  loading,
  failed,
  readyCount,
  items,
  onSelectCapability,
  onOpenProfiles,
  onOpenCloud,
  onOpenAllCapabilities,
}: HomeCapabilityMatrixViewProps) {
  const { t, i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? 'en').startsWith('zh');
  const listJoiner = isZh ? '、' : ', ';

  const itemByCapability = new Map(items.map((item) => [item.capability, item]));
  const grouped = groupCapabilities(items.map((item) => item.capability));

  const formatLabelPreview = (subset: readonly HomeCapabilityMatrixItem[]) => {
    const names = subset
      .slice(0, 2)
      .map((item) => displayRuntimeConfigCapabilityLabel(item.capability, t))
      .join(listJoiner);
    return subset.length > 2
      ? t('runtimeConfig.overview.capabilityMatrix.moreCapabilities', { names })
      : names;
  };

  return (
    <AppCardSurface
      kind="operational-solid"
      className="flex h-full min-w-0 flex-col justify-between gap-4 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
      data-testid="home-capability-matrix"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.overview.capabilityMatrix.title')}
          </h2>
          {!loading && !failed ? (
            <button
              type="button"
              onClick={onOpenAllCapabilities}
              data-testid="home-status-capabilities"
              className="rounded-lg text-xs text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {t('runtimeConfig.overview.capabilityMatrix.readySummary', { count: readyCount })}
            </button>
          ) : null}
        </div>
        <Button tone="ghost" size="sm" onClick={onOpenAllCapabilities} data-testid="home-capability-all">
          {t('runtimeConfig.overview.capabilityMatrix.allAction')} →
        </Button>
      </header>

      {loading ? (
        <LoadingSkeleton lines={3} label={t('Common.loading')} />
      ) : failed ? (
        <p className="rounded-2xl bg-[var(--nimi-home-soft-well)] px-4 py-3 text-xs text-[var(--nimi-status-warning)]" data-testid="home-capability-error">
          {t('runtimeConfig.capabilities.readFailed')}
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {grouped.map(({ group, items: groupIds }) => {
            const groupItems = groupIds
              .map((id) => itemByCapability.get(id))
              .filter((entry): entry is HomeCapabilityMatrixItem => Boolean(entry));
            const attentionItem = groupItems.find((entry) => entry.state === 'attention');
            const preparingItem = groupItems.find((entry) => entry.state === 'preparing');
            const readyItems = groupItems.filter((entry) => entry.state === 'ready');
            const targetItem = attentionItem ?? preparingItem ?? readyItems[0] ?? groupItems[0];
            if (!targetItem) return null;

            const groupState: CapabilityPreparationState = attentionItem
              ? 'attention'
              : preparingItem
                ? 'preparing'
                : readyItems.length > 0
                  ? 'ready'
                  : 'unset';

            const focusItem = attentionItem ?? preparingItem ?? (readyItems.length === 1 ? readyItems[0] : undefined);
            const subtitle = focusItem
              ? `${displayRuntimeConfigCapabilityLabel(focusItem.capability, t)}${
                  focusItem.modelLabel ? ` · ${modelDisplayTitle(focusItem.modelLabel)}` : ''
                }`
              : readyItems.length > 1
                ? formatLabelPreview(readyItems)
                : formatLabelPreview(groupItems);

            const badgeText = attentionItem
              ? t('runtimeConfig.overview.capabilityMatrix.states.attention')
              : preparingItem
                ? t('runtimeConfig.overview.capabilityMatrix.states.preparing')
                : readyItems.length > 0
                  ? t('runtimeConfig.overview.capabilityMatrix.groupReadyCount', {
                      ready: readyItems.length,
                      total: groupItems.length,
                    })
                  : t('runtimeConfig.overview.capabilityMatrix.groupTotalCount', {
                      total: groupItems.length,
                    });

            const badgeToneClass = attentionItem
              ? 'font-medium text-[var(--nimi-status-warning)]'
              : preparingItem || readyItems.length > 0
                ? 'font-medium text-[var(--nimi-text-primary)]'
                : 'text-[var(--nimi-text-secondary)]';

            return (
              <button
                key={group}
                type="button"
                onClick={() => onSelectCapability(targetItem.capability)}
                data-testid={`home-capability-group:${group}`}
                data-state={groupState}
                className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-[var(--nimi-home-soft-well)] px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--nimi-home-soft-well-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-xs font-semibold text-[var(--nimi-text-primary)]">
                    {t(`runtimeConfig.capabilities.group.${group}`)}
                  </p>
                  <p className="truncate text-xs text-[var(--nimi-text-secondary)]">
                    {subtitle}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`size-2 shrink-0 rounded-full ${STATE_DOT[groupState]}`} aria-hidden="true" />
                  <span className={`text-xs tabular-nums ${badgeToneClass}`}>
                    {badgeText}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <footer className="flex items-center justify-between gap-2 pt-1 text-xs">
        <button
          type="button"
          onClick={onOpenProfiles}
          data-testid="home-capability-profiles"
          className="min-w-0 truncate text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
        >
          {t('runtimeConfig.overview.capabilityMatrix.profilesAction')}
        </button>
        <button
          type="button"
          onClick={onOpenCloud}
          data-testid="home-capability-cloud"
          className="shrink-0 font-medium text-[var(--nimi-text-primary)] transition-colors hover:text-[var(--nimi-action-primary-bg)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
        >
          {t('runtimeConfig.overview.capabilityMatrix.cloudAction')} →
        </button>
      </footer>
    </AppCardSurface>
  );
}
