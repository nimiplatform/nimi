import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowRight,
  CalendarCheck2,
  Clock,
  Monitor,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { createWebBrowserRealm } from './browser-realm.js';
import { AccountFeedback, AccountHeading } from './account-center-layout.js';
import { accountCenterCopy, type AccountCopyKey } from './account-center-copy.js';
import { InstallNimiPanel } from './account-overview.js';
import { detectVisitorPlatform, type DetectedPlatform } from '../pages/download-assets.js';

const AccountRuntimeManager = lazy(() =>
  import('./account-runtime-manager.js').then((module) => ({
    default: module.AccountRuntimeManager,
  })),
);

type Api = ReturnType<typeof createWebBrowserRealm>['generated'];
type Snapshot = Awaited<ReturnType<Api['getMyPrimaryRuntime']>>;
type Intent = Awaited<ReturnType<Api['getMyPrimaryRuntimeIntent']>>;

export type RuntimeLivePhase = 'idle' | 'connecting' | 'connected' | 'maintenance' | 'stopped';

export type RuntimeLiveSummary = {
  phase: RuntimeLivePhase;
  connectedPeers: number | null;
};

const IDLE_LIVE_SUMMARY: RuntimeLiveSummary = {
  phase: 'idle',
  connectedPeers: null,
};

function copyForLocale(locale: 'zh' | 'en') {
  const index = locale === 'zh' ? 1 : 0;
  return (key: AccountCopyKey) => accountCenterCopy[key][index];
}

function phaseStatusKey(phase: RuntimeLivePhase): AccountCopyKey {
  switch (phase) {
    case 'connecting':
      return 'runtimeStateConnecting';
    case 'connected':
      return 'runtimeStateRunning';
    case 'maintenance':
      return 'runtimeStateMaintenance';
    case 'stopped':
      return 'runtimeStateStopped';
    case 'idle':
    default:
      return 'runtimeStateStandby';
  }
}

