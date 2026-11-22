import process from 'node:process';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  session,
  shell,
  webContents,
} from 'electron';
import {
  configureNimiElectronAppHostProfile,
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  createNimiElectronStandardApplicationMenuTemplate,
  isAllowedElectronRendererUrl,
  NIMI_ELECTRON_APP_ASSET_PROTOCOL_REGISTRATION,
  registerNimiElectronAppBridge,
  type NimiElectronAppChromeHost,
  type RegisteredNimiElectronAppBridge,
} from '@nimiplatform/kit/shell/electron/main';
import {
  NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES,
  NIMI_DESKTOP_APP_PROTOCOL_SCHEME,
} from './app-origin-protocol.js';
import {
  buildManagedWebUnloadDialogCopy,
  createManagedWebLifecycleController,
  createRollingWindowRateLimiter,
  evaluateManagedWebExternalOpenRequest,
} from './managed-web-carrier-policy.js';
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
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: displayName,
      applicationVersion: version,
    });
  }
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
  const chromeHost: NimiElectronAppChromeHost | undefined = windowConfig.titleBarStyle === 'hidden'
    ? createNimiElectronAppChromeHost({
      metadata: { name: displayName, version },
      allowedRendererUrls,
      app,
      appCommands: [{
        id: 'app.nimi-account',
        menu: 'file',
        labels: { en: 'Nimi account', zh: 'Nimi 账号' },
        defaultVisible: false,
      }],
      menu: Menu,
    })
    : undefined;

  if (!chromeHost) {
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(
          createNimiElectronStandardApplicationMenuTemplate({ appName: displayName }) as Electron.MenuItemConstructorOptions[],
        ),
      );
    } else {
      Menu.setApplicationMenu(null);
    }
  }

  let mainWindow: BrowserWindow | undefined;
  let bridge: RegisteredNimiElectronAppBridge | undefined;
  const externalLinkLimiter = createRollingWindowRateLimiter();

  const iconImage = iconPngBytes ? nativeImage.createFromBuffer(iconPngBytes) : undefined;
  const validIcon = iconImage && !iconImage.isEmpty() ? iconImage : undefined;

  const createMainWindow = async (onConstructed?: () => void): Promise<BrowserWindow> => {
    const isHiddenChrome = windowConfig.titleBarStyle === 'hidden';
    const chromeOptions = isHiddenChrome
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
      autoHideMenuBar: isHiddenChrome,
      webPreferences: {
        preload: input.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });
    mainWindow = win;
    lifecycle.markWindowCreated();
    onConstructed?.();

    if (chromeHost) {
      chromeHost.bindWindow(win);
    } else if (process.platform !== 'darwin') {
      win.setMenu(null);
      win.setMenuBarVisibility(false);
    }

    win.on('close', () => {
      lifecycle.markWindowClose(win);
    });
    win.on('closed', () => {
      lifecycle.markWindowClosed(win);
      if (mainWindow === win) {
        mainWindow = undefined;
      }
    });
    win.webContents.on('will-prevent-unload', (event) => {
      lifecycle.handleWillPreventUnload(win, () => {
        event.preventDefault();
      });
    });
    win.webContents.setWindowOpenHandler((details) => {
      const safeUrl = evaluateManagedWebExternalOpenRequest({
        url: details.url,
        disposition: details.disposition,
        hasPostBody: Boolean(details.postBody),
        windowDestroyed: win.isDestroyed(),
        windowVisible: !win.isDestroyed() && win.isVisible(),
        windowFocused: !win.isDestroyed() && win.isFocused(),
        rateLimiter: externalLinkLimiter,
      });
      if (safeUrl) {
        void shell.openExternal(safeUrl).catch((error) => {
          process.stderr.write(
            `[managed-web-carrier] external open failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        });
      }
      return { action: 'deny' };
    });

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
    try {
      await win.loadURL(entryUrl);
    } catch (error) {
      if (!win.isDestroyed()) {
        throw error;
      }
    }
    return win;
  };

  const lifecycle = createManagedWebLifecycleController<BrowserWindow>({
    platform: process.platform,
    getWindows: () => BrowserWindow.getAllWindows(),
    isWindowDestroyed: (win) => win.isDestroyed(),
    destroyWindow: (win) => {
      win.destroy();
    },
    createWindow: async (onConstructed) => {
      await createMainWindow(onConstructed);
    },
    confirmUnload: async (win, signal) => {
      if (signal.aborted || win.isDestroyed()) {
        return false;
      }
      const copy = buildManagedWebUnloadDialogCopy(displayName, app.getLocale());
      const result = await dialog.showMessageBox(win, {
        type: 'warning',
        title: copy.title,
        message: copy.message,
        detail: copy.detail,
        buttons: [...copy.buttons],
        defaultId: copy.defaultId,
        cancelId: copy.cancelId,
        noLink: copy.noLink,
        signal,
      });
      return !signal.aborted && result.response === 1;
    },
    quitApp: () => {
      app.quit();
    },
    unregisterBridge: () => {
      bridge?.unregister();
      bridge = undefined;
    },
    disposeChromeHost: () => {
      chromeHost?.dispose();
    },
    onResetError: (error) => {
      process.stderr.write(
        `[managed-web-carrier] session reset failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    },
  });

  app.on('window-all-closed', () => {
    if (lifecycle.shouldQuitOnWindowAllClosed()) {
      app.quit();
    }
  });
  app.on('before-quit', () => {
    lifecycle.markBeforeQuit();
  });
  app.on('will-quit', () => {
    lifecycle.markWillQuit();
  });
  process.on('SIGTERM', () => {
    lifecycle.handleSigterm();
  });

  void app.whenReady().then(async () => {
    installManagedWebPermissionPolicy(session.defaultSession, trustedOrigin);
    if (process.platform === 'darwin' && validIcon) {
      app.dock?.setIcon(validIcon);
    }
    if (snapshot) {
      protocol.handle(NIMI_DESKTOP_APP_PROTOCOL_SCHEME, createManagedWebProtocolHandler(snapshot));
    }
    bridge = registerNimiElectronAppBridge({
      ...(chromeHost ? { chromeHost } : {}),
      appId,
      allowedRendererUrls,
      assetMediaPlatform: {
        protocol,
        webRequest: session.defaultSession.webRequest,
        webContents,
      },
      ipcMain,
      onSessionInvalidated: () => {
        lifecycle.handleSessionInvalidated();
      },
    });
    await createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && lifecycle.shouldCreateOnActivate()) {
        void createMainWindow().catch((error) => {
          process.stderr.write(
            `[managed-web-carrier] activate window failed: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        });
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
