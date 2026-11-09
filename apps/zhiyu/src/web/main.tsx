import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { createNimiRemoteAppSession, type NimiRemoteAppSessionConfig } from '@nimiplatform/kit/core/remote-app-session';
import { prepareRuntimeClientLogin, completeRuntimeClientLogin } from '@nimiplatform/sdk/realm/runtime-client';
import { connectRemoteRuntime } from '@nimiplatform/sdk/runtime/remote';
import { createNimiRendererHostBinding, createNimiRendererThemeController, NimiRendererHostProvider, type NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';
import { ZhiyuFrame } from '../production/surface.js';
import { ZhiyuNavigationOwner } from '../shell/app/navigation.js';
import { setZhiyuRemoteRuntime } from '../shell/auth/runtime-platform.js';
import '../styles.css';
import '../renderer/styles.css';

declare const __NIMI_APP_WEB_CONFIG__: NimiRemoteAppSessionConfig;
const config = __NIMI_APP_WEB_CONFIG__;
setZhiyuRemoteRuntime(null);
const session = createNimiRemoteAppSession(config, {
  storage: sessionStorage, navigate: url => location.assign(url),
  clearCallback: () => history.replaceState(null, '', config.redirectUri),
  prepare: prepareRuntimeClientLogin, complete: completeRuntimeClientLogin, connect: connectRemoteRuntime,
  messages: { loginExpired: '本次登录已失效，请重新登录。', appSourceRequired: '织羽需要普通生态应用来源。' },
});

const off = session.subscribe(() => setZhiyuRemoteRuntime(session.getSnapshot().connection));
function WebEntry() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const connected = state.phase === 'connected' && state.connection;
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-sm">
      <strong>织羽网页版</strong><span>{state.identity?.displayName}</span>
      {connected && <span>{state.connection?.primary.displayName}</span>}
      {(connected || state.phase === 'connecting') && <Button size="sm" onClick={session.disconnect}>断开连接</Button>}
      {state.identity && <Button size="sm" onClick={() => { void session.signOut(); }}>退出织羽登录</Button>}
    </header>
    {connected ? <div className="min-h-0 flex-1" key={state.identity?.contextId}><ZhiyuNavigationOwner><ZhiyuFrame host={rendererHost.facade} nativeAuth={false} /></ZhiyuNavigationOwner></div>
      : <main className="m-auto flex max-w-xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">与 Nimi 伙伴继续交流</h1>
        <p>连接你的主 Runtime，使用已有伙伴、对话与配置。请保持 PC 上的 Nimi Home 运行。</p>
        <p role="status">{state.phase === 'connecting' ? '正在连接。首次使用时，请在 PC Home 确认织羽来源。' : '同一来源正常重连无需重复批准。'}</p>
        {state.error && <p role="alert">{state.error.message}</p>}
        {state.phase !== 'connecting' && (state.identity
          ? <Button onClick={() => { void session.connect(); }}>连接我的 Runtime</Button>
          : <Button disabled={state.phase === 'signing-in' || state.phase === 'signing-out'} onClick={() => { void session.signIn(); }}>使用 Nimi 账号登录</Button>)}
      </main>}
  </div>;
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
void session.restore(location.href);
const pageHide = (event: PageTransitionEvent) => { if (event.persisted) session.disconnect(); else session.dispose(); };
window.addEventListener('pagehide', pageHide);
if (import.meta.hot) import.meta.hot.dispose(() => { window.removeEventListener('pagehide', pageHide); session.dispose(); off(); setZhiyuRemoteRuntime(null); reactRoot.unmount(); overlayRoot.remove(); });
