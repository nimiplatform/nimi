import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Exercise native-window lifetime without running a second Electron process.
// Actual renderer, protected session and model acceptance run separately in Home.
const mockUrl = `data:text/javascript,${encodeURIComponent(`
export const state = { windows: [], owners: [], bridges: [], bridgeHandles: [], medias: [], chromes: [], placement: null, chromeApp: null, handlers: new Map(), listeners: new Map() };
export class BrowserWindow {
  constructor() {
    this.destroyed=false; this.focused=false; this.focusCount=0; this.listeners=new Map(); state.windows.push(this);
    this._webContents={mainFrame:{url:'nimi-app://zhiyu/index.html'},isDestroyed:()=>this.destroyed,setWindowOpenHandler(){},on(){},send(){}};
  }
  get webContents(){if(this.destroyed) throw new TypeError('Object has been destroyed'); return this._webContents;}
  isDestroyed(){return this.destroyed;} isFocused(){return !this.destroyed && this.focused;} isMinimized(){return false;} restore(){} show(){}
  focus(){this.focused=true; this.focusCount++;}
  emit(event,...args){for(const callback of this.listeners.get(event) ?? []) callback(...args);}
  destroy(){if(this.destroyed) return; this.destroyed=true; this.emit('closed');}
  on(event,callback){const list=this.listeners.get(event) ?? []; list.push(callback); this.listeners.set(event,list);}
  async loadURL(){}
  close(){this.emit('close',{preventDefault(){}});}
}
export const app={getPath(){return 'C:/test-home';}};
export const dialog={}; export const Menu={}; export const webContents={}; export const shell={showItemInFolder(){}};
export const ipcMain={on(channel,fn){state.listeners.set(channel,fn);},removeListener(channel){state.listeners.delete(channel);},handle(channel,fn){state.handlers.set(channel,fn);},removeHandler(channel){state.handlers.delete(channel);}};
export const session={fromPartition(){return {protocol:{handle(){}},webRequest:{},setPermissionRequestHandler(){},setPermissionCheckHandler(){}};}};
export function createNimiElectronAppChromeWindowOptions(){return {};}
export function createNimiElectronAppChromeHost(input){state.chromeApp=input.app;const chrome={disposed:0,bindWindow(){},dispose(){this.disposed++;}};state.chromes.push(chrome);return chrome;}
export function createNimiElectronBundledAppLocalHostOwner(input){const owner={appId:input.appId,host:{},closed:0,async shutdown(){this.closed++;}};state.owners.push(owner);return owner;}
export function createNimiElectronLocalAppAssetMediaHost(){const media={invalidated:0,closed:0,invalidateAll(){this.invalidated++;},close(){this.closed++;}};state.medias.push(media);return media;}
export function registerNimiElectronRuntimeBridge(input){state.bridges.push(input);const handle={unregistered:0,unregister(){this.unregistered++;}};state.bridgeHandles.push(handle);return handle;}
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
function host(canOpen = () => true) {
  return createDesktopBundledZhiyuHost({ rendererIndexPath: 'C:/Nimi/zhiyu/dist/index.html',
    preloadPath: 'C:/Nimi/zhiyu-preload.cjs', version: '0.1.0', canOpen,
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


test('only the active Zhiyu main frame can read or acknowledge a target', async () => {
  state.placement = async () => ({ async shutdown() {} });
  const appHost = host();
  await appHost.open();
  const sender = state.windows.at(-1).webContents;
  const event = { sender, senderFrame: sender.mainFrame };
  const read = state.handlers.get('nimi:zhiyu:conversation-open:read');
  const acknowledge = state.listeners.get('nimi:zhiyu:conversation-open:ack');
  const pending = appHost.openConversation({ conversationAnchorId: 'anchor-a' });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const request = read(event);
  assert.ok(request);
  assert.equal(read({ sender: {}, senderFrame: sender.mainFrame }), null);
  assert.equal(read({ sender, senderFrame: {} }), null);
  acknowledge({ sender, senderFrame: {} }, { requestId: request.requestId, status: 'opened' });
  assert.equal(read(event), request);
  acknowledge(event, { requestId: request.requestId, status: 'opened' });
  await pending;
  assert.equal(read(event), null);
  await appHost.shutdown();
  assert.equal(state.handlers.has('nimi:zhiyu:conversation-open:read'), false);
  assert.equal(state.handlers.has('nimi:zhiyu:harness-handoff:submit'), false);
});

test('bundled Zhiyu registers the strict harness handoff IPC and blocks spoofed senders', async () => {
  state.placement = async () => ({ async shutdown() {} });
  const appHost = host();
  await appHost.open();
  const sender = state.windows.at(-1).webContents;
  const handoff = state.handlers.get('nimi:zhiyu:harness-handoff:submit');
  assert.ok(handoff, 'bundled Zhiyu host must register nimi:zhiyu:harness-handoff:submit');
  await assert.rejects(
    handoff({ sender: {}, senderFrame: sender.mainFrame }, {
      agentHandle: 'agent_1',
      requestId: 'req-1',
      text: 'Do task',
      handoffBriefText: 'Task brief',
    }),
    /zhiyu-handoff-sender-unauthorized/,
  );
  await assert.rejects(
    handoff({ sender, senderFrame: sender.mainFrame }, {
      agentHandle: 'agent_1',
      requestId: 'req-1',
      text: 'Do task',
      handoffBriefText: 'Task brief',
      entrySurface: 'forged',
    }),
    /zhiyu-handoff-invalid-brief/,
  );
  await appHost.shutdown();
  assert.equal(state.handlers.has('nimi:zhiyu:harness-handoff:submit'), false);
});

test('unexpected non-close window destruction cleans up via closed event and allows immediate reopen', async () => {
  let placementClosed = 0;
  const firstShutdownGate = deferred<void>();
  let nextGate: ReturnType<typeof deferred<void>> | null = firstShutdownGate;
  state.placement = async () => {
    const gate = nextGate;
    nextGate = null;
    return {
      async shutdown() {
        if (gate) await gate.promise;
        placementClosed++;
      },
    };
  };
  const appHost = host();
  await appHost.open();
  const firstWindow = state.windows.at(-1);
  const firstOwner = state.owners.at(-1);
  const firstBridge = state.bridgeHandles.at(-1);
  const firstMedia = state.medias.at(-1);
  const firstChrome = state.chromes.at(-1);
  assert.equal(appHost.isOpen(), true);

  // Simulate OS force-destroy, window.destroy(), or CDP Target.closeTarget bypassing 'close'.
  firstWindow.destroy();
  assert.equal(firstWindow.isDestroyed(), true);
  assert.equal(appHost.isOpen(), false);

  // Immediately reopen while async cleanup from 'closed' is still in flight.
  const reopening = appHost.open();
  await Promise.resolve();
  assert.equal(state.windows.at(-1), firstWindow);
  assert.equal(firstOwner.closed, 0);

  // Unblock old placement shutdown and verify full teardown + clean window recreation.
  firstShutdownGate.resolve();
  await reopening;
  assert.equal(placementClosed, 1);
  assert.equal(firstOwner.closed, 1);
  assert.equal(firstBridge.unregistered, 1);
  assert.equal(firstMedia.invalidated, 1);
  assert.equal(firstMedia.closed, 1);
  assert.equal(firstChrome.disposed, 1);

  const secondWindow = state.windows.at(-1);
  const secondOwner = state.owners.at(-1);
  assert.notEqual(secondWindow, firstWindow);
  assert.notEqual(secondOwner, firstOwner);
  assert.equal(secondWindow.isDestroyed(), false);
  assert.equal(secondWindow.focusCount, 1);
  assert.equal(appHost.isOpen(), true);

  await appHost.shutdown();
  assert.equal(secondOwner.closed, 1);
  assert.equal(appHost.isOpen(), false);
});

test('open recovers when current window is already destroyed before closed fires and ignores stale closed', async () => {
  let placementClosed = 0;
  state.placement = async () => ({ async shutdown() { placementClosed++; } });
  const appHost = host();
  await appHost.open();
  const firstWindow = state.windows.at(-1);
  const firstOwner = state.owners.at(-1);
  const firstBridge = state.bridgeHandles.at(-1);
  const firstMedia = state.medias.at(-1);
  const firstChrome = state.chromes.at(-1);

  // Mark window destroyed without firing 'closed' yet so open() hits the current-record guard.
  firstWindow.destroyed = true;
  assert.equal(appHost.isOpen(), false);

  await appHost.open();
  assert.equal(placementClosed, 1);
  assert.equal(firstOwner.closed, 1);
  assert.equal(firstBridge.unregistered, 1);
  assert.equal(firstMedia.invalidated, 1);
  assert.equal(firstMedia.closed, 1);
  assert.equal(firstChrome.disposed, 1);

  const secondWindow = state.windows.at(-1);
  const secondOwner = state.owners.at(-1);
  assert.notEqual(secondWindow, firstWindow);
  assert.equal(secondWindow.isDestroyed(), false);
  assert.equal(secondWindow.focusCount, 1);
  assert.equal(appHost.isOpen(), true);

  // A delayed 'closed' event from the old destroyed window must not close the new window.
  firstWindow.emit('closed');
  await Promise.resolve();
  assert.equal(appHost.isOpen(), true);
  assert.equal(secondWindow.isDestroyed(), false);
  assert.equal(secondOwner.closed, 0);

  await appHost.shutdown();
  assert.equal(secondOwner.closed, 1);
});

test('reopening waits for cleanup and rechecks Home admission before creating a window', async () => {
  const cleanup = deferred<void>();
  state.placement = async () => ({ shutdown: () => cleanup.promise });
  let canOpen = true;
  const appHost = host(() => canOpen);
  await appHost.open();
  const windowsBefore = state.windows.length;

  const closing = appHost.close();
  const reopening = appHost.open();
  canOpen = false;
  cleanup.resolve();

  await assert.rejects(reopening, /bundled-zhiyu-home-unavailable/);
  await closing;
  assert.equal(state.windows.length, windowsBefore);
  await appHost.shutdown();
});

test('unexpected destruction during pending openConversation cleans up without touching destroyed webContents', async () => {
  state.placement = async () => ({ async shutdown() {} });
  const appHost = host();
  await appHost.open();
  const firstWindow = state.windows.at(-1);
  const firstOwner = state.owners.at(-1);

  const pending = appHost.openConversation({ conversationAnchorId: 'anchor-destroyed' });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

  // Destroy window while conversation delivery is pending; webContents getter throws when destroyed.
  firstWindow.destroy();
  await assert.rejects(pending, /did not confirm that the conversation opened/);
  assert.equal(appHost.isOpen(), false);
  assert.equal(firstOwner.closed, 1);

  await appHost.open();
  const secondWindow = state.windows.at(-1);
  assert.notEqual(secondWindow, firstWindow);
  assert.equal(secondWindow.isDestroyed(), false);
  assert.equal(appHost.isOpen(), true);

  await appHost.shutdown();
});
