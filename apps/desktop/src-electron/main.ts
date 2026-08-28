import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  shell,
  Tray,
  type MessageBoxOptions,
} from 'electron';
import {
  NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION,
  NimiElectronShellHostError,
  createElectronRuntimeBridgeCommandNames,
  createElectronShellFileProtocolHost,
  createNimiElectronDesktopControlHost,
  createNimiElectronDeveloperModeStatusProbe,
  createNimiElectronRuntimeLifecycleHost,
  exchangeElectronOauthTokenInHost,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  resolveElectronRuntimeDefaults,
  type NimiElectronFileDialogOpenPayload,
  type NimiElectronFileDialogOpenResult,
  type NimiElectronIpcMainInvokeEvent,
  type NimiElectronShellFileProtocolHost,
  type RegisteredNimiElectronRuntimeBridge,
} from '@nimiplatform/kit/shell/electron/main';
import { buildAvatarLaunchHandoffPayload } from '@nimiplatform/kit/features/avatar/headless';
import type { NimiDesktopOpenIntentEnvelope } from '@nimiplatform/kit/core/desktop-open';
import {
  createDesktopElectronLocalDevelopmentHost,
  type DesktopElectronLocalDevelopmentHost,
} from './local-development-host.js';
import { createDesktopElectronProductControlHost } from './product-control-host.js';
import {
  requireDesktopSourceRuntime,
  sourceRuntimeBootstrapFailureMessage,
} from './source-runtime-bootstrap.js';
import {
  createDesktopElectronOpenIntentHost,
  DESKTOP_OPEN_INTENT_EVENT,
  type DesktopElectronOpenIntentHost,
} from './desktop-open-intent-host.js';
import {
  assertMacOSElectronSecurity,
  resolveElectronRuntimeDeploymentProfile,
} from './macos-electron-security.js';
import {
  createDesktopElectronBundledAvatarHost,
  type DesktopElectronBundledAvatarHost,
} from './bundled-avatar-host.js';
import { createDesktopElectronSystemResourcesHost } from './system-resources-host.js';
import { createDesktopElectronSupportLogsHost } from './support-logs-host.js';
import {
  createDesktopElectronChatAiStoreHost,
  type DesktopElectronChatAiStoreHost,
} from './chat-ai-store-host.js';
import { createDesktopElectronDataCleanupHost } from './data-cleanup-host.js';
import { createDesktopDataRootOperationGate } from './data-root-operation-gate.js';
import { createDesktopElectronHttpHost } from './http-request-host.js';
import {
  bindDesktopSenderInvalidation,
  createDesktopElectronConnectorAuthAcquisitionHost,
  createDesktopManagedConnectorCredentialRuntime,
  type DesktopElectronConnectorAuthAcquisitionHost,
} from './connector-auth-acquisition-host.js';
import { createDesktopElectronRendererLogHost } from './renderer-log-host.js';
import {
  createDesktopElectronMenuBarHost,
  type DesktopElectronMenuBarHost,
  type MenuBarRuntimeStatus,
} from './menu-bar-host.js';
import {
  createDesktopAppOriginProtocol,
  desktopRendererOrigin,
  NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES,
  NIMI_DESKTOP_APP_PROTOCOL_SCHEME,
} from './app-origin-protocol.js';
import {
  MENU_BAR_OPEN_TAB_EVENT,
  type MenuBarOpenTabPayload,
} from '../src/shell/shared/menu-bar-types.js';

const APP_ID = 'nimi.desktop';
const ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX = 'nimi:runtime:event:';
declare const __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__: boolean;
declare const __NIMI_ELECTRON_DEVELOPMENT_BUILD__: boolean;
const MACOS_LOCAL_DEVELOPMENT_BUILD = typeof __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__;
const ELECTRON_DEVELOPMENT_BUILD = typeof __NIMI_ELECTRON_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_ELECTRON_DEVELOPMENT_BUILD__;
const SOURCE_PER_USER_RUNTIME_D2 = ELECTRON_DEVELOPMENT_BUILD
  && !MACOS_LOCAL_DEVELOPMENT_BUILD
  && (
    (process.platform === 'darwin' && process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT === '1')
    || (process.platform === 'win32' && process.env.NIMI_WINDOWS_SOURCE_LOCAL_DEVELOPMENT === '1')
  );

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistAvatarIndex = path.join(appRoot, 'avatar', 'dist', 'index.html');
const appOriginProtocol = createDesktopAppOriginProtocol({
  protocol,
  roots: {
    desktop: path.dirname(rendererDistIndex),
    avatar: path.dirname(rendererDistAvatarIndex),
  },
});
const rendererUrl = ELECTRON_DEVELOPMENT_BUILD
  ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_RENDERER_URL)
  : '';
