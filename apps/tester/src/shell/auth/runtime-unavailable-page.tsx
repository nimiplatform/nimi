import type { NimiAppAuthUnavailable } from '@nimiplatform/sdk';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { appTitle } from './runtime-platform.js';

type RuntimeUnavailablePageProps = {
  projection?: NimiAppAuthUnavailable;
  message?: string;
  onRetry: () => void;
};

export function RuntimeUnavailablePage({ projection, message, onRetry }: RuntimeUnavailablePageProps) {
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
        {projection?.actionHint ? <p className="runtime-action-hint">{projection.actionHint}</p> : null}
        <Button type="button" tone="primary" onClick={onRetry}>Retry Runtime check</Button>
      </Surface>
    </main>
  );
}
