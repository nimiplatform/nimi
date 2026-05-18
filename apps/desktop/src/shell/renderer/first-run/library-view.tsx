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

export interface LibraryViewProps {
  readonly projection: LibraryProjection;
}

export function LibraryView({ projection }: LibraryViewProps): ReactElement {
  if (projection.status === 'error') {
    return (
      <section data-testid="library-view" aria-labelledby="library-view-title">
        <h2 id="library-view-title">Library</h2>
        <p data-testid="library-error" data-state="error">
          Unable to load the app registry: {projection.detail}
        </p>
      </section>
    );
  }
  return (
    <section data-testid="library-view" aria-labelledby="library-view-title">
      <h2 id="library-view-title">Library</h2>
      {projection.entries.length === 0 ? (
        <p data-testid="library-empty" data-state="empty">No admitted Nimi Apps yet.</p>
      ) : (
        <ul data-testid="library-entry-list">
          {projection.entries.map((entry) => {
            const readiness = entry.status?.launchReadiness;
            return (
              <li
                key={entry.app.appId}
                data-testid={`library-entry-${entry.app.appId}`}
                data-trust-tier={entry.app.trustTier}
                data-launch-readiness={readiness ?? 'unknown'}
              >
                <span data-testid={`library-entry-${entry.app.appId}-name`}>{entry.app.displayName}</span>
                <span data-testid={`library-entry-${entry.app.appId}-tier`}>{TRUST_TIER_LABELS[entry.app.trustTier]}</span>
                <span data-testid={`library-entry-${entry.app.appId}-state`}>
                  {readiness ? LAUNCH_READINESS_LABELS[readiness] : 'Status Unavailable'}
                </span>
                {entry.fetchError ? (
                  <span data-testid={`library-entry-${entry.app.appId}-error`}>{entry.fetchError}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
