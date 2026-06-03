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
 * preserved; every gated developer surface derives its reachability from that
 * one persisted value.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isDeveloperModeEnabled,
  subscribeDeveloperMode,
  loadStoredPerformancePreferences,
  persistStoredPerformancePreferences,
} from './developer-mode.js';
import {
  describeDeveloperModeRuntimeSyncError,
  syncDeveloperModeRuntimeGate,
} from './developer-mode-runtime-sync.js';

export function DeveloperModeToggle() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => isDeveloperModeEnabled());
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep in sync if Developer Mode is toggled elsewhere (e.g. another
  // discoverable entry or a second tab) — a single persisted truth.
  useEffect(() => {
    return subscribeDeveloperMode((next) => {
      setEnabled(next);
    });
  }, []);

  const toggle = async () => {
    if (syncing) {
      return;
    }
    const next = !enabled;
    const flowId = `developer-mode-toggle-${Date.now().toString(36)}`;
    setSyncing(true);
    setError(null);
    try {
      await syncDeveloperModeRuntimeGate({ enabled: next, flowId });
      const prefs = loadStoredPerformancePreferences();
      persistStoredPerformancePreferences({ ...prefs, developerMode: next });
      setEnabled(next);
    } catch (syncError) {
      setError(describeDeveloperModeRuntimeSyncError(syncError));
    } finally {
      setSyncing(false);
    }
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
          {error ? (
            <p
              data-testid="developer-mode-sync-error"
              className="text-xs font-medium text-[var(--nimi-status-danger)]"
            >
              {error}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          data-testid="developer-mode-toggle-button"
          aria-pressed={enabled}
          disabled={syncing}
          onClick={toggle}
          className={
            enabled
              ? 'rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-active)] px-3.5 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-action-ghost-hover)] disabled:cursor-wait disabled:opacity-70'
              : 'rounded-lg bg-[var(--nimi-action-primary-bg)] px-3.5 py-2 text-xs font-medium text-[var(--nimi-action-primary-fg)] transition hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-wait disabled:opacity-70'
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