const bundledAvatarRendererUrl = ELECTRON_DEVELOPMENT_BUILD
  ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_RENDERER_URL) || 'http://127.0.0.1:1427'
  : appOriginProtocol.rendererUrl('avatar');
const AVATAR_ONLY_DEVELOPMENT_MODE = ELECTRON_DEVELOPMENT_BUILD
  && normalizeText(process.env.NIMI_DESKTOP_ELECTRON_AVATAR_ONLY) === '1';
// Nimi Desktop has no public Runtime TCP endpoint. Kit uses this non-endpoint
// label only in lifecycle/error projections; every admitted unary is carried
// by the native protected Desktop control session.
const PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF = 'protected-desktop-control';

// Standard shell local-asset protocol host. Serves only files explicitly
// registered readable (kit host also allows configured `roots`; desktop keeps
// the historical registered-only serving gate by passing no roots). The
// path-allow gate for which absolute paths may be resolved stays on the
// standard shell host via `localAssetRoots`.
//
// Privileged scheme registration is centralized below because Electron reads
// these declarations during app bootstrap.
const localAssetProtocolHost: NimiElectronShellFileProtocolHost = createElectronShellFileProtocolHost({
  protocol: {
    registerSchemesAsPrivileged: () => {
      throw new Error('Desktop registers Electron privileged schemes once during app bootstrap.');
    },
    handle: (scheme, handler) =>
      protocol.handle(scheme, async (request) => (await handler(request)) as Response),
  },
});
let mainWindow: BrowserWindow | undefined;
const desktopSenderInvalidationListeners = new Set<() => void>();
let localDevelopmentHost: DesktopElectronLocalDevelopmentHost | undefined;
let desktopOpenIntentHost: DesktopElectronOpenIntentHost | undefined;
let bundledAvatarHost: DesktopElectronBundledAvatarHost | undefined;
let chatAiStoreHost: DesktopElectronChatAiStoreHost | undefined;
let menuBarHost: DesktopElectronMenuBarHost | undefined;
let connectorAuthAcquisitionHost: DesktopElectronConnectorAuthAcquisitionHost | undefined;
let registeredRuntimeBridge: RegisteredNimiElectronRuntimeBridge | undefined;
let quitCleanup: Promise<void> | undefined;
let quitCleanupComplete = false;

app.setName(MACOS_LOCAL_DEVELOPMENT_BUILD ? 'Nimi Dev' : 'Nimi');
if (SOURCE_PER_USER_RUNTIME_D2) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => app.quit());
  }
}
configureDesktopElectronChromiumRuntime();

const ownsDesktopInstanceLock = app.requestSingleInstanceLock();
if (!ownsDesktopInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void focusDesktopMainWindow();
  });

  protocol.registerSchemesAsPrivileged([
    {
      scheme: NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION.scheme,
      privileges: { ...NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION.privileges },
    },
    {
      scheme: NIMI_DESKTOP_APP_PROTOCOL_SCHEME,
      privileges: { ...NIMI_DESKTOP_APP_PROTOCOL_PRIVILEGES },
    },
  ]);

  void bootstrapDesktopElectronHost();
}

