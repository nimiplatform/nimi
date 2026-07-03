import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import {
  assertOpaqueElectronLocalAgentRef,
  createNimiElectronFileAIConfigStore,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronRuntimeTrustedCallerMode,
} from '@nimiplatform/kit/shell/electron/main';
import { createTesterElectronCommandHandlers } from './commands/tester-commands.js';
import { createTesterElectronTrustedRuntimeMetadataProvider } from './runtime-auth.js';

const APP_ID = 'nimi.tester';
const FILE_PROTOCOL = 'nimi-shell-file';

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
const readableFiles = new Set<string>();
const worldTourWindows = new Map<string, BrowserWindow>();

protocol.registerSchemesAsPrivileged([{
  scheme: FILE_PROTOCOL,
  privileges: {
    standard: true,
    secure: true,
    corsEnabled: true,
    supportFetchAPI: true,
    stream: true,
  },
}]);

app.setName('Nimi Tester');
configureTesterElectronChromiumRuntime();

void app.whenReady().then(async () => {
  registerReadableFileProtocol();
  const standardDataRoot = resolveStandardDataRoot();
  const localAgentIdentity = resolveTesterElectronLocalAgentIdentity();
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
      downloadsDir: app.getPath('downloads'),
      revealInOs: (filePath) => shell.showItemInFolder(filePath),
      registerReadableFile,
      openWorldTourWindow,
    }),
    standardShellHost: {
      dataRoot: standardDataRoot,
      localAssetRoots: resolveStandardLocalAssetRoots(standardDataRoot),
      resolveLocalAssetUrl: resolveTesterLocalAssetUrl,
      openExternalUrl: openTesterExternalUrl,
      ...(localAgentIdentity ? { localAgentIdentity } : {}),
      runtimeTrustedCaller: {
        mode: resolveRuntimeTrustedCallerMode(),
      },
      aiConfigStore: createTesterAiConfigStore(standardDataRoot),
      runtimeConfigGet: createTesterRuntimeConfigReader(standardDataRoot),
    },
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
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
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
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
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

async function resolveTesterLocalAssetUrl(filePath: string): Promise<string> {
  await registerReadableFile(filePath);
  return encodeReadableFileUrl(filePath);
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

async function registerReadableFile(filePath: string): Promise<void> {
  const canonical = await realpath(filePath).catch(() => path.resolve(filePath));
  readableFiles.add(canonical);
}

function encodeReadableFileUrl(filePath: string): string {
  return `${FILE_PROTOCOL}://local/${encodeURIComponent(path.resolve(filePath))}`;
}

function registerReadableFileProtocol(): void {
  protocol.handle(FILE_PROTOCOL, async (request) => {
    try {
      const filePath = decodeReadableFileUrl(request.url);
      const canonical = await realpath(filePath);
      if (!readableFiles.has(canonical)) {
        return new Response('file is not registered for tester preview', { status: 403 });
      }
      return new Response(await readFile(canonical), {
        headers: {
          'content-type': contentTypeForPath(canonical),
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error || 'file read failed'), {
        status: 404,
        headers: {
          'access-control-allow-origin': '*',
        },
      });
    }
  });
}

function decodeReadableFileUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== `${FILE_PROTOCOL}:`) {
    throw new Error(`unsupported tester file protocol: ${url.protocol}`);
  }
  const encoded = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
  return decodeURIComponent(encoded);
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
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
