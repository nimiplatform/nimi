import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import type { NimiAppSession } from '@nimiplatform/kit/core/app-session';
import { NimiAppSessionProvider, NimiAccountControl, NimiAppAccessGate } from '@nimiplatform/kit/auth/app';
import { createNimiRendererHostBinding, createNimiRendererThemeController, NimiRendererHostProvider, type NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { ZhiyuFrame } from './surface.js';
import { ZhiyuNavigationOwner } from '../shell/app/navigation.js';
import { setZhiyuRemoteRuntime } from '../shell/auth/runtime-platform.js';
import '../styles.css';
import '../renderer/styles.css';

export function mountZhiyuRemote(session: NimiAppSession, title: string) {
setZhiyuRemoteRuntime(null);
const off = session.subscribe(() => {
  const state = session.getSnapshot();
  setZhiyuRemoteRuntime(state.runtime.status === 'connected' && state.identity.status === 'signed-in'
    ? { ...state.runtime.scope, user: state.identity.user } : null);
});
function WebEntry() {
  return <NimiAppSessionProvider session={session}><div className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-sm"><strong>{title}</strong><NimiAccountControl hideSignedOut /></header>
    <NimiAppAccessGate title="与 Nimi 伙伴继续交流" externalAccountControl>{scope => <div className="min-h-0 flex-1"><ZhiyuNavigationOwner><ZhiyuFrame host={rendererHost.facade} client={scope.client} /></ZhiyuNavigationOwner></div>}</NimiAppAccessGate>
  </div></NimiAppSessionProvider>;
}
const root = document.getElementById('root')!;
root.classList.add('nimi-ui-module--zhiyu');
const overlayRoot = document.createElement('div'); overlayRoot.classList.add('nimi-ui-module--zhiyu'); document.body.append(overlayRoot);
const rendererHost = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
  opaqueScopePrefix: 'zhiyu-web', declaredMethods: [], capabilities: [],
  localization: { locale: 'zh-CN', language: 'zh', direction: 'ltr' }, targets: { renderer: root, overlay: overlayRoot },
  theme: createNimiRendererThemeController({ scheme: 'light', accentPack: 'nimi-accent', density: 'regular' }),
  operations: { invoke: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
  overlays: { target: overlayRoot, acquire: async () => ({ ok: false, error: { disposition: 'unsupported' } }) },
  surfaceLifecycle: { reportReadyCandidate: () => undefined },
});
const reactRoot = createRoot(root);
reactRoot.render(<React.StrictMode><NimiRendererHostProvider binding={rendererHost}><NimiThemeProvider accentPack="nimi-accent"><TooltipProvider><WebEntry /></TooltipProvider></NimiThemeProvider></NimiRendererHostProvider></React.StrictMode>);
void session.start();
return () => { session.dispose(); off(); setZhiyuRemoteRuntime(null); reactRoot.unmount(); overlayRoot.remove(); };
}
