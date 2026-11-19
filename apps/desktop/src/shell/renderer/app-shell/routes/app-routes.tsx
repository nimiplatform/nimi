import { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import { useAppStore, useAppStoreApi, type AuthStatus } from '../providers/app-store';
import { E2E_IDS } from '../../testability/e2e-ids';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import { logoutAndClearSession, useLogoutSessionDependencies } from '../../features/auth/logout';
import { RuntimeLoadingScreen } from './runtime-loading-screen';
import { SupportDegradedEntry } from '../../features/support/support-degraded-entry.js';
import { AmbientBackground } from '@nimiplatform/kit/ui';
import { DesktopRecoveryActions, SharedStatusShell, STATUS_SHELL_PRIMARY_BUTTON, STATUS_SHELL_SECONDARY_BUTTON } from './status-shell';
import { RuntimeMaintenanceRecoveryScreen } from './runtime-maintenance-recovery';
import { retryRuntimeAccountConnectionNow } from '../../infra/bootstrap/auth-state-watcher.js';
import { useDesktopProductAdmission } from './desktop-product-admission.js';
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

function accountRetainsOrdinaryShell(status: AuthStatus): boolean {
  return status === 'authenticated' || status === 'refresh-pending';
}

function accountRequiresLogin(status: AuthStatus): boolean {
  return status === 'anonymous'
    || status === 'login-pending'
    || status === 'expired'
    || status === 'reauth-required';
}

function DesktopFirstRunGate(props: {
  readonly projection: NimiProductControlRecordProjection;
  readonly onProjectionChange: () => void;
}) {
  return (
    <AmbientBackground
      variant="mesh"
      className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
    >
      <div data-testid="desktop-first-run-gate" className="flex min-h-screen min-w-0">
        <Suspense fallback={<RuntimeLoadingScreen />}>
          <FirstRunGatePanel
            projection={props.projection}
            onProjectionChange={props.onProjectionChange}
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
          <SupportDegradedEntry recovery={{ title: t('Support.homeProfileTitle'), detail: error ?? undefined, actionLabel: t('Support.homeProfileRetry'), onAction: () => { void retry(); }, busy }} />
        </div>
      </div>
    </SharedStatusShell>
  );
}

function DesktopOrdinaryShellGate() {
  const authStatus = useAppStore((state) => state.auth.status);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  const logoutDependencies = useLogoutSessionDependencies();
  const { t } = useTranslation();
  const { admission, retry: retryAdmission, homeProfile, profileUnavailable, projection, error } = useDesktopProductAdmission(authStatus);
  const { navigation } = useAppStoreApi();
  const hadAdmission = useRef(false);
  const workAllowed = admission === 'ready' && homeProfile?.workAllowed === true && accountRetainsOrdinaryShell(authStatus);
  useEffect(() => {
    if (!workAllowed && hadAdmission.current) navigation.reset({ id: 'home' });
    hadAdmission.current = workAllowed;
  }, [navigation, workAllowed]);
  const navigate = useNavigate();

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
          // token custody) and
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
  if (homeProfile?.sourceRuntimeRestartRequired) {
    return (
      <SharedStatusShell title={t('Support.homeProfileTitle')} description={t('Bootstrap.maintenanceSourceRestart')}>
        <SupportDegradedEntry />
      </SharedStatusShell>
    );
  }
  if (admission === 'unavailable') {
    return (
      <SharedStatusShell title={t('DataManagement.dataRootReadFailed')}>
        <DesktopRecoveryActions
          testId="desktop-product-control-unavailable"
          retryLabel={t('Bootstrap.admissionFailedRetry')}
          onRetry={retryAdmission}
          technicalDetail={error}
        />
      </SharedStatusShell>
    );
  }
  if (admission === 'first-run' && projection) {
    return <DesktopFirstRunGate projection={projection} onProjectionChange={retryAdmission} />;
  }
  if (!accountRetainsOrdinaryShell(authStatus)) {
    return <RuntimeLoadingScreen />;
  }
  if (profileUnavailable) {
    return (
      <SharedStatusShell title={t('Support.homeProfileStillUnavailable')}>
        <DesktopRecoveryActions testId="desktop-home-profile-unavailable" retryLabel={t('Bootstrap.admissionFailedRetry')} onRetry={retryAdmission} />
      </SharedStatusShell>
    );
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
        <SupportDegradedEntry recovery={{ title: t('Bootstrap.admissionFailedTitle'), actionLabel: t('Bootstrap.admissionFailedRetry'), onAction: props.onRetry }} />
      </div>
    </SharedStatusShell>
  );
}

function DesktopAccountUnavailableScreen() {
  const { t } = useTranslation();
  const failureDetail = useAppStore((state) => state.auth.failureDetail);
  const runtimeUnavailable = useAppStore((state) => state.offlineTier === 'L2');
  return (
    <SharedStatusShell
      title={t(runtimeUnavailable ? 'Auth.localRuntimeUnavailableTitle' : 'Auth.runtimeAccountUnavailableTitle')}
      description={t(runtimeUnavailable ? 'Auth.localRuntimeUnavailableDescription' : 'Auth.runtimeAccountUnavailableDescription')}
    >
      <DesktopRecoveryActions
        testId="desktop-account-unavailable"
        status={t(runtimeUnavailable ? 'Auth.localRuntimeCheckingConnection' : 'Auth.runtimeAccountReconnecting')}
        retryLabel={t(runtimeUnavailable ? 'Auth.localRuntimeCheckConnection' : 'Auth.runtimeAccountRetryNow')}
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
