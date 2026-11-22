import path from 'node:path';
import process from 'node:process';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  session,
  webContents,
} from 'electron';
import {
  configureNimiElectronAppHostProfile,
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  isAllowedElectronRendererUrl,
  NIMI_ELECTRON_APP_ASSET_PROTOCOL_REGISTRATION,
  registerNimiElectronAppBridge,
} from '@nimiplatform/kit/shell/electron/main';
import {
  NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES,
  NIMI_DESKTOP_APP_PROTOCOL_SCHEME,
} from './app-origin-protocol.js';
import {
  createManagedWebProtocolHandler,
  isAllowedManagedWebNavigationUrl,
  loadDevManagedWebProjectMetadata,
  loadVerifiedManagedWebSnapshot,
  parseManagedWebCarrierArguments,
  type ManagedWebCarrierLaunch,
  type ManagedWebWindowConfig,
  type VerifiedManagedWebSnapshot,
} from './managed-web-snapshot.js';

export { parseManagedWebCarrierArguments, type ManagedWebCarrierLaunch };

// @nimi-authority: definition.nimi.platform.app-ecosystem.managed-web-desktop-carrier
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034c

export function startManagedWebCarrier(input: {
  readonly launch: ManagedWebCarrierLaunch;
  readonly preloadPath: string;
}): void {
  // Synchronous pre-ready configuration: bind Host technical profile first so
  // Electron never touches default OS user profile paths.
  app.commandLine.appendSwitch('disable-background-networking');
  configureNimiElectronAppHostProfile(app);

  let snapshot: VerifiedManagedWebSnapshot | undefined;
  let appId: string;
  let version: string;
  let displayName: string;
  let windowConfig: ManagedWebWindowConfig;
  let iconPngBytes: Buffer | undefined;
  let entryUrl: string;
  let trustedOrigin: string;

  if (input.launch.mode === 'installed') {
    snapshot = loadVerifiedManagedWebSnapshot(input.launch.workingDirectory, input.launch.payloadDigest);
    appId = snapshot.appId;
    version = snapshot.version;
    displayName = snapshot.displayName;
    windowConfig = snapshot.windowConfig;
    iconPngBytes = snapshot.iconPngBytes;
    entryUrl = `${NIMI_DESKTOP_APP_PROTOCOL_SCHEME}://${appId}/index.html`;
    trustedOrigin = `${NIMI_DESKTOP_APP_PROTOCOL_SCHEME}://${appId}`;
  } else {
    const devMeta = loadDevManagedWebProjectMetadata(input.launch.workingDirectory);
    appId = devMeta.appId;
    version = devMeta.version;
    displayName = devMeta.displayName;
    windowConfig = devMeta.windowConfig;
    iconPngBytes = devMeta.iconPngBytes;
    entryUrl = input.launch.rendererOrigin;
    trustedOrigin = input.launch.rendererOrigin;
  }

  app.setName(displayName);
  if (process.platform === 'win32') {
    app.setAppUserModelId(`ai.nimi.apps.${appId}${input.launch.mode === 'dev' ? '.dev' : ''}`);
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: NIMI_DESKTOP_APP_PROTOCOL_SCHEME,
      privileges: { ...NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES },
    },
    NIMI_ELECTRON_APP_ASSET_PROTOCOL_REGISTRATION,
  ]);

  const allowedRendererUrls = [entryUrl];
  const chromeHost = createNimiElectronAppChromeHost({
    metadata: { name: displayName, version },
    allowedRendererUrls,
    app,
    menu: Menu,
  });

  let mainWindow: BrowserWindow | undefined;
  let resettingRenderer = false;
  let quitting = false;
  let scopeReset: Promise<void> | undefined;

  const iconImage = iconPngBytes ? nativeImage.createFromBuffer(iconPngBytes) : undefined;
  const validIcon = iconImage && !iconImage.isEmpty() ? iconImage : undefined;

  const createMainWindow = async (): Promise<BrowserWindow> => {
    const chromeOptions = windowConfig.titleBarStyle === 'hidden'
      ? createNimiElectronAppChromeWindowOptions()
      : {};
    const win = new BrowserWindow({
      ...chromeOptions,
      width: windowConfig.width,
      height: windowConfig.height,
      minWidth: windowConfig.minWidth,
      minHeight: windowConfig.minHeight,
      ...(validIcon ? { icon: validIcon } : {}),
      title: displayName,
      autoHideMenuBar: true,
      webPreferences: {
        preload: input.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });
    mainWindow = win;
    chromeHost.bindWindow(win);
    win.on('closed', () => {
      if (mainWindow === win) {
        mainWindow = undefined;
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const isAllowedTopLevelUrl = (targetUrl: string): boolean => (
      input.launch.mode === 'installed'
        ? isAllowedManagedWebNavigationUrl(targetUrl, entryUrl)
        : isAllowedElectronRendererUrl(targetUrl, allowedRendererUrls)
    );
    win.webContents.on('will-navigate', (event, targetUrl) => {
      if (!isAllowedTopLevelUrl(targetUrl)) {
        event.preventDefault();
      }
    });
    win.webContents.on('will-redirect', (event, targetUrl, _isInPlace, isMainFrame) => {
      if (isMainFrame && !isAllowedTopLevelUrl(targetUrl)) {
        event.preventDefault();
      }
    });
    await win.loadURL(entryUrl);
    return win;
  };

  const resetAccountScopedRenderer = (): void => {
    if (quitting || scopeReset || !BrowserWindow.getAllWindows().length) return;
    resettingRenderer = true;
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    scopeReset = createMainWindow()
      .then(() => undefined)
      .catch((error) => {
        process.stderr.write(`[managed-web-carrier] session reset failed: ${error instanceof Error ? error.message : String(error)}\n`);
      })
      .finally(() => {
        scopeReset = undefined;
        resettingRenderer = false;
      });
  };

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !resettingRenderer) {
      app.quit();
    }
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => {
    chromeHost.dispose();
  });

  void app.whenReady().then(async () => {
    installManagedWebPermissionPolicy(session.defaultSession, trustedOrigin);
    if (process.platform === 'darwin' && validIcon) {
      app.dock?.setIcon(validIcon);
    }
    if (snapshot) {
      protocol.handle(NIMI_DESKTOP_APP_PROTOCOL_SCHEME, createManagedWebProtocolHandler(snapshot));
    }
    registerNimiElectronAppBridge({
      chromeHost,
      appId,
      allowedRendererUrls,
      assetMediaPlatform: {
        protocol,
        webRequest: session.defaultSession.webRequest,
        webContents,
      },
      ipcMain,
      onSessionInvalidated: resetAccountScopedRenderer,
    });
    await createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && !resettingRenderer) {
        void createMainWindow();
      }
    });
  }).catch((error) => {
    process.stderr.write(`[managed-web-carrier] startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    app.exit(78);
  });
}

function installManagedWebPermissionPolicy(
  targetSession: Pick<Electron.Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>,
  trustedOrigin: string,
): void {
  const isTrusted = (url: string | undefined): boolean => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      const origin = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
      return origin.toLowerCase() === trustedOrigin.toLowerCase();
    } catch {
      return false;
    }
  };
  targetSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || wc?.getURL();
    callback(isTrusted(requestingUrl) && permission === 'clipboard-sanitized-write');
  });
  targetSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => (
    isTrusted(requestingOrigin) && permission === 'clipboard-sanitized-write'
  ));
}
