import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/nimi-kit/ui';
import { i18n, initI18n } from '@renderer/i18n';
import '@renderer/styles.css';
import { bindRuntimeI18n } from "@nimiplatform/sdk/mod";
import { installSdkTauriRuntimeHook } from '@runtime/tauri-api';
import { pingDesktopMacosSmoke } from '@renderer/bridge/runtime-bridge/macos-smoke';
const App = lazy(async () => {
    const mod = await import('@renderer/App');
    return { default: mod.default };
});
if (!import.meta.env.DEV) {
    document.addEventListener('contextmenu', (e) => e.preventDefault());
}
const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('ROOT_MOUNT_NODE_MISSING');
}
installSdkTauriRuntimeHook();
bindRuntimeI18n(i18n);
void pingDesktopMacosSmoke('renderer-main-entry').catch(() => {});
window.addEventListener('error', (event) => {
    void pingDesktopMacosSmoke('window-page-error', {
      message: event.message || '',
      filename: event.filename || '',
      lineno: event.lineno || 0,
      colno: event.colno || 0,
    }).catch(() => {});
});
window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
      ? event.reason.message
      : String(event.reason || 'unhandled rejection');
    void pingDesktopMacosSmoke('window-page-error', {
      message: reason,
      type: 'unhandledrejection',
    }).catch(() => {});
});
initI18n().finally(() => {
    createRoot(rootElement).render(<Suspense fallback={null}>
      <NimiThemeProvider accentPack="desktop-accent" defaultScheme="light">
        <App />
      </NimiThemeProvider>
    </Suspense>);
    void pingDesktopMacosSmoke('renderer-root-mounted').catch(() => {});
});
