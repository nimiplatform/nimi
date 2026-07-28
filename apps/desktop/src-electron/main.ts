import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type MessageBoxOptions } from 'electron';
import {
  NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION,
  NimiElectronShellHostError,
  createElectronShellFileProtocolHost,
  createNimiElectronFileAIConfigStore,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronAIConfigStore,
  type NimiElectronFileDialogOpenPayload,
  type NimiElectronFileDialogOpenResult,
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
  createDesktopElectronOpenIntentHost,
  DESKTOP_OPEN_INTENT_EVENT,
  type DesktopElectronOpenIntentHost,
} from './desktop-open-intent-host.js';
import { assertMacOSElectronSecurity } from './macos-electron-security.js';
import {
  createDesktopElectronBundledAvatarHost,
  type DesktopElectronBundledAvatarHost,
} from './bundled-avatar-host.js';

const APP_ID = 'nimi.desktop';
const ELECTRON_RUNTIME_EVENT_CHANNEL_PREFIX = 'nimi:runtime:event:';
declare const __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__: boolean;
declare const __NIMI_ELECTRON_DEVELOPMENT_BUILD__: boolean;
const MACOS_LOCAL_DEVELOPMENT_BUILD = typeof __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__;
const ELECTRON_DEVELOPMENT_BUILD = typeof __NIMI_ELECTRON_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_ELECTRON_DEVELOPMENT_BUILD__;
const MACOS_LOCAL_DEVELOPMENT_RENDERER_URL = 'http://127.0.0.1:1420';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistUrl = pathToFileURL(rendererDistIndex).toString();
const rendererDistAvatarIndex = path.join(appRoot, '..', 'avatar', 'dist', 'index.html');
const rendererDistAvatarUrl = pathToFileURL(rendererDistAvatarIndex).toString();
const rendererUrl = MACOS_LOCAL_DEVELOPMENT_BUILD
  ? MACOS_LOCAL_DEVELOPMENT_RENDERER_URL
  : ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_RENDERER_URL)
    : '';
const bundledAvatarRendererUrl = ELECTRON_DEVELOPMENT_BUILD
  ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_RENDERER_URL) || 'http://127.0.0.1:1427'
  : rendererDistAvatarUrl;
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
let registeredRuntimeBridge: RegisteredNimiElectronRuntimeBridge | undefined;
let quitCleanup: Promise<void> | undefined;
let quitCleanupComplete = false;

app.setName(MACOS_LOCAL_DEVELOPMENT_BUILD ? 'Nimi Dev' : 'Nimi');
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
  ]);

  void bootstrapDesktopElectronHost();
}

async function bootstrapDesktopElectronHost(): Promise<void> {
  try {
    await app.whenReady();
    localAssetProtocolHost.registerProtocolHandler();
    localDevelopmentHost = await createDesktopElectronLocalDevelopmentHost({
      homeDirectory: app.getPath('home'),
      focusMainWindow: focusDesktopMainWindow,
    });
    desktopOpenIntentHost = await createDesktopElectronOpenIntentHost({
      homeDirectory: app.getPath('home'),
      focusMainWindow: focusDesktopMainWindow,
      emitIntent: emitDesktopOpenIntent,
    });
    const productControlHost = createDesktopElectronProductControlHost();
    const resolveProductControlDataRoot = createDesktopProductControlDataRootResolver(
      productControlHost.resolveSelectedDataRoot,
    );
    bundledAvatarHost = await createDesktopElectronBundledAvatarHost({
      rendererUrl: bundledAvatarRendererUrl,
      preloadPath,
      resolveAppPrivateDataRoot: async () => path.join(
        await resolveProductControlDataRoot(),
        'apps',
        'nimi.avatar',
        'data',
      ),
      localAssetProtocolHost,
      resolveSelectedDataRoot: resolveProductControlDataRoot,
      devRendererRoot: ELECTRON_DEVELOPMENT_BUILD
        ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_DEV_ROOT)
        : undefined,
    });
    registeredRuntimeBridge = registerNimiElectronRuntimeBridge({
      appId: APP_ID,
      runtimeEndpoint: PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF,
      runtimeDeploymentProfile: ELECTRON_DEVELOPMENT_BUILD ? 'local-development' : 'production',
      allowedOrigins: allowedRendererOrigins(),
      allowedRendererUrls: allowedRendererUrls(),
      ipcMain,
      desktopHost: {
        authorizeSender: (event) => {
          const window = mainWindow;
          return Boolean(window && !window.isDestroyed()
            && event.sender === window.webContents
            && event.senderFrame === window.webContents.mainFrame);
        },
        subscribeSenderInvalidation: (listener) => {
          desktopSenderInvalidationListeners.add(listener);
          return () => desktopSenderInvalidationListeners.delete(listener);
        },
      },
      commandHandlers: {
        ...localDevelopmentHost.commandHandlers,
        ...desktopOpenIntentHost.commandHandlers,
        ...productControlHost.commandHandlers,
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
        aiConfigStore: createDesktopAiConfigStore(resolveProductControlDataRoot),
      },
      bundledAvatarHost: bundledAvatarHost.runtimeBridgeHost,
    });

    if (AVATAR_ONLY_DEVELOPMENT_MODE) {
      await bundledAvatarHost.launchInitialAvatar(buildAvatarLaunchHandoffPayload({
        agentId: normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_AGENT_ID),
        avatarInstanceId: normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_INSTANCE_ID),
        launchSource: 'official-avatar-electron-dev-launcher',
      }));
    } else {
      await createMainWindow();
    }

    app.on('activate', () => {
      if (!AVATAR_ONLY_DEVELOPMENT_MODE && BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  } catch (error: unknown) {
    await shutdownBeforeQuit().catch(() => undefined);
    process.stderr.write(`[desktop-bootstrap] ${desktopBootstrapFailureCode(error)}\n`);
    dialog.showErrorBox(
      'Nimi could not start safely',
      'The verified Desktop carrier could not be initialized. Repair the Nimi installation and try again.',
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
  const runtimeBridge = registeredRuntimeBridge;
  await Promise.all([
    localHost?.shutdown(),
    openIntentHost?.shutdown(),
    avatarHost?.shutdown(),
  ]);
  runtimeBridge?.unregister();
  if (localDevelopmentHost === localHost) localDevelopmentHost = undefined;
  if (desktopOpenIntentHost === openIntentHost) desktopOpenIntentHost = undefined;
  if (bundledAvatarHost === avatarHost) bundledAvatarHost = undefined;
  if (registeredRuntimeBridge === runtimeBridge) registeredRuntimeBridge = undefined;
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
    if (!quitCleanupComplete) {
      event.preventDefault();
      app.quit();
    }
  });
  const invalidateDesktopSender = () => {
    for (const listener of desktopSenderInvalidationListeners) listener();
  };
  window.webContents.on('render-process-gone', invalidateDesktopSender);
  window.on('closed', () => {
    invalidateDesktopSender();
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  secureDesktopWindow(window);
  await window.loadURL(rendererUrl || rendererDistUrl);
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
    origins.add(originForRendererUrl(url));
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
  const urls = new Set<string>([rendererUrl || rendererDistUrl]);
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

function originForRendererUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
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

function createDesktopAiConfigStore(
  resolveDataRoot: () => Promise<string>,
): NimiElectronAIConfigStore {
  const currentStore = async () => createNimiElectronFileAIConfigStore({
    dataRoot: await resolveDataRoot(),
    storeLabel: 'desktop AI Config',
  });
  return {
    get: async (input) => (await currentStore()).get(input),
    set: async (input) => (await currentStore()).set(input),
  };
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
