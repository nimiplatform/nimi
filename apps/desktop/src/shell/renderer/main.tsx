import React, { Suspense, lazy, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';
import bootstrapEntryCopy from '@renderer/locales/en/26-Bootstrap.json';
import '@renderer/styles.css';

const ENTRY_IMPORT_RETRY_DELAYS_MS = import.meta.env.DEV
    ? [80, 160, 320, 640, 1000]
    : [];

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function isRetryableEntryImportError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return (
      message.includes('Importing a module script failed')
      || message.includes('Failed to fetch dynamically imported module')
      || message.includes('Load failed')
    );
}

function createEntryImportError(label: string, error: unknown, attempts: number): Error {
    const reason = error instanceof Error ? error.message : String(error || 'unknown import error');
    const wrapped = new Error(`${label} failed after ${attempts} attempt(s): ${reason}`);
    wrapped.name = 'EntryImportError';
    wrapped.cause = error;
    return wrapped;
}

async function loadEntryModule<T>(label: string, importer: () => Promise<T>): Promise<T> {
    let attempts = 0;

    for (;;) {
        attempts += 1;
        try {
            return await importer();
        } catch (error) {
            const retryDelay = ENTRY_IMPORT_RETRY_DELAYS_MS[attempts - 1];
            if (retryDelay === undefined || !isRetryableEntryImportError(error)) {
                throw createEntryImportError(label, error, attempts);
            }
            pingSmokeAsync('renderer-entry-import-retry', {
              label,
              attempt: attempts,
              retryDelayMs: retryDelay,
              ...describeUnhandledReason(error),
            });
            await delay(retryDelay);
        }
    }
}

async function preflightRendererAppDependencies(): Promise<void> {
    if (!import.meta.env.DEV) {
        return;
    }
    await Promise.all([
      loadEntryModule('entry:app-providers', () => import('@renderer/app-shell/providers/app-providers')),
      loadEntryModule('entry:app-routes', () => import('@renderer/app-shell/routes/app-routes')),
      loadEntryModule('entry:app-error-boundary', () => import('@renderer/infra/error-boundary/app-error-boundary')),
      loadEntryModule('entry:app-store', () => import('@renderer/app-shell/providers/app-store')),
      loadEntryModule('entry:renderer-log', () => import('@renderer/infra/telemetry/renderer-log')),
      loadEntryModule('entry:menu-bar-navigation-listener', () => import('@renderer/infra/menu-bar/menu-bar-navigation-listener')),
      loadEntryModule('entry:menu-bar-runtime-sync', () => import('@renderer/infra/menu-bar/menu-bar-runtime-sync')),
      loadEntryModule('entry:desktop-updates', () => import('@renderer/infra/bootstrap/desktop-updates')),
      loadEntryModule('entry:desktop-macos-smoke', () => import('@renderer/infra/bootstrap/desktop-macos-smoke')),
      loadEntryModule('entry:runtime-health-coordinator', () => import('@renderer/features/runtime-config/runtime-health-coordinator')),
    ]);
}

// All runtime modules are lazy-imported to keep vendor-data and
// runtime-bridge out of the main entry's static dependency graph.
// They resolve concurrently with the lazy App chunk — well before
// App mounts and makes its first SDK / i18n call.
const runtimeReady = Promise.all([
    loadEntryModule('entry:tauri-runtime-api', () => import('@runtime/tauri-api')),
    loadEntryModule('entry:sdk-mod', () => import('@nimiplatform/sdk/mod')),
    loadEntryModule('entry:i18n', () => import('@renderer/i18n')),
]).then(([tauriApi, sdkMod, i18nMod]) => {
    tauriApi.installSdkTauriRuntimeHook();
    sdkMod.bindRuntimeI18n(i18nMod.i18n);
    return i18nMod;
});
const entryBootCopy = bootstrapEntryCopy as {
    initializingRuntime: string;
    initializingRuntimeDescription: string;
    bootSequenceLabel: string;
    startFailedTitle: string;
    rendererEntryFailed: string;
};

const ENTRY_BOOT_PROGRESS_FLOOR_PERCENT = 8;

type TauriCoreInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type TauriInvokeOwner = { invoke?: unknown };
type TauriSmokeGlobal = typeof globalThis & {
    __TAURI__?: {
      core?: TauriInvokeOwner;
      invoke?: unknown;
    };
    __TAURI_INTERNALS__?: TauriInvokeOwner;
    __TAURI_IPC__?: TauriInvokeOwner;
    window?: {
      __TAURI__?: {
        core?: TauriInvokeOwner;
        invoke?: unknown;
      };
      __TAURI_INTERNALS__?: TauriInvokeOwner;
      __TAURI_IPC__?: TauriInvokeOwner;
    };
};

function bindTauriInvoke(owner: TauriInvokeOwner | null | undefined): TauriCoreInvoke | null {
    const invoke = owner?.invoke;
    return typeof invoke === 'function' ? (invoke.bind(owner) as TauriCoreInvoke) : null;
}

function resolveTauriCoreInvoke(): TauriCoreInvoke | null {
    const tauriGlobal = globalThis as TauriSmokeGlobal;
    return bindTauriInvoke(tauriGlobal.__TAURI__?.core)
      || bindTauriInvoke(tauriGlobal.__TAURI__)
      || bindTauriInvoke(tauriGlobal.__TAURI_INTERNALS__)
      || bindTauriInvoke(tauriGlobal.__TAURI_IPC__)
      || bindTauriInvoke(tauriGlobal.window?.__TAURI__?.core)
      || bindTauriInvoke(tauriGlobal.window?.__TAURI__)
      || bindTauriInvoke(tauriGlobal.window?.__TAURI_INTERNALS__)
      || bindTauriInvoke(tauriGlobal.window?.__TAURI_IPC__);
}

function pingSmokeAsync(event: string, payload?: Record<string, unknown>): void {
    const invoke = resolveTauriCoreInvoke();
    if (!invoke) {
        return;
    }
    void invoke('desktop_macos_smoke_ping', {
      payload: {
        stage: event,
        details: payload,
      },
    }).catch(() => {});
}

function describeUnhandledReason(reason: unknown): Record<string, unknown> {
    if (reason instanceof Error) {
        return {
          message: reason.message || '',
          name: reason.name || '',
          stack: reason.stack || '',
        };
    }
    if (reason && typeof reason === 'object') {
        return {
          message: String((reason as { message?: unknown }).message || ''),
          name: String((reason as { name?: unknown }).name || ''),
          raw: JSON.stringify(reason, (_key, value) => (
            typeof value === 'bigint' ? value.toString() : value
          )),
        };
    }
    return {
      message: String(reason || 'unhandled rejection'),
    };
}

const App = lazy(async () => {
    // Start loading the App chunk immediately — in parallel with runtime
    // hooks and i18n init — so the download overlaps with setup work.
    try {
        const appPromise = (async () => {
            await preflightRendererAppDependencies();
            return loadEntryModule('entry:renderer-app', () => import('@renderer/App'));
        })();
        const i18nMod = await runtimeReady;
        await i18nMod.initI18n();
        const mod = await appPromise;
        return { default: mod.default };
    } catch (error) {
        pingSmokeAsync('renderer-app-import-failed', describeUnhandledReason(error));
        throw error;
    }
});

type EntryErrorBoundaryState = {
    error: Error | null;
};

class EntryErrorBoundary extends React.Component<PropsWithChildren, EntryErrorBoundaryState> {
    constructor(props: PropsWithChildren) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error: Error): EntryErrorBoundaryState {
        return { error };
    }

    override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        pingSmokeAsync('renderer-entry-boundary-caught', {
          ...describeUnhandledReason(error),
          componentStack: errorInfo.componentStack,
        });
    }

    override render() {
        if (this.state.error) {
            return <EntryBootSurface
              title={entryBootCopy.startFailedTitle}
              detail={this.state.error.message || entryBootCopy.rendererEntryFailed}
            />;
        }
        return this.props.children;
    }
}

