import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
  createRendererEntryModuleLoader,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
import './styles.css';
// Synchronously initializes i18next before mount; see shell/i18n/index.ts.
import { getCurrentLocale } from './shell/i18n/index.js';
import { installDocumentLangSync } from './shell/i18n/document-lang.js';

// Platform bootstrap (Kit-owned): install the shell invoke/listen bridge before
// the fixed local-app SDK client is constructed. The renderer receives only the
// typed local-app command set, never transport or session authority material.
installNimiShellRuntimeBridge();
installDocumentLangSync();

const entryModuleLoader = createRendererEntryModuleLoader({
  retryDelaysMs: DEFAULT_DEV_RENDERER_ENTRY_IMPORT_RETRY_DELAYS_MS,
});

const App = lazy(async () => {
  const mod = await entryModuleLoader.load('entry:lab-app', () => import('./shell/App.js'));
  return { default: mod.App };
});

const rendererRoot = document.getElementById('root') as HTMLElement;
rendererRoot.classList.add('nimi-ui-module--lab');
const overlayRoot = document.createElement('div');
overlayRoot.id = 'lab-production-overlays';
overlayRoot.classList.add('nimi-ui-module--lab');
document.body.append(overlayRoot);
const rendererHost = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
  opaqueScopePrefix: 'lab-production',
  declaredMethods: [],
  capabilities: [],
  localization: getCurrentLocale() === 'zh'
    ? { locale: 'zh-CN', language: 'zh', direction: 'ltr' }
    : { locale: 'en-US', language: 'en', direction: 'ltr' },
  targets: { renderer: rendererRoot, overlay: overlayRoot },
  theme: createNimiRendererThemeController({
    scheme: 'light',
    accentPack: 'nimi-accent',
    density: 'regular',
  }),
  operations: {
    invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
  },
  overlays: {
    target: overlayRoot,
    acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
  },
  surfaceLifecycle: { reportReadyCandidate: () => undefined },
});

createRoot(rendererRoot).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <App rendererHost={rendererHost} />
    </Suspense>
  </React.StrictMode>,
);
