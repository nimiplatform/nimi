/**
 * Environment section — canonical six-section Runtime IA.
 *
 * Merges the retired `runtime` (Operations) and `data-management` sections
 * (Runtime Surface Cleanup table): Nimi-managed dependencies, engines, data
 * root, storage, and repair.
 *
 * Data-root relocation is not an admitted ordinary Desktop feature. This
 * surface shows current storage and repair controls without exposing a
 * placeholder migration path.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePage } from './runtime-config-page-runtime';
import { DataManagementPage } from '../settings/settings-data-management-page';
import { E2E_IDS } from '../../testability/e2e-ids';

type EnvironmentSubTabId = 'dependencies' | 'data';

type EnvironmentPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

const SUB_TABS: Array<{ id: EnvironmentSubTabId; labelKey: string; defaultLabel: string }> = [
  { id: 'dependencies', labelKey: 'runtimeConfig.environment.tabDependencies', defaultLabel: 'Dependencies & Engines' },
  { id: 'data', labelKey: 'runtimeConfig.environment.tabData', defaultLabel: 'Data & Storage' },
];

export function EnvironmentPage({ model, state }: EnvironmentPageProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<EnvironmentSubTabId>('dependencies');

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-1 px-5 pt-4"
        data-testid="runtime-environment-subtabs"
      >
        {SUB_TABS.map((tab) => {
          const active = tab.id === subTab;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`runtime-environment-subtab:${tab.id}`}
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {subTab === 'dependencies' ? (
          <div data-testid={E2E_IDS.runtimeEnvironmentPane('dependencies')} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RuntimePage model={model} state={state} />
          </div>
        ) : null}
        {subTab === 'data' ? (
          <div data-testid={E2E_IDS.runtimeEnvironmentPane('data')} className="min-w-0">
            <DataManagementPage />
          </div>
        ) : null}
      </div>
    </div>
  );
}
