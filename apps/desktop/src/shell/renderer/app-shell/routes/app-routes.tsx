import { Suspense, lazy, useState, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { projectNimiProductControlAdmission, type NimiProductControlState } from '@nimiplatform/sdk/runtime';
import { useAppStore, type AuthStatus } from '../providers/app-store';
import { E2E_IDS } from '../../testability/e2e-ids';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { logoutAndClearSession, useLogoutSessionDependencies } from '../../features/auth/logout';
import { RuntimeLoadingScreen } from './runtime-loading-screen';
import { SupportDegradedEntry } from '../../features/support/support-degraded-entry.js';
import { AmbientBackground } from '@nimiplatform/kit/ui';
import { DesktopRecoveryActions, SharedStatusShell, STATUS_SHELL_PRIMARY_BUTTON, STATUS_SHELL_SECONDARY_BUTTON } from './status-shell';
import { RuntimeMaintenanceRecoveryScreen } from './runtime-maintenance-recovery';
import { retryRuntimeAccountConnectionNow } from '../../infra/bootstrap/auth-state-watcher.js';
import type { DesktopHomeProfileStatus } from '../../bridge/runtime-bridge/product-control.js';
import { DesktopFormalSessionGate } from './desktop-formal-session-gate.js';

const LoginPage = lazy(async () => {
  const mod = await import('../../features/auth/login-page');
  return { default: mod.LoginPage };
});

const MainLayout = lazy(async () => {
  const mod = await import('../layouts/main-layout');
  return { default: mod.MainLayout };
});

const FirstRunGatePanel = lazy(async () => {
  const mod = await import('../../features/nimi-home/first-run-gate-panel');
  return { default: mod.FirstRunGatePanel };
});

function BootstrapErrorScreen({ message, retryRuntimeService = false }: { message: string; retryRuntimeService?: boolean }) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [retrying, setRetrying] = useState(false);
  const [detail, setDetail] = useState(message);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (retryRuntimeService) await bindings.app.commands.firstRun.retryHomeProfile();
      else await bindings.app.commands.reloadApplication();
    } catch (error) { setDetail(error instanceof Error ? error.message : String(error)); }
    finally { setRetrying(false); }
  };
  return (
    <SharedStatusShell
      title={t('Bootstrap.startFailedTitle')}
      description={t('Bootstrap.startFailedDescription')}
    >
      <DesktopRecoveryActions
        testId={E2E_IDS.appBootstrapErrorScreen}
        retryLabel={t('Bootstrap.retryStart')}
        onRetry={() => { void retry(); }}
        retrying={retrying}
        technicalDetail={detail}
      />
    </SharedStatusShell>
  );
}

// Wave 1 of the route-admission single-point refactor: route decisions live
// at AppRoutes top-level only (LoginPage and ProductControlWorkflow never
// render `<Navigate>`). Pre-Wave-1 had those two surfaces racing each other
// and tripping Electron's `history.replaceState() > 100 / 10s` throttle.
//
// `desktopBridge.getProductControlRecord()` returns the persisted projection
// of `~/.nimi/nimi.json` — it does NOT re-run the backend admission. When
// the file's last write was `not_logged_in` (e.g. a previous session ended
// in failure), repeated reads will keep reporting `not_logged_in` forever;
// the only way to advance the file's state is the backend admission op
// `admitProductReadyForUse`, which is the sole writer of `ready_for_use`
// per P-COLD-016. So when we observe `not_logged_in` while the renderer
// store says authenticated, we request a fresh admission (the backend
// re-verifies all evidence including the runtime account session) and route
// on whatever state the backend returns:
//
//  - `ready_for_use`     → `ready`, mounts the ordinary shell
//  - `not_logged_in`     → `admission-failed`, surfaces the failure
//  - any other state     → `first-run`, hands off to the wizard
//
// Wave 8 behavioural invariant unchanged: only `ready_for_use` produces
// `ready`. Renderer never mints `ready_for_use`; it only requests admission.
type DesktopOrdinaryShellAdmission =
  | 'checking'
  | 'requesting-admission'
  | 'admission-failed'
  | 'login'
  | 'first-run'
  | 'ready';

type DesktopOrdinaryShellAdmissionHandle = {
  readonly admission: DesktopOrdinaryShellAdmission;
  readonly retry: () => void;
};

function accountRetainsOrdinaryShell(status: AuthStatus): boolean {
  return status === 'authenticated' || status === 'refresh-pending';
}