function EntryBootSurface(props: { title: string; detail: string }) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--nimi-canvas-bg,#f8fafc)] px-6 text-[var(--nimi-text-primary,#111827)]">
        <div className="w-full max-w-lg rounded-lg border border-[var(--nimi-border-subtle,#e5e7eb)] bg-[var(--nimi-surface-bg,#ffffff)] p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted,#64748b)]">
            Nimi Runtime
          </p>
          <h1 className="mt-3 text-lg font-semibold text-[var(--nimi-text-primary,#111827)]">
            {props.title}
          </h1>
          <p className="mt-3 break-words text-sm leading-6 text-[var(--nimi-text-secondary,#475569)]">
            {props.detail}
          </p>
        </div>
      </div>
    );
}

function EntryNimiLogoMark({ className = 'h-12 w-12' }: { className?: string }) {
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
          fill="var(--nimi-text-primary,#111827)"
        />
        <path
          d="M366.78 358.693C387.936 354.799 413.753 366.464 428.697 381.272C455.942 408.267 451.554 439.24 451.453 474.569C436.213 470.888 426.427 471.087 410.973 473.849C410.952 464.297 411.502 434.843 409.743 426.92C408.674 422.173 406.671 417.686 403.851 413.72C397.957 405.5 389.408 400.845 379.57 399.148C361.515 396.503 343.387 406.617 337.892 424.366C335.266 432.85 335.94 441.424 335.986 450.205C336.03 458.147 336.033 466.089 335.995 474.031C321.154 470.317 310.245 471.335 295.554 474.351L295.477 447.484C295.438 423.32 296.416 407.895 312.579 387.553C325.927 370.754 345.517 360.925 366.78 358.693Z"
          fill="var(--nimi-action-primary-bg,#5fcbb2)"
        />
        <path
          d="M308.576 481.688C328.835 479.184 350.932 486.027 366.299 499.41C355.659 511.25 350.596 521.465 346.144 536.55C345.187 535.31 344.164 534.12 343.08 532.99C336.399 526.07 327.253 522.07 317.637 521.865C306.582 521.69 297.979 525.26 289.97 532.86C276.865 545.29 279.364 561.995 279.416 578.375L279.48 617.375C279.575 625.65 280.237 633.975 275.159 641.04C272.042 645.34 267.339 648.215 262.092 649.035C250.188 650.875 239.87 642.685 239.051 630.68C237.974 614.88 239.03 598.35 238.633 582.555C237.997 557.28 237.564 532.345 254.522 511.645C268.926 493.583 285.701 484.6 308.576 481.688Z"
          fill="var(--nimi-action-primary-bg-hover,#2f9f8d)"
        />
      </svg>
    );
}

