import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/nimi-kit/ui';
import '@renderer/styles.css';

// All runtime modules are lazy-imported to keep vendor-data and
// runtime-bridge out of the main entry's static dependency graph.
// They resolve concurrently with the lazy App chunk — well before
// App mounts and makes its first SDK / i18n call.
const runtimeReady = Promise.all([
    import('@runtime/tauri-api'),
    import('@nimiplatform/sdk/mod'),
    import('@renderer/i18n'),
]).then(([tauriApi, sdkMod, i18nMod]) => {
    tauriApi.installSdkTauriRuntimeHook();
    sdkMod.bindRuntimeI18n(i18nMod.i18n);
    return i18nMod;
});

function pingSmokeAsync(event: string, payload?: Record<string, unknown>): void {
    void import('@renderer/bridge/runtime-bridge/macos-smoke')
        .then((m) => m.pingDesktopMacosSmoke(event, payload))
        .catch(() => {});
}

const App = lazy(async () => {
    // Start loading the App chunk immediately — in parallel with runtime
    // hooks and i18n init — so the download overlaps with setup work.
    const appPromise = import('@renderer/App');
    const i18nMod = await runtimeReady;
    await i18nMod.initI18n();
    const mod = await appPromise;
    return { default: mod.default };
});
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
    const reason = event.reason instanceof Error
      ? event.reason.message
      : String(event.reason || 'unhandled rejection');
    pingSmokeAsync('window-page-error', {
      message: reason,
      type: 'unhandledrejection',
    });
});

// Mount the root immediately — Suspense shows nothing until the lazy
// App resolves (which awaits runtime hooks + i18n init internally).
createRoot(rootElement).render(<Suspense fallback={null}>
  <NimiThemeProvider accentPack="desktop-accent" defaultScheme="light">
    <App />
  </NimiThemeProvider>
</Suspense>);
pingSmokeAsync('renderer-root-mounted');
