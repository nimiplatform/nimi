/**
 * Discoverable Developer Mode toggle (`D-DEV-002`).
 *
 * `D-DEV-002` requires Developer Mode's enable / disable / current-state
 * display to live at a discoverable in-app location — canonically `Settings`.
 * Developer Mode MUST NOT be reachable only through launch parameters,
 * environment variables, or hidden shortcuts. This component is that
 * discoverable entry: a self-contained card that shows the current state and
 * flips it.
 *
 * It writes through the canonical performance-preferences store
 * (`developer-mode.ts` → `settings-storage.ts`) so a single source of truth is
 * preserved; every gated surface (`Developer Tools`, standalone Tester
 * reference, mod UI) derives its reachability from that one persisted value.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isDeveloperModeEnabled,
  subscribeDeveloperMode,
  loadStoredPerformancePreferences,
  persistStoredPerformancePreferences,
} from './developer-mode.js';

export function DeveloperModeToggle() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => isDeveloperModeEnabled());

  // Keep in sync if Developer Mode is toggled elsewhere (e.g. another
  // discoverable entry or a second tab) — a single persisted truth.
  useEffect(() => {
    return subscribeDeveloperMode((next) => {
      setEnabled(next);
    });
  }, []);

  const toggle = () => {
    const next = !enabled;
    const prefs = loadStoredPerformancePreferences();
    persistStoredPerformancePreferences({ ...prefs, developerMode: next });
    setEnabled(next);
  };

  return (
    <div
      data-testid="developer-mode-toggle"
      data-developer-mode={enabled ? 'on' : 'off'}
      className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('DeveloperTools.developerModeTitle')}
          </p>
          <p className="max-w-xl text-xs text-[var(--nimi-text-secondary)]">
            {t('DeveloperTools.developerModeDescription')}
          </p>
          <p
            data-testid="developer-mode-status"
            className={
              enabled
                ? 'text-xs font-medium text-[var(--nimi-status-success)]'
                : 'text-xs font-medium text-[var(--nimi-text-muted)]'
            }
          >
            {enabled
              ? t('DeveloperTools.developerModeStatusOn')
              : t('DeveloperTools.developerModeStatusOff')}
          </p>
        </div>
        <button
          type="button"
          data-testid="developer-mode-toggle-button"
          aria-pressed={enabled}
          onClick={toggle}
          className={
            enabled
              ? 'rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-active)] px-3.5 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-action-ghost-hover)]'
              : 'rounded-lg bg-[var(--nimi-action-primary-bg)] px-3.5 py-2 text-xs font-medium text-[var(--nimi-action-primary-fg)] transition hover:bg-[var(--nimi-action-primary-bg-hover)]'
          }
        >
          {enabled
            ? t('DeveloperTools.developerModeDisable')
            : t('DeveloperTools.developerModeEnable')}
        </button>
      </div>
    </div>
  );
}
