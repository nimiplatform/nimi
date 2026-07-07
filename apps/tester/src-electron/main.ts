import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain, Menu, protocol, shell } from 'electron';
import {
  assertOpaqueElectronLocalAgentRef,
  createElectronShellFileProtocolHost,
  createNimiElectronFileAIConfigStore,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  resolveElectronStandardStorageRoots,
  type NimiElectronRuntimeTrustedCallerMode,
  type NimiElectronShellFileProtocolHost,
  type NimiElectronStandardDataRootBinding,
  type NimiElectronStandardShellHost,
} from '@nimiplatform/kit/shell/electron/main';
import { createTesterElectronCommandHandlers } from './commands/tester-commands.js';
import { createTesterElectronTrustedRuntimeMetadataProvider } from './runtime-auth.js';

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
  const localAgentIdentity = resolveTesterElectronLocalAgentIdentity();
  const standardShellHost: NimiElectronStandardShellHost = {
    standardDataRootBinding: resolveStandardDataRootBinding(),
    localAssetRoots: resolveStandardLocalAssetRoots(standardDataRoot),
    localAssetProtocolHost: fileProtocolHost,
    revealInOs: (filePath) => shell.showItemInFolder(filePath),
    exportDirectory: () => app.getPath('downloads'),
    openExternalUrl: openTesterExternalUrl,
    ...(localAgentIdentity ? { localAgentIdentity } : {}),
    runtimeTrustedCaller: {
      mode: resolveRuntimeTrustedCallerMode(),
    },
    aiConfigStore: createTesterAiConfigStore(standardDataRoot),
    runtimeConfigGet: createTesterRuntimeConfigReader(standardDataRoot),
  };
  registerNimiElectronRuntimeBridge({
    appId: APP_ID,
    runtimeEndpoint,
    allowedOrigins: allowedRendererOrigins(),
    allowedRendererUrls: allowedRendererUrls(),
    ipcMain,
    trustedRuntimeMetadataProvider: createTesterElectronTrustedRuntimeMetadataProvider({
      appId: APP_ID,
      runtimeEndpoint,
    }),
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

function createTesterRuntimeConfigReader(dataRoot: string): () => Promise<{
  readonly path: string;
  readonly config: Readonly<Record<string, unknown>>;
}> {
  return async () => {
    const filePath = path.join(dataRoot, 'runtime', 'config.json');
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`tester Runtime config payload is invalid: ${filePath}`);
    }
    return {
      path: filePath,
      config: parsed as Readonly<Record<string, unknown>>,
    };
  };
}

function resolveRuntimeTrustedCallerMode(): NimiElectronRuntimeTrustedCallerMode {
  const mode = normalizeText(process.env.NIMI_TESTER_ELECTRON_RUNTIME_TRUSTED_CALLER_MODE) || 'local-developer-app';
  if (
    mode === 'local-developer-app'
    || mode === 'local-first-party-app'
    || mode === 'desktop-shell'
  ) {
    return mode;
  }
  throw new Error(`unsupported tester Electron Runtime trusted caller mode: ${mode}`);
}

function resolveTesterElectronLocalAgentIdentity(): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} | undefined {
  const localAgentRef = normalizeText(process.env.NIMI_TESTER_ELECTRON_LOCAL_AGENT_REF);
  if (!localAgentRef) {
    return undefined;
  }
  const ownerUserId = normalizeRequiredEnv(
    process.env.NIMI_TESTER_ELECTRON_LOCAL_AGENT_OWNER_USER_ID,
    'NIMI_TESTER_ELECTRON_LOCAL_AGENT_OWNER_USER_ID',
  );
  const runtimeSourceRef = normalizeRequiredEnv(
    process.env.NIMI_TESTER_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF,
    'NIMI_TESTER_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF',
  );
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error('NIMI_TESTER_ELECTRON_LOCAL_AGENT_REF must start with local-agent:');
  }
  assertOpaqueElectronLocalAgentRef({
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    command: 'NIMI_TESTER_ELECTRON_LOCAL_AGENT_REF',
  });
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}

function normalizeRequiredEnv(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${field} is required when NIMI_TESTER_ELECTRON_LOCAL_AGENT_REF is set`);
  }
  return normalized;
}

function isTesterRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

async function openTesterExternalUrl(url: string): Promise<void> {
  const capturePath = normalizeText(process.env.NIMI_TESTER_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE);
  if (capturePath) {
    const resolved = path.resolve(capturePath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await appendFile(resolved, `${url}\n`, 'utf8');
    return;
  }
  await shell.openExternal(url);
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
