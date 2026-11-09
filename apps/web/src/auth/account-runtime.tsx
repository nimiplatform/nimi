import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { createWebBrowserRealm } from './browser-realm.js';
import { AccountFeedback, AccountHeading } from './account-center-layout.js';
import { useAccountCopy } from './account-center-copy.js';

const AccountRuntimeManager = lazy(() => import('./account-runtime-manager.js').then(module => ({ default: module.AccountRuntimeManager })));

type Api = ReturnType<typeof createWebBrowserRealm>['generated'];
type Snapshot = Awaited<ReturnType<Api['getMyPrimaryRuntime']>>;
type Intent = Awaited<ReturnType<Api['getMyPrimaryRuntimeIntent']>>;

// @nimi-authority: rule.nimi.platform.product-lifecycle.primary-runtime-confirmation
export function AccountRuntime({ accountId, onVerifyAgain }: {
  accountId: string;
  onVerifyAgain: () => void;
}) {
  const c = useAccountCopy();
  const location = useLocation();
  const navigate = useNavigate();
  const intentId = new URLSearchParams(location.search).get('intent');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [verifyAgain, setVerifyAgain] = useState(false);
  const [completed, setCompleted] = useState(false);
  const generation = useRef(0);
  const report = useCallback((reason: unknown) => {
    const code = extractNimiErrorFields(reason).reasonCode;
    setVerifyAgain(code === 'AUTH_RECENT_LOGIN_REQUIRED');
    setError(c(code === 'AUTH_RECENT_LOGIN_REQUIRED' ? 'runtimeVerify' :
      code === 'PRIMARY_RUNTIME_BINDING_CHANGED' ? 'runtimeChanged' :
      code === 'PRIMARY_RUNTIME_INTENT_UNAVAILABLE' || code === 'AUTH_SESSION_REVOKED' ? 'runtimeExpired' : 'runtimeFailed'));
  }, [c]);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(null); setIntent(null); setVerifyAgain(false);
    try {
      const api = createWebBrowserRealm().generated;
      const [next, pending] = await Promise.all([
        api.getMyPrimaryRuntime({ path: {} }),
        intentId ? api.getMyPrimaryRuntimeIntent({ path: { intentId } }) : Promise.resolve(null),
      ]);
      if (current !== generation.current) return;
      if (next.accountId !== accountId || (pending && pending.expectedAccountId !== accountId)) {
        setError(c('runtimeWrongAccount')); return;
      }
      setSnapshot(next); setIntent(pending);
    } catch (reason) { if (current === generation.current) report(reason); }
    finally { if (current === generation.current) setLoading(false); }
  }, [accountId, intentId, c, report]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  async function confirm() {
    if (!intent || working) return;
    const current = generation.current;
    setWorking(true); setError(null); setVerifyAgain(false);
    try {
      const result = await createWebBrowserRealm().generated.confirmMyPrimaryRuntime({
        path: {}, body: { intentId: intent.intentId, expectedAccountId: accountId },
      });
      if (current !== generation.current) return;
      if (result.accountId !== accountId) { setError(c('runtimeWrongAccount')); return; }
      setSnapshot(result); setIntent(null); setCompleted(true);
      navigate('/account/runtime', { replace: true });
    } catch (reason) { if (current === generation.current) report(reason); }
    finally { if (current === generation.current) setWorking(false); }
  }

  return <>
    <AccountHeading title={c('runtime')} description={c('runtimeIntro')} />
    <AccountFeedback error={error} message={completed ? c('runtimeConfirmed') : null} />
    {loading ? <p role="status">{c('loading')}</p> : <>
      {snapshot && <section className="ac-section">
        <h2>{snapshot.binding?.displayName || c('runtimeNotBound')}</h2>
        <p>{snapshot.binding ? c('runtimeBindingOnly') : c('runtimeStartHome')}</p>
      </section>}
      {intent && <section className="ac-section">
        <h2>{intent.operation === 'reinitialize' ? c('runtimeReplace') : c('runtimeBind')}</h2>
        <p><strong>{intent.displayName}</strong></p>
        <p>{intent.operation === 'reinitialize' ? c('runtimeNoMigration') : c('runtimeBindDescription')}</p>
        <div className="ac-actions">
          <button type="button" className="ac-button" disabled={working || verifyAgain} onClick={() => void confirm()}>
            {working ? c('saving') : intent.operation === 'reinitialize' ? c('runtimeReplace') : c('runtimeBind')}
          </button>
          <button type="button" className="ac-button ac-button--secondary" disabled={working} onClick={() => navigate('/account/runtime', { replace: true })}>{c('cancel')}</button>
        </div>
      </section>}
      {verifyAgain && <button type="button" className="ac-button" disabled={working} onClick={onVerifyAgain}>{c('runtimeSignInAgain')}</button>}
      {!working && <button type="button" className="ac-text-button" onClick={() => void load()}>{c('refresh')}</button>}
      {snapshot?.binding && !intent && <Suspense fallback={<p role="status">{c('loading')}</p>}><AccountRuntimeManager key={snapshot.binding.bindingId} accountId={accountId} /></Suspense>}
    </>}
  </>;
}
