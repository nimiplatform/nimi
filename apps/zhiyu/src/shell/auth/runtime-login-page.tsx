import { useMemo, useState } from 'react';
import { DesktopShellAuthPage } from '@nimiplatform/kit/auth';
import { InlineAlert } from '@nimiplatform/kit/ui';
import {
  createZhiyuDesktopBrowserAuthAdapter,
  createZhiyuRuntimeAccountBroker,
  zhiyuShellOAuthBridge,
} from './runtime-account-auth';
import type { RuntimePlatformReadyProjection } from './runtime-platform';

type RuntimeLoginPageProps = {
  readonly client: RuntimePlatformReadyProjection['client'];
  readonly errorMessage?: string;
  readonly layout?: 'screen' | 'panel';
  readonly onReady: () => void;
};

export function RuntimeLoginPage({
  client,
  errorMessage,
  layout = 'screen',
  onReady,
}: RuntimeLoginPageProps) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const adapter = useMemo(() => createZhiyuDesktopBrowserAuthAdapter(onReady, client), [client, onReady]);
  const runtimeAccountBroker = useMemo(() => createZhiyuRuntimeAccountBroker(client), [client]);

  return (
    <div className={`runtime-login-screen runtime-login-screen--${layout}`}>
      <DesktopShellAuthPage
        adapter={adapter}
        session={{
          mode: 'desktop-browser',
          authStatus: 'unauthenticated',
          authError: errorMessage || statusMessage,
          setAuthSession: () => {
            onReady();
          },
          setStatusBanner: (banner) => {
            setStatusMessage(banner?.message || null);
          },
        }}
        desktopBrowserAuth={{
          bridge: zhiyuShellOAuthBridge,
          runtimeAccountBroker,
          hintVisibility: 'always',
        }}
        testIds={{
          screen: 'zhiyu-runtime-login-page',
          logoTrigger: 'zhiyu-runtime-login-trigger',
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