async function bootstrapDesktopElectronHost(): Promise<void> {
  try {
    await app.whenReady();
    if (SOURCE_PER_USER_RUNTIME_D2) {
      await requireDesktopSourceRuntime(createNimiElectronDeveloperModeStatusProbe());
    }
    localAssetProtocolHost.registerProtocolHandler();
    appOriginProtocol.register();
    localDevelopmentHost = await createDesktopElectronLocalDevelopmentHost({
      homeDirectory: app.getPath('home'),
    });
    desktopOpenIntentHost = await createDesktopElectronOpenIntentHost({
      homeDirectory: app.getPath('home'),
      focusMainWindow: focusDesktopMainWindow,
      emitIntent: emitDesktopOpenIntent,
    });
    const productControlHost = createDesktopElectronProductControlHost();
    const systemResourcesHost = createDesktopElectronSystemResourcesHost();
    const resolveProductControlDataRoot = createDesktopProductControlDataRootResolver(
      productControlHost.resolveSelectedDataRoot,
    );
    const dataRootOperationGate = createDesktopDataRootOperationGate();
    chatAiStoreHost = createDesktopElectronChatAiStoreHost({
      resolveSelectedDataRoot: productControlHost.resolveReadyDataRoot,
      operationGate: dataRootOperationGate,
    });
    const supportLogsHost = createDesktopElectronSupportLogsHost({
      resolveSelectedDataRoot: resolveProductControlDataRoot,
      downloadsDirectory: app.getPath('downloads'),
      revealFile: (filePath) => shell.showItemInFolder(filePath),
    });
    const dataCleanupHost = createDesktopElectronDataCleanupHost({
      resolveReadyDataRoot: productControlHost.resolveReadyDataRoot,
      operationGate: dataRootOperationGate,
    });
    const runtimeDeploymentProfile = resolveElectronRuntimeDeploymentProfile({
      electronDevelopmentBuild: ELECTRON_DEVELOPMENT_BUILD,
      macOSLocalDevelopmentBuild: MACOS_LOCAL_DEVELOPMENT_BUILD,
    });
    const runtimeLifecycleProfile = SOURCE_PER_USER_RUNTIME_D2 ? 'source' : 'fixed';
    const httpRequestHost = createDesktopElectronHttpHost({
      realmBaseUrl: resolveDesktopRealmBaseUrl(runtimeDeploymentProfile),
    });
    connectorAuthAcquisitionHost = createDesktopElectronConnectorAuthAcquisitionHost({
      proxyHttp: httpRequestHost.connectorAuthRequest,
      runtime: createDesktopManagedConnectorCredentialRuntime(
        createNimiElectronDesktopControlHost(),
      ),
      openExternalUrl: openDesktopExternalUrl,
      oauthTokenExchange: async (input, signal) => {
        const result = await exchangeElectronOauthTokenInHost(input, undefined, signal);
        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenType: result.tokenType,
          expiresIn: result.expiresIn,
          scope: result.scope,
        };
      },
      authorizeSender: authorizeDesktopRendererSender,
      subscribeSenderInvalidation: (listener) => {
        desktopSenderInvalidationListeners.add(listener);
        return () => desktopSenderInvalidationListeners.delete(listener);
      },
    });
    const rendererLogHost = createDesktopElectronRendererLogHost();
    const runtimeLifecycleHost = createNimiElectronRuntimeLifecycleHost(
      PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF,
      runtimeLifecycleProfile,
    );
    const runtimeCommandNames = createElectronRuntimeBridgeCommandNames();
    const invokeRuntimeLifecycle = async (
      command: string,
    ): Promise<MenuBarRuntimeStatus> => (
      await runtimeLifecycleHost.invoke(command, runtimeCommandNames)
    ) as MenuBarRuntimeStatus;
    menuBarHost = createDesktopElectronMenuBarHost({
      electron: { Menu, Tray },
      icon: process.platform === 'darwin' ? createDesktopMenuBarIcon() : '',
      runtimeLifecycleProfile,
      lifecycle: {
        status: () => invokeRuntimeLifecycle(runtimeCommandNames.status),
        start: () => invokeRuntimeLifecycle(runtimeCommandNames.start),
        restart: () => invokeRuntimeLifecycle(runtimeCommandNames.restart),
      },
      focusMainWindow: focusDesktopMainWindow,
      hideMainWindow: hideDesktopMainWindow,
      emitRendererEvent: emitDesktopMenuBarEvent,
      quit: () => app.quit(),
      reportError: (operation, error) => {
        process.stderr.write(
          `[desktop-menu-bar] ${normalizeText(operation) || 'operation'}:${desktopBootstrapFailureCode(error)}\n`,
        );
      },
    });
    bundledAvatarHost = await createDesktopElectronBundledAvatarHost({
      rendererUrl: bundledAvatarRendererUrl,
      packagedRendererIndexPath: ELECTRON_DEVELOPMENT_BUILD ? undefined : rendererDistAvatarIndex,
      publishPreviewImage: (bytes) => appOriginProtocol.publishAvatarPreview(bytes),
      preloadPath,
      resolveAppPrivateDataRoot: async () => path.join(
        await resolveProductControlDataRoot(),
        'apps',
        'nimi.avatar',
        'data',
      ),
      localAssetProtocolHost,
      devRendererRoot: ELECTRON_DEVELOPMENT_BUILD
        ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_DEV_ROOT)
        : undefined,
    });
    // @nimi-authority: definition.nimi.desktop.bridge-ipc.command-registration-plane
    // @nimi-authority: definition.nimi.desktop.command-execution.registered-surface
    // @nimi-authority: rule.nimi.desktop.command-execution.r005
    // @nimi-authority: rule.nimi.desktop.command-execution.r006
    registeredRuntimeBridge = registerNimiElectronRuntimeBridge({
      appId: APP_ID,
      runtimeEndpoint: PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF,
      runtimeDeploymentProfile,
      runtimeLifecycleProfile,
      allowedOrigins: allowedRendererOrigins(),
      allowedRendererUrls: allowedRendererUrls(),
      ipcMain,
      desktopHost: {
        authorizeSender: authorizeDesktopRendererSender,
        subscribeSenderInvalidation: (listener) => {
          desktopSenderInvalidationListeners.add(listener);
          return () => desktopSenderInvalidationListeners.delete(listener);
        },
      },
      commandHandlers: {
        ...localDevelopmentHost.commandHandlers,
        ...desktopOpenIntentHost.commandHandlers,
        ...productControlHost.commandHandlers,
        ...chatAiStoreHost.commandHandlers,
        ...systemResourcesHost.commandHandlers,
        ...supportLogsHost.commandHandlers,
        ...dataCleanupHost.commandHandlers,
        ...httpRequestHost.commandHandlers,
        ...connectorAuthAcquisitionHost.commandHandlers,
        ...rendererLogHost.commandHandlers,
        ...menuBarHost.commandHandlers,
        ...bundledAvatarHost.desktopCommandHandlers,
      },
      standardShellHost: {
        allowAllStandardShellCommands: true,
        standardDataRootBinding: {
          source: 'product-control-projection',
          resolveDataRoot: resolveProductControlDataRoot,
        },
        localAssetRoots: resolveStandardLocalAssetRoots(),
        localAssetProtocolHost,
        openFileDialog: openDesktopStandardFileDialog,
        openExternalUrl: openDesktopExternalUrl,
        confirmDialog: confirmDesktopDialog,
        focusMainWindow: focusDesktopMainWindow,
        runtimeTrustedCaller: {
          mode: 'desktop-shell',
        },
      },
      bundledAvatarHost: bundledAvatarHost.runtimeBridgeHost,
    });

    if (AVATAR_ONLY_DEVELOPMENT_MODE) {
      await bundledAvatarHost.launchInitialAvatar(buildAvatarLaunchHandoffPayload({
        agentHandle: normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_HANDLE),
        conversationAnchorId: normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_CONVERSATION_ANCHOR_ID),
        avatarInstanceId: normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID),
        launchSource: 'official-avatar-electron-dev-launcher',
      }));
    } else {
      if (menuBarHost.enabled) {
        await menuBarHost.initialize();
      }
      await createMainWindow();
    }

    app.on('activate', () => {
      if (AVATAR_ONLY_DEVELOPMENT_MODE) return;
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
        return;
      }
      void focusDesktopMainWindow();
    });
  } catch (error: unknown) {
    await shutdownBeforeQuit().catch(() => undefined);
    const failureCode = desktopBootstrapFailureCode(error);
    process.stderr.write(`[desktop-bootstrap] ${failureCode}\n`);
    dialog.showErrorBox(
      'Nimi could not start safely',
      SOURCE_PER_USER_RUNTIME_D2
        ? sourceRuntimeBootstrapFailureMessage(failureCode)
        : MACOS_LOCAL_DEVELOPMENT_BUILD
          ? `Nimi Dev bootstrap failed (${failureCode}). Start it with "pnpm dev:runtime -- --desktop" and inspect the terminal output.`
          : 'The verified Desktop carrier could not be initialized. Repair the Nimi installation and try again.',
    );
    app.exit(1);
  }
}

function desktopBootstrapFailureCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'desktop-bootstrap-failed';
  for (const key of ['reasonCode', 'code', 'message'] as const) {
    const value = (error as Readonly<Record<string, unknown>>)[key];
    if (typeof value === 'string' && /^[a-z][a-z0-9-]{0,127}$/u.test(value)) return value;
  }
  return 'desktop-bootstrap-failed';
}

function configureDesktopElectronChromiumRuntime(): void {
  app.commandLine.appendSwitch('disable-background-networking');
  assertMacOSElectronSecurity({
    platform: process.platform,
    commandLine: app.commandLine,
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (quitCleanupComplete) return;
  event.preventDefault();
  quitCleanup ??= shutdownBeforeQuit()
    .then(() => {
      quitCleanupComplete = true;
      app.quit();
    })
    .catch(() => {
      quitCleanup = undefined;
      dialog.showErrorBox(
        'Nimi could not close safely',
        'A supervised local app did not shut down cleanly. Nimi remains open so you can retry without leaving an orphan process.',
      );
    });
});

async function shutdownBeforeQuit(): Promise<void> {
  const localHost = localDevelopmentHost;
  const openIntentHost = desktopOpenIntentHost;
  const avatarHost = bundledAvatarHost;
  const chatStoreHost = chatAiStoreHost;
  const currentMenuBarHost = menuBarHost;
  const connectorAuthHost = connectorAuthAcquisitionHost;
  const runtimeBridge = registeredRuntimeBridge;
  await localHost?.shutdown();
  const cleanupResults = await Promise.allSettled([
    openIntentHost?.shutdown(),
    avatarHost?.shutdown(),
    chatStoreHost?.close(),
    connectorAuthHost?.shutdown(),
  ]);
  try {
    runtimeBridge?.unregister();
  } catch (error) {
    cleanupResults.push({ status: 'rejected', reason: error });
  }
  try {
    currentMenuBarHost?.dispose();
  } catch (error) {
    cleanupResults.push({ status: 'rejected', reason: error });
  }
  if (localDevelopmentHost === localHost) localDevelopmentHost = undefined;
  if (desktopOpenIntentHost === openIntentHost) desktopOpenIntentHost = undefined;
  if (bundledAvatarHost === avatarHost) bundledAvatarHost = undefined;
  if (chatAiStoreHost === chatStoreHost) chatAiStoreHost = undefined;
  if (menuBarHost === currentMenuBarHost) menuBarHost = undefined;
  if (connectorAuthAcquisitionHost === connectorAuthHost) connectorAuthAcquisitionHost = undefined;
  if (registeredRuntimeBridge === runtimeBridge) registeredRuntimeBridge = undefined;
  for (const result of cleanupResults) {
    if (result.status === 'rejected') {
      process.stderr.write(
        `[desktop-shutdown] ${desktopBootstrapFailureCode(result.reason)}\n`,
      );
    }
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 390,
    minHeight: 600,
    title: 'Nimi',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.on('close', (event) => {
    if (!quitCleanupComplete && menuBarHost?.hideMainWindowOnClose()) {
      event.preventDefault();
      return;
    }
    if (!quitCleanupComplete) {
      event.preventDefault();
      app.quit();
    }
  });
  window.on('show', () => menuBarHost?.setWindowVisible(true));
  window.on('hide', () => menuBarHost?.setWindowVisible(false));
  const invalidateDesktopSender = () => {
    for (const listener of desktopSenderInvalidationListeners) listener();
  };
  bindDesktopSenderInvalidation(window.webContents, invalidateDesktopSender);
  window.on('closed', () => {
    invalidateDesktopSender();
    if (mainWindow === window) {
      mainWindow = undefined;
    }
    menuBarHost?.setWindowVisible(false);
  });
  secureDesktopWindow(window);
  await window.loadURL(rendererUrl || appOriginProtocol.rendererUrl('desktop'));
  return window;
}

async function openDesktopStandardFileDialog(
  payload: NimiElectronFileDialogOpenPayload,
): Promise<NimiElectronFileDialogOpenResult> {
  const properties: Electron.OpenDialogOptions['properties'] = [
    payload.kind === 'directory' ? 'openDirectory' : 'openFile',
  ];
  if (payload.multiple) properties.push('multiSelections');
  const options: Electron.OpenDialogOptions = {
    title: payload.title,
    properties,
    filters: payload.filters?.map((filter) => ({
      name: filter.name,
      extensions: [...filter.extensions],
    })),
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return {
    canceled: result.canceled,
    paths: result.filePaths,
  };
}

function secureDesktopWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isDesktopRendererUrl(url)) {
      event.preventDefault();
    }
  });
}

