import { Suspense, lazy, useRef, useState, useEffect, type ReactNode, type MouseEvent } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { AmbientBackground, ProgressIndicator, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { desktopBridge } from '@renderer/bridge';

const LoginPage = lazy(async () => {
  const mod = await import('@renderer/features/auth/login-page');
  return { default: mod.LoginPage };
});

const MainLayout = lazy(async () => {
  const mod = await import('@renderer/app-shell/layouts/main-layout');
  return { default: mod.MainLayout };
});

const NimiHomePanel = lazy(async () => {
  const mod = await import('@renderer/features/nimi-home/nimi-home-panel');
  return { default: mod.NimiHomePanel };
});

const WorldTourViewerRoute = lazy(async () => {
  const mod = await import('@renderer/features/tester/world-tour-viewer-route');
  return { default: mod.WorldTourViewerRoute };
});

function isStandaloneWorldTourRoute(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (!window.location.hash.startsWith('#/world-tour-viewer')) {
    return false;
  }
  const queryIndex = window.location.hash.indexOf('?');
  if (queryIndex < 0) {
    return false;
  }
  const params = new URLSearchParams(window.location.hash.slice(queryIndex + 1));
  return Boolean(params.get('launchToken')?.trim());
}

function NimiLogoMark({ className = 'h-12 w-12' }: { className?: string }) {
  return (
    <svg
      viewBox="184 313 380 380"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M422.113 481.686C430.279 480.015 446.572 482.447 454.744 485.044C474.442 491.419 490.788 505.375 500.17 523.835C510.86 544.83 507.885 568.74 508.02 591.755C508.09 603.355 509.375 625.185 506.61 635.715C501.86 653.805 472.816 653.475 468.884 633.79C467.447 626.595 467.732 621.445 467.725 614.045L467.799 576.085C467.82 569.98 468.13 559.645 467.414 553.935C466.877 549.735 465.639 545.65 463.753 541.855C458.426 531.205 450.147 526.415 439.371 522.855C418.86 518.45 397.129 530.92 393.886 552.465C392.732 560.135 393.355 570.905 393.38 578.865L393.501 616.235C393.539 630.155 393.938 646.325 376.066 648.96C370.79 649.76 365.414 648.385 361.173 645.145C356.643 641.695 353.662 636.02 353.392 630.495C352.832 619.04 352.815 605.915 353.063 594.415C353.741 563.005 348.149 536.885 369.342 510.415C382.862 493.529 400.96 484.259 422.113 481.686Z"
        fill="var(--nimi-text-primary)"
      />
      <path
        d="M366.78 358.693C387.936 354.799 413.753 366.464 428.697 381.272C455.942 408.267 451.554 439.24 451.453 474.569C436.213 470.888 426.427 471.087 410.973 473.849C410.952 464.297 411.502 434.843 409.743 426.92C408.674 422.173 406.671 417.686 403.851 413.72C397.957 405.5 389.408 400.845 379.57 399.148C361.515 396.503 343.387 406.617 337.892 424.366C335.266 432.85 335.94 441.424 335.986 450.205C336.03 458.147 336.033 466.089 335.995 474.031C321.154 470.317 310.245 471.335 295.554 474.351L295.477 447.484C295.438 423.32 296.416 407.895 312.579 387.553C325.927 370.754 345.517 360.925 366.78 358.693Z"
        fill="var(--nimi-action-primary-bg)"
      />
      <path
        d="M308.576 481.688C328.835 479.184 350.932 486.027 366.299 499.41C355.659 511.25 350.596 521.465 346.144 536.55C345.187 535.31 344.164 534.12 343.08 532.99C336.399 526.07 327.253 522.07 317.637 521.865C306.582 521.69 297.979 525.26 289.97 532.86C276.865 545.29 279.364 561.995 279.416 578.375L279.48 617.375C279.575 625.65 280.237 633.975 275.159 641.04C272.042 645.34 267.339 648.215 262.092 649.035C250.188 650.875 239.87 642.685 239.051 630.68C237.974 614.88 239.03 598.35 238.633 582.555C237.997 557.28 237.564 532.345 254.522 511.645C268.926 493.583 285.701 484.6 308.576 481.688Z"
        fill="var(--nimi-action-primary-bg-hover)"
      />
    </svg>
  );
}

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;
const BOOT_PROGRESS_FLOOR_PERCENT = 8;

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
      <style>{`
        @keyframes nimi-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        @keyframes nimi-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes nimi-pulse {
          0%, 100% { transform: scale(1); opacity: 0.45; }
          50% { transform: scale(1.08); opacity: 0.9; }
        }
        @keyframes nimi-dot {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        .nimi-bootstrap-pulse { animation: nimi-pulse 2.8s ease-in-out infinite; }
        .nimi-bootstrap-pulse-slow { animation: nimi-pulse 3.4s ease-in-out infinite; }
        .nimi-bootstrap-spin { animation: nimi-spin 18s linear infinite; }
        .nimi-bootstrap-float { animation: nimi-float 3.2s ease-in-out infinite; }
        .nimi-bootstrap-dot { animation: nimi-dot 1.4s ease-in-out infinite; }
        .nimi-bootstrap-dot:nth-child(2) { animation-delay: 180ms; }
        .nimi-bootstrap-dot:nth-child(3) { animation-delay: 360ms; }
      `}</style>
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <Surface
          as="section"
          tone="hero"
          material="glass-thick"
          padding="none"
          className="w-full max-w-[460px] rounded-3xl px-8 py-10 sm:px-10 sm:py-11"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-8 flex h-24 w-24 items-center justify-center">
              <div
                className="nimi-bootstrap-pulse absolute inset-0 rounded-3xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_26%,var(--nimi-surface-card))]"
              />
              <div
                className="nimi-bootstrap-spin absolute inset-[-8px] rounded-3xl border border-dashed border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,var(--nimi-surface-card))]"
              />
              <div
                className="nimi-bootstrap-pulse-slow absolute inset-[-16px] rounded-3xl border border-[var(--nimi-border-subtle)]"
              />
              <div
                className="nimi-bootstrap-float relative flex h-20 w-20 items-center justify-center rounded-3xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)]"
              >
                <NimiLogoMark />
              </div>
            </div>
            <div className="mb-3 rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,var(--nimi-surface-card))] bg-[var(--nimi-surface-active)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nimi-action-primary-bg-hover)]">
              {props.eyebrow}
            </div>
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-[var(--nimi-text-primary)]">
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

function LoadingScreen() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(BOOT_PROGRESS_FLOOR_PERCENT);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const target = 90;
    const range = target - BOOT_PROGRESS_FLOOR_PERCENT;
    const duration = 6500;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(BOOT_PROGRESS_FLOOR_PERCENT + range * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const clamped = Math.min(100, progress);

  return (
    <SharedStatusShell
      eyebrow="Nimi Runtime"
      title={t('Bootstrap.initializingRuntime')}
      description={t('Bootstrap.initializingRuntimeDescription')}
    >
      <div data-testid={E2E_IDS.appLoadingScreen} className="mt-8 w-full max-w-[18rem]">
        <ProgressIndicator value={clamped} />
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--nimi-text-muted)]">
          <span>{t('Bootstrap.bootSequenceLabel')}</span>
          <span>{Math.round(clamped)}%</span>
        </div>
        <div className="mt-5 flex items-center justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="nimi-bootstrap-dot h-2.5 w-2.5 rounded-full bg-[var(--nimi-action-primary-bg)]"
            />
          ))}
        </div>
      </div>
    </SharedStatusShell>
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

