import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  createNimiElectronFileAIConfigStore,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronRuntimeTrustedCallerMode,
} from '@nimiplatform/kit/shell/electron/main';
import { createZhiyuElectronTrustedRuntimeMetadataProvider } from './runtime-auth.js';

const APP_ID = 'nimi.zhiyu';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistUrl = pathToFileURL(rendererDistIndex).toString();
const rendererUrl = normalizeText(process.env.NIMI_ZHIYU_ELECTRON_RENDERER_URL);
const runtimeEndpoint = normalizeText(process.env.NIMI_RUNTIME_GRPC_ADDR)
  || normalizeText(process.env.NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT)
  || '127.0.0.1:46371';
let mainWindow: BrowserWindow | undefined;

app.setName('织羽 Zhiyu');
configureZhiyuElectronChromiumRuntime();

void app.whenReady().then(async () => {
  const standardDataRoot = resolveStandardDataRoot();
  registerNimiElectronRuntimeBridge({
    appId: APP_ID,
    runtimeEndpoint,
    allowedOrigins: allowedRendererOrigins(),
    allowedRendererUrls: allowedRendererUrls(),
    ipcMain,
    trustedRuntimeMetadataProvider: createZhiyuElectronTrustedRuntimeMetadataProvider({
      appId: APP_ID,
      runtimeEndpoint,
    }),
    standardShellHost: {
      dataRoot: standardDataRoot,
      localAssetRoots: [],
      runtimeTrustedCaller: {
        mode: resolveRuntimeTrustedCallerMode(),
      },
      aiConfigStore: createNimiElectronFileAIConfigStore({
        dataRoot: standardDataRoot,
        storeLabel: 'zhiyu AI Config',
      }),
    },
  });

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

function configureZhiyuElectronChromiumRuntime(): void {
  app.commandLine.appendSwitch('disable-background-networking');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    title: '织羽 Zhiyu',
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
  secureZhiyuWindow(window);
  await loadRendererRoute(window);
  return window;
}

async function loadRendererRoute(window: BrowserWindow): Promise<void> {
  await window.loadURL(rendererUrl || rendererDistUrl);
}

function secureZhiyuWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isZhiyuRendererUrl(url)) {
      event.preventDefault();
    }
  });
}

function allowedRendererOrigins(): string[] {
  const origins = new Set<string>();
  for (const url of allowedRendererUrls()) {
    origins.add(originForRendererUrl(url));
  }
  for (const origin of normalizeText(process.env.NIMI_ZHIYU_ELECTRON_ALLOWED_ORIGINS).split(',')) {
    const normalized = normalizeText(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return [...origins];
}

function allowedRendererUrls(): string[] {
  const urls = new Set<string>([rendererUrl || rendererDistUrl]);
  for (const url of normalizeText(process.env.NIMI_ZHIYU_ELECTRON_ALLOWED_RENDERER_URLS).split(',')) {
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

function isZhiyuRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

function resolveStandardDataRoot(): string {
  const fromEnv = normalizeText(process.env.NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT);
  return path.resolve(fromEnv || path.join(app.getPath('userData'), 'standard-shell-data'));
}

function resolveRuntimeTrustedCallerMode(): NimiElectronRuntimeTrustedCallerMode {
  const mode = normalizeText(process.env.NIMI_ZHIYU_ELECTRON_RUNTIME_TRUSTED_CALLER_MODE) || 'local-first-party-app';
  if (
    mode === 'local-developer-app'
    || mode === 'local-first-party-app'
    || mode === 'desktop-shell'
  ) {
    return mode;
  }
  throw new Error(`unsupported zhiyu Electron Runtime trusted caller mode: ${mode}`);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
