import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import {
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronAIConfigStore,
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

void app.whenReady().then(async () => {
  registerReadableFileProtocol();
  const standardDataRoot = resolveStandardDataRoot();
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
      localAgentIdentity: {
        ownerUserId: normalizeText(process.env.NIMI_TESTER_ELECTRON_LOCAL_AGENT_OWNER_USER_ID) || 'tester-local-owner',
        runtimeSourceRef: normalizeText(process.env.NIMI_TESTER_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF) || APP_ID,
      },
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

function createTesterAiConfigStore(dataRoot: string): NimiElectronAIConfigStore {
  return {
    get: async ({ scopeRef }) => {
      const filePath = testerAiConfigPath(dataRoot, scopeRef);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
      } catch (error) {
        if (isNotFoundError(error)) {
          return undefined;
        }
        throw error;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`tester AI Config store record is invalid: ${filePath}`);
      }
      const record = parsed as Record<string, unknown>;
      if (record.scopeRef !== scopeRef || !record.config || typeof record.config !== 'object' || Array.isArray(record.config)) {
        throw new Error(`tester AI Config store record does not match requested scope: ${filePath}`);
      }
      return record.config as Readonly<Record<string, unknown>>;
    },
    set: async ({ scopeRef, config }) => {
      const filePath = testerAiConfigPath(dataRoot, scopeRef);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({
        schemaVersion: 1,
        scopeRef,
        config,
      }, null, 2), 'utf8');
      return config;
    },
  };
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

function testerAiConfigPath(dataRoot: string, scopeRef: string): string {
  const encoded = Buffer.from(scopeRef, 'utf8').toString('base64url');
  return path.join(dataRoot, 'ai-config', `${encoded}.json`);
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT');
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
