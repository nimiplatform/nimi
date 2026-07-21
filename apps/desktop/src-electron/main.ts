import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type MessageBoxOptions } from 'electron';
import {
  NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION,
  createElectronShellFileProtocolHost,
  createNimiElectronFileAIConfigStore,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
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
import { createDevKernelExternalUrlCapture } from './dev-kernel-external-url-capture.js';
import {
  createDesktopElectronOpenIntentHost,
  DESKTOP_OPEN_INTENT_EVENT,
  type DesktopElectronOpenIntentHost,
} from './desktop-open-intent-host.js';
import { assertMacOSDesktopAcceptanceProfile } from './macos-desktop-acceptance.js';
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
let localDevelopmentHost: DesktopElectronLocalDevelopmentHost | undefined;
let desktopOpenIntentHost: DesktopElectronOpenIntentHost | undefined;
let bundledAvatarHost: DesktopElectronBundledAvatarHost | undefined;
let registeredRuntimeBridge: RegisteredNimiElectronRuntimeBridge | undefined;
let quitCleanup: Promise<void> | undefined;
let quitCleanupComplete = false;
const devKernelExternalUrlCapture = createDevKernelExternalUrlCapture();

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
    const standardDataRoot = resolveStandardDataRoot();
    await mkdir(standardDataRoot, { recursive: true });
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
    bundledAvatarHost = await createDesktopElectronBundledAvatarHost({
      rendererUrl: bundledAvatarRendererUrl,
      preloadPath,
      appPrivateDataRoot: path.join(app.getPath('userData'), 'bundled-avatar', 'standard-shell-data'),
      localAssetProtocolHost,
      resolveSelectedDataRoot: productControlHost.resolveSelectedDataRoot,
      devRendererRoot: ELECTRON_DEVELOPMENT_BUILD
        ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_BUNDLED_AVATAR_DEV_ROOT)
        : undefined,
    });
    registeredRuntimeBridge = registerNimiElectronRuntimeBridge({
      appId: APP_ID,
      runtimeEndpoint: PROTECTED_DESKTOP_RUNTIME_TRANSPORT_REF,
      allowedOrigins: allowedRendererOrigins(),
      allowedRendererUrls: allowedRendererUrls(),
      ipcMain,
      commandHandlers: {
        ...localDevelopmentHost.commandHandlers,
        ...desktopOpenIntentHost.commandHandlers,
        ...productControlHost.commandHandlers,
        ...bundledAvatarHost.desktopCommandHandlers,
        product_control_default_data_root_directory: () => path.resolve(app.getPath('home'), 'Nimi'),
      },
      standardShellHost: {
        allowAllStandardShellCommands: true,
        // Runtime-owned app storage is outside authority package #2a. Omitting
        // the binding keeps storage commands typed unavailable instead of
        // reopening the retired public-TCP GetAppStorage fallback.
        localAssetRoots: resolveStandardLocalAssetRoots(standardDataRoot),
        localAssetProtocolHost,
        openFileDialog: openDesktopStandardFileDialog,
        openExternalUrl: openDesktopExternalUrl,
        confirmDialog: confirmDesktopDialog,
        focusMainWindow: focusDesktopMainWindow,
        runtimeTrustedCaller: {
          mode: 'desktop-shell',
        },
        aiConfigStore: createDesktopAiConfigStore(standardDataRoot),
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
  assertMacOSDesktopAcceptanceProfile({
    platform: process.platform,
    macOSLocalDevelopmentBuild: MACOS_LOCAL_DEVELOPMENT_BUILD,
    commandLine: app.commandLine,
    argv: process.argv,
    env: process.env,
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
  window.on('closed', () => {
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

function resolveStandardDataRoot(): string {
  const fromEnv = ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT)
    : '';
  return path.resolve(fromEnv || path.join(app.getPath('userData'), 'standard-shell-data'));
}

function resolveStandardLocalAssetRoots(dataRoot: string): string[] {
  const fromEnv = ELECTRON_DEVELOPMENT_BUILD
    ? normalizeText(process.env.NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS)
    : '';
  if (!fromEnv) {
    return [dataRoot, app.getPath('downloads')].map((filePath) => path.resolve(filePath));
  }
  return fromEnv
    .split(path.delimiter)
    .map((filePath) => normalizeText(filePath))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
}

function createDesktopAiConfigStore(dataRoot: string) {
  return createNimiElectronFileAIConfigStore({
    dataRoot,
    storeLabel: 'desktop AI Config',
  });
}

async function openDesktopExternalUrl(url: string): Promise<void> {
  if (await devKernelExternalUrlCapture.capture(url)) {
    return;
  }
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