function accountRequiresLogin(status: AuthStatus): boolean {
  return status === 'anonymous'
    || status === 'login-pending'
    || status === 'expired'
    || status === 'reauth-required';
}

function useDesktopOrdinaryShellAdmission(
  authStatus: AuthStatus,
): DesktopOrdinaryShellAdmissionHandle {
  const [admission, setAdmission] = useState<DesktopOrdinaryShellAdmission>('checking');
  const [retryToken, setRetryToken] = useState(0);
  const bindings = useDesktopRendererBindings();

  useEffect(() => {
    if (authStatus === 'refresh-pending') {
      // Refresh is an in-place account transition. Preserve the last admitted
      // product shell instead of re-reading product control while Runtime is
      // deliberately pausing new Realm work. Reconciliation resumes from a
      // fresh authenticated projection after rotation completes.
      return;
    }
    if (authStatus === 'bootstrapping' || authStatus === 'unavailable') {
      setAdmission('checking');
      return;
    }
    let cancelled = false;
    let admissionRequested = false;

    const projectVerdict = (projection: { state: NimiProductControlState }) => {
      if (cancelled) return;
      const decision = projectNimiProductControlAdmission(projection.state);
      if (decision.kind === 'ordinary-shell') {
        setAdmission('ready');
        return;
      }
      if (decision.kind === 'login') {
        if (authStatus !== 'authenticated') {
          setAdmission('login');
          return;
        }
        // Only happens when the persisted record's last write was a failed
        // admission. The renderer cannot rescue this by reading harder; it
        // must request a fresh backend admission once. If the admission
        // result is still `not_logged_in`, the failure is real and we
        // surface it to the user.
        if (admissionRequested) {
          logRendererEvent({
            level: 'warn',
            area: 'shell',
            message: 'route-admission:backend-admission-returned-not-logged-in',
            details: { productControlState: projection.state },
          });
          setAdmission('admission-failed');
          return;
        }
        admissionRequested = true;
        setAdmission('requesting-admission');
        void bindings.app.commands.firstRun.admitReadyForUse()
          .then((next) => {
            projectVerdict(next);
          })
          .catch((error) => {
            if (cancelled) return;
            logRendererEvent({
              level: 'warn',
              area: 'shell',
              message: 'route-admission:admit-ready-for-use-failed',
              details: {
                error: error instanceof Error ? error.message : String(error),
              },
            });
            setAdmission('admission-failed');
          });
        return;
      }
      // Any other state is genuine first-run setup work. The first-run gate
      // owns ongoing projection refresh and calls onReadyForUse when setup
      // completes; avoid a parent-shell poll loop while setup is visible.
      setAdmission('first-run');
    };

    // Product Control owns first-run before account login. Read its local
    // projection for anonymous as well as authenticated account states so a
    // missing data root takes over the window before /login. Keep the current
    // verdict visible while an authenticated projection is rechecked (notably
    // after refresh-pending -> authenticated).
    void bindings.app.commands.firstRun.getRecord()
      .then(projectVerdict)
      .catch(() => {
        if (!cancelled) setAdmission('first-run');
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, bindings, retryToken]);

  return {
    admission,
    retry: () => setRetryToken((token) => token + 1),
  };
}

function DesktopFirstRunGate(props: {
  readonly onLoginRequired: () => void;
  readonly onReadyForUse: () => void;
}) {
  return (
    <AmbientBackground
      variant="mesh"
      className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
    >
      <div data-testid="desktop-first-run-gate" className="flex min-h-screen min-w-0">
        <Suspense fallback={<RuntimeLoadingScreen />}>
          <FirstRunGatePanel
            onLoginRequired={props.onLoginRequired}
            onReadyForUse={props.onReadyForUse}
          />
        </Suspense>
      </div>
    </AmbientBackground>
  );
}

function ReadyDesktopShell() {
  // The ordinary UI slice starts at Home. Do not overwrite an explicit App or
  // Chat intent already admitted while this shell was mounting.
  return <MainLayout />;
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-017a
function useHomeProfileStatus(enabled: boolean): DesktopHomeProfileStatus | null {
  const bindings = useDesktopRendererBindings();
  const [status, setStatus] = useState<DesktopHomeProfileStatus | null>(null);
  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    let disposed = false;
    const read = () => {
      void bindings.app.commands.firstRun.getHomeProfileStatus().then((next) => {
        if (!disposed) setStatus(next);
      }).catch(() => {
        if (!disposed) setStatus({ mode: 'bootstrap', workAllowed: false, relaunchRequested: false });
      });
    };
    read();
    // Reuse the existing Product Control observation rather than another poller.
    const unsubscribe = bindings.app.events.subscribeProductControlRecord(read);
    return () => { disposed = true; unsubscribe(); };
  }, [bindings, enabled]);
  return status;
}

function HomeProfileRepairScreen() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bindings.app.commands.firstRun.retryHomeProfile();
      if (!result.requested) setError(t('Support.homeProfileStillUnavailable'));
    } catch {
      setError(t('Support.homeProfileStillUnavailable'));
    } finally { setBusy(false); }
  };
  return (
    <SharedStatusShell title={t('Support.homeProfileTitle')} description={t('Support.homeProfileDescription')}>
      <div className="mt-4 flex flex-col items-center gap-4" data-testid="home-profile-repair">
        {error ? <p role="status" className="text-sm text-[var(--nimi-status-danger)]">{error}</p> : null}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" disabled={busy} onClick={() => { void retry(); }} className={STATUS_SHELL_PRIMARY_BUTTON}>
            {t('Support.homeProfileRetry')}
          </button>
          <SupportDegradedEntry />
        </div>
      </div>
    </SharedStatusShell>
  );
}

