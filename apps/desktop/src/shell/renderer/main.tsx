import React, { Suspense, lazy, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
import { motion } from 'motion/react';
import {
  DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
  createRendererEntryModuleLoader,
  describeRendererEntryFailureReason,
  ensureNimiShellRuntimeBridgeInstalled,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
import bootstrapEntryCopy from '@renderer/locales/en/26-Bootstrap.json';
import entryLogoImage from './assets/logo.png';
import '@renderer/styles.css';

const entryModuleLoader = createRendererEntryModuleLoader({
    retryDelaysMs: import.meta.env.DEV ? DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS : [],
    reportStage: pingSmokeAsync,
    setTimeout: window.setTimeout.bind(window),
});
const loadEntryModule = entryModuleLoader.load;

async function preflightRendererAppDependencies(): Promise<void> {
    if (!import.meta.env.DEV) {
        return;
    }
    await Promise.all([
      loadEntryModule('entry:app-providers', () => import('@renderer/app-shell/providers/app-providers')),
      loadEntryModule('entry:app-routes', () => import('@renderer/app-shell/routes/app-routes')),
      loadEntryModule('entry:app-error-boundary', () => import('@renderer/infra/error-boundary/app-error-boundary')),
      loadEntryModule('entry:sdk-ai', () => import('@nimiplatform/sdk/ai')),
      loadEntryModule('entry:renderer-log', () => import('@nimiplatform/kit/telemetry')),
      loadEntryModule('entry:menu-bar-navigation-listener', () => import('@renderer/infra/menu-bar/menu-bar-navigation-listener')),
      loadEntryModule('entry:menu-bar-runtime-sync', () => import('@renderer/infra/menu-bar/menu-bar-runtime-sync')),
      loadEntryModule('entry:desktop-updates', () => import('@renderer/infra/bootstrap/desktop-updates')),
      loadEntryModule('entry:desktop-macos-smoke', () => import('@renderer/infra/bootstrap/desktop-macos-smoke')),
      loadEntryModule('entry:runtime-health-coordinator', () => import('@renderer/features/runtime-config/runtime-health-coordinator')),
    ]);
}

// The standard shell host hook is an entry preflight: App must never mount
// before the host invoke/listen surface exists. Other runtime modules still
// resolve with the lazy App chunk before App makes product bridge calls.
const runtimeReady = Promise.all([
    ensureNimiShellRuntimeBridgeInstalled({
      reportStage: pingSmokeAsync,
      setTimeout: window.setTimeout.bind(window),
    }),
    loadEntryModule('entry:i18n', () => import('@renderer/i18n')),
]).then(([, i18nMod]) => i18nMod);
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

const describeUnhandledReason = describeRendererEntryFailureReason;

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
    const prefersReducedMotion = usePrefersReducedMotion();
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--nimi-canvas-bg,#f8fafc)] px-6 text-[var(--nimi-text-primary,#111827)]">
        <motion.div
          initial={{ opacity: prefersReducedMotion ? 1 : 0, y: prefersReducedMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
          className="w-full max-w-lg rounded-lg border border-[var(--nimi-border-subtle,#e5e7eb)] bg-[var(--nimi-surface-bg,#ffffff)] p-6 shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted,#64748b)]">
            Nimi Runtime
          </p>
          <h1 className="mt-3 text-lg font-semibold text-[var(--nimi-text-primary,#111827)]">
            {props.title}
          </h1>
          <p className="mt-3 break-words text-sm leading-6 text-[var(--nimi-text-secondary,#475569)]">
            {props.detail}
          </p>
        </motion.div>
      </div>
    );
}

function EntryNimiLogoMark({ className = 'h-12 w-12' }: { className?: string }) {
    return (
      <img src={entryLogoImage} alt="" className={`${className} object-contain`} aria-hidden="true" />
    );
}

function EntryRuntimeBootSurface(props: {
    title: string;
    detail: string;
    sequenceLabel: string;
}) {
    const prefersReducedMotion = usePrefersReducedMotion();
    return (
      <div className="nimi-entry-runtime-boot relative flex min-h-screen items-center justify-center overflow-hidden px-6 text-[var(--nimi-text-primary,#111827)]">
        <style>{`
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
        `}</style>
        <motion.section
          initial={{ opacity: prefersReducedMotion ? 1 : 0, y: prefersReducedMotion ? 0 : 10, scale: prefersReducedMotion ? 1 : 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.32, ease: [0.05, 0.7, 0.1, 1] }}
          className="nimi-entry-card w-full max-w-[420px] rounded-2xl px-6 py-7 sm:px-7 sm:py-8"
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--nimi-border-subtle,#e5e7eb)] bg-[var(--nimi-surface-card,#ffffff)] shadow-[0_10px_24px_rgba(15,23,42,0.10)]">
                <EntryNimiLogoMark />
            </div>
            <div className="mb-3 rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#5fcbb2)_18%,var(--nimi-surface-card,#ffffff))] bg-[var(--nimi-surface-active,#e9fbf5)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nimi-action-primary-bg-hover,#2f9f8d)]">
              Nimi Runtime
            </div>
            <h1 className="text-2xl font-semibold text-[var(--nimi-text-primary,#111827)]">
              {props.title}
            </h1>
            <p className="mt-3 max-w-[28rem] text-sm leading-6 text-[var(--nimi-text-secondary,#475569)]">
              {props.detail}
            </p>
            <div className="mt-7 w-full max-w-[18rem]">
              <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#5fcbb2)_13%,white)]">
                <motion.div
                  className="h-full rounded-full bg-[var(--nimi-action-primary-bg,#5fcbb2)]"
                  initial={{ width: prefersReducedMotion ? `${ENTRY_BOOT_PROGRESS_FLOOR_PERCENT}%` : '2%' }}
                  animate={{ width: `${ENTRY_BOOT_PROGRESS_FLOOR_PERCENT}%` }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: [0.2, 0, 0, 1] }}
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
                    className="h-2.5 w-2.5 rounded-full bg-[var(--nimi-action-primary-bg,#5fcbb2)] opacity-70"
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.section>
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
