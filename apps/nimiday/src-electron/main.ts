import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, protocol, screen, session, Tray, webContents } from 'electron';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';
import { registerWindowsNotificationIdentity } from './windows-notification-identity.js';

declare const __NIMI_ELECTRON_PRODUCTION__: boolean;

// Bind user data, session data and temp to the Host profile Nimi Desktop
// prepared under the selected data root, before any session or window and
// before the rest of Kit loads: a module that failed to load first would
// leave Electron on its default paths in the OS user's profile.
try {
  configureNimiElectronAppHostProfile(app);
} catch (error) {
  process.stderr.write(`[nimi-app-host-profile] ${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(78);
  throw error;
}

const IS_PRODUCTION_BUNDLE = typeof __NIMI_ELECTRON_PRODUCTION__ !== 'undefined'
  && __NIMI_ELECTRON_PRODUCTION__;
if (IS_PRODUCTION_BUNDLE) rejectProductionDebugging();

const {
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} = await import('@nimiplatform/kit/shell/electron/main');

const APP_ID = 'nimi.day';
const NATIVE_BUNDLE_IDENTIFIER = "ai.nimi.apps.nimi.day";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const appIconPath = path.join(appRoot, 'assets', 'native', process.platform === 'win32' ? 'windows.ico' : process.platform === 'darwin' ? 'macos.png' : 'app.png');
const preloadPath = path.join(currentDir, 'preload.cjs');
const productionRendererUrl = pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString();
const developmentRendererUrl = readDevelopmentRendererUrl();
const rendererUrl = developmentRendererUrl || productionRendererUrl;
const allowedRendererUrls = [rendererUrl];
let resettingRenderer = false;
let quitting = false;
let tray: Tray | undefined;
let followups: ReturnType<typeof import('./followup-host.js')['createDayFollowUpHost']> | undefined;
let dayStorage: ReturnType<typeof import('./day-storage-host.js')['createDayStorageHost']> | undefined;

app.setName("NimiDay");
const appUserModelId = app.isPackaged ? NATIVE_BUNDLE_IDENTIFIER : `${NATIVE_BUNDLE_IDENTIFIER}.dev`;
app.setAppUserModelId(appUserModelId);
// Complete Windows sender registration before any renderer can notify.
try {
  await registerWindowsNotificationIdentity({
    appUserModelId,
    displayName: app.getName(),
    iconPath: appIconPath,
  });
} catch (error) {
  process.stderr.write(`[nimiday-notification-identity] ${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(1);
  throw error;
}
Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'NimiDay', submenu: [{ label: '打开 NimiDay', click: openMainWindow }, { label: '退出并停止 NimiDay', role: 'quit' }] },
  ...(process.platform === 'darwin' ? [
    { role: 'fileMenu' as const },
    { role: 'editMenu' as const },
    { role: 'windowMenu' as const },
  ] : []),
]));
registerNimiElectronAppAssetProtocolScheme(protocol);

void app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(appIconPath);
  const { createDayFollowUpHost } = await import('./followup-host.js');
  const { createDayStorageHost } = await import('./day-storage-host.js');
  dayStorage = createDayStorageHost();
  followups = createDayFollowUpHost(openMainWindow, dayStorage.readCollection);
  // @nimi-authority: rule.nimi.nimiday.assistant.background-follow-up
  // Windows has no Dock/application menu once the last window closes.
  // Keep a user-owned way to reopen the live Host without stopping its work.
  if (process.platform === 'win32') {
    tray = new Tray(nativeImage.createFromPath(appIconPath).resize({ width: 16, height: 16 }));
    tray.setToolTip('NimiDay');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 NimiDay', click: openMainWindow },
      { type: 'separator' },
      { label: '退出并停止 NimiDay', click: () => app.quit() },
    ]));
    tray.on('click', openMainWindow);
  }
  registerNimiElectronAppBridge({
    appId: APP_ID,
    allowedRendererUrls,
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    ipcMain,
    appCommandHandlers: { ...followups.handlers, ...dayStorage.handlers },
    onSessionReady: services => { dayStorage?.bind(services); followups?.bind(services); },
    onSessionInvalidated: () => { dayStorage?.invalidate(); followups?.invalidate(); resetAccountScopedRenderer(); },
  });
  await createMainWindow();
  app.on('activate', openMainWindow);
});

// Accepted arrangements keep following real replies in this protected Host.
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; tray?.destroy(); tray = undefined; dayStorage?.invalidate(); followups?.invalidate(); });

function openMainWindow(): void {
  if (quitting) return;
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } else {
    void createMainWindow().catch((error: unknown) => {
      process.stderr.write(`[nimiday-open-window] ${error instanceof Error ? error.message : String(error)}\n`);
    });
  }
}

// A revoked/account-changed scope must not leave renderer timers or queued
// promises alive to use the rebound Host. This does not run on normal renewal.
function resetAccountScopedRenderer(): void {
  const windows = BrowserWindow.getAllWindows();
  if (quitting || windows.length === 0) return;
  resettingRenderer = true;
  try {
    for (const window of windows) window.destroy();
    void createMainWindow().catch((error: unknown) => {
      process.stderr.write(`[nimi-app-session-reset] ${error instanceof Error ? error.message : String(error)}\n`);
    });
  } finally { resettingRenderer = false; }
}

async function createMainWindow(): Promise<void> {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.min(1420, width),
    height: Math.min(1030, height),
    minWidth: Math.min(360, width),
    minHeight: Math.min(560, height),
    center: true,
    title: "NimiDay",
    icon: appIconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) event.preventDefault();
  });
  try {
    await window.loadURL(rendererUrl);
  } catch (error) {
    if (!window.isDestroyed()) throw error;
  }
}

function rejectProductionDebugging(): void {
  const switches = new Set(['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'inspect-wait', 'inspect-port', 'inspect-publish-uid']);
  for (const argument of [...process.argv, ...process.execArgv]) {
    const name = /^--(inspect[^=]*)(?:=|$)/u.exec(argument)?.[1];
    if (name) switches.add(name);
  }
  const active = [...switches].find(name => app.commandLine.hasSwitch(name));
  if (active) {
    const error = new Error(`The production Electron bundle rejects --${active}.`);
    process.stderr.write(`[nimi-app-production] ${error.message}\n`);
    app.exit(78);
    throw error;
  }
}

function readDevelopmentRendererUrl(): string {
  const flag = '--nimi-dev-renderer-url';
  const prefix = '--nimi-dev-renderer-url=';
  const hasDevelopmentRendererArgument = process.argv.some((value) => value === flag || value.startsWith(prefix));
  if (IS_PRODUCTION_BUNDLE && hasDevelopmentRendererArgument) {
    throw new Error('The production Electron bundle rejects --nimi-dev-renderer-url.');
  }
  if (process.argv.includes(flag)) throw new Error('Nimi development renderer URL is missing.');
  const values = process.argv.filter((value) => value.startsWith(prefix));
  if (values.length === 0) return '';
  if (values.length !== 1) throw new Error('Nimi development renderer URL must be singular.');
  const selected = values[0];
  if (!selected) throw new Error('Nimi development renderer URL is missing.');
  const raw = selected.slice(prefix.length);
  const parsed = new URL(raw);
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
