import { prepareRuntimeClientLogin, completeRuntimeClientLogin, connectRemoteRuntime } from '@nimiplatform/kit/core/sdk-contract';
import { createNimiAppSession, type NimiRemoteAppConfig } from '@nimiplatform/kit/core/app-session';

// @nimi-authority: rule.nimi.platform.ui-design-system.remote-app-session
export function createWebNimiAppSession(config: NimiRemoteAppConfig) {
  const session = createNimiAppSession({ kind: 'remote', sourceKind: 'web', config, storage: window.sessionStorage,
    callbackUrl: () => window.location.href, navigate: url => window.location.assign(url),
    clearCallback: () => window.history.replaceState(null, '', config.redirectUri),
    prepare: prepareRuntimeClientLogin, complete: completeRuntimeClientLogin, connect: connectRemoteRuntime });
  const hide = (event: PageTransitionEvent) => { if (event.persisted) session.disconnectRuntime(); else dispose(); };
  const resume = () => { if (document.visibilityState === 'visible') void session.recheck(); };
  const show = (event: PageTransitionEvent) => { if (event.persisted) session.cancelSignIn(); resume(); };
  window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
  document.addEventListener('visibilitychange', resume);
  function dispose() {
    window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show);
    document.removeEventListener('visibilitychange', resume); session.dispose();
  }
  return Object.freeze({ ...session, dispose });
}
export type { NimiRemoteAppConfig } from '@nimiplatform/kit/core/app-session';
