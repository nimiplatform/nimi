import { Button, InlineAlert, StatusBadge } from '@nimiplatform/kit/ui';
import '../ui/nimiday.css';
import { NimiDayProvider, useDayStore, useNimiDay } from './context.js';
import { Onboarding } from '../ui/onboarding.js';
import { Shell } from '../ui/shell.js';
import { UiHost } from '../ui/ui-host.js';

function Gate() {
  const { copy, store } = useNimiDay();
  const snapshot = useDayStore();
  if (snapshot.status === 'loading') {
    return (
      <div className="nd-center">
        <StatusBadge tone="neutral" shape="dot">{copy.common.loading}</StatusBadge>
      </div>
    );
  }
  if (snapshot.status === 'closed') {
    // The session this data belonged to has ended: reload from the current one.
    return (
      <div className="nd-center" data-testid="nd-session-ended">
        <InlineAlert tone="info" action={<Button size="sm" tone="secondary" onClick={() => globalThis.location?.reload()}>{copy.load.reload}</Button>}>
          <strong>{copy.load.sessionEndedTitle}</strong>
          <div>{copy.load.sessionEndedBody}</div>
        </InlineAlert>
      </div>
    );
  }
  if (snapshot.status === 'failed') {
    return (
      <div className="nd-center" data-testid="nd-load-failed">
        <InlineAlert tone="warning" action={<Button size="sm" tone="secondary" onClick={() => { void store.load(); }}>{copy.common.retry}</Button>}>
          <strong>{copy.load.failedTitle}</strong>
          <div>{copy.load.failedBody}</div>
          {snapshot.loadError ? <div className="nd-faint">{snapshot.loadError}</div> : null}
        </InlineAlert>
      </div>
    );
  }
  return (
    <UiHost>
      {snapshot.state.profile.onboarded ? <Shell /> : <Onboarding />}
    </UiHost>
  );
}

export function NimiDayApp() {
  return (
    <NimiDayProvider>
      <Gate />
    </NimiDayProvider>
  );
}
