import React, { Suspense, lazy, type PropsWithChildren } from 'react';
import { createRoot } from 'react-dom/client';
import { AmbientBackground, NimiThemeProvider, ProgressIndicator } from '@nimiplatform/kit/ui';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
import { motion } from 'motion/react';
import {
  DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
  createRendererEntryModuleLoader,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
import bootstrapEntryCopy from './locales/en/26-Bootstrap.json';
import entryLogoImage from './assets/logo.png';
import './foundation.css';
import './styles.css';

const entryModuleLoader = createRendererEntryModuleLoader({
    retryDelaysMs: import.meta.env.DEV ? DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS : [],
    setTimeout: window.setTimeout.bind(window),
});
const loadEntryModule = entryModuleLoader.load;

async function preflightRendererAppDependencies(): Promise<void> {
    if (!import.meta.env.DEV) {
        return;
    }
    await Promise.all([
      loadEntryModule('entry:canonical-renderer-factory', () => import('./renderer/factory')),
      loadEntryModule('entry:production-renderer-host', () => import('./renderer/production-host')),
      loadEntryModule('entry:production-renderer-bindings', () => import('./renderer/production-bindings')),
      loadEntryModule('entry:sdk-ai', () => import('@nimiplatform/sdk/ai')),
      loadEntryModule('entry:renderer-log', () => import('@nimiplatform/kit/telemetry')),
    ]);
}

const entryBootCopy = bootstrapEntryCopy as {
    initializingRuntime: string;
    initializingRuntimeDescription: string;
    bootSequenceLabel: string;
    startFailedTitle: string;
    rendererEntryFailed: string;
};

const ENTRY_BOOT_PROGRESS_FLOOR_PERCENT = 8;

const App = lazy(async () => {
    // Start loading the App chunk immediately — in parallel with runtime
    // hooks and i18n init — so the download overlaps with setup work.
    const appPromise = (async () => {
        await preflightRendererAppDependencies();
        return loadEntryModule('entry:renderer-app', () => import('./App'));
    })();
    const mod = await appPromise;
    return { default: mod.default };
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
    const title = props.title.replace(/(?:\.{3}|…)+$/u, '');

    return (
      <AmbientBackground
        variant="mesh"
        className="flex min-h-screen items-center justify-center overflow-hidden bg-[var(--nimi-surface-canvas,#f8fafc)] px-6 py-8 text-[var(--nimi-text-primary,#111827)]"
      >
        <div
          aria-hidden="true"
          className="nimi-material-glass-regular absolute inset-0 z-[1] bg-[color-mix(in_srgb,var(--nimi-material-glass-regular-bg)_58%,transparent)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
        />
        <motion.section
          initial={{ opacity: prefersReducedMotion ? 1 : 0, y: prefersReducedMotion ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.32, ease: [0.05, 0.7, 0.1, 1] }}
          className="relative z-10 flex w-full max-w-[420px] flex-col items-center text-center"
        >
          <div
            data-testid="runtime-loading-logo"
            className="flex h-24 w-24 items-center justify-center"
          >
            <EntryNimiLogoMark className="h-24 w-24 drop-shadow-[0_10px_18px_rgba(33,183,181,0.14)]" />
          </div>
          <div className="mt-6 rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#5fcbb2)_42%,white)] bg-[var(--nimi-surface-card,#fff)] px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-action-primary-bg,#5fcbb2)]">
            Nimi Runtime
          </div>
          <h1 className="mt-4 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-[var(--nimi-text-primary,#111827)]">
            {title}
          </h1>
          <p className="mt-2 max-w-[28rem] text-sm leading-6 text-[var(--nimi-text-secondary,#475569)]">
            {props.detail}
          </p>
          <div className="mt-7 w-full max-w-[18rem]">
            <ProgressIndicator
              value={ENTRY_BOOT_PROGRESS_FLOOR_PERCENT}
              showValue
              aria-label={title}
              className="[&_.nimi-progress__track]:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#5fcbb2)_10%,white)]"
            />
            <p className="mt-3 text-xs text-[var(--nimi-text-muted,#64748b)]">{props.sequenceLabel}</p>
          </div>
        </motion.section>
      </AmbientBackground>
    );
}
if (!import.meta.env.DEV) {
    document.addEventListener('contextmenu', (e) => e.preventDefault());
}
const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('ROOT_MOUNT_NODE_MISSING');
}
// Mount the root immediately. Entry failures stay fail-closed, but they must
// never collapse into an unobservable blank webview.
createRoot(rootElement).render(
  <EntryErrorBoundary>
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light" defaultDensity="compact">
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