function allowedRendererOrigins(): string[] {
  const origins = new Set<string>();
  for (const url of allowedRendererUrls()) {
    origins.add(desktopRendererOrigin(url));
  }
  const configured = ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_ALLOWED_ORIGINS)
    : '';
  for (const origin of configured.split(',')) {
    const normalized = normalizeText(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return [...origins];
}

function allowedRendererUrls(): string[] {
  const urls = new Set<string>([rendererUrl || appOriginProtocol.rendererUrl('desktop')]);
  const configured = ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_ALLOWED_RENDERER_URLS)
    : '';
  for (const url of configured.split(',')) {
    const normalized = normalizeText(url);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

function isDesktopRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

function resolveStandardLocalAssetRoots(): string[] {
  const fromEnv = ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS)
    : '';
  if (!fromEnv) {
    return [path.resolve(app.getPath('downloads'))];
  }
  return fromEnv
    .split(path.delimiter)
    .map((filePath) => normalizeText(filePath))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
}

function createDesktopProductControlDataRootResolver(
  resolveSelectedDataRoot: () => Promise<string>,
): () => Promise<string> {
  return async () => {
    try {
      const dataRoot = await resolveSelectedDataRoot();
      if (!path.isAbsolute(dataRoot)) {
        throw new NimiElectronShellHostError({
          code: 'host-internal-error',
          message: 'Desktop canonical Product Control data root is not absolute',
          reasonCode: 'electron-product-control-data-root-invalid',
          actionHint: 'repair_canonical_product_control_data_root',
          details: { valueType: typeof dataRoot },
        });
      }
      return dataRoot;
    } catch (error) {
      if (error instanceof NimiElectronShellHostError) {
        throw error;
      }
      throw new NimiElectronShellHostError({
        code: 'capability-unavailable',
        message: 'Desktop canonical Product Control data root is unavailable',
        reasonCode: 'electron-product-control-data-root-unavailable',
        actionHint: 'complete_or_repair_canonical_product_control',
        details: {
          cause: error instanceof Error ? error.message : String(error ?? ''),
        },
      });
    }
  };
}

async function openDesktopExternalUrl(url: string): Promise<void> {
  await shell.openExternal(url);
}

function authorizeDesktopRendererSender(event: NimiElectronIpcMainInvokeEvent): boolean {
  const window = mainWindow;
  return Boolean(window && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame);
}

async function confirmDesktopDialog(payload: {
  readonly title: string;
  readonly description: string;
  readonly level?: string;
}): Promise<{ readonly confirmed: boolean }> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const options: MessageBoxOptions = {
    type: payload.level === 'error' ? 'error' : payload.level === 'warning' ? 'warning' : 'info',
    buttons: ['Cancel', 'OK'],
    cancelId: 0,
    defaultId: 1,
    title: payload.title,
    message: payload.title,
    detail: payload.description,
  };
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return { confirmed: result.response === 1 };
}

