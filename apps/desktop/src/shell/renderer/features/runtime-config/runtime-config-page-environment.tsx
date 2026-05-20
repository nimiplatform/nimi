/**
 * Environment section — canonical six-section Runtime IA.
 *
 * Merges the retired `runtime` (Operations) and `data-management` sections
 * (Runtime Surface Cleanup table): Nimi-managed dependencies, engines, data
 * root, storage, and repair.
 *
 * The nimi_data data-root migration entry is shipped as a fail-closed stub.
 * Migration mechanics are owned by portfolio topic T10 — this surface only
 * routes to a "not yet available" state and never performs a partial
 * migration.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { RuntimePage } from './runtime-config-page-runtime';
import { DataManagementPage } from '../settings/settings-data-management-page';
import { RuntimePageShell } from './runtime-config-page-shell';

type EnvironmentSubTabId = 'dependencies' | 'data';

type EnvironmentPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

const SUB_TABS: Array<{ id: EnvironmentSubTabId; labelKey: string; defaultLabel: string }> = [
  { id: 'dependencies', labelKey: 'runtimeConfig.environment.tabDependencies', defaultLabel: 'Dependencies & Engines' },
  { id: 'data', labelKey: 'runtimeConfig.environment.tabData', defaultLabel: 'Data & Storage' },
];

/**
 * Fail-closed nimi_data migration entry. T10 owns the migration mechanics; this
 * stub clearly routes to "not yet available" and performs no partial work.
 */
function DataRootMigrationStub() {
  const { t } = useTranslation();
  const [showUnavailable, setShowUnavailable] = useState(false);

  return (
    <section data-testid="runtime-environment-data-migration">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">
          {t('runtimeConfig.environment.migrationTitle', { defaultValue: 'Data Root Migration' })}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          {t('runtimeConfig.environment.migrationDescription', {
            defaultValue: 'Moving the nimi_data root to a new location is not yet available.',
          })}
        </p>
        <button
          type="button"
          data-testid="runtime-environment-data-migration-trigger"
          onClick={() => setShowUnavailable(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-400 shadow-sm"
        >
          {t('runtimeConfig.environment.migrationButton', { defaultValue: 'Migrate Data Root' })}
        </button>
        {showUnavailable ? (
          <p
            className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
            role="status"
            data-testid="runtime-environment-data-migration-unavailable"
          >
            {t('runtimeConfig.environment.migrationUnavailable', {
              defaultValue:
                'Data root migration is not yet available. This will be enabled in a future release; no partial migration is performed.',
            })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function EnvironmentPage({ model, state }: EnvironmentPageProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<EnvironmentSubTabId>('dependencies');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      <div className="flex min-h-0 flex-1 flex-col">
        {subTab === 'dependencies' ? (
          <div data-testid="runtime-environment-pane:dependencies" className="flex min-h-0 flex-1 flex-col">
            <RuntimePage model={model} state={state} />
          </div>
        ) : null}
        {subTab === 'data' ? (
          <div data-testid="runtime-environment-pane:data">
            <DataManagementPage />
            <RuntimePageShell maxWidth="4xl">
              <DataRootMigrationStub />
            </RuntimePageShell>
          </div>
        ) : null}
      </div>
    </div>
  );
}
