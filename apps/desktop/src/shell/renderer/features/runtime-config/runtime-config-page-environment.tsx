/**
 * Environment section — canonical five-section Runtime IA.
 *
 * Merges the retired `runtime` (Operations) and `data-management` sections
 * (Runtime Surface Cleanup table): Nimi-managed dependencies, engines, data
 * root, and storage.
 *
 * Data-root relocation is not an admitted ordinary Desktop feature. The data
 * tab shows the runtime-scoped storage view only; account-level data actions
 * (cache, account deletion, logout) live exclusively in Settings.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PillTabs } from '@nimiplatform/kit/ui';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePage } from './runtime-config-page-runtime';
import { EnvironmentDataTab } from './runtime-config-environment-data-tab';
import { E2E_IDS } from '../../testability/e2e-ids';

type EnvironmentSubTabId = 'dependencies' | 'data';

type EnvironmentPageProps = {
  model: RuntimeConfigPanelControllerModel;
};

const SUB_TABS: Array<{ id: EnvironmentSubTabId; labelKey: string; defaultLabel: string }> = [
  { id: 'dependencies', labelKey: 'runtimeConfig.environment.tabDependencies', defaultLabel: 'Dependencies & Engines' },
  { id: 'data', labelKey: 'runtimeConfig.environment.tabData', defaultLabel: 'Data & Storage' },
];

export function EnvironmentPage({ model }: EnvironmentPageProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<EnvironmentSubTabId>('dependencies');

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-1 px-5 pt-4"
        data-testid="runtime-environment-subtabs"
      >
        <PillTabs
          size="sm"
          ariaLabel="Environment sections"
          items={SUB_TABS.map((tab) => ({
            value: tab.id,
            label: t(tab.labelKey, { defaultValue: tab.defaultLabel }),
          }))}
          value={subTab}
          onValueChange={(value) => setSubTab(value as EnvironmentSubTabId)}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {subTab === 'dependencies' ? (
          <div data-testid={E2E_IDS.runtimeEnvironmentPane('dependencies')} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RuntimePage model={model} />
          </div>
        ) : null}
        {subTab === 'data' ? (
          <div data-testid={E2E_IDS.runtimeEnvironmentPane('data')} className="min-w-0">
            <EnvironmentDataTab />
          </div>
        ) : null}
      </div>
    </div>
  );
}
