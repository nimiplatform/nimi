import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain, Menu, protocol } from 'electron';
import {
  createElectronShellFileProtocolHost,
  createNimiElectronFileAIConfigStore,
  createNimiElectronInstalledHost,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  resolveElectronStandardStorageRoots,
  type NimiElectronShellFileProtocolHost,
  type NimiElectronStandardDataRootBinding,
  type NimiElectronStandardShellHost,
} from '@nimiplatform/kit/shell/electron/main';
import { NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID } from '@nimiplatform/kit/shell/capabilities';
import { createTesterElectronCommandHandlers } from './commands/tester-commands.js';

const APP_ID = 'nimi.tester';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistUrl = pathToFileURL(rendererDistIndex).toString();
const rendererUrl = normalizeText(process.env.NIMI_TESTER_ELECTRON_RENDERER_URL);
const runtimeEndpoint = normalizeText(process.env.NIMI_RUNTIME_GRPC_ADDR)
  || normalizeText(process.env.NIMI_TESTER_ELECTRON_RUNTIME_ENDPOINT)
  || '127.0.0.1:46371';
const worldTourWindows = new Map<string, BrowserWindow>();

const fileProtocolHost: NimiElectronShellFileProtocolHost = createElectronShellFileProtocolHost({
  protocol: {
    registerSchemesAsPrivileged: (customSchemes) => protocol.registerSchemesAsPrivileged([...customSchemes]),
    handle: (scheme, handler) => protocol.handle(scheme, (request) => handler(request) as Promise<Response>),
  },
  roots: resolveStandardLocalAssetRoots(resolveStandardDataRoot()),
});

fileProtocolHost.registerPrivilegedSchemes();

app.setName('Nimi Tester');
Menu.setApplicationMenu(null);
configureTesterElectronChromiumRuntime();

void app.whenReady().then(async () => {
  fileProtocolHost.registerProtocolHandler();
  const standardDataRoot = resolveStandardDataRoot();
  const standardShellHost: NimiElectronStandardShellHost = {
    capabilitySetRef: NIMI_INSTALLED_NIMI_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
    installedHost: createNimiElectronInstalledHost(),
    standardDataRootBinding: resolveStandardDataRootBinding(),
    localAssetRoots: resolveStandardLocalAssetRoots(standardDataRoot),
    localAssetProtocolHost: fileProtocolHost,
    aiConfigStore: createTesterAiConfigStore(standardDataRoot),
  };
  registerNimiElectronRuntimeBridge({
    appId: APP_ID,
    runtimeEndpoint,
    allowedOrigins: allowedRendererOrigins(),
    allowedRendererUrls: allowedRendererUrls(),
    ipcMain,
    commandHandlers: createTesterElectronCommandHandlers({
      registerReadableFile: (filePath) => fileProtocolHost.registerReadableFile(filePath).then(() => undefined),
      resolveWorldTourStorageRoots: () => resolveWorldTourStorageRoots(standardShellHost),
      openWorldTourWindow,
    }),
    standardShellHost,
  });

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

function configureTesterElectronChromiumRuntime(): void {
  app.commandLine.appendSwitch('disable-background-networking');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    title: 'Nimi Tester',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenTesterWindowChrome(window);
  secureTesterWindow(window);
  await loadRendererRoute(window, '/');
  return window;
}

async function openWorldTourWindow(input: {
  readonly route: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}): Promise<{ readonly windowLabel: string }> {
  for (const window of worldTourWindows.values()) {
    if (!window.isDestroyed()) {
      window.close();
    }
  }
  worldTourWindows.clear();

  const windowLabel = `world-tour-${Date.now()}`;
  const window = new BrowserWindow({
    width: input.width,
    height: input.height,
    minWidth: input.minWidth,
    minHeight: input.minHeight,
    title: input.title,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenTesterWindowChrome(window);
  secureTesterWindow(window);
  worldTourWindows.set(windowLabel, window);
  window.on('closed', () => {
    worldTourWindows.delete(windowLabel);
  });
  await loadRendererRoute(window, input.route);
  return { windowLabel };
}

async function loadRendererRoute(window: BrowserWindow, route: string): Promise<void> {
  const hash = hashFromRoute(route);
  if (rendererUrl) {
    const url = new URL(rendererUrl);
    if (hash) {
      url.hash = hash;
    }
    await window.loadURL(url.toString());
    return;
  }
  await window.loadURL(hash ? `${rendererDistUrl}#${hash}` : rendererDistUrl);
}

function hardenTesterWindowChrome(window: BrowserWindow): void {
  window.setAutoHideMenuBar(true);
  window.setMenuBarVisibility(false);
  window.removeMenu();
}

function secureTesterWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTesterRendererUrl(url)) {
      event.preventDefault();
    }
  });
}

