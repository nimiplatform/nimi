import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type MessageBoxOptions } from 'electron';
import {
  assertOpaqueElectronLocalAgentRef,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronAIConfigStore,
} from '@nimiplatform/kit/shell/electron/main';

const APP_ID = 'nimi.desktop';
const FILE_PROTOCOL = 'nimi-shell-file';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistUrl = pathToFileURL(rendererDistIndex).toString();
const rendererUrl = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_RENDERER_URL);
const runtimeEndpoint = normalizeText(process.env.NIMI_RUNTIME_GRPC_ADDR)
  || normalizeText(process.env.NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT)
  || '127.0.0.1:46371';
const readableFiles = new Set<string>();
let mainWindow: BrowserWindow | undefined;

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

app.setName('Nimi Desktop');
configureDesktopElectronChromiumRuntime();

void app.whenReady().then(async () => {
  registerReadableFileProtocol();
  const standardDataRoot = resolveStandardDataRoot();
  const localAgentIdentity = resolveOptionalDesktopElectronLocalAgentIdentity();
  await mkdir(standardDataRoot, { recursive: true });
  registerNimiElectronRuntimeBridge({
    appId: APP_ID,
    runtimeEndpoint,
    allowedOrigins: allowedRendererOrigins(),
    allowedRendererUrls: allowedRendererUrls(),
    ipcMain,
    standardShellHost: {
      dataRoot: standardDataRoot,
      localAssetRoots: resolveStandardLocalAssetRoots(standardDataRoot),
      resolveLocalAssetUrl: resolveDesktopLocalAssetUrl,
      openExternalUrl: openDesktopExternalUrl,
      confirmDialog: confirmDesktopDialog,
      focusMainWindow: focusDesktopMainWindow,
      ...(localAgentIdentity ? { localAgentIdentity } : {}),
      runtimeTrustedCaller: {
        mode: 'desktop-shell',
      },
      aiConfigStore: createDesktopAiConfigStore(standardDataRoot),
      runtimeConfigGet: createDesktopRuntimeConfigReader(standardDataRoot),
    },
  });

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

function configureDesktopElectronChromiumRuntime(): void {
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
    title: 'Nimi Desktop',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  secureDesktopWindow(window);
  await window.loadURL(rendererUrl || rendererDistUrl);
  return window;
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
  for (const origin of normalizeText(process.env.NIMI_DESKTOP_ELECTRON_ALLOWED_ORIGINS).split(',')) {
    const normalized = normalizeText(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return [...origins];
}

function allowedRendererUrls(): string[] {
  const urls = new Set<string>([rendererUrl || rendererDistUrl]);
  for (const url of normalizeText(process.env.NIMI_DESKTOP_ELECTRON_ALLOWED_RENDERER_URLS).split(',')) {
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
  const fromEnv = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT);
  return path.resolve(fromEnv || path.join(app.getPath('userData'), 'standard-shell-data'));
}

function resolveStandardLocalAssetRoots(dataRoot: string): string[] {
  const fromEnv = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS);
  if (!fromEnv) {
    return [dataRoot, app.getPath('downloads')].map((filePath) => path.resolve(filePath));
  }
  return fromEnv
    .split(path.delimiter)
    .map((filePath) => normalizeText(filePath))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
}

function resolveOptionalDesktopElectronLocalAgentIdentity(): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} | undefined {
  const localAgentRef = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_REF);
  if (!localAgentRef) {
    return undefined;
  }
  const ownerUserId = normalizeRequiredEnv(
    process.env.NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_OWNER_USER_ID,
    'NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_OWNER_USER_ID',
  );
  const runtimeSourceRef = normalizeRequiredEnv(
    process.env.NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF,
    'NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF',
  );
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error('NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_REF must start with local-agent:');
  }
  assertOpaqueElectronLocalAgentRef({
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    command: 'NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_REF',
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
    throw new Error(`${field} is required when NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_REF is set`);
  }
  return normalized;
}

function createDesktopAiConfigStore(dataRoot: string): NimiElectronAIConfigStore {
  return {
    get: async ({ scopeRef }) => {
      const filePath = desktopAiConfigPath(dataRoot, scopeRef);
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
        throw new Error(`desktop AI Config store record is invalid: ${filePath}`);
      }
      const record = parsed as Record<string, unknown>;
      if (record.scopeRef !== scopeRef || !record.config || typeof record.config !== 'object' || Array.isArray(record.config)) {
        throw new Error(`desktop AI Config store record does not match requested scope: ${filePath}`);
      }
      return record.config as Readonly<Record<string, unknown>>;
    },
    set: async ({ scopeRef, config }) => {
      const filePath = desktopAiConfigPath(dataRoot, scopeRef);
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

function createDesktopRuntimeConfigReader(dataRoot: string): () => Promise<{
  readonly path: string;
  readonly config: Readonly<Record<string, unknown>>;
}> {
  return async () => {
    const filePath = path.join(dataRoot, 'runtime', 'config.json');
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`desktop Runtime config payload is invalid: ${filePath}`);
    }
    return {
      path: filePath,
      config: parsed as Readonly<Record<string, unknown>>,
    };
  };
}

function desktopAiConfigPath(dataRoot: string, scopeRef: string): string {
  const encoded = Buffer.from(scopeRef, 'utf8').toString('base64url');
  return path.join(dataRoot, 'ai-config', `${encoded}.json`);
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT');
}

async function resolveDesktopLocalAssetUrl(filePath: string): Promise<string> {
  await registerReadableFile(filePath);
  return encodeReadableFileUrl(filePath);
}

async function openDesktopExternalUrl(url: string): Promise<void> {
  const capturePath = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE);
  if (capturePath) {
    const resolved = path.resolve(capturePath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await appendFile(resolved, `${url}\n`, 'utf8');
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
  window.focus();
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
        return new Response('file is not registered for desktop preview', { status: 403 });
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
    throw new Error(`unsupported desktop file protocol: ${url.protocol}`);
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
