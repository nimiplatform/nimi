/// <reference types="vite/client" />
import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { createNimiRendererHostBinding, createNimiRendererThemeController, type NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import '../styles.css';
import './styles.css';
import { getCurrentLocale } from '../shell/i18n/index.js';
import { installDocumentLangSync } from '../shell/i18n/document-lang.js';
import { setLabRemoteRuntime } from '../shell/local-app-runtime-platform.js';
import { clearRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { createWebNimiAppSession } from '@nimiplatform/kit/auth/app/web';
import { appId } from '../shell/auth/app-identity.js';
import { LabWebApp } from './app.js';

// The browser never installs the native shell bridge or constructs a local Host.
setLabRemoteRuntime(null);
const config = { clientId: String(import.meta.env.VITE_NIMI_LAB_WEB_CLIENT_ID || ''),
  realmEnvironmentId: String(import.meta.env.VITE_NIMI_REALM_ENVIRONMENT_ID || ''),
  officialWebBaseUrl: String(import.meta.env.VITE_NIMI_OFFICIAL_WEB_URL || ''),
  realmBaseUrl: window.location.origin, redirectUri: new URL('/', window.location.origin).href };
const errors = [
  !config.clientId && 'VITE_NIMI_LAB_WEB_CLIENT_ID',
  !config.realmEnvironmentId && 'VITE_NIMI_REALM_ENVIRONMENT_ID',
  !config.officialWebBaseUrl && 'VITE_NIMI_OFFICIAL_WEB_URL',
].filter((value): value is string => Boolean(value));
if (window.location.protocol !== 'https:') errors.push('HTTPS');
const disposeLanguage = installDocumentLangSync();
const root = document.getElementById('root')!;
root.classList.add('nimi-workbench-host', 'nimi-ui-module--lab'); document.body.classList.add('nimi-ui-module--lab');
const overlays = document.createElement('div'); overlays.classList.add('nimi-ui-module--lab'); document.body.append(overlays);
const rendererHost = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
  opaqueScopePrefix: 'lab-web-renderer', declaredMethods: [], capabilities: [],
  localization: getCurrentLocale() === 'zh' ? { locale: 'zh-CN', language: 'zh', direction: 'ltr' } : { locale: 'en-US', language: 'en', direction: 'ltr' },
  targets: { renderer: root, overlay: overlays }, theme: createNimiRendererThemeController({ scheme: 'light', accentPack: 'nimi-accent', density: 'regular' }),
  operations: { invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
  overlays: { target: overlays, acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
  surfaceLifecycle: { reportReadyCandidate: () => undefined },
});
const connection = createWebNimiAppSession({ ...config, appId });
const unsubscribe = connection.subscribe(() => { const state = connection.getSnapshot();
  setLabRemoteRuntime(state.runtime.status === 'connected' && state.identity.status === 'signed-in' ? { ...state.runtime.scope, user: state.identity.user } : null);
  clearRuntimePlatformProjection(); });
const reactRoot = createRoot(root);
reactRoot.render(<React.StrictMode><NimiThemeProvider accentPack="nimi-accent" defaultScheme="light"><TooltipProvider>
  <LabWebApp connection={connection} rendererHost={rendererHost} configurationErrors={errors} />
</TooltipProvider></NimiThemeProvider></React.StrictMode>);
if (!errors.length) void connection.start();
const dispose = () => { connection.dispose(); unsubscribe(); setLabRemoteRuntime(null); };
if (import.meta.hot) import.meta.hot.dispose(() => { dispose(); reactRoot.unmount(); overlays.remove(); disposeLanguage(); });
