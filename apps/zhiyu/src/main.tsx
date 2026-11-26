import { createDesktopNimiAppSession } from '@nimiplatform/kit/auth/app/desktop';
import { NimiAppSessionProvider, NimiAppAccessGate, useNimiAppSession } from '@nimiplatform/kit/auth/app';
import type { NimiAppCommand } from '@nimiplatform/kit/core/app-commands';
import type { NimiAppRuntimeClient } from '@nimiplatform/sdk/app';
import React, { useMemo } from 'react';
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
import { NimiMotionProvider } from '@nimiplatform/kit/ui/motion';
import './styles.css';
import './renderer/styles.css';
import { ZhiyuNavigationOwner } from './shell/app/navigation.js';
import { resolveSystemScheme, useSystemScheme } from './production/system-scheme.js';

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

const themeController = createNimiRendererThemeController({
  scheme: resolveSystemScheme(),
  accentPack: 'nimi-accent',
  density: 'regular',
});

const rendererHost = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
  opaqueScopePrefix: 'zhiyu-production',
  declaredMethods: [],
  capabilities: [],
  localization: { locale: 'zh-CN', language: 'zh', direction: 'ltr' },
  targets: { renderer: root, overlay: overlayRoot },
  theme: themeController,
  operations: {
    invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
  },
  overlays: {
    target: overlayRoot,
    acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
  },
  surfaceLifecycle: { reportReadyCandidate: () => undefined },
});

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-app-chrome
function DesktopZhiyuFrame({ client }: { client: NimiAppRuntimeClient }) {
  const { session, snapshot } = useNimiAppSession();
  const account = session.account;
  const name = snapshot.identity.status === 'signed-in' ? snapshot.identity.user?.displayName : null;
  const commands = useMemo<readonly NimiAppCommand[]>(() => account.kind === 'home-managed' ? [{
    id: 'zhiyu.account.manage', menu: 'file', group: 'account', order: 10,
    label: name ? `在 Home 管理账号 · ${name}` : '在 Home 管理账号',
    state: () => ({ visible: true, enabled: true }),
    execute: () => account.openAccountOwner(),
  }] : [], [account, name]);
  return <ZhiyuFrame host={rendererHost.facade} client={client} commands={commands} />;
}

function DesktopZhiyuRoot() {
  const scheme = useSystemScheme(themeController);
  return (
    <NimiRendererHostProvider binding={rendererHost}>
      <NimiThemeProvider accentPack="nimi-accent" scheme={scheme}>
        <NimiMotionProvider>
          <TooltipProvider>
            <NimiAppSessionProvider session={appSession}>
              <NimiAppAccessGate title="织羽">{scope => (
                <ZhiyuNavigationOwner>
                  <DesktopZhiyuFrame client={scope.client} />
                </ZhiyuNavigationOwner>
              )}</NimiAppAccessGate>
            </NimiAppSessionProvider>
          </TooltipProvider>
        </NimiMotionProvider>
      </NimiThemeProvider>
    </NimiRendererHostProvider>
  );
}

createRoot(root).render(
  <React.StrictMode>
    <DesktopZhiyuRoot />
  </React.StrictMode>,
);

void appSession.start();
if (import.meta.hot) import.meta.hot.dispose(() => appSession.dispose());
