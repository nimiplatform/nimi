import { Suspense, lazy, useState, useEffect, type ReactNode, type MouseEvent } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { AmbientBackground, Surface } from '@nimiplatform/kit/ui';
import { projectNimiProductControlAdmission, type NimiProductControlState } from '@nimiplatform/sdk/runtime';
import { useAppStore, type AuthStatus } from '@renderer/app-shell/providers/app-store';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { desktopBridge } from '@renderer/bridge';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { logoutAndClearSession } from '@renderer/features/auth/logout';
import bootstrapLogoImage from '../../assets/logo.png';
import { RuntimeLoadingScreen } from './runtime-loading-screen';

const LoginPage = lazy(async () => {
  const mod = await import('@renderer/features/auth/login-page');
  return { default: mod.LoginPage };
});

const MainLayout = lazy(async () => {
  const mod = await import('@renderer/app-shell/layouts/main-layout');
  return { default: mod.MainLayout };
});

const FirstRunGatePanel = lazy(async () => {
  const mod = await import('@renderer/features/nimi-home/first-run-gate-panel');
  return { default: mod.FirstRunGatePanel };
});

function NimiLogoMark({ className = 'h-12 w-12' }: { className?: string }) {
  return (
    <img src={bootstrapLogoImage} alt="" className={`${className} object-contain`} aria-hidden="true" />
  );
}

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;

function SharedStatusShell(props: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  const flags = getShellFeatureFlags();

  const onDragRegionMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!flags.enableTitlebarDrag) return;
    if (event.button !== 0) return;
    if (event.detail > 1) return;
    if (event.clientX < MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX) return;
    void desktopBridge.startWindowDrag().catch(() => {
      // no-op
    });
  };

  return (
    <AmbientBackground
      variant="mesh"
      className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 z-20 h-8"
        onMouseDown={onDragRegionMouseDown}
      />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <Surface
          as="section"
          tone="panel"
          material="glass-regular"
          padding="none"
          className="w-full max-w-[420px] rounded-2xl px-6 py-7 sm:px-7 sm:py-8"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)]">
              <NimiLogoMark className="h-10 w-10" />
            </div>
            <div className="mb-3 rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,var(--nimi-surface-card))] bg-[var(--nimi-surface-active)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nimi-action-primary-bg-hover)]">
              {props.eyebrow}
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--nimi-text-primary)]">
              {props.title}
            </h1>
            {props.description ? (
              <p className="mt-3 max-w-[28rem] text-sm leading-6 text-[var(--nimi-text-secondary)]">
                {props.description}
              </p>
            ) : null}
            {props.children}
          </div>
        </Surface>
      </div>
    </AmbientBackground>
  );
}