function EntryRuntimeBootSurface(props: {
    title: string;
    detail: string;
    sequenceLabel: string;
}) {
    return (
      <div className="nimi-entry-runtime-boot relative flex min-h-screen items-center justify-center overflow-hidden px-6 text-[var(--nimi-text-primary,#111827)]">
        <style>{`
          @keyframes nimi-entry-float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-6px); }
          }
          @keyframes nimi-entry-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes nimi-entry-pulse {
            0%, 100% { transform: scale(1); opacity: 0.45; }
            50% { transform: scale(1.08); opacity: 0.9; }
          }
          @keyframes nimi-entry-dot {
            0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
            40% { transform: translateY(-4px); opacity: 1; }
          }
          .nimi-entry-runtime-boot {
            background:
              radial-gradient(circle at 22% 18%, rgba(186, 222, 255, 0.56), transparent 35%),
              radial-gradient(circle at 72% 20%, rgba(236, 232, 255, 0.64), transparent 36%),
              radial-gradient(circle at 42% 78%, rgba(217, 252, 239, 0.58), transparent 38%),
              var(--nimi-surface-canvas,#f8fafc);
          }
          .nimi-entry-card {
            border: 1px solid rgba(255,255,255,0.76);
            background: color-mix(in srgb, var(--nimi-surface-card,#ffffff) 82%, transparent);
            box-shadow: 0 24px 70px rgba(15, 23, 42, 0.10);
            backdrop-filter: blur(22px);
          }
          .nimi-entry-pulse { animation: nimi-entry-pulse 2.8s ease-in-out infinite; }
          .nimi-entry-pulse-slow { animation: nimi-entry-pulse 3.4s ease-in-out infinite; }
          .nimi-entry-spin { animation: nimi-entry-spin 18s linear infinite; }
          .nimi-entry-float { animation: nimi-entry-float 3.2s ease-in-out infinite; }
          .nimi-entry-dot { animation: nimi-entry-dot 1.4s ease-in-out infinite; }
          .nimi-entry-dot:nth-child(2) { animation-delay: 180ms; }
          .nimi-entry-dot:nth-child(3) { animation-delay: 360ms; }
        `}</style>
        <section className="nimi-entry-card w-full max-w-[460px] rounded-3xl px-8 py-10 sm:px-10 sm:py-11">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-8 flex h-24 w-24 items-center justify-center">
              <div className="nimi-entry-pulse absolute inset-0 rounded-3xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#5fcbb2)_26%,var(--nimi-surface-card,#ffffff))]" />
              <div className="nimi-entry-spin absolute inset-[-8px] rounded-3xl border border-dashed border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#5fcbb2)_16%,var(--nimi-surface-card,#ffffff))]" />
              <div className="nimi-entry-pulse-slow absolute inset-[-16px] rounded-3xl border border-[var(--nimi-border-subtle,#e5e7eb)]" />
              <div className="nimi-entry-float relative flex h-20 w-20 items-center justify-center rounded-3xl border border-[var(--nimi-border-subtle,#e5e7eb)] bg-[var(--nimi-surface-card,#ffffff)] shadow-[0_12px_30px_rgba(15,23,42,0.12)]">
                <EntryNimiLogoMark />
              </div>
            </div>
            <div className="mb-3 rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#5fcbb2)_18%,var(--nimi-surface-card,#ffffff))] bg-[var(--nimi-surface-active,#e9fbf5)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nimi-action-primary-bg-hover,#2f9f8d)]">
              Nimi Runtime
            </div>
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-[var(--nimi-text-primary,#111827)]">
              {props.title}
            </h1>
            <p className="mt-3 max-w-[28rem] text-sm leading-6 text-[var(--nimi-text-secondary,#475569)]">
              {props.detail}
            </p>
            <div className="mt-8 w-full max-w-[18rem]">
              <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#5fcbb2)_13%,white)]">
                <div
                  className="h-full rounded-full bg-[var(--nimi-action-primary-bg,#5fcbb2)]"
                  style={{ width: `${ENTRY_BOOT_PROGRESS_FLOOR_PERCENT}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-[var(--nimi-text-muted,#64748b)]">
                <span>{props.sequenceLabel}</span>
                <span>{ENTRY_BOOT_PROGRESS_FLOOR_PERCENT}%</span>
              </div>
              <div className="mt-5 flex items-center justify-center gap-2">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="nimi-entry-dot h-2.5 w-2.5 rounded-full bg-[var(--nimi-action-primary-bg,#5fcbb2)]"
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
}
if (!import.meta.env.DEV) {
    document.addEventListener('contextmenu', (e) => e.preventDefault());
}
const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('ROOT_MOUNT_NODE_MISSING');
}
pingSmokeAsync('renderer-main-entry');
window.addEventListener('error', (event) => {
    pingSmokeAsync('window-page-error', {
      message: event.message || '',
      filename: event.filename || '',
      lineno: event.lineno || 0,
      colno: event.colno || 0,
    });
});
window.addEventListener('unhandledrejection', (event) => {
    const reason = describeUnhandledReason(event.reason);
    pingSmokeAsync('window-page-error', {
      ...reason,
      type: 'unhandledrejection',
    });
});

// Mount the root immediately. Entry failures stay fail-closed, but they must
// never collapse into an unobservable blank webview.
createRoot(rootElement).render(
  <EntryErrorBoundary>
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
      <Suspense
        fallback={<EntryRuntimeBootSurface
          title={entryBootCopy.initializingRuntime}
          detail={entryBootCopy.initializingRuntimeDescription}
          sequenceLabel={entryBootCopy.bootSequenceLabel}
        />}
      >
        <App />
      </Suspense>
    </NimiThemeProvider>
  </EntryErrorBoundary>,
);
pingSmokeAsync('renderer-root-mounted');
