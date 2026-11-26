import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { NimiMotionProvider } from '@nimiplatform/kit/ui/motion';
import type { NimiAppSession } from '@nimiplatform/kit/core/app-session';
import { NimiAppSessionProvider } from '@nimiplatform/kit/auth/app';
import { createNimiRendererHostBinding, createNimiRendererThemeController, NimiRendererHostProvider, type NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { setZhiyuRemoteRuntime } from '../shell/auth/runtime-platform.js';
import { ZhiyuRemoteShell } from './remote-shell.js';
import { resolveSystemScheme, useSystemScheme } from './system-scheme.js';
import '../styles.css';
import '../renderer/styles.css';

export { ZhiyuRemoteShell } from './remote-shell.js';

export function mountZhiyuRemote(session: NimiAppSession, title: string) {
  setZhiyuRemoteRuntime(null);
  const off = session.subscribe(() => {
    const state = session.getSnapshot();
    setZhiyuRemoteRuntime(state.runtime.status === 'connected' && state.identity.status === 'signed-in'
      ? { ...state.runtime.scope, user: state.identity.user } : null);
  });

  const root = document.getElementById('root')!;
  root.classList.add('nimi-ui-module--zhiyu');
  const overlayRoot = document.createElement('div');
  overlayRoot.classList.add('nimi-ui-module--zhiyu');
  document.body.append(overlayRoot);

  const themeController = createNimiRendererThemeController({
    scheme: resolveSystemScheme(),
    accentPack: 'nimi-accent',
    density: 'regular',
  });
  const rendererHost = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
    opaqueScopePrefix: 'zhiyu-web',
    declaredMethods: [],
    capabilities: [],
    localization: { locale: 'zh-CN', language: 'zh', direction: 'ltr' },
    targets: { renderer: root, overlay: overlayRoot },
    theme: themeController,
    operations: { invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
    overlays: { target: overlayRoot, acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
    surfaceLifecycle: { reportReadyCandidate: () => undefined },
  });

  function RemoteRoot() {
    const scheme = useSystemScheme(themeController);
    return (
      <NimiRendererHostProvider binding={rendererHost}>
        <NimiThemeProvider accentPack="nimi-accent" scheme={scheme}>
          <NimiMotionProvider>
            <TooltipProvider>
              <NimiAppSessionProvider session={session}>
                <ZhiyuRemoteShell host={rendererHost.facade} title={title} />
              </NimiAppSessionProvider>
            </TooltipProvider>
          </NimiMotionProvider>
        </NimiThemeProvider>
      </NimiRendererHostProvider>
    );
  }

  const reactRoot = createRoot(root);
  reactRoot.render(
    <React.StrictMode>
      <RemoteRoot />
    </React.StrictMode>,
  );
  void session.start();
  return () => {
    session.dispose();
    off();
    setZhiyuRemoteRuntime(null);
    reactRoot.unmount();
    overlayRoot.remove();
  };
}
