import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { appTitle, type RuntimePlatformUnavailableProjection } from './runtime-platform.js';

type RuntimeUnavailablePageProps = {
  projection?: RuntimePlatformUnavailableProjection;
  message?: string;
  offlineTier?: OfflineTier;
  onRetry: () => void;
};

export function RuntimeUnavailablePage({ projection, message, offlineTier, onRetry }: RuntimeUnavailablePageProps) {
  const body = message || projection?.message || 'Runtime session projection is not ready.';
  return (
    <main className="runtime-unavailable-screen">
      <Surface className="runtime-unavailable-panel" material="glass-thick" tone="panel" elevation="floating">
        <div className="runtime-unavailable-heading">
          <StatusBadge tone="warning" shape="dot">action required</StatusBadge>
          <h1>{appTitle}</h1>
        </div>
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>Runtime session unavailable</strong>
            <span>{body}</span>
          </div>
        </InlineAlert>
        {offlineTier ? <p className="runtime-action-hint">Offline tier: {offlineTier}</p> : null}
        {projection?.actionHint ? <p className="runtime-action-hint">{projection.actionHint}</p> : null}
        <Button type="button" tone="primary" onClick={onRetry}>Retry Runtime check</Button>
      </Surface>
    </main>
  );
}