function DesktopOrdinaryShellGate() {
  const authStatus = useAppStore((state) => state.auth.status);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  const logoutDependencies = useLogoutSessionDependencies();
  const { admission: observedAdmission, retry: retryAdmission } = useDesktopOrdinaryShellAdmission(authStatus);
  const [firstRunReady, setFirstRunReady] = useState(false);
  const [firstRunLoginRequired, setFirstRunLoginRequired] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!accountRetainsOrdinaryShell(authStatus)) {
      setFirstRunReady(false);
    }
  }, [authStatus]);

  // Single root admission: unauthenticated renderer-store routes to /login
  // via an imperative navigate inside an effect. Rendering `<Navigate>` here
  // would re-fire history.replaceState on every gate re-render (react-router's
  // <Navigate> uses a no-deps effect), which is precisely what tripped the
  // pre-Wave-1 throttle when paired with LoginPage's reverse-Navigate.
  const admission: DesktopOrdinaryShellAdmission = firstRunLoginRequired
    ? 'login'
    : firstRunReady && accountRetainsOrdinaryShell(authStatus)
      ? 'ready'
      : observedAdmission;
  const homeProfile = useHomeProfileStatus(admission === 'ready');

  useEffect(() => {
    if (
      admission === 'login'
      || (admission === 'ready' && accountRequiresLogin(authStatus))
    ) {
      navigate('/login', { replace: true });
    }
  }, [admission, authStatus, navigate]);

  if (admission === 'checking' || admission === 'requesting-admission' || admission === 'login') {
    return <RuntimeLoadingScreen />;
  }
  if (admission === 'admission-failed') {
    return (
      <DesktopAdmissionFailedScreen
        onRetry={retryAdmission}
        onSignOut={() => {
          // logoutAndClearSession is the canonical desktop sign-out path: it
          // calls runtime.account.logout (so Runtime revokes its session and
          // token custody), kills in-flight streams, and
          // clears the React Query cache — in addition to clearAuthSession.
          // A bare clearAuthSession() would leave the runtime session intact,
          // so the admission-failed surface looks unresponsive.
          void logoutAndClearSession(
            { clearAuthSession, onFeedback: logoutDependencies.feedback },
            logoutDependencies.logout,
          );
        }}
      />
    );
  }
  if (admission === 'first-run') {
    return (
      <DesktopFirstRunGate
        onLoginRequired={() => setFirstRunLoginRequired(true)}
        onReadyForUse={() => setFirstRunReady(true)}
      />
    );
  }
  if (!accountRetainsOrdinaryShell(authStatus)) {
    return <RuntimeLoadingScreen />;
  }
  if (!homeProfile) return <RuntimeLoadingScreen />;
  if (!homeProfile.workAllowed) return <HomeProfileRepairScreen />;
  return (
    <DesktopFormalSessionGate>
      <Suspense fallback={<RuntimeLoadingScreen />}>
        <ReadyDesktopShell />
      </Suspense>
    </DesktopFormalSessionGate>
  );
}

