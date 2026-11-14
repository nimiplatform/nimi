import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, protocol, session, webContents } from 'electron';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';

configureNimiElectronAppHostProfile(app);
const { isAllowedElectronRendererUrl, registerNimiElectronAppAssetProtocolScheme, registerNimiElectronAppBridge }
  = await import('@nimiplatform/kit/shell/electron/main');

const developmentArg = '--nimi-dev-renderer-url=';
const developmentUrls = process.argv.filter(arg => arg.startsWith(developmentArg));
const developmentUrl = developmentUrls[0]?.slice(developmentArg.length);
if (developmentUrls.length > 1 || (developmentUrl && developmentUrl !== 'http://127.0.0.1:1455')) {
  throw new Error('NimiUtopia renderer origin must match its development manifest.');
}
const rendererUrl = developmentUrl || new URL('../dist/index.html', import.meta.url).href;
const allowedRendererUrls = [rendererUrl];
let window: BrowserWindow | undefined;
let quitting = false;
app.setName('NimiUtopia');
app.on('before-quit', () => { quitting = true; });
registerNimiElectronAppAssetProtocolScheme(protocol);

function openWindow() {
  if (window || quitting) return;
  const next = new BrowserWindow({
    title: 'NimiUtopia', width: 1060, height: 760, minWidth: 440, minHeight: 520,
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window = next;
  next.on('closed', () => { if (window === next) window = undefined; });
  next.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  next.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) event.preventDefault();
  });
  void next.loadURL(rendererUrl).catch(error => { if (!next.isDestroyed()) console.error(error); });
}

void app.whenReady().then(() => {
  registerNimiElectronAppBridge({
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
