import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, realpath } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import {
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
} from '@nimiplatform/kit/shell/electron/main';
import { createTesterElectronCommandHandlers } from './commands/tester-commands.js';

const APP_ID = 'com.nimiplatform.tester';
const FILE_PROTOCOL = 'nimi-shell-file';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.js');
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
    supportFetchAPI: true,
    stream: true,
  },
}]);

app.setName('Nimi Tester');

void app.whenReady().then(async () => {
  registerReadableFileProtocol();
  registerNimiElectronRuntimeBridge({
    appId: APP_ID,
    runtimeEndpoint,
    allowedOrigins: allowedRendererOrigins(),
    allowedRendererUrls: allowedRendererUrls(),
    ipcMain,
    commandHandlers: createTesterElectronCommandHandlers({
      downloadsDir: app.getPath('downloads'),
      revealInOs: (filePath) => shell.showItemInFolder(filePath),
      registerReadableFile,
      openWorldTourWindow,
    }),
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
      sandbox: false,
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
      sandbox: false,
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

function isTesterRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

async function registerReadableFile(filePath: string): Promise<void> {
  const canonical = await realpath(filePath).catch(() => path.resolve(filePath));
  readableFiles.add(canonical);
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
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error || 'file read failed'), { status: 404 });
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