function BootstrapErrorScreen({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <SharedStatusShell
      eyebrow="Nimi Runtime"
      title={t('Bootstrap.startFailedTitle')}
      description={message}
    >
      <div
        data-testid={E2E_IDS.appBootstrapErrorScreen}
        className="mt-8 rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,white)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,white)] px-4 py-3 text-sm text-[var(--nimi-status-danger)]"
      >
        Runtime bootstrap stopped before the app shell became available.
      </div>
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

  useEffect(() => {
    if (authStatus === 'refresh-pending') {
      // Refresh is an in-place account transition. Preserve the last admitted
      // product shell instead of re-reading product control while Runtime is
      // deliberately pausing new Realm work. Reconciliation resumes from a
      // fresh authenticated projection after rotation completes.
      return;
    }
    if (authStatus !== 'authenticated') {
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
          setAdmission('checking');
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
        void desktopBridge.admitProductReadyForUse()
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

    // Keep the current verdict visible while an authenticated projection is
    // rechecked (notably after refresh-pending -> authenticated). Initial boot
    // already starts at `checking`; a completed shell must not be torn down
    // merely because token rotation advanced the account sequence.
    void desktopBridge.getProductControlRecord()
      .then(projectVerdict)
      .catch(() => {
        if (!cancelled) setAdmission('first-run');
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, retryToken]);

  return {
    admission,
    retry: () => setRetryToken((token) => token + 1),
  };
}

function DesktopFirstRunGate(props: { readonly onReadyForUse: () => void }) {
  return (
    <AmbientBackground
      variant="mesh"
      className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
    >
      <div data-testid="desktop-first-run-gate" className="flex min-h-screen min-w-0">
        <Suspense fallback={<RuntimeLoadingScreen />}>
          <FirstRunGatePanel onReadyForUse={props.onReadyForUse} />
        </Suspense>
      </div>
    </AmbientBackground>
  );
}

function ReadyDesktopShell() {
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  useEffect(() => {
    setActiveTab('chat');
  }, [setActiveTab]);

  return <MainLayout />;
}

function DesktopOrdinaryShellGate() {
  const authStatus = useAppStore((state) => state.auth.status);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  const { admission: observedAdmission, retry: retryAdmission } = useDesktopOrdinaryShellAdmission(authStatus);
  const [firstRunReady, setFirstRunReady] = useState(false);
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
  useEffect(() => {
    if (accountRequiresLogin(authStatus)) {
      navigate('/login', { replace: true });
    }
  }, [authStatus, navigate]);

  const admission: DesktopOrdinaryShellAdmission = firstRunReady ? 'ready' : observedAdmission;

  if (!accountRetainsOrdinaryShell(authStatus)) {
    return <RuntimeLoadingScreen />;
  }
  if (admission === 'checking' || admission === 'requesting-admission') {
    return <RuntimeLoadingScreen />;
  }
  if (admission === 'admission-failed') {
    return (
      <DesktopAdmissionFailedScreen
        onRetry={retryAdmission}
        onSignOut={() => {
          // logoutAndClearSession is the canonical desktop sign-out path: it
          // calls runtime.account.logout (so runtime-side session is revoked),
          // clears the persisted access token, kills in-flight streams, and
          // clears the React Query cache — in addition to clearAuthSession.
          // A bare clearAuthSession() would leave the runtime session intact,
          // so the admission-failed surface looks unresponsive.
          void logoutAndClearSession({ clearAuthSession });
        }}
      />
    );
  }
  if (admission === 'first-run') {
    return <DesktopFirstRunGate onReadyForUse={() => setFirstRunReady(true)} />;
  }
  return (
    <Suspense fallback={<RuntimeLoadingScreen />}>
      <ReadyDesktopShell />
    </Suspense>
  );
}

function DesktopAdmissionFailedScreen(props: {
  readonly onRetry: () => void;
  readonly onSignOut: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SharedStatusShell
      eyebrow="Nimi Runtime"
      title={t('Bootstrap.admissionFailedTitle', { defaultValue: 'Sign-in did not reach the local runtime' })}
      description={t('Bootstrap.admissionFailedDescription', {
        defaultValue:
          'Your account is signed in to the realm, but the local Nimi runtime has not received the session. This usually clears with a retry; if it does not, sign out and sign in again.',
      })}
    >
      <div
        data-testid="desktop-admission-failed"
        className="mt-8 flex w-full max-w-[18rem] flex-col gap-3"
      >
        <button
          type="button"
          data-testid="desktop-admission-failed-retry"
          onClick={props.onRetry}
          className="inline-flex h-10 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] px-4 text-sm font-semibold text-[var(--nimi-action-primary-fg)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)]"
        >
          {t('Bootstrap.admissionFailedRetry', { defaultValue: 'Retry' })}
        </button>
        <button
          type="button"
          data-testid="desktop-admission-failed-sign-out"
          onClick={props.onSignOut}
          className="inline-flex h-10 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 text-sm font-semibold text-[var(--nimi-text-primary)] transition-colors hover:bg-[var(--nimi-surface-active)]"
        >
          {t('Bootstrap.admissionFailedSignOut', { defaultValue: 'Sign out' })}
        </button>
      </div>
    </SharedStatusShell>
  );
}

function DesktopAccountUnavailableScreen() {
  const { t } = useTranslation();
  return (
    <SharedStatusShell
      eyebrow="Nimi Runtime"
      title={t('Auth.runtimeAccountUnavailableTitle', {
        defaultValue: 'Account service is unavailable',
      })}
      description={t('Auth.runtimeAccountUnavailableDescription', {
        defaultValue:
          'Nimi Runtime is not providing a trusted account session. Repair or restart Runtime, then retry. Your account has not been treated as signed out.',
      })}
    >
      <button
        type="button"
        data-testid="desktop-account-unavailable-retry"
        onClick={() => window.location.reload()}
        className="mt-8 inline-flex h-10 min-w-36 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] px-5 text-sm font-semibold text-[var(--nimi-action-primary-fg)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)]"
      >
        {t('Common.retry', { defaultValue: 'Retry' })}
      </button>
    </SharedStatusShell>
  );
}

export function AppRoutes() {
  const flags = getShellFeatureFlags();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const bootstrapError = useAppStore((state) => state.bootstrapError);
  const authStatus = useAppStore((state) => state.auth.status);
  const isDesktopShell = flags.mode === 'desktop';

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

  if (flags.mode !== 'web' && !bootstrapReady && !bootstrapError) {
    return <RuntimeLoadingScreen />;
  }

  if (bootstrapError) {
    return <BootstrapErrorScreen message={bootstrapError} />;
  }

  if (isDesktopShell && authStatus === 'unavailable') {
    return <DesktopAccountUnavailableScreen />;
  }

  return (
    <Routes>
      {isDesktopShell ? (
        <>
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
        </>
      ) : authStatus === 'authenticated' ? (
        <>
          <Route path="/" element={(
            <Suspense fallback={<RuntimeLoadingScreen />}>
              <MainLayout />
            </Suspense>
          )}
          />
          {flags.mode === 'web' ? (
            <Route
              path="/login"
              element={(
                <Suspense fallback={<RuntimeLoadingScreen />}>
                  <LoginPage />
                </Suspense>
              )}
            />
          ) : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <>
          <Route
            path="/login"
            element={(
              <Suspense fallback={<RuntimeLoadingScreen />}>
                <LoginPage />
              </Suspense>
            )}
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
    </Routes>
  );
}
