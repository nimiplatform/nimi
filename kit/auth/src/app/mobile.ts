import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { createNimiAppSession, type NimiRemoteAppConfig } from '@nimiplatform/kit/core/app-session';
import { prepareRuntimeClientLogin, completeRuntimeClientLogin, readRuntimeClientSource, connectRemoteRuntime, createNimiError } from '@nimiplatform/kit/core/sdk-contract';

type Source = Awaited<ReturnType<typeof readRuntimeClientSource>>;
interface AndroidAccess {
  verifySource(source: { kind: string; origin: string; redirectUri: string; packageName: string; certificateSha256: string }): Promise<void>;
  request(input: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number; headers: Record<string, string>; body: string;
  }>;
  cancelRequest(input: { id: string }): Promise<void>;
}
const access = registerPlugin<AndroidAccess>('NimiAppAccess');
function platformError(error: unknown) {
  const details = error as { code?: string; message?: string };
  return createNimiError({ message: details?.message || 'Android App access is unavailable.',
    reasonCode: details?.code || 'KIT_MOBILE_ACCESS_UNAVAILABLE', source: 'sdk' });
}

// Capacitor's general HTTP implementation installs a global cookie handler.
// This narrow native transport preserves the SDK's no-cookie/no-redirect policy.
const nativeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, { ...init, credentials: 'omit', redirect: 'error' });
  if (request.signal.aborted) throw request.signal.reason;
  const id = crypto.randomUUID(), body = request.method === 'GET' ? undefined : await request.text();
  if (request.signal.aborted) throw request.signal.reason;
  return new Promise<Response>((resolve, reject) => {
    const abort = () => { void access.cancelRequest({ id }).catch(() => {}); reject(request.signal.reason); };
    request.signal.addEventListener('abort', abort, { once: true });
    void access.request({ id, url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body })
      .then(result => {
        if (request.signal.aborted) return;
        if (result.status >= 300 && result.status < 400) throw new TypeError('Realm redirects are not permitted.');
        resolve(new Response(result.status === 204 ? null : result.body, { status: result.status, headers: result.headers }));
      }).catch(error => reject(platformError(error)))
      .finally(() => request.signal.removeEventListener('abort', abort));
  });
};

// @nimi-authority: rule.nimi.platform.remote-clients.android-registration
// @nimi-authority: rule.nimi.platform.remote-clients.android-development
// @nimi-authority: rule.nimi.platform.ui-design-system.remote-app-session
/** Android 12+ container adapter. Uses the registered App Link or explicitly
 * admitted local-development callback; Web and unsupported native hosts fail. */
export function createMobileNimiAppSession(config: Omit<NimiRemoteAppConfig, 'fetch'>) {
  if (Capacitor.getPlatform() !== 'android' || !['NimiAppAccess', 'App', 'Browser'].every(name => Capacitor.isPluginAvailable(name))) {
    throw createNimiError({ message: 'This entry requires the NimiAppAccess, App and Browser Android plugins.', reasonCode: 'KIT_MOBILE_HOST_REQUIRED', source: 'sdk' });
  }
  const sourceKind = new URL(config.redirectUri).protocol === 'https:' ? 'android-app-link' : 'android-dev-scheme';
  async function verifySource(source: Source) {
    if (source.kind !== sourceKind || source.role !== 'app' || !source.androidPackageName || !source.androidCertificateSha256) {
      throw createNimiError({ message: 'An admitted Android source matching this callback is required.', reasonCode: 'KIT_MOBILE_SOURCE_REQUIRED', source: 'sdk' });
    }
    try { await access.verifySource({ kind: source.kind, origin: source.origin, redirectUri: source.redirectUri,
      packageName: source.androidPackageName, certificateSha256: source.androidCertificateSha256 }); }
    catch (error) { throw platformError(error); }
  }
  const session = createNimiAppSession({ kind: 'remote', sourceKind, config: { ...config, fetch: nativeFetch },
    storage: window.sessionStorage, callbackUrl: () => '', clearCallback() {}, verifySource,
    async prepare(options, expectedAccountId) {
      await verifySource(await readRuntimeClientSource(options));
      return prepareRuntimeClientLogin(options, expectedAccountId);
    },
    complete: completeRuntimeClientLogin, connect: connectRemoteRuntime,
    async navigate(url) { try { await Browser.open({ url }); } catch (error) { throw platformError(error); } },
  });
  let disposed = false, reconnectOnResume = false;
  const callback = async (url: string) => {
    if (!disposed && await session.acceptCallback(url)) await Browser.close();
  };
  const links = App.addListener('appUrlOpen', event => { void callback(event.url); });
  const lifecycle = App.addListener('appStateChange', event => {
    if (disposed) return;
    if (!event.isActive) {
      const state = session.getSnapshot();
      reconnectOnResume = state.runtime.status === 'connected' || state.runtime.status === 'connecting';
      if (reconnectOnResume) session.disconnectRuntime();
    } else {
      const reconnect = reconnectOnResume; reconnectOnResume = false;
      void session.recheck().then(async () => { if (!disposed && reconnect) await session.connectRuntime(); });
    }
  });
  let started: Promise<void> | undefined;
  return Object.freeze({ ...session,
    start: () => started ??= (async () => {
      await Promise.all([links, lifecycle]);
      if (disposed) return;
      await session.start();
      const launch = await App.getLaunchUrl();
      if (launch?.url) await callback(launch.url);
    })(),
    dispose() { disposed = true; session.dispose(); void links.then(handle => handle.remove()); void lifecycle.then(handle => handle.remove()); },
  });
}
