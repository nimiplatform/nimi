import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
  createRendererEntryModuleLoader,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
import { I18nProvider } from './i18n.js';
import { AppThemeProvider, useAppTheme } from './theme.js';
import { getTargetAppSession, endTargetAppSession } from './shell/workbench-target-adapter.js';
import './styles.css';

installNimiShellRuntimeBridge();
const session = getTargetAppSession();

const entryModuleLoader = createRendererEntryModuleLoader({
  retryDelaysMs: DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
});

const App = lazy(async () => {
  const mod = await entryModuleLoader.load('entry:ai-nimi-harness-app', () => import('./shell/App.js'));
  return { default: mod.App };
});

function ThemedRoot() {
  const { scheme } = useAppTheme();
  return (
    <NimiThemeProvider scheme={scheme} accentPack="nimi-accent">
      <TooltipProvider>
        <Suspense fallback={null}>
          <App />
        </Suspense>
      </TooltipProvider>
    </NimiThemeProvider>
  );
}

const rendererRoot = document.getElementById('root') as HTMLElement;
/* Admitted workbench styles use this module scope, including body-portaled controls. */
document.body.classList.add('nimi-ui-module--lab');
rendererRoot.classList.add('nimi-workbench-host', 'nimi-ui-module--lab');
const reactRoot = createRoot(rendererRoot);
reactRoot.render(
  <React.StrictMode>
    <AppThemeProvider>
      <I18nProvider>
        <ThemedRoot />
      </I18nProvider>
    </AppThemeProvider>
  </React.StrictMode>,
);
void session.start();
if (import.meta.hot) import.meta.hot.dispose(() => { endTargetAppSession(session); reactRoot.unmount(); });
