import { AppCardSurface, Button, capabilityIcon, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  capabilityPreparationState,
  type CapabilityInventory,
  type CapabilityPreparationState,
} from '../runtime-config/runtime-capability-inventory.js';
import { displayRuntimeConfigCapabilityLabel } from '../runtime-config/runtime-config-capability-labels.js';
import type { RuntimeSetupTask } from '../runtime-config/runtime-setup-task-store.js';

export const HOME_CORE_CAPABILITIES = [
  'text.generate',
  'audio.synthesize',
  'audio.transcribe',
  'image.generate',
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
  unset: 'bg-[var(--nimi-text-muted)]',
  unknown: 'bg-[var(--nimi-text-muted)]',
};

const STATE_ICON_TONE: Record<CapabilityPreparationState, string> = {
  ready: 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success)]',
  preparing: 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]',
  attention: 'bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]',
  unset: 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]',
  unknown: 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]',
};

const STATE_CARD_STYLE: Record<CapabilityPreparationState, string> = {
  ready:
    'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] hover:-translate-y-0.5 hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]',
  preparing:
    'border-[var(--nimi-status-info)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] hover:-translate-y-0.5 hover:shadow-[var(--nimi-elevation-raised)]',
  attention:
    'border-[var(--nimi-status-warning)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] hover:-translate-y-0.5 hover:shadow-[var(--nimi-elevation-raised)]',
  unset:
    'border-dashed border-[var(--nimi-border-subtle)] bg-transparent hover:border-solid hover:border-[var(--nimi-border-strong)] hover:bg-[var(--nimi-surface-card)]',
  unknown:
    'border-dashed border-[var(--nimi-border-subtle)] bg-transparent hover:border-solid hover:border-[var(--nimi-border-strong)] hover:bg-[var(--nimi-surface-card)]',
};

export function deriveHomeCapabilityMatrixItems(input: {
  inventory: CapabilityInventory | undefined;
  tasks: readonly RuntimeSetupTask[];
  unavailable: boolean;
}): HomeCapabilityMatrixItem[] {
  return HOME_CORE_CAPABILITIES.map((capability) => {
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
    const modelLabel = loadout?.displayName || loadout?.loadoutId || null;
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
  const { t } = useTranslation();
  return (
    <AppCardSurface kind="promoted-glass" className="flex min-w-0 flex-col gap-3.5 p-5" data-testid="home-capability-matrix">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-action-primary-bg)]">
            <Cpu size={16} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.overview.capabilityMatrix.title')}
            </h2>
            {!loading && !failed ? (
              <button
                type="button"
                onClick={onOpenAllCapabilities}
                data-testid="home-status-capabilities"
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
                  readyCount > 0
                    ? 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success)]'
                    : 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-active)]'
                }`}
              >
                {t('runtimeConfig.overview.capabilityMatrix.readySummary', { count: readyCount })}
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button tone="ghost" size="sm" onClick={onOpenProfiles} data-testid="home-capability-profiles">
            {t('runtimeConfig.overview.capabilityMatrix.profilesAction')}
          </Button>
          <Button tone="ghost" size="sm" onClick={onOpenCloud} data-testid="home-capability-cloud">
            {t('runtimeConfig.overview.capabilityMatrix.cloudAction')}
          </Button>
        </div>
      </header>

      {loading ? (
        <LoadingSkeleton lines={2} label={t('Common.loading')} />
      ) : failed ? (
        <p className="text-sm text-[var(--nimi-status-warning)]" data-testid="home-capability-error">
          {t('runtimeConfig.capabilities.readFailed')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {items.map((item) => {
            const Icon = capabilityIcon(item.capability);
            const label = displayRuntimeConfigCapabilityLabel(item.capability, t);
            return (
              <button
                key={item.capability}
                type="button"
                onClick={() => onSelectCapability(item.capability)}
                data-testid={`home-capability-tile:${item.capability}`}
                data-state={item.state}
                className={`flex min-w-0 flex-col justify-between gap-2.5 rounded-xl border p-3 text-left transition-all duration-150 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${STATE_CARD_STYLE[item.state]}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${STATE_ICON_TONE[item.state]}`}>
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--nimi-text-secondary)]">
                    <span className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[item.state]}`} aria-hidden="true" />
                    <span>{t(`runtimeConfig.overview.capabilityMatrix.states.${item.state}`)}</span>
                  </span>
                </div>

                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-xs font-semibold text-[var(--nimi-text-primary)]">{label}</p>
                  <p className="truncate text-[11px] text-[var(--nimi-text-secondary)]">
                    {item.modelLabel ?? t('runtimeConfig.overview.capabilityMatrix.unsetHint')}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </AppCardSurface>
  );
}
