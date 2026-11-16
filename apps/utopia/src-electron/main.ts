import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, protocol, session, webContents } from 'electron';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';

configureNimiElectronAppHostProfile(app);
const {
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} = await import('@nimiplatform/kit/shell/electron/main');

const developmentArg = '--nimi-dev-renderer-url=';
const developmentUrls = process.argv.filter(arg => arg.startsWith(developmentArg));
const developmentUrl = developmentUrls[0]?.slice(developmentArg.length);
if (developmentUrls.length > 1 || (developmentUrl && developmentUrl !== 'http://127.0.0.1:1455')) {
  throw new Error('NimiUtopia renderer origin must match its development manifest.');
}
const rendererUrl = developmentUrl || new URL('../dist/index.html', import.meta.url).href;
const allowedRendererUrls = [rendererUrl];
const appPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const chromeHost = createNimiElectronAppChromeHost({
  metadata: { name: 'NimiUtopia', version: appPackage.version },
  allowedRendererUrls,
  app,
  menu: Menu,
});
let window: BrowserWindow | undefined;
let quitting = false;
app.setName('NimiUtopia');
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => chromeHost.dispose());
registerNimiElectronAppAssetProtocolScheme(protocol);

function openWindow() {
  if (window || quitting) return;
  const next = new BrowserWindow({
    ...createNimiElectronAppChromeWindowOptions(),
    title: 'NimiUtopia', width: 1200, height: 780, minWidth: 440, minHeight: 520,
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window = next;
  chromeHost.bindWindow(next);
  next.on('closed', () => { if (window === next) window = undefined; });
  next.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  next.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) event.preventDefault();
  });
  void next.loadURL(rendererUrl).catch(error => { if (!next.isDestroyed()) console.error(error); });
}

void app.whenReady().then(() => {
  registerNimiElectronAppBridge({
    chromeHost,
    appId: 'nimi.utopia', allowedRendererUrls, ipcMain,
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    onSessionInvalidated: () => {
      if (!window || quitting) return;
      window.destroy();
      window = undefined;
      openWindow();
    },
  });
  openWindow();
  app.on('activate', openWindow);
});
