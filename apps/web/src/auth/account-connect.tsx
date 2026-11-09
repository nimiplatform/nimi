import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { createWebBrowserRealm } from './browser-realm.js';
import { AccountFeedback, AccountHeading } from './account-center-layout.js';
import { useAccountCopy } from './account-center-copy.js';
import { readRuntimeConnectRequest } from './runtime-connect-request.js';

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

  async function confirm() {
    if (!request || !source || busy) return;
    const current = generation.current;
    setBusy(true); setError(null);
    try {
      const result = await createWebBrowserRealm().generated.authorizeRuntimeClient({ path: {}, body: { ...request, expectedAccountId: accountId } });
      if (current !== generation.current) return;
      const callback = new URL(result.redirectUrl);
      const destination = new URL(source.redirectUri);
      if (callback.origin !== destination.origin || callback.pathname !== destination.pathname || callback.hash
        || callback.username || callback.password || callback.searchParams.get('state') !== request.state
        || !/^[A-Za-z0-9_-]{43}$/.test(callback.searchParams.get('code') || '') || [...callback.searchParams].length !== 2) throw new Error('Invalid authorization response');
      window.location.assign(callback.href);
    } catch {
      if (current === generation.current) { setError(c('connectFailed')); setBusy(false); }
    }
  }
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
    {source && <section className="ac-section">
      <h2>{source.displayName}</h2>
      <p>{source.origin}</p>
      <p>{c('connectIdentity')} <strong>{displayName}</strong></p>
      <p>{c(source.role === 'official_manager' ? 'connectManager' : 'connectConsumer')}</p>
      <div className="ac-actions">
        <button type="button" className="ac-button" disabled={busy} onClick={() => void confirm()}>{c(busy ? 'sending' : 'connectContinue')}</button>
        <button type="button" className="ac-button ac-button--secondary" disabled={busy} onClick={cancel}>{c('cancel')}</button>
      </div>
    </section>}
  </>;
}
