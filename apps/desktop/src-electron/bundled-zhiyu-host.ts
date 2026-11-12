import path from 'node:path';
import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell, webContents } from 'electron';
import {
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  createNimiElectronBundledAppLocalHostOwner,
  createNimiElectronLocalAppAssetMediaHost,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
} from '@nimiplatform/kit/shell/electron/main';
import { NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { createZhiyuElectronResourcePackPlacementHost } from '../../zhiyu/src-electron/resource-pack-placement-host.js';
import { redeemDesktopZhiyuResourcePackPlacement } from '../../zhiyu/src-electron/resource-pack-placement-redemption.js';
import { resolveZhiyuResourcePackPlacementAgentHandle } from '../../zhiyu/src-electron/resource-pack-placement-agent-resolution.js';
import { ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL, ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL } from '../../zhiyu/src-electron/resource-pack-placement-ipc.js';
import { createDesktopAppOriginProtocol } from './app-origin-protocol.js';
import { installDesktopPermissionPolicy } from './desktop-permission-policy.js';

const rendererUrl = 'nimi-app://zhiyu/index.html';
const invokeChannel = 'nimi:zhiyu:runtime:invoke';
const eventChannelPrefix = 'nimi:zhiyu:runtime:event:';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-009
// Zhiyu shares the installed Home executable, with its own origin, session,
// renderer bridge and Runtime App identity. It never uses Home's App client.
export function createDesktopBundledZhiyuHost(input: {
  rendererIndexPath: string;
  preloadPath: string;
  version: string;
  canOpen: () => boolean;
  reportError: (error: unknown) => void;
}) {
  const appSession = session.fromPartition('persist:nimi-bundled-zhiyu');
  createDesktopAppOriginProtocol({ protocol: appSession.protocol, roots: { zhiyu: path.dirname(input.rendererIndexPath) } }).register();
  installDesktopPermissionPolicy(appSession, new Set(['nimi-app://zhiyu']));
  let current: {
    window: BrowserWindow;
    owner: ReturnType<typeof createNimiElectronBundledAppLocalHostOwner>;
    bridge: ReturnType<typeof registerNimiElectronRuntimeBridge>;
    media: ReturnType<typeof createNimiElectronLocalAppAssetMediaHost>;
    chrome: ReturnType<typeof createNimiElectronAppChromeHost>;
    placement?: Awaited<ReturnType<typeof createZhiyuElectronResourcePackPlacementHost>>;
  } | undefined;
  let opening: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  const focus = async () => {
    if (!current || current.window.isDestroyed()) throw new Error('bundled-zhiyu-window-unavailable');
    if (current.window.isMinimized()) current.window.restore();
    current.window.show(); current.window.focus();
  };
  const close = (): Promise<void> => {
    if (closing) return closing;
    const record = current;
    if (!record) return Promise.resolve();
    current = undefined;
    if (!record.window.isDestroyed()) record.window.destroy();
    record.media.invalidateAll();
    closing = (async () => {
      try {
        await record.placement?.shutdown();
        await record.owner.shutdown();
      } finally {
        record.bridge.unregister(); record.media.close(); record.chrome.dispose();
      }
    })();
    void closing.then(() => { closing = undefined; }, () => undefined);
    return closing;
  };
  const acknowledge = (event: Electron.IpcMainEvent, value: unknown) => {
    const record = current;
    if (!record || event.sender !== record.window.webContents || event.senderFrame !== event.sender.mainFrame) return;
    record.placement?.acknowledge(value);
  };
  ipcMain.on(ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL, acknowledge);

  const open = async (): Promise<void> => {
    if (!input.canOpen()) throw new Error('bundled-zhiyu-home-unavailable');
    if (closing) await closing;
    if (opening) return opening;
    if (current) return focus();
    opening = (async () => {
      const owner = createNimiElectronBundledAppLocalHostOwner({ appId: 'nimi.zhiyu', revealInOs: target => shell.showItemInFolder(target) });
      const chrome = createNimiElectronAppChromeHost({
        metadata: { name: '织羽', version: input.version }, allowedRendererUrls: [rendererUrl],
        app: { quit: () => { void close().catch(input.reportError); } }, menu: Menu,
      });
      const media = createNimiElectronLocalAppAssetMediaHost({
        localAppHost: owner.host,
        platform: { protocol: appSession.protocol, webRequest: appSession.webRequest, webContents },
      });
      const bridge = registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu', runtimeEndpoint: 'bundled-app-protected-carrier',
        allowedOrigins: ['nimi-app://zhiyu'], allowedRendererUrls: [rendererUrl],
        ipcMain, invokeChannel, eventChannelPrefix,
        createGrpcClient: () => { throw new Error('bundled-zhiyu-requires-protected-carrier'); },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          localAppHost: owner.host, localAppAssetMediaHost: media, chromeHost: chrome,
          openFileDialog: async request => {
            const window = current?.window;
            if (!window) throw new Error('bundled-zhiyu-window-unavailable');
            const result = await dialog.showOpenDialog(window, {
              title: request.title,
              properties: [request.kind === 'directory' ? 'openDirectory' : 'openFile', ...(request.multiple ? ['multiSelections' as const] : [])],
              filters: request.filters?.map(filter => ({ name: filter.name, extensions: [...filter.extensions] })),
            });
            return { canceled: result.canceled, paths: result.filePaths };
          },
        },
      });
      const window = new BrowserWindow({
        title: '织羽', width: 1200, height: 820, minWidth: 720, minHeight: 540,
        show: false, ...createNimiElectronAppChromeWindowOptions(),
        webPreferences: {
          preload: input.preloadPath, session: appSession, contextIsolation: true, nodeIntegration: false, sandbox: true,
          additionalArguments: [`--nimi-electron-runtime-invoke-channel=${invokeChannel}`, `--nimi-electron-runtime-event-channel-prefix=${eventChannelPrefix}`],
        },
      });
      const record = { window, owner, bridge, media, chrome, placement: undefined as Awaited<ReturnType<typeof createZhiyuElectronResourcePackPlacementHost>> | undefined };
      current = record;
      chrome.bindWindow(window);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (!isAllowedElectronRendererUrl(url, [rendererUrl])) event.preventDefault();
      });
      window.on('close', event => { event.preventDefault(); void close().catch(input.reportError); });
      try {
        await window.loadURL(rendererUrl);
        if (current !== record) throw new Error('bundled-zhiyu-launch-canceled');
        const placement = await createZhiyuElectronResourcePackPlacementHost({
          homeDirectory: app.getPath('home'), focusMainWindow: focus,
          redeemPlacement: correlationRef => redeemDesktopZhiyuResourcePackPlacement({ correlationRef }),
          resolveDestinationAgent: anchor => resolveZhiyuResourcePackPlacementAgentHandle(owner.host, anchor),
          emitPlacement: event => window.webContents.send(ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL, event),
        });
        if (current !== record) {
          await placement.shutdown();
          throw new Error('bundled-zhiyu-launch-canceled');
        }
        record.placement = placement;
        await focus();
      } catch (error) { await close(); throw error; }
    })();
    try { await opening; } finally { opening = undefined; }
  };
  return {
    open,
    isOpen: () => Boolean(current),
    close,
    async shutdown() {
      if (opening) await opening.catch(() => undefined);
      await close();
      ipcMain.removeListener(ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL, acknowledge);
    },
  };
}
