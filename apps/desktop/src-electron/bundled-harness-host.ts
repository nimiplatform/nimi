import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, Menu, dialog, ipcMain, session, shell, webContents } from 'electron';
import {
  createNimiElectronAppBusinessServices,
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  createNimiElectronBundledAppLocalHostOwner,
  createNimiElectronLocalAppAssetMediaHost,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronAppBusinessServices,
} from '@nimiplatform/kit/shell/electron/main';
import { NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { createDesktopAppOriginProtocol } from './app-origin-protocol.js';
import { installDesktopPermissionPolicy } from './desktop-permission-policy.js';

const rendererUrl = 'nimi-app://harness/index.html';
const invokeChannel = 'nimi:harness:runtime:invoke';
const eventChannelPrefix = 'nimi:harness:runtime:event:';

type HarnessBundledController = Readonly<{
  start: () => Promise<void>;
  focusWorkSession: (workSessionRef: string) => Promise<void>;
  shutdown: () => Promise<void>;
}>;

type HarnessBundledControllerModule = Readonly<{
  createHarnessBundledController: (input: {
    ipcMain: typeof ipcMain;
    services: NimiElectronAppBusinessServices;
    engineWorkerPath: string;
    ownsSender: (event: Electron.IpcMainInvokeEvent) => boolean;
    notifyViewChanged: () => void;
    notifyFocusSession: (workSessionRef: string) => void;
    focusWindow: () => Promise<void>;
    reportError: (error: unknown) => void;
  }) => HarnessBundledController;
}>;

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-pkgrel-009
// Nimi Harness shares the installed Home distribution with its own origin,
// session, renderer bridge, utilityProcess engine worker, and Runtime App identity
// (bundled_harness_v1 / nimi.harness). It never uses Home's App client.
export function createDesktopBundledHarnessHost(input: {
  rendererIndexPath: string;
  preloadPath: string;
  controllerPath: string;
  engineWorkerPath: string;
  version: string;
  canOpen: () => boolean;
  onFocus?: () => void;
  reportError: (error: unknown) => void;
}) {
  const appSession = session.fromPartition('persist:nimi-bundled-harness');
  createDesktopAppOriginProtocol({
    protocol: appSession.protocol,
    roots: { harness: path.dirname(input.rendererIndexPath) },
  }).register();
  installDesktopPermissionPolicy(appSession, new Set(['nimi-app://harness']));

  type BundledHarnessRecord = {
    window: BrowserWindow;
    owner: ReturnType<typeof createNimiElectronBundledAppLocalHostOwner>;
    business: ReturnType<typeof createNimiElectronAppBusinessServices>;
    bridge: ReturnType<typeof registerNimiElectronRuntimeBridge>;
    media: ReturnType<typeof createNimiElectronLocalAppAssetMediaHost>;
    chrome: ReturnType<typeof createNimiElectronAppChromeHost>;
    controller?: HarnessBundledController;
  };
  let current: BundledHarnessRecord | undefined;
  let opening: Promise<void> | undefined;
  let closing: Promise<void> | undefined;

  const ownsSender = (event: Electron.IpcMainInvokeEvent) => Boolean(
    current
    && input.canOpen()
    && event.sender === current.window.webContents
    && event.senderFrame === event.sender.mainFrame,
  );

  const focus = async () => {
    if (!current || current.window.isDestroyed()) throw new Error('bundled-harness-window-unavailable');
    if (current.window.isMinimized()) current.window.restore();
    current.window.show();
    current.window.focus();
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
        await record.controller?.shutdown();
        record.business.close();
        await record.owner.shutdown();
      } finally {
        record.bridge.unregister();
        record.media.close();
        record.chrome.dispose();
      }
    })();
    void closing.then(() => { closing = undefined; }, () => undefined);
    return closing;
  };

  const open = async (workSessionRef?: string): Promise<void> => {
    if (!input.canOpen()) throw new Error('bundled-harness-home-unavailable');
    if (closing) await closing;
    if (opening) {
      await opening;
      if (workSessionRef && current?.controller) {
        await current.controller.focusWorkSession(workSessionRef).catch(input.reportError);
      }
      return focus();
    }
    if (current) {
      if (workSessionRef && current.controller) {
        await current.controller.focusWorkSession(workSessionRef).catch(input.reportError);
      }
      return focus();
    }
    opening = (async () => {
      const owner = createNimiElectronBundledAppLocalHostOwner({
        appId: 'nimi.harness',
        revealInOs: target => shell.showItemInFolder(target),
      });
      const business = createNimiElectronAppBusinessServices(owner.host);
      const chrome = createNimiElectronAppChromeHost({
        metadata: { name: 'Nimi Harness', version: input.version },
        allowedRendererUrls: [rendererUrl],
        app: { quit: () => { void close().catch(input.reportError); } },
        menu: Menu,
      });
      const media = createNimiElectronLocalAppAssetMediaHost({
        localAppHost: owner.host,
        platform: { protocol: appSession.protocol, webRequest: appSession.webRequest, webContents },
      });
      const bridge = registerNimiElectronRuntimeBridge({
        appId: 'nimi.harness',
        runtimeEndpoint: 'bundled-app-protected-carrier',
        allowedOrigins: ['nimi-app://harness'],
        allowedRendererUrls: [rendererUrl],
        ipcMain,
        invokeChannel,
        eventChannelPrefix,
        createGrpcClient: () => { throw new Error('bundled-harness-requires-protected-carrier'); },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          localAppHost: owner.host,
          localAppAssetMediaHost: media,
          chromeHost: chrome,
          openFileDialog: async request => {
            const window = current?.window;
            if (!window) throw new Error('bundled-harness-window-unavailable');
            const result = await dialog.showOpenDialog(window, {
              title: request.title,
              properties: [
                request.kind === 'directory' ? 'openDirectory' : 'openFile',
                ...(request.multiple ? ['multiSelections' as const] : []),
              ],
              filters: request.filters?.map(filter => ({ name: filter.name, extensions: [...filter.extensions] })),
            });
            return { canceled: result.canceled, paths: result.filePaths };
          },
        },
      });
      const window = new BrowserWindow({
        title: 'Nimi Harness',
        width: 1280,
        height: 840,
        minWidth: 800,
        minHeight: 560,
        show: false,
        ...createNimiElectronAppChromeWindowOptions(),
        webPreferences: {
          preload: input.preloadPath,
          session: appSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          additionalArguments: [
            `--nimi-electron-runtime-invoke-channel=${invokeChannel}`,
            `--nimi-electron-runtime-event-channel-prefix=${eventChannelPrefix}`,
          ],
        },
      });
      if (input.onFocus) window.on('focus', input.onFocus);
      const record: BundledHarnessRecord = {
        window,
        owner,
        business,
        bridge,
        media,
        chrome,
        controller: undefined,
      };
      current = record;
      chrome.bindWindow(window);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (!isAllowedElectronRendererUrl(url, [rendererUrl])) event.preventDefault();
      });
      window.on('close', event => {
        event.preventDefault();
        void close().catch(input.reportError);
      });
      try {
        const controllerModule = await import(pathToFileURL(input.controllerPath).href) as HarnessBundledControllerModule;
        if (current !== record) throw new Error('bundled-harness-launch-canceled');
        const controller = controllerModule.createHarnessBundledController({
          ipcMain,
          services: business.services,
          engineWorkerPath: input.engineWorkerPath,
          ownsSender,
          notifyViewChanged: () => {
            if (current === record && !window.isDestroyed()) {
              window.webContents.send('harness:view-changed');
            }
          },
          notifyFocusSession: (ref) => {
            if (current === record && !window.isDestroyed()) {
              window.webContents.send('harness:focus-session', ref);
            }
          },
          focusWindow: focus,
          reportError: input.reportError,
        });
        record.controller = controller;
        await controller.start();
        await window.loadURL(rendererUrl);
        if (current !== record) throw new Error('bundled-harness-launch-canceled');
        if (workSessionRef) {
          await controller.focusWorkSession(workSessionRef).catch(input.reportError);
        }
        await focus();
      } catch (error) {
        await close();
        throw error;
      }
    })();
    try {
      await opening;
    } finally {
      opening = undefined;
    }
  };

  return {
    open,
    isOpen: () => Boolean(current),
    isFocused: () => Boolean(current && !current.window.isDestroyed() && current.window.isFocused()),
    close,
    async shutdown() {
      if (opening) await opening.catch(() => undefined);
      await close();
    },
  };
}
