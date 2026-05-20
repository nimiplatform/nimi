/**
 * Advanced section — canonical six-section Runtime IA.
 *
 * Merges the retired `performance` section (Runtime Surface Cleanup table) and
 * gates Mods / Mod Developer surfaces behind admitted Developer Mode. Mods are
 * NOT an ordinary Runtime section — they only appear here when Developer Mode
 * is enabled in Preferences & Updates.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { ModsPage } from './runtime-config-page-mods';
import { PerformancePage } from '../settings/settings-performance-page';
import {
  loadStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
} from '../settings/settings-storage';

type AdvancedSubTabId = 'preferences' | 'developer';

type AdvancedPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function AdvancedPage({ model, state }: AdvancedPageProps) {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<AdvancedSubTabId>('preferences');
  const [developerMode, setDeveloperMode] = useState(
    () => loadStoredPerformancePreferences().developerMode === true,
  );

  // Developer Mode is an admitted preference; subscribe so the gate reacts
  // immediately when the user toggles it in Preferences & Updates.
  useEffect(() => {
    return subscribeStoredPerformancePreferences((prefs) => {
      setDeveloperMode(prefs.developerMode === true);
    });
  }, []);

  // If Developer Mode is disabled while the Developer tab is active, fall back
  // to Preferences so no developer surface is reachable without the gate.
  useEffect(() => {
    if (!developerMode && subTab === 'developer') {
      setSubTab('preferences');
    }
  }, [developerMode, subTab]);

  const subTabs: Array<{ id: AdvancedSubTabId; labelKey: string; defaultLabel: string }> = [
    { id: 'preferences', labelKey: 'runtimeConfig.advanced.tabPreferences', defaultLabel: 'Preferences & Updates' },
  ];
  if (developerMode) {
    subTabs.push({ id: 'developer', labelKey: 'runtimeConfig.advanced.tabDeveloper', defaultLabel: 'Developer Tools' });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-1 px-5 pt-4"
        data-testid="runtime-advanced-subtabs"
      >
        {subTabs.map((tab) => {
          const active = tab.id === subTab;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`runtime-advanced-subtab:${tab.id}`}
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
        {subTab === 'preferences' ? (
          <div data-testid="runtime-advanced-pane:preferences">
            <PerformancePage />
          </div>
        ) : null}
        {subTab === 'developer' && developerMode ? (
          <div data-testid="runtime-advanced-pane:developer" className="flex min-h-0 flex-1 flex-col">
            <ModsPage model={model} state={state} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
