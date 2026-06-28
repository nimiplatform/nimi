import { useMemo, useState } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/kit/auth';
import { InlineAlert } from '@nimiplatform/kit/ui';
import { createNimiAppDesktopBrowserAuthAdapter, createNimiAppRuntimeAccountBroker, nimiAppTauriOAuthBridge } from './runtime-account-auth.js';
import type { RuntimePlatformReadyProjection } from './runtime-platform.js';

type RuntimeLoginPageProps = {
  client: RuntimePlatformReadyProjection['client'];
  errorMessage?: string;
  layout?: 'screen' | 'panel';
  onReady: () => void;
};

export function RuntimeLoginPage({ client, errorMessage, layout = 'screen', onReady }: RuntimeLoginPageProps) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const adapter = useMemo(() => createNimiAppDesktopBrowserAuthAdapter(onReady, client), [client, onReady]);
  const runtimeAccountBroker = useMemo(() => createNimiAppRuntimeAccountBroker(client), [client]);

  return (
    <div className={`runtime-login-screen runtime-login-screen--${layout}`}>
      <DesktopShellAuthPage
        adapter={adapter}
        session={{
          mode: 'desktop-browser',
          authStatus: 'unauthenticated',
          authError: errorMessage || statusMessage,
          setAuthSession: () => { onReady(); },
          setStatusBanner: (banner) => { setStatusMessage(banner?.message || null); },
        }}
        desktopBrowserAuth={{
          bridge: nimiAppTauriOAuthBridge,
          runtimeAccountBroker,
          hintVisibility: 'always',
        }}
        testIds={{
          screen: 'nimi-app-runtime-login-page',
          logoTrigger: 'nimi-app-runtime-login-trigger',
        }}
      />
      {errorMessage ? (
        <InlineAlert className="runtime-login-alert" tone="warning">
          <div className="runtime-alert-copy">
            <strong>Runtime account required</strong>
            <span>{errorMessage}</span>
          </div>
        </InlineAlert>
      ) : null}
    </div>
  );
}
