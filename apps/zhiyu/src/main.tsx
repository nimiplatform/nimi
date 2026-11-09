import { createDesktopNimiAppSession } from '@nimiplatform/kit/auth/app/desktop';
import { NimiAppSessionProvider, NimiAppAccessGate, NimiAccountControl } from '@nimiplatform/kit/auth/app';
import React from 'react';
import { ZhiyuFrame } from './production/surface.js';
import { createRoot } from 'react-dom/client';
import {
  NimiRendererHostProvider,
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import './styles.css';
import './renderer/styles.css';
import { ZhiyuNavigationOwner } from './shell/app/navigation.js';

installNimiShellRuntimeBridge();
const appSession = createDesktopNimiAppSession();

const root = document.getElementById('root');
if (!root) {
  throw new Error('zhiyu root element is missing');
}
root.classList.add('nimi-ui-module--zhiyu');

const overlayRoot = document.createElement('div');
overlayRoot.id = 'zhiyu-production-overlays';
overlayRoot.classList.add('nimi-ui-module--zhiyu');
document.body.append(overlayRoot);

const rendererHost = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
  opaqueScopePrefix: 'zhiyu-production',
  declaredMethods: [],
  capabilities: [],
  localization: { locale: 'zh-CN', language: 'zh', direction: 'ltr' },
  targets: { renderer: root, overlay: overlayRoot },
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

createRoot(root).render(
  <React.StrictMode>
    <NimiRendererHostProvider binding={rendererHost}>
      <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
        <TooltipProvider>
          <NimiAppSessionProvider session={appSession}>
            <NimiAppAccessGate title="织羽">{scope => (
              <ZhiyuNavigationOwner>
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex shrink-0 justify-end px-4 py-1"><NimiAccountControl hideSignedOut /></div>
                  <ZhiyuFrame host={rendererHost.facade} client={scope.client} />
                </div>
              </ZhiyuNavigationOwner>
            )}</NimiAppAccessGate>
          </NimiAppSessionProvider>
        </TooltipProvider>
      </NimiThemeProvider>
    </NimiRendererHostProvider>
  </React.StrictMode>,
);

void appSession.start();
if (import.meta.hot) import.meta.hot.dispose(() => appSession.dispose());