function formatDateTime(iso: string, locale: 'zh' | 'en', futureOnlyTime: boolean): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const date = new Date(parsed);
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  if (futureOnlyTime) {
    return date.toLocaleTimeString(tag);
  }
  return date.toLocaleString(tag, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type AccountRuntimeViewProps = {
  locale?: 'zh' | 'en';
  platform: DetectedPlatform;
  userHandle?: string;
  snapshot: Snapshot | null;
  intent: Intent | null;
  loading: boolean;
  working: boolean;
  error: string | null;
  completed: boolean;
  verifyAgain: boolean;
  liveSummary?: RuntimeLiveSummary;
  nowMs?: number;
  onRefresh: () => void;
  onConfirm: () => void;
  onCancelIntent: () => void;
  onVerifyAgain: () => void;
  managerSlot?: ReactNode;
};

// @nimi-authority: rule.nimi.platform.product-lifecycle.primary-runtime-confirmation
export function AccountRuntimeView({
  locale = 'zh',
  platform,
  userHandle = '',
  snapshot,
  intent,
  loading,
  working,
  error,
  completed,
  verifyAgain,
  liveSummary = IDLE_LIVE_SUMMARY,
  nowMs,
  onRefresh,
  onConfirm,
  onCancelIntent,
  onVerifyAgain,
  managerSlot,
}: AccountRuntimeViewProps) {
  const c = copyForLocale(locale);
  const binding = snapshot?.binding ?? null;
  const referenceNow = nowMs ?? Date.now();
  const validAfterMs = binding?.validAfter ? Date.parse(binding.validAfter) : Number.NaN;
  const isActivationPending = Number.isFinite(validAfterMs) && validAfterMs > referenceNow;

  return (
    <div className="ac-host-page" data-host-view={intent ? 'intent' : binding ? 'bound' : loading ? 'loading' : 'unbound'}>
      <AccountHeading
        title={c('runtimeHeading')}
        description={c('runtimeIntro')}
        action={
          !working ? (
            <button
              type="button"
              className="ac-host-refresh"
              disabled={loading}
              onClick={onRefresh}
            >
              <RefreshCw size={14} aria-hidden="true" className={loading ? 'is-spinning' : undefined} />
              <span>{c('refresh')}</span>
            </button>
          ) : null
        }
      />

      <AccountFeedback error={error} message={completed ? c('runtimeConfirmed') : null} />

      {verifyAgain ? (
        <div className="ac-host-verify-banner" role="alert">
          <div className="ac-host-verify-copy">
            <ShieldAlert size={18} aria-hidden="true" />
            <span>{c('runtimeVerify')}</span>
          </div>
          <button
            type="button"
            className="ac-button ac-button--pill ac-button--small"
            disabled={working}
            onClick={onVerifyAgain}
          >
            {c('runtimeSignInAgain')}
          </button>
        </div>
      ) : null}

      {loading && !snapshot && !intent ? (
        <div className="ac-host-loading" role="status" aria-busy="true">
          <div className="ac-skeleton-block ac-skeleton-host-hero" />
          <div className="ac-skeleton-block ac-skeleton-host-deck" />
          <p className="ac-muted">{c('loading')}</p>
        </div>
      ) : (
        <>
          {intent ? (
            <section
              className={`ac-host-intent-card${intent.operation === 'reinitialize' ? ' ac-host-intent-card--reinit' : ''}`}
              aria-labelledby="ac-host-intent-title"
            >
              <div className="ac-host-intent-head">
                <span
                  className={`ac-pill ${intent.operation === 'reinitialize' ? 'ac-pill--warn' : 'ac-pill--brand'}`}
                >
                  {c(intent.operation === 'reinitialize' ? 'runtimeReplaceBadge' : 'runtimeBindBadge')}
                </span>
                <h2 id="ac-host-intent-title">
                  {intent.operation === 'reinitialize' ? c('runtimeReplace') : c('runtimeBind')}
                </h2>
              </div>

              {intent.operation === 'reinitialize' && binding ? (
                <div className="ac-host-diff">
                  <div className="ac-host-diff-node ac-host-diff-node--old">
                    <span>{c('runtimeCurrentHost')}</span>
                    <strong>{binding.displayName || c('runtime')}</strong>
                  </div>
                  <ArrowRight size={18} aria-hidden="true" className="ac-host-diff-arrow" />
                  <div className="ac-host-diff-node ac-host-diff-node--new">
                    <span>{c('runtimeNewHost')}</span>
                    <strong>{intent.displayName}</strong>
                  </div>
                </div>
              ) : (
                <div className="ac-host-target-chip">
                  <span className="ac-host-emblem ac-host-emblem--sm" aria-hidden="true">
                    <Monitor size={20} />
                  </span>
                  <div>
                    <span className="ac-host-eyebrow">{c('runtimeNewHost')}</span>
                    <strong>{intent.displayName}</strong>
                  </div>
                </div>
              )}

              {intent.operation === 'reinitialize' ? (
                <div className="ac-host-reinit-warning">
                  <div className="ac-host-reinit-warning-title">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <strong>{c('runtimeReinitWarningTitle')}</strong>
                  </div>
                  <ul>
                    <li>{c('runtimeNoMigration')}</li>
                    <li>{c('runtimeActivationWait')}</li>
                  </ul>
                </div>
              ) : (
                <p className="ac-host-intent-desc">{c('runtimeBindDescription')}</p>
              )}

              <div className="ac-actions ac-host-intent-actions">
                <button
                  type="button"
                  className={`ac-button ac-button--pill${intent.operation === 'reinitialize' ? ' ac-button--ink' : ''}`}
                  disabled={working || verifyAgain}
                  onClick={onConfirm}
                >
                  {working
                    ? c('saving')
                    : intent.operation === 'reinitialize'
                      ? c('runtimeReplace')
                      : c('runtimeBind')}
                </button>
                <button
                  type="button"
                  className="ac-button ac-button--secondary ac-button--pill"
                  disabled={working}
                  onClick={onCancelIntent}
                >
                  {c('cancel')}
                </button>
              </div>
            </section>
          ) : binding ? (
            <>
              <section
                className="ac-host-hero"
                data-host-phase={liveSummary.phase}
                aria-labelledby="ac-host-device-name"
              >
                <div className="ac-host-hero-top">
                  <div className="ac-host-identity">
                    <span className={`ac-host-emblem is-${liveSummary.phase}`} aria-hidden="true">
                      <Monitor size={24} />
                    </span>
                    <div className="ac-host-identity-copy">
                      <span className="ac-host-eyebrow">{c('runtimeHeroLabel')}</span>
                      <h2 id="ac-host-device-name">{binding.displayName || c('runtime')}</h2>
                      <p className="ac-host-identity-note">{c('runtimeBindingOnly')}</p>
                    </div>
                  </div>

                  <span
                    className={`ac-host-status-pill is-${liveSummary.phase}`}
                    role="status"
                  >
                    <span className="ac-host-status-dot" aria-hidden="true" />
                    <span>{c(phaseStatusKey(liveSummary.phase))}</span>
                  </span>
                </div>

                <div className="ac-host-hero-footer">
                  <div className="ac-host-hero-facts">
                    {binding.validAfter ? (
                      <span
                        className={`ac-host-fact${isActivationPending ? ' ac-host-fact--pending' : ''}`}
                      >
                        {isActivationPending ? (
                          <Clock size={14} aria-hidden="true" />
                        ) : (
                          <CalendarCheck2 size={14} aria-hidden="true" />
                        )}
                        <span>
                          {c(isActivationPending ? 'runtimeActivationTime' : 'runtimeEligibleSince')}{' '}
                          <time dateTime={binding.validAfter}>
                            {formatDateTime(binding.validAfter, locale, isActivationPending)}
                          </time>
                        </span>
                      </span>
                    ) : null}

                    {liveSummary.connectedPeers !== null ? (
                      <span className="ac-host-fact ac-host-fact--live">
                        <Activity size={14} aria-hidden="true" />
                        <span>
                          {liveSummary.connectedPeers} {c('runtimeActivePeers')}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  <Link to="/account" className="ac-host-space-link">
                    <span>{c('runtimeOpenSpace')}</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </section>

              {managerSlot}
            </>
          ) : snapshot ? (
            <section className="ac-hero-card ac-host-unbound-hero" aria-labelledby="ac-host-unbound-title">
              <div className="ac-host-unbound-head">
                <span className="ac-pill ac-pill--brand">{c('runtimeNotBound')}</span>
                <h2 id="ac-host-unbound-title">{c('runtimeUnboundHeading')}</h2>
                <p className="ac-host-unbound-lead">{c('runtimeStartHome')}</p>
              </div>

              <ol className="ac-host-steps-grid">
                <li>
                  <span className="ac-runtime-step-num" aria-hidden="true">01</span>
                  <div>
                    <strong>{c('runtimeStep1Title')}</strong>
                    <p>{c('runtimeStep1Body')}</p>
                  </div>
                </li>
                <li>
                  <span className="ac-runtime-step-num" aria-hidden="true">02</span>
                  <div>
                    <strong>
                      {c('runtimeStep2Title')}
                      {userHandle ? ` (@${userHandle})` : ''}
                    </strong>
                    <p>{c('runtimeStep2Body')}</p>
                  </div>
                </li>
                <li>
                  <span className="ac-runtime-step-num" aria-hidden="true">03</span>
                  <div>
                    <strong>{c('runtimeStep3Title')}</strong>
                    <p>{c('runtimeStep3Body')}</p>
                  </div>
                </li>
              </ol>

              <InstallNimiPanel platform={platform} locale={locale} compact />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.primary-runtime-confirmation
export function AccountRuntime({
  accountId,
  userHandle = '',
  onVerifyAgain,
}: {
  accountId: string;
  userHandle?: string;
  onVerifyAgain: () => void;
}) {
  const { i18n } = useTranslation();
  const locale: 'zh' | 'en' = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const c = useCallback(
    (key: AccountCopyKey) => accountCenterCopy[key][locale === 'zh' ? 1 : 0],
    [locale],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const intentId = new URLSearchParams(location.search).get('intent');
  const [platform, setPlatform] = useState<DetectedPlatform>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [verifyAgain, setVerifyAgain] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [liveSummary, setLiveSummary] = useState<RuntimeLiveSummary>(IDLE_LIVE_SUMMARY);
  const generation = useRef(0);

  useEffect(() => {
    setPlatform(detectVisitorPlatform());
  }, []);

  const report = useCallback(
    (reason: unknown) => {
      const code = extractNimiErrorFields(reason).reasonCode;
      setVerifyAgain(code === 'AUTH_RECENT_LOGIN_REQUIRED');
      setError(
        c(
          code === 'AUTH_RECENT_LOGIN_REQUIRED'
            ? 'runtimeVerify'
            : code === 'PRIMARY_RUNTIME_BINDING_CHANGED'
              ? 'runtimeChanged'
              : code === 'PRIMARY_RUNTIME_INTENT_UNAVAILABLE' || code === 'AUTH_SESSION_REVOKED'
                ? 'runtimeExpired'
                : 'runtimeFailed',
        ),
      );
    },
    [c],
  );

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setIntent(null);
    setVerifyAgain(false);
    try {
      const api = createWebBrowserRealm().generated;
      const [next, pending] = await Promise.all([
        api.getMyPrimaryRuntime({ path: {} }),
        intentId ? api.getMyPrimaryRuntimeIntent({ path: { intentId } }) : Promise.resolve(null),
      ]);
      if (current !== generation.current) return;
      if (next.accountId !== accountId || (pending && pending.expectedAccountId !== accountId)) {
        setError(c('runtimeWrongAccount'));
        return;
      }
      setSnapshot(next);
      setIntent(pending);
    } catch (reason) {
      if (current === generation.current) report(reason);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [accountId, intentId, c, report]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const activeBindingId = snapshot?.binding?.bindingId ?? null;
  useEffect(() => {
    setLiveSummary(IDLE_LIVE_SUMMARY);
  }, [activeBindingId, intentId]);

  async function confirm() {
    if (!intent || working) return;
    const current = generation.current;
    setWorking(true);
    setError(null);
    setVerifyAgain(false);
    try {
      const result = await createWebBrowserRealm().generated.confirmMyPrimaryRuntime({
        path: {},
        body: { intentId: intent.intentId, expectedAccountId: accountId },
      });
      if (current !== generation.current) return;
      if (result.accountId !== accountId) {
        setError(c('runtimeWrongAccount'));
        return;
      }
      setSnapshot(result);
      setIntent(null);
      setCompleted(true);
      navigate('/account/runtime', { replace: true });
    } catch (reason) {
      if (current === generation.current) report(reason);
    } finally {
      if (current === generation.current) setWorking(false);
    }
  }

  const managerSlot =
    snapshot?.binding && !intent ? (
      <Suspense
        fallback={
          <div className="ac-host-loading-inline" role="status" aria-busy="true">
            <div className="ac-skeleton-block ac-skeleton-host-deck" />
          </div>
        }
      >
        <AccountRuntimeManager
          key={snapshot.binding.bindingId}
          accountId={accountId}
          onLiveSummaryChange={setLiveSummary}
        />
      </Suspense>
    ) : null;

  return (
    <AccountRuntimeView
      locale={locale}
      platform={platform}
      userHandle={userHandle}
      snapshot={snapshot}
      intent={intent}
      loading={loading}
      working={working}
      error={error}
      completed={completed}
      verifyAgain={verifyAgain}
      liveSummary={liveSummary}
      onRefresh={() => void load()}
      onConfirm={() => void confirm()}
      onCancelIntent={() => navigate('/account/runtime', { replace: true })}
      onVerifyAgain={onVerifyAgain}
      managerSlot={managerSlot}
    />
  );
}
