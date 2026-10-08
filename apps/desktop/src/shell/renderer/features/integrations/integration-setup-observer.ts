import type { NimiIntegrationConnectionSetup } from '@nimiplatform/sdk/app';

export const integrationSetupPending = (status: string) => ['awaiting-input', 'awaiting-confirmation', 'awaiting-new-target', 'verifying'].includes(status);

// A local observation deadline is independent of RPC completion. It does not
// assert a remote terminal status or issue a cancellation on the user's behalf.
export function observeIntegrationSetup(options: {
  setup: NimiIntegrationConnectionSetup;
  query: () => Promise<NimiIntegrationConnectionSetup>;
  update: (setup: NimiIntegrationConnectionSetup) => void;
  error: (cause: unknown) => void;
  expired: () => void;
}): () => void {
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { stopped = true; clearTimeout(pollTimer); clearTimeout(expiryTimer); };
  const deadline = Date.parse(options.setup.expiresAt || '');
  const expire = () => { if (!stopped) { stop(); options.expired(); } };
  const live = () => {
    if (stopped) return false;
    if (!Number.isFinite(deadline) || Date.now() >= deadline) { expire(); return false; }
    return true;
  };
  const poll = () => {
    if (!live()) return;
    void options.query().then(next => {
      if (!live()) return;
      options.update(next);
      if (integrationSetupPending(next.status)) pollTimer = setTimeout(poll, 1000);
      else stop();
    }).catch(cause => {
      if (!live()) return;
      options.error(cause);
      pollTimer = setTimeout(poll, 1000);
    });
  };
  expiryTimer = setTimeout(expire, Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0);
  pollTimer = setTimeout(poll, 1000);
  return stop;
}
