import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, protocol, session, webContents } from 'electron';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';

// Bind user data, session data and temp to the Desktop-prepared Host profile
// before any session or window exists and before the rest of Kit loads;
// never fall back to default paths.
try {
  configureNimiElectronAppHostProfile(app);
} catch (error) {
  process.stderr.write(`[nimi-app-host-profile] ${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(78);
  throw error;
}

const {
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} = await import('@nimiplatform/kit/shell/electron/main');

const APP_ID = 'nimi.lab';
let worldTourWindow: BrowserWindow | null = null;
let worldTourLaunch: { manifestPath: string; token: string; senderId: number } | null = null;

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const appIconPath = path.join(appRoot, 'assets', process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png');
const preloadPath = path.join(currentDir, 'preload.cjs');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistUrl = pathToFileURL(rendererDistIndex).toString();
const rendererUrl = readDevelopmentRendererUrl()
  || normalizeText(process.env.NIMI_LAB_ELECTRON_RENDERER_URL);
const appPackage = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { version: string };
const chromeHost = createNimiElectronAppChromeHost({
  metadata: { name: 'Nimi Lab', version: appPackage.version }, allowedRendererUrls: allowedRendererUrls(), app, menu: Menu,
  appCommands: [{ id: 'lab.open-settings', menu: 'file', labels: { en: 'Settings', zh: '设置' } }],
});
let resettingRenderer = false;
let quitting = false;

app.setName('Nimi Lab');
if (process.platform === 'win32') {
  // Separate each App and its development carrier in the Windows taskbar.
  app.setAppUserModelId(`ai.nimi.apps.${APP_ID}${app.isPackaged ? '' : '.dev'}`);
}
configureLabElectronChromiumRuntime();
registerNimiElectronAppAssetProtocolScheme(protocol);

void app.whenReady().then(async () => {
  app.dock?.setIcon(appIconPath);
  registerNimiElectronAppBridge({
    chromeHost,
    appId: APP_ID,
    allowedRendererUrls: allowedRendererUrls(),
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    ipcMain,
    onSessionInvalidated: resetAccountScopedRenderer,
    appCommandHandlers: {
      open_world_tour_window: async ({ payload }) => {
        const value = worldTourPayload(payload, ['manifestPath']);
        const manifestPath = worldTourManifestPath(value.manifestPath);
        worldTourWindow?.close();
        const viewer = createLabWindow('World Tour', 1280, 860, 900, 600);
        const token = randomUUID();
        worldTourWindow = viewer;
        worldTourLaunch = { manifestPath, token, senderId: viewer.webContents.id };
        viewer.on('closed', () => {
          if (worldTourWindow === viewer) { worldTourWindow = null; worldTourLaunch = null; }
        });
        try {
          const query = new URLSearchParams({ manifestPath, launchToken: token });
          await loadRendererRoute(viewer, `/world-tour-viewer?${query}`);
          return { windowLabel: `world-tour-${viewer.id}`, manifestPath };
        } catch (error) {
          viewer.close();
          throw error;
        }
      },
      claim_world_tour_viewer_launch: ({ payload, event }) => {
        const value = worldTourPayload(payload, ['manifestPath', 'launchToken']);
        if (!worldTourLaunch || worldTourLaunch.senderId !== event.sender?.id
          || worldTourLaunch.manifestPath !== value.manifestPath || worldTourLaunch.token !== value.launchToken) {
          throw new Error('world-tour-viewer-launch-rejected');
        }
        return {};
      },
    },
  });

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

function configureLabElectronChromiumRuntime(): void {
  app.commandLine.appendSwitch('disable-background-networking');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !resettingRenderer) {
    app.quit();
  }
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => chromeHost.dispose());

function resetAccountScopedRenderer(): void {
  const windows = BrowserWindow.getAllWindows();
  if (quitting || !windows.length) return;
  resettingRenderer = true;
  try {
    for (const window of windows) window.destroy();
    worldTourWindow = null; worldTourLaunch = null;
    void createMainWindow().catch(error => process.stderr.write(`[lab-session-reset] ${String(error)}\n`));
  } finally { resettingRenderer = false; }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = createLabWindow('Nimi Lab', 1440, 940, 360, 640);
  await loadRendererRoute(window, '/');
  return window;
}

function createLabWindow(title: string, width: number, height: number, minWidth: number, minHeight: number): BrowserWindow {
  const window = new BrowserWindow({
    ...createNimiElectronAppChromeWindowOptions(),
    width, height, minWidth, minHeight, title,
    icon: appIconPath,
    backgroundColor: '#f6f8fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chromeHost.bindWindow(window);
  secureLabWindow(window);
  return window;
}

function worldTourPayload(input: Readonly<Record<string, unknown>>, keys: string[]): Record<string, unknown> {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error('world-tour-input-invalid');
  return value as Record<string, unknown>;
}

function worldTourManifestPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('world-tour/') || !value.endsWith('.json')
    || value.length > 1024 || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('world-tour-manifest-path-invalid');
  }
  return value;
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

function secureLabWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isLabRendererUrl(url)) {
      event.preventDefault();
    }
  });
}

function allowedRendererUrls(): string[] {
  const urls = new Set<string>([rendererUrl || rendererDistUrl]);
  for (const url of normalizeText(process.env.NIMI_LAB_ELECTRON_ALLOWED_RENDERER_URLS).split(',')) {
    const normalized = normalizeText(url);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

function isLabRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
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

function readDevelopmentRendererUrl(): string {
  const prefix = '--nimi-dev-renderer-url=';
  const values = process.argv.filter((value) => value.startsWith(prefix));
  if (values.length === 0) {
    return '';
  }
  if (values.length !== 1) {
    throw new Error('Nimi development renderer URL must be singular.');
  }
  const parsed = new URL(values[0].slice(prefix.length));
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase())
    || !parsed.port
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Nimi development renderer URL must be exact loopback.');
  }
  return parsed.origin;
}
