import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Exercise native-window lifetime without running a second Electron process.
// Actual renderer, protected session and model acceptance run separately in Home.
const mockUrl = `data:text/javascript,${encodeURIComponent(`
export const state = { windows: [], owners: [], bridges: [], placement: null, chromeApp: null };
export class BrowserWindow {
  constructor() { this.destroyed=false; this.listeners=new Map(); state.windows.push(this); this.webContents={mainFrame:{url:'nimi-app://zhiyu/index.html'},setWindowOpenHandler(){},on(){},send(){}}; }
  isDestroyed(){return this.destroyed;} isMinimized(){return false;} restore(){} show(){} focus(){}
  destroy(){this.destroyed=true;}
  on(event,callback){this.listeners.set(event,callback);}
  async loadURL(){}
  close(){this.listeners.get('close')?.({preventDefault(){}});}
}
export const app={getPath(){return 'C:/test-home';}};
export const dialog={}; export const Menu={}; export const webContents={}; export const shell={showItemInFolder(){}};
export const ipcMain={on(){},removeListener(){}};
export const session={fromPartition(){return {protocol:{handle(){}},webRequest:{},setPermissionRequestHandler(){},setPermissionCheckHandler(){}};}};
export function createNimiElectronAppChromeWindowOptions(){return {};}
export function createNimiElectronAppChromeHost(input){state.chromeApp=input.app;return {bindWindow(){},dispose(){}};}
export function createNimiElectronBundledAppLocalHostOwner(input){const owner={appId:input.appId,host:{},closed:0,async shutdown(){this.closed++;}};state.owners.push(owner);return owner;}
export function createNimiElectronLocalAppAssetMediaHost(){return {invalidateAll(){},close(){}};}
export function registerNimiElectronRuntimeBridge(input){state.bridges.push(input);return {unregister(){}};}
export function isAllowedElectronRendererUrl(url,urls){return urls.includes(url);}
export const NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID='local-app-standard-shell-v1';
export function createZhiyuElectronResourcePackPlacementHost(){return state.placement();}
export function readDesktopOpenJsonResponse(){throw Error('unused');}
export function resolveDesktopOpenFetch(){throw Error('unused');}
export function resolveDesktopOpenPresenceDescriptor(){throw Error('unused');}
`)} `;
const moduleUrl = mockUrl.trim();
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron' || specifier === '@nimiplatform/kit/shell/electron/main'
      || specifier === '@nimiplatform/kit/shell/capabilities'
      || specifier.endsWith('/resource-pack-placement-host.js')) return { url: moduleUrl, shortCircuit: true };
    return next(specifier, context);
  },
});
const { state } = await import(moduleUrl);
const { createDesktopBundledZhiyuHost } = await import('../src-electron/bundled-zhiyu-host.js');
hooks.deregister();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function host() {
  return createDesktopBundledZhiyuHost({ rendererIndexPath: 'C:/Nimi/zhiyu/dist/index.html',
    preloadPath: 'C:/Nimi/zhiyu-preload.cjs', version: '0.1.0', canOpen: () => true,
    reportError: error => { throw error; } });
}

test('bundled Zhiyu focuses its current window and closes only its own App resources', async () => {
  state.placement = async () => ({ async shutdown() {} });
  const appHost = host();
  await appHost.open();
  const window = state.windows.at(-1);
  const owner = state.owners.at(-1);
  await appHost.open();
  assert.equal(state.windows.at(-1), window);
  assert.equal(owner.appId, 'nimi.zhiyu');
  assert.equal(state.bridges.at(-1).standardShellHost.localAppHost, owner.host);
  state.chromeApp.quit();
  await appHost.close();
  assert.equal(window.isDestroyed(), true);
  assert.equal(owner.closed, 1);
  assert.equal(appHost.isOpen(), false);
  await appHost.shutdown();
});

test('closing during placement startup disposes the late Host instead of leaking its presence', async () => {
  const started = deferred<void>();
  const placement = deferred<{ shutdown(): Promise<void> }>();
  let placementClosed = 0;
  state.placement = () => { started.resolve(); return placement.promise; };
  const appHost = host();
  const opening = appHost.open();
  const rejected = assert.rejects(opening, /bundled-zhiyu-launch-canceled/);
  await started.promise;
  await appHost.close();
  placement.resolve({ async shutdown() { placementClosed++; } });
  await rejected;
  assert.equal(placementClosed, 1);
  assert.equal(appHost.isOpen(), false);
  await appHost.shutdown();
});