async function focusDesktopMainWindow(): Promise<void> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.moveTop();
  window.focus();
  menuBarHost?.setWindowVisible(true);
}

function hideDesktopMainWindow(): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  window?.hide();
}

function emitDesktopOpenIntent(envelope: NimiDesktopOpenIntentEnvelope): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window || window.webContents.isDestroyed()) {
    throw new Error('desktop-open-desktop-not-ready');
  }
  window.webContents.send(
    `${ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX}${DESKTOP_OPEN_INTENT_EVENT}`,
    envelope,
  );
}

function emitDesktopMenuBarEvent(
  eventName: typeof MENU_BAR_OPEN_TAB_EVENT,
  payload: MenuBarOpenTabPayload,
): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window || window.webContents.isDestroyed()) {
    throw new Error('desktop-menu-bar-renderer-not-ready');
  }
  window.webContents.send(
    `${ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX}${eventName}`,
    payload,
  );
}

function createDesktopMenuBarIcon(): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'favicon-32x32.png')
    : path.join(appRoot, 'src', 'shell', 'renderer', 'assets', 'favicon-32x32.png');
  const icon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 18, height: 18 });
  if (icon.isEmpty()) {
    throw new Error('desktop-menu-bar-icon-unavailable');
  }
  return icon;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveDesktopRealmBaseUrl(
  deploymentProfile: ReturnType<typeof resolveElectronRuntimeDeploymentProfile>,
): string {
  const defaults = resolveElectronRuntimeDefaults(deploymentProfile);
  const realm = defaults.realm;
  if (!realm || typeof realm !== 'object' || Array.isArray(realm)) {
    throw new Error('desktop-http-realm-defaults-invalid');
  }
  const realmBaseUrl = (realm as Readonly<Record<string, unknown>>).realmBaseUrl;
  if (typeof realmBaseUrl !== 'string' || !realmBaseUrl) {
    throw new Error('desktop-http-realm-defaults-invalid');
  }
  return realmBaseUrl;
}