function DesktopAdmissionFailedScreen(props: {
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SharedStatusShell
      title={t('Bootstrap.admissionFailedTitle', { defaultValue: 'Sign-in did not reach the local runtime' })}
      description={t('Bootstrap.admissionFailedDescription', {
        defaultValue:
          'Your account is signed in to the realm, but the local Nimi runtime has not received the session. This usually clears with a retry; if it does not, sign out and sign in again.',
      })}
    >
      <div
        data-testid="desktop-admission-failed"
        className="mt-4 flex w-full max-w-[18rem] flex-col gap-3"
      >
        <button
          type="button"
          data-testid="desktop-admission-failed-retry"
          onClick={props.onRetry}
          className={STATUS_SHELL_PRIMARY_BUTTON}
        >
          {t('Bootstrap.admissionFailedRetry', { defaultValue: 'Retry' })}
        </button>
        <button
          type="button"
          data-testid="desktop-admission-failed-sign-out"
          onClick={props.onSignOut}
          className={STATUS_SHELL_SECONDARY_BUTTON}
        >
          {t('Bootstrap.admissionFailedSignOut', { defaultValue: 'Sign out' })}
        </button>
      </div>
    </SharedStatusShell>
  );
}

function DesktopAccountUnavailableScreen() {
  const { t } = useTranslation();
  const failureDetail = useAppStore((state) => state.auth.failureDetail);
  return (
    <SharedStatusShell
      title={t('Auth.runtimeAccountUnavailableTitle')}
      description={t('Auth.runtimeAccountUnavailableDescription')}
    >
      <DesktopRecoveryActions
        testId="desktop-account-unavailable"
        status={t('Auth.runtimeAccountReconnecting')}
        retryLabel={t('Auth.runtimeAccountRetryNow')}
        onRetry={retryRuntimeAccountConnectionNow}
        technicalDetail={failureDetail}
      />
    </SharedStatusShell>
  );
}

// Matches the bootstrap watchdog: past this, the loading screen says Nimi is
// still starting and offers a reload and Support instead of reporting failure.
const DESKTOP_SLOW_START_MS = 25_000;

function DesktopBootstrapLoadingScreen() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  return (
    <RuntimeLoadingScreen
      slowAfterMs={DESKTOP_SLOW_START_MS}
      slowActions={(
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            data-testid="runtime-loading-slow-reload"
            onClick={() => { void bindings.app.commands.reloadApplication(); }}
            className={STATUS_SHELL_SECONDARY_BUTTON}
          >
            {t('Bootstrap.retryStart')}
          </button>
          <SupportDegradedEntry />
        </div>
      )}
    />
  );
}

export function AppRoutes() {
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const bootstrapError = useAppStore((state) => state.bootstrapError);
  const runtimeMaintenance = useAppStore((state) => state.runtimeMaintenance);
  const authStatus = useAppStore((state) => state.auth.status);
  const bindings = useDesktopRendererBindings();
  const [startupFailure, setStartupFailure] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void bindings.app.commands.firstRun.getHomeProfileStatus()
      .then(status => { if (active) setStartupFailure(status.startupFailure ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bindings]);

  // Single post-login handoff: the user-agent leaves /login exactly once when
  // the renderer-store flips to authenticated. Doing this here (instead of
  // inside LoginPage via `<Navigate to="/">`) keeps LoginPage out of the route
  // decision graph, so a transient renderer/product-control divergence can't
  // bounce the location between `/login` and `/` and trip the
  // history.replaceState throttle.
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (authStatus === 'authenticated' && location.pathname === '/login') {
      navigate('/', { replace: true });
    }
  }, [authStatus, location.pathname, navigate]);

  if (startupFailure) return <BootstrapErrorScreen message={startupFailure} retryRuntimeService />;

  if (!bootstrapReady && !bootstrapError) {
    return <DesktopBootstrapLoadingScreen />;
  }

  // The owner's typed refusal outranks every other start state: Runtime
  // serves nothing else, and this page is the way forward (shell-runtime r025).
  if (runtimeMaintenance) {
    return <RuntimeMaintenanceRecoveryScreen reasonCode={runtimeMaintenance} />;
  }

  if (bootstrapError) {
    return <BootstrapErrorScreen message={bootstrapError} />;
  }

  if (authStatus === 'unavailable') {
    return <DesktopAccountUnavailableScreen />;
  }

  return (
    <Routes>
      <Route path="/" element={<DesktopOrdinaryShellGate />} />
      <Route
        path="/login"
        element={(
          <Suspense fallback={<RuntimeLoadingScreen />}>
            <LoginPage />
          </Suspense>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
