// Discovery View — pure presentational React component for the Discovery tab.

import type { ReactElement } from 'react';
import type { DiscoveryProjection } from './discovery-projection.js';
import type { AppLaunchReadiness } from '@nimiplatform/sdk/app';

const ACTION_LABELS: Partial<Record<AppLaunchReadiness, string>> = {
  'install-required': 'Install',
  'update-required': 'Update',
  'repair-required': 'Repair',
};

const ACTION_TONES: Partial<Record<AppLaunchReadiness, string>> = {
  'install-required': 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-fg)]',
  'update-required': 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
  'repair-required': 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] text-[var(--nimi-status-warning)]',
};

export interface DiscoveryViewProps {
  readonly projection: DiscoveryProjection;
}

export function DiscoveryView({ projection }: DiscoveryViewProps): ReactElement {
  if (projection.status === 'error') {
    return (
      <section data-testid="discovery-view" aria-labelledby="discovery-view-title" className="flex h-full flex-col gap-3">
        <h2 id="discovery-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">Discovery</h2>
        <p data-testid="discovery-error" data-state="error" className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
          Unable to load discovery: {projection.detail}
        </p>
      </section>
    );
  }
  return (
    <section data-testid="discovery-view" aria-labelledby="discovery-view-title" className="flex h-full flex-col gap-4">
      <div>
        <h2 id="discovery-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">Discovery</h2>
        <p className="mt-1 text-sm text-[color:var(--nimi-text-secondary)]">Apps available for this Nimi install.</p>
      </div>
      {projection.entries.length === 0 ? (
        <p data-testid="discovery-empty" data-state="empty" className="rounded-lg border border-dashed border-[color:var(--nimi-border-subtle)] px-4 py-8 text-center text-sm text-[color:var(--nimi-text-muted)]">
          No installable apps available right now.
        </p>
      ) : (
        <ul data-testid="discovery-entry-list" className="flex flex-col gap-2">
          {projection.entries.map((entry) => {
            const readiness = entry.status?.launchReadiness;
            const action = readiness ? ACTION_LABELS[readiness] : undefined;
            return (
              <li
                key={entry.app.appId}
                data-testid={`discovery-entry-${entry.app.appId}`}
                data-trust-tier={entry.app.trustTier}
                data-launch-readiness={readiness ?? 'unknown'}
                className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-2"
              >
                <span data-testid={`discovery-entry-${entry.app.appId}-name`} className="min-w-0 truncate text-sm font-medium text-[color:var(--nimi-text-primary)]">{entry.app.displayName}</span>
                {action ? (
                  <span data-testid={`discovery-entry-${entry.app.appId}-action`} className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${readiness ? ACTION_TONES[readiness] : ''}`}>
                    {action}
                  </span>
                ) : null}
                {entry.fetchError ? (
                  <span data-testid={`discovery-entry-${entry.app.appId}-error`} className="sr-only">{entry.fetchError}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
