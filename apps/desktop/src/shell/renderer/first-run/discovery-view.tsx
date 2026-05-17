// Discovery View — pure presentational React component for the Discovery tab.

import type { ReactElement } from 'react';
import type { DiscoveryProjection } from './discovery-projection.js';
import type { AppLaunchReadiness } from '@nimiplatform/sdk/app';

const ACTION_LABELS: Partial<Record<AppLaunchReadiness, string>> = {
  'install-required': 'Install',
  'update-required': 'Update',
  'repair-required': 'Repair',
};

export interface DiscoveryViewProps {
  readonly projection: DiscoveryProjection;
}

export function DiscoveryView({ projection }: DiscoveryViewProps): ReactElement {
  if (projection.status === 'error') {
    return (
      <section data-testid="discovery-view" aria-labelledby="discovery-view-title">
        <h2 id="discovery-view-title">Discovery</h2>
        <p data-testid="discovery-error" data-state="error">
          Unable to load discovery: {projection.detail}
        </p>
      </section>
    );
  }
  return (
    <section data-testid="discovery-view" aria-labelledby="discovery-view-title">
      <h2 id="discovery-view-title">Discovery</h2>
      {projection.entries.length === 0 ? (
        <p data-testid="discovery-empty" data-state="empty">No installable apps available right now.</p>
      ) : (
        <ul data-testid="discovery-entry-list">
          {projection.entries.map((entry) => {
            const readiness = entry.status?.launchReadiness;
            const action = readiness ? ACTION_LABELS[readiness] : undefined;
            return (
              <li
                key={entry.app.appId}
                data-testid={`discovery-entry-${entry.app.appId}`}
                data-trust-tier={entry.app.trustTier}
                data-launch-readiness={readiness ?? 'unknown'}
              >
                <span data-testid={`discovery-entry-${entry.app.appId}-name`}>{entry.app.displayName}</span>
                {action ? (
                  <span data-testid={`discovery-entry-${entry.app.appId}-action`}>{action}</span>
                ) : null}
                {entry.fetchError ? (
                  <span data-testid={`discovery-entry-${entry.app.appId}-error`}>{entry.fetchError}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