type DesktopOrdinaryShellAdmission = 'checking' | 'not-ready' | 'ready';

function useDesktopOrdinaryShellAdmission(authStatus: 'bootstrapping' | 'anonymous' | 'authenticated'): DesktopOrdinaryShellAdmission {
  const [admission, setAdmission] = useState<DesktopOrdinaryShellAdmission>('checking');

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      setAdmission('checking');
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    const refresh = async () => {
      try {
        const projection = await desktopBridge.getProductControlRecord();
        if (cancelled) return;
        const next: DesktopOrdinaryShellAdmission = projection.state === 'ready_for_use' ? 'ready' : 'not-ready';
        setAdmission(next);
        if (next !== 'ready') {
          timer = window.setTimeout(refresh, 1500);
        }
      } catch {
        if (!cancelled) {
          setAdmission('not-ready');
          timer = window.setTimeout(refresh, 1500);
        }
      }
    };

    setAdmission('checking');
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [authStatus]);

  return admission;
}

function DesktopFirstRunGate() {
  return (
    <AmbientBackground
      variant="mesh"
      className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
    >
      <div data-testid="desktop-first-run-gate" className="flex min-h-screen min-w-0">
        <Suspense fallback={<LoadingScreen />}>
          <NimiHomePanel />
        </Suspense>
      </div>
    </AmbientBackground>
  );
}

function ReadyDesktopShell() {
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  useEffect(() => {
    if (activeTab !== 'chat') {
      setActiveTab('chat');
    }
  }, [activeTab, setActiveTab]);

  if (activeTab !== 'chat') {
    return <LoadingScreen />;
  }

  return <MainLayout />;
}

function DesktopOrdinaryShellGate() {
  const authStatus = useAppStore((state) => state.auth.status);
  const admission = useDesktopOrdinaryShellAdmission(authStatus);

  if (authStatus === 'bootstrapping') {
    return <LoadingScreen />;
  }
  if (authStatus !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  if (admission === 'checking') {
    return <LoadingScreen />;
  }
  if (admission !== 'ready') {
    return <DesktopFirstRunGate />;
  }
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ReadyDesktopShell />
    </Suspense>
  );
}

export function AppRoutes() {
  const flags = getShellFeatureFlags();
  const standaloneWorldTour = isStandaloneWorldTourRoute();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const bootstrapError = useAppStore((state) => state.bootstrapError);
  const authStatus = useAppStore((state) => state.auth.status);
  const isDesktopShell = flags.mode === 'desktop';

  if (!standaloneWorldTour && flags.mode !== 'web' && !bootstrapReady && !bootstrapError) {
    return <LoadingScreen />;
  }

  if (!standaloneWorldTour && bootstrapError) {
    return <BootstrapErrorScreen message={bootstrapError} />;
  }

  return (
    <Routes>
      {isDesktopShell ? (
        <>
          <Route
            path="/world-tour-viewer"
            element={(
              <Suspense fallback={<LoadingScreen />}>
                <WorldTourViewerRoute />
              </Suspense>
            )}
          />
          <Route path="/" element={<DesktopOrdinaryShellGate />} />
          <Route
            path="/login"
            element={(
              <Suspense fallback={<LoadingScreen />}>
                <LoginPage />
              </Suspense>
            )}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : authStatus === 'authenticated' ? (
        <>
          <Route path="/" element={(
            <Suspense fallback={<LoadingScreen />}>
              <MainLayout />
            </Suspense>
          )}
          />
          {flags.mode === 'web' ? (
            <Route
              path="/login"
              element={(
                <Suspense fallback={<LoadingScreen />}>
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
              <Suspense fallback={<LoadingScreen />}>
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
