/**
 * Models section — canonical six-section Runtime IA.
 *
 * Merges the retired `recommend`, `local` (Local Models), and `catalog`
 * sections (Runtime Surface Cleanup table) into one section with an internal
 * sub-tab. Each sub-tab keeps its full original page composition; only the
 * top-level IA entry is collapsed.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RecommendPage } from './runtime-config-page-recommend';
import { LocalPage } from './runtime-config-page-local';
import { CatalogPage } from './runtime-config-page-catalog';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type ModelsSubTabId = 'recommend' | 'installed' | 'catalog';

type ModelsPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

const SUB_TABS: Array<{ id: ModelsSubTabId; labelKey: string; defaultLabel: string }> = [
  { id: 'recommend', labelKey: 'runtimeConfig.models.tabRecommend', defaultLabel: 'Recommended' },
  { id: 'installed', labelKey: 'runtimeConfig.models.tabInstalled', defaultLabel: 'Installed' },
  { id: 'catalog', labelKey: 'runtimeConfig.models.tabCatalog', defaultLabel: 'Model Catalog' },
];

export function ModelsPage({ model, state }: ModelsPageProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<ModelsSubTabId>('installed');
  useEffect(() => {
    if (state.actionFocus?.focus === 'runtime-config-action-focus.models-catalog-install') {
      setSubTab('catalog');
      model.updateState((prev) => ({
        ...prev,
        actionFocus: null,
      }));
    }
  }, [model, state.actionFocus]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-1 px-5 pt-4"
        data-testid="runtime-models-subtabs"
      >
        {SUB_TABS.map((tab) => {
          const active = tab.id === subTab;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`runtime-models-subtab:${tab.id}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => setSubTab(tab.id)}
              className={
                active
                  ? 'rounded-lg bg-[var(--nimi-action-primary-bg)] px-3.5 py-1.5 text-xs font-semibold text-white'
                  : 'rounded-lg px-3.5 py-1.5 text-xs font-medium text-[var(--nimi-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_70%,white)] hover:text-[var(--nimi-text-secondary)]'
              }
            >
              {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {subTab === 'recommend' ? (
          <div data-testid={E2E_IDS.runtimeModelsPane('recommend')}>
            <RecommendPage model={model} state={state} />
          </div>
        ) : null}
        {subTab === 'installed' ? (
          <div data-testid={E2E_IDS.runtimeModelsPane('installed')} className="flex min-h-0 flex-1 flex-col">
            <LocalPage model={model} state={state} />
          </div>
        ) : null}
        {subTab === 'catalog' ? (
          <div data-testid={E2E_IDS.runtimeModelsPane('catalog')}>
            <CatalogPage model={model} state={state} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
