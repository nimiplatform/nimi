import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrustTierId } from '@nimiplatform/sdk/app';
import type { DesktopAppsCardState, DesktopAppsPanelProjection } from './apps-panel-projection.js';

const TRUST_TIER_LABEL_KEYS: Record<TrustTierId, string> = {
  'nimi-first-party': 'Apps.trustTier.firstParty',
  'nimi-verified-partner': 'Apps.trustTier.verifiedPartner',
  'nimi-community': 'Apps.trustTier.community',
};

const CARD_STATE_LABEL_KEYS: Record<DesktopAppsCardState, string> = {
  not_installed_installable: 'Apps.state.notInstalledInstallable',
  installing: 'Apps.state.installing',
  installed_ready: 'Apps.state.installedReady',
  update_available: 'Apps.state.updateAvailable',
  update_required: 'Apps.state.updateRequired',
  permission_required: 'Apps.state.permissionRequired',
  repair_required: 'Apps.state.repairRequired',
  unsupported_on_this_device: 'Apps.state.unsupportedOnThisDevice',
  blocked_by_policy: 'Apps.state.blockedByPolicy',
  install_failed: 'Apps.state.installFailed',
  uninstalling: 'Apps.state.uninstalling',
  status_unavailable: 'Apps.state.statusUnavailable',
};

const CARD_STATE_TONES: Record<DesktopAppsCardState, string> = {
  not_installed_installable: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  installing: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  installed_ready: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  update_available: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  update_required: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  permission_required: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  repair_required: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  unsupported_on_this_device: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  blocked_by_policy: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,transparent)] text-[color:var(--nimi-text-muted)]',
  install_failed: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  uninstalling: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  status_unavailable: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_10%,transparent)] text-[color:var(--nimi-text-muted)]',
};

export interface AppsPanelViewProps {
  readonly projection: DesktopAppsPanelProjection;
}

export function AppsPanelView({ projection }: AppsPanelViewProps): ReactElement {
  const { t } = useTranslation();

  if (projection.status === 'error') {
    return (
      <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-3">
        <h2 id="apps-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">
          {t('Apps.title')}
        </h2>
        <p data-testid="apps-error" data-state="error" className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
          {t('Apps.error', { detail: projection.detail })}
        </p>
      </section>
    );
  }

  return (
    <section data-testid="apps-view" aria-labelledby="apps-view-title" className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="apps-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">
            {t('Apps.title')}
          </h2>
          <p className="mt-1 text-sm text-[color:var(--nimi-text-secondary)]">{t('Apps.description')}</p>
        </div>
        <span data-testid="apps-entry-count" className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-3 py-1 text-xs font-medium text-[color:var(--nimi-text-muted)]">
          {projection.entries.length}
        </span>
      </div>

      {projection.entries.length === 0 ? (
        <p data-testid="apps-empty" data-state="empty" className="rounded-lg border border-dashed border-[color:var(--nimi-border-subtle)] px-4 py-8 text-center text-sm text-[color:var(--nimi-text-muted)]">
          {t('Apps.empty')}
        </p>
      ) : (
        <ul data-testid="apps-entry-list" className="flex flex-col gap-2">
          {projection.entries.map((entry) => (
            <li
              key={entry.app.appId}
              data-testid={`apps-entry-${entry.app.appId}`}
              data-app-card-state={entry.cardState}
              data-trust-tier={entry.app.trustTier}
              data-launch-readiness={entry.status?.launchReadiness ?? 'unknown'}
              className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-2"
            >
              <div className="min-w-0">
                <span data-testid={`apps-entry-${entry.app.appId}-name`} className="block truncate text-sm font-medium text-[color:var(--nimi-text-primary)]">
                  {entry.app.displayName}
                </span>
                <span data-testid={`apps-entry-${entry.app.appId}-tier`} className="mt-0.5 block truncate text-xs text-[color:var(--nimi-text-muted)]">
                  {t(TRUST_TIER_LABEL_KEYS[entry.app.trustTier])}
                </span>
              </div>
              <span data-testid={`apps-entry-${entry.app.appId}-state`} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${CARD_STATE_TONES[entry.cardState]}`}>
                {t(CARD_STATE_LABEL_KEYS[entry.cardState])}
              </span>
              {entry.detail ? (
                <span data-testid={`apps-entry-${entry.app.appId}-detail`} className="sr-only">{entry.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