function allowedRendererOrigins(): string[] {
  const origins = new Set<string>();
  for (const url of allowedRendererUrls()) {
    origins.add(originForRendererUrl(url));
  }
  for (const origin of normalizeText(process.env.NIMI_TESTER_ELECTRON_ALLOWED_ORIGINS).split(',')) {
    const normalized = normalizeText(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return [...origins];
}

function originForRendererUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
}

function allowedRendererUrls(): string[] {
  const urls = new Set<string>([rendererUrl || rendererDistUrl]);
  for (const url of normalizeText(process.env.NIMI_TESTER_ELECTRON_ALLOWED_RENDERER_URLS).split(',')) {
    const normalized = normalizeText(url);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

function resolveStandardDataRoot(): string {
  const fromEnv = normalizeText(process.env.NIMI_TESTER_ELECTRON_STANDARD_DATA_ROOT);
  return path.resolve(fromEnv || path.join(app.getPath('userData'), 'standard-shell-data'));
}

function resolveStandardDataRootBinding(): NimiElectronStandardDataRootBinding {
  const fromEnv = normalizeText(process.env.NIMI_TESTER_ELECTRON_STANDARD_DATA_ROOT);
  if (fromEnv) {
    return {
      source: 'runtime-launch-projection',
      durableDataRoot: path.resolve(fromEnv),
      projectionRef: 'tester-electron-acceptance-fixture',
    };
  }
  return { source: 'runtime-get-app-storage' };
}

function resolveStandardLocalAssetRoots(dataRoot: string): string[] {
  const fromEnv = normalizeText(process.env.NIMI_TESTER_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS);
  if (!fromEnv) {
    return [dataRoot, app.getPath('downloads')].map((filePath) => path.resolve(filePath));
  }
  return fromEnv
    .split(path.delimiter)
    .map((filePath) => normalizeText(filePath))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
}

function createTesterAiConfigStore(dataRoot: string) {
  return createNimiElectronFileAIConfigStore({
    dataRoot,
    storeLabel: 'tester AI Config',
  });
}

function isTesterRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

/**
 * Resolves the Runtime-attested cache/temp roots for the app-owned world-tour
 * fixture cache and launch-token temp handles from the standard data root
 * binding. Falls back to the resolved data root when the binding does not carry
 * explicit cache/temp roots (e.g. the acceptance launch projection).
 */
async function resolveWorldTourStorageRoots(
  host: NimiElectronStandardShellHost,
): Promise<{ readonly cacheRoot: string; readonly tempRoot: string }> {
  const roots = await resolveElectronStandardStorageRoots(host, 'world_tour_storage_roots');
  return {
    cacheRoot: roots.cacheRoot ?? roots.dataRoot,
    tempRoot: roots.tempRoot ?? roots.dataRoot,
  };
}

function hashFromRoute(route: string): string {
  const normalized = normalizeText(route);
  if (!normalized || normalized === '/') {
    return '';
  }
  if (normalized.startsWith('/#')) {
    return normalized.slice(2);
  }
  if (normalized.startsWith('#')) {
    return normalized.slice(1);
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
