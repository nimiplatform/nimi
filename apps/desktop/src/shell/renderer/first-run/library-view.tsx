// Library View — pure presentational React component for the Library tab.
//
// Renders a typed `LibraryProjection` from `projectLibrary`. Stateless;
// fail-closed: when projection.status === 'error', renders an error
// banner — never falls back to an empty Library list as if success.

import type { ReactElement } from 'react';
import type { LibraryProjection } from './library-projection.js';
import type { AppLaunchReadiness, TrustTierId } from '@nimiplatform/sdk/app';

const LAUNCH_READINESS_LABELS: Record<AppLaunchReadiness, string> = {
  ready: 'Ready to Launch',
  'install-required': 'Install Required',
  'update-required': 'Update Required',
  'repair-required': 'Repair Required',
  'permission-required': 'Permission Required',
  'blocked-by-master-gate': 'Pending Master Gate',
  unsupported: 'Unsupported on this Host',
};

const TRUST_TIER_LABELS: Record<TrustTierId, string> = {
  'nimi-first-party': 'First-Party',
  'nimi-verified-partner': 'Verified Partner',
  'nimi-community': 'Community',
};

const LAUNCH_READINESS_TONES: Record<AppLaunchReadiness, string> = {
  ready: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  'install-required': 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  'update-required': 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  'repair-required': 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  'permission-required': 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  'blocked-by-master-gate': 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,transparent)] text-[color:var(--nimi-text-muted)]',
  unsupported: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
};

export interface LibraryViewProps {
  readonly projection: LibraryProjection;
}

export function LibraryView({ projection }: LibraryViewProps): ReactElement {
  if (projection.status === 'error') {
    return (
      <section data-testid="library-view" aria-labelledby="library-view-title" className="flex h-full flex-col gap-3">
        <h2 id="library-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">Library</h2>
        <p data-testid="library-error" data-state="error" className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-3 py-2 text-sm leading-6 text-[var(--nimi-status-danger)]">
          Unable to load the app registry: {projection.detail}
        </p>
      </section>
    );
  }
  return (
    <section data-testid="library-view" aria-labelledby="library-view-title" className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="library-view-title" className="text-base font-semibold text-[color:var(--nimi-text-primary)]">Library</h2>
          <p className="mt-1 text-sm text-[color:var(--nimi-text-secondary)]">Installed and admitted Nimi apps.</p>
        </div>
        <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] px-3 py-1 text-xs font-medium text-[color:var(--nimi-text-muted)]">
          {projection.entries.length}
        </span>
      </div>
      {projection.entries.length === 0 ? (
        <p data-testid="library-empty" data-state="empty" className="rounded-lg border border-dashed border-[color:var(--nimi-border-subtle)] px-4 py-8 text-center text-sm text-[color:var(--nimi-text-muted)]">
          No admitted Nimi Apps yet.
        </p>
      ) : (
        <ul data-testid="library-entry-list" className="flex flex-col gap-2">
          {projection.entries.map((entry) => {
            const readiness = entry.status?.launchReadiness;
            return (
              <li
                key={entry.app.appId}
                data-testid={`library-entry-${entry.app.appId}`}
                data-trust-tier={entry.app.trustTier}
                data-launch-readiness={readiness ?? 'unknown'}
                className="flex min-h-14 items-center justify-between gap-4 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] px-3 py-2"
              >
                <div className="min-w-0">
                  <span data-testid={`library-entry-${entry.app.appId}-name`} className="block truncate text-sm font-medium text-[color:var(--nimi-text-primary)]">{entry.app.displayName}</span>
                  <span data-testid={`library-entry-${entry.app.appId}-tier`} className="mt-0.5 block truncate text-xs text-[color:var(--nimi-text-muted)]">{TRUST_TIER_LABELS[entry.app.trustTier]}</span>
                </div>
                <span data-testid={`library-entry-${entry.app.appId}-state`} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${readiness ? LAUNCH_READINESS_TONES[readiness] : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_10%,transparent)] text-[color:var(--nimi-text-muted)]'}`}>
                  {readiness ? LAUNCH_READINESS_LABELS[readiness] : 'Status Unavailable'}
                </span>
                {entry.fetchError ? (
                  <span data-testid={`library-entry-${entry.app.appId}-error`} className="sr-only">{entry.fetchError}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
