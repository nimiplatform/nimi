import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { createWebBrowserRealm, webRealmOrigin } from './browser-realm.js';
import { AccountFeedback, AccountHeading } from './account-center-layout.js';
import { useAccountCopy } from './account-center-copy.js';
import { readRuntimeConnectRequest } from './runtime-connect-request.js';
import { runtimeClientConfirmationUrl } from '@nimiplatform/sdk/realm/runtime-client';

type Source = Awaited<ReturnType<ReturnType<typeof createWebBrowserRealm>['generated']['getRuntimeClientSource']>>;

// @nimi-authority: rule.nimi.platform.product-lifecycle.remote-client-sign-in
export function AccountConnect({ accountId, displayName }: { accountId: string; displayName: string }) {
  const c = useAccountCopy();
  const location = useLocation();
  const request = useMemo(() => readRuntimeConnectRequest(location.search), [location.search]);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setSource(null); setError(null); setLoading(true); setBusy(false);
    if (!request) { setError(c('connectInvalid')); setLoading(false); return; }
    void createWebBrowserRealm().generated.getRuntimeClientSource({ path: { clientId: request.clientId } }).then(result => {
      if (current !== generation.current) return;
      if (result.redirectUri !== request.redirectUri) { setError(c('connectInvalid')); return; }
      setSource(result);
    }).catch(() => { if (current === generation.current) setError(c('connectUnavailable')); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [request, c]);

  function cancel() {
    if (!request || !source || busy) return;
    const callback = new URL(source.redirectUri);
    callback.searchParams.set('error', 'access_denied'); callback.searchParams.set('state', request.state);
    window.location.assign(callback.href);
  }

  return <>
    <AccountHeading title={c('connect')} description={c('connectIntro')} />
    <AccountFeedback error={error} />
    {loading && <p role="status">{c('loading')}</p>}
    {source && request && <section className="ac-section">
      <h2>{source.displayName}</h2>
      <p>{source.origin}</p>
      {source.kind !== 'web' && <p>Android · {source.androidPackageName}{source.kind === 'android-dev-scheme' ? ' · 本机开发' : ''}</p>}
      <p>{c('connectIdentity')} <strong>{displayName}</strong></p>
      <p>{c(source.role === 'official_manager' ? 'connectManager' : 'connectConsumer')}</p>
      <form className="ac-actions" method="post" action={runtimeClientConfirmationUrl(webRealmOrigin())} onSubmit={() => setBusy(true)}>
        {Object.entries({ ...request, expectedAccountId: accountId }).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <button type="submit" className="ac-button" disabled={busy}>{c(busy ? 'sending' : 'connectContinue')}</button>
        <button type="button" className="ac-button ac-button--secondary" disabled={busy} onClick={cancel}>{c('cancel')}</button>
      </form>
    </section>}
  </>;
}
