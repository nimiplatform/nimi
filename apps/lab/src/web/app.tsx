import { lazy, Suspense, useSyncExternalStore } from 'react';
import { Button, InlineAlert, LoadingSkeleton, Surface } from '@nimiplatform/kit/ui';
import type { NimiRendererHostBindingV1, NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { useTranslation } from '../shell/i18n/index.js';
import type { LabWebConnection } from './connection.js';

const Lab = lazy(async () => ({ default: (await import('../shell/App.js')).App }));

export function LabWebApp({ connection, rendererHost, configurationErrors }: {
  connection: LabWebConnection;
  rendererHost: NimiRendererHostBindingV1<NimiRendererHostMethodMap>;
  configurationErrors: readonly string[];
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const busy = ['signing-in', 'connecting', 'signing-out'].includes(state.phase);
  if (state.connection && state.phase === 'connected') return <div className="lab-web-shell">
    <header className="lab-web-connection-bar">
      <div><strong>{t('Auth.web.title')}</strong><span>{state.connection.primary.displayName} · {state.identity?.displayName}</span></div>
      <div className="lab-web-actions">
        <Button tone="secondary" size="sm" onClick={connection.disconnect}>{t('Auth.web.disconnect')}</Button>
        <Button tone="ghost" size="sm" onClick={() => void connection.signOut()}>{t('Auth.web.signOut')}</Button>
      </div>
    </header>
    <div className="lab-web-workbench"><Suspense fallback={<LoadingSkeleton lines={4} />}>
      <Lab key={state.connection.identity.contextId} rendererHost={rendererHost} webCarrier />
    </Suspense></div>
  </div>;
  return <main className="lab-web-connect">
    <Surface className="lab-web-connect-panel" tone="panel">
      <h1>{t('Auth.web.title')}</h1>
      <p>{t('Auth.web.intro')}</p>
      {state.identity && <p><strong>{state.identity.displayName}</strong></p>}
      <InlineAlert tone="info">{configurationErrors.length ? t('Auth.web.configure') : t(`Auth.web.states.${state.stage && state.phase === 'connecting' ? state.stage : state.phase}`)}</InlineAlert>
      <p>{t('Auth.web.prerequisite')}</p>
      {state.error && <InlineAlert tone="warning"><div><p>{t('Auth.web.failed')}</p><p>{state.error.message}</p><code>{state.error.reasonCode}</code></div></InlineAlert>}
      <div className="lab-web-actions">
        {state.identity && state.phase !== 'signed-out'
          ? <Button disabled={busy || configurationErrors.length > 0} onClick={() => void connection.connect()}>{t('Auth.web.connect')}</Button>
          : <Button disabled={busy || configurationErrors.length > 0} onClick={() => void connection.signIn()}>{t('Auth.web.signIn')}</Button>}
        {state.phase === 'connecting' && <Button tone="secondary" onClick={connection.disconnect}>{t('Auth.web.cancel')}</Button>}
        {state.identity && state.phase !== 'connecting' && <Button tone="secondary" disabled={busy} onClick={() => void connection.signOut()}>{t('Auth.web.signOut')}</Button>}
        {state.pendingRevocation && <Button tone="secondary" disabled={busy} onClick={() => void connection.signOut()}>{t('Auth.web.endContext')}</Button>}
      </div>
      <details className="lab-web-details"><summary>{t('Auth.web.details')}</summary>
        {configurationErrors.length > 0 && <ul>{configurationErrors.map(error => <li key={error}>{error}</li>)}</ul>}
        <p>{t('Auth.web.scope')}</p><p>{t('Auth.web.network')}</p>
      </details>
    </Surface>
  </main>;
}
