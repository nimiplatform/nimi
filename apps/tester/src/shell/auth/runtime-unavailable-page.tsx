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
  const nextAction = userAction(projection?.actionHint);
  return (
    <main className="runtime-unavailable-screen" aria-live="polite">
      <Surface className="runtime-unavailable-panel" material="glass-thick" tone="panel" elevation="floating">
        <div className="runtime-unavailable-heading">
          <StatusBadge tone="warning" shape="dot">Setup required</StatusBadge>
          <h1>{appTitle}</h1>
        </div>
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>Nimi Desktop connection required</strong>
            <span>{body}</span>
          </div>
        </InlineAlert>
        {offlineTier ? <p className="runtime-action-hint">Protection state: offline tier {offlineTier}</p> : null}
        {nextAction ? <p className="runtime-action-hint">Next: {nextAction}</p> : null}
        <Button type="button" tone="primary" onClick={onRetry}>Retry Runtime check</Button>
      </Surface>
    </main>
  );
}

function userAction(actionHint: string | undefined): string {
  switch (actionHint) {
    case 'approve_project_in_nimi_desktop':
    case 'complete_local_app_authorization':
      return 'Review and approve this project in Nimi Desktop.';
    case 'restart_official_nimi_app_dev_command':
      return 'Run the official development command again.';
    case 'restore_authorized_project_identity':
    case 'readmit_local_development_project':
      return 'Restore the approved app ID, project root, shell, and capabilities.';
    case 'open_nimi_desktop_and_retry':
    case 'start_fixed_runtime_service':
      return 'Open Nimi Desktop, confirm Runtime is available, then retry.';
    case 'restart_through_verified_desktop_supervisor':
      return 'Close this process and relaunch the project through Nimi Desktop.';
    case 'reopen_local_app_session':
      return 'Reopen the protected local-app session through Nimi Desktop.';
    case 'reauthorize_for_current_account':
      return 'Authorize this project for the current Nimi account.';
    default:
      return '';
  }
}
