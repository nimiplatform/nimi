import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
  createRendererEntryModuleLoader,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
import './styles.css';
import './shell/auth/auth-i18n.js';

// Platform bootstrap (Kit-owned): install the scoped runtime-transport bridge
// (invoke + event listen) before any runtime/platform client is constructed, so
// SDK/Kit runtime streaming (chat.stream) can subscribe to bridge events. No-op
// outside the Tauri webview. The app does not know the hook details — that
// contract lives in @nimiplatform/kit.
installNimiShellRuntimeBridge();

const entryModuleLoader = createRendererEntryModuleLoader({
  retryDelaysMs: DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
});

const App = lazy(async () => {
  const mod = await entryModuleLoader.load('entry:tester-app', () => import('./shell/App.js'));
  return { default: mod.App };
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <NimiThemeProvider accentPack="nimi-accent">
      <TooltipProvider>
        <Suspense fallback={null}>
          <App />
        </Suspense>
      </TooltipProvider>
    </NimiThemeProvider>
  </React.StrictMode>,
);
