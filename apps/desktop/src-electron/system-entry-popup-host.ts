import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, Rectangle, Screen } from 'electron';
import {
  SYSTEM_ENTRY_CHANNELS,
  parseSystemEntryActionRequest,
  type SystemEntryActionRequest,
  type SystemEntrySnapshot,
} from '../src/shell/shared/system-entry-types.js';

export type SystemEntryDismissReason = 'escape' | 'outside' | 'destination' | 'menu' | 'invalidate';

export type SystemEntryPopupHost = {
  show(): Promise<void>;
  hide(reason: SystemEntryDismissReason): void;
  isVisible(): boolean;
  isOpening(): boolean;
  publish(snapshot: SystemEntrySnapshot): void;
  webContents(): BrowserWindow['webContents'] | undefined;
  dispose(): void;
};

export type CreateSystemEntryPopupHostInput = {
  electron: {
    BrowserWindow: typeof BrowserWindow;
    ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
    screen: Pick<Screen, 'getDisplayMatching' | 'getDisplayNearestPoint' | 'getCursorScreenPoint' | 'on' | 'removeListener'>;
  };
  url: string;
  preloadPath: string;
  configurePopup(window: BrowserWindow): void;
  anchor(): Rectangle | undefined;
  getSnapshot(): Promise<SystemEntrySnapshot>;
  act(request: SystemEntryActionRequest): Promise<void>;
  openMenu(): void;
  restoreEntryFocus(): void;
  reportError(operation: string, error: unknown): void;
  platform?: NodeJS.Platform;
};

// @nimi-authority: rule.nimi.desktop.bridge-ipc.system-entry-isolation
export function createSystemEntryPopupHost(input: CreateSystemEntryPopupHostInput): SystemEntryPopupHost {
  const platform = input.platform ?? process.platform;
  const trustedUrl = new URL(input.url).href;
  if (!input.preloadPath.trim() || !['http:', 'https:', 'nimi-app:'].includes(new URL(trustedUrl).protocol)) {
    throw new Error('system-entry-popup-document-invalid');
  }
  let window: BrowserWindow | undefined;
  let loading: Promise<BrowserWindow> | undefined;
  let showIntent = 0;
  let opening = false;
  let disposed = false;

  const authorized = (event: IpcMainInvokeEvent): boolean => Boolean(
    !disposed && window && !window.isDestroyed() && !window.webContents.isDestroyed()
    && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame?.url === trustedUrl && window.webContents.getURL() === trustedUrl,
  );
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (!authorized(event)) throw new Error('system-entry-sender-rejected');
  };
  const noArguments = (args: unknown[]): void => {
    if (args.length !== 0) throw new Error('system-entry-payload-invalid');
  };

  const hide = (reason: SystemEntryDismissReason): void => {
    showIntent += 1;
    opening = false;
    if (window && !window.isDestroyed()) window.hide();
    if (reason === 'escape') input.restoreEntryFocus();
  };
  const publish = (snapshot: SystemEntrySnapshot): void => {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(SYSTEM_ENTRY_CHANNELS.changed, snapshot);
  };

  const handlers: Array<[string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>]> = [
    [SYSTEM_ENTRY_CHANNELS.snapshot, async (event, ...args) => {
      assertSender(event);
      noArguments(args);
      const snapshot = await input.getSnapshot();
      assertSender(event);
      return snapshot;
    }],
    [SYSTEM_ENTRY_CHANNELS.action, async (event, ...args) => {
      assertSender(event);
      if (args.length !== 1) throw new Error('system-entry-payload-invalid');
      const request = parseSystemEntryActionRequest(args[0]);
      await input.act(request);
    }],
    [SYSTEM_ENTRY_CHANNELS.close, async (event, ...args) => {
      assertSender(event);
      noArguments(args);
      hide('escape');
    }],
    [SYSTEM_ENTRY_CHANNELS.menu, async (event, ...args) => {
      assertSender(event);
      noArguments(args);
      input.openMenu();
    }],
  ];
  const installedChannels: string[] = [];
  try {
    for (const [channel, handler] of handlers) {
      input.electron.ipcMain.handle(channel, handler);
      installedChannels.push(channel);
    }
  } catch (error) {
    for (const channel of installedChannels) input.electron.ipcMain.removeHandler(channel);
    throw error;
  }

  const bounds = (): Rectangle => {
    const anchor = input.anchor();
    const valid = anchor && finiteRect(anchor) && anchor.width > 0 && anchor.height > 0;
    const cursor = input.electron.screen.getCursorScreenPoint();
    const display = valid
      ? input.electron.screen.getDisplayMatching(anchor)
      : input.electron.screen.getDisplayNearestPoint(cursor);
    return positionSystemEntryPopup(
      valid ? anchor : { x: cursor.x, y: cursor.y, width: 0, height: 0 },
      display.workArea,
      platform,
    );
  };

  const ensureWindow = (): Promise<BrowserWindow> => {
    if (disposed) return Promise.reject(new Error('system-entry-popup-disposed'));
    if (loading) return loading;
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) return Promise.resolve(window);
    let created: BrowserWindow;
    try {
      created = new input.electron.BrowserWindow({
        ...bounds(), title: 'Nimi', show: false, frame: false,
        resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        skipTaskbar: true, autoHideMenuBar: true, backgroundColor: '#f8fafc',
        ...(platform === 'darwin' ? { type: 'panel' as const } : {}),
        webPreferences: {
          preload: input.preloadPath, contextIsolation: true, sandbox: true,
          nodeIntegration: false, nodeIntegrationInSubFrames: false,
          webviewTag: false, backgroundThrottling: true,
        },
      });
      window = created;
      // Called before any document is loaded so the main permission policy
      // can deny browser privileges for this exact webContents.
      input.configurePopup(created);
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      created.webContents.on('will-navigate', (event, url) => {
        if (url !== trustedUrl) event.preventDefault();
      });
      created.webContents.on('will-redirect', (event) => { event.preventDefault(); });
      created.webContents.on('will-attach-webview', (event) => { event.preventDefault(); });
      created.webContents.on('before-input-event', (event, key) => {
        if (key.type === 'keyDown' && key.key === 'Escape') {
          event.preventDefault();
          hide('escape');
        }
      });
      created.webContents.on('render-process-gone', () => {
        hide('invalidate');
        if (!created.isDestroyed()) created.destroy();
      });
      created.on('blur', () => {
        if (created.isVisible()) hide('outside');
      });
      created.on('close', (event) => {
        if (!disposed) { event.preventDefault(); hide('escape'); }
      });
      created.on('closed', () => { if (window === created) window = undefined; });
    } catch (error) {
      if (window && !window.isDestroyed()) window.destroy();
      window = undefined;
      return Promise.reject(error);
    }
    const load = created.loadURL(trustedUrl).then(() => {
      if (disposed || created.isDestroyed() || created.webContents.isDestroyed()) {
        throw new Error('system-entry-popup-unavailable');
      }
      return created;
    }).catch((error: unknown) => {
      if (!created.isDestroyed()) created.destroy();
      if (window === created) window = undefined;
      throw error;
    });
    const tracked = load.finally(() => { if (loading === tracked) loading = undefined; });
    loading = tracked;
    return tracked;
  };

  const reposition = (): void => {
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    try { window.setBounds(bounds()); }
    catch (error) { hide('outside'); input.reportError('system-entry-popup-position', error); }
  };
  input.electron.screen.on('display-added', reposition);
  input.electron.screen.on('display-removed', reposition);
  input.electron.screen.on('display-metrics-changed', reposition);

  return Object.freeze({
    async show(): Promise<void> {
      const request = ++showIntent;
      opening = true;
      try {
        const current = await ensureWindow();
        if (disposed || request !== showIntent || current.isDestroyed()) return;
        current.setBounds(bounds());
        current.show();
        current.focus();
        opening = false;
        try { publish(await input.getSnapshot()); }
        catch (error) { input.reportError('system-entry-popup-snapshot', error); }
      } finally {
        if (request === showIntent) opening = false;
      }
    },
    hide,
    isVisible: () => Boolean(window && !window.isDestroyed() && window.isVisible()),
    isOpening: () => opening,
    publish,
    webContents: () => window && !window.isDestroyed() ? window.webContents : undefined,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      showIntent += 1;
      opening = false;
      for (const channel of installedChannels) input.electron.ipcMain.removeHandler(channel);
      input.electron.screen.removeListener('display-added', reposition);
      input.electron.screen.removeListener('display-removed', reposition);
      input.electron.screen.removeListener('display-metrics-changed', reposition);
      if (window && !window.isDestroyed()) window.destroy();
      window = undefined;
    },
  });
}

export function positionSystemEntryPopup(anchor: Rectangle, workArea: Rectangle, platform: NodeJS.Platform): Rectangle {
  if (!finiteRect(anchor) || !finiteRect(workArea) || workArea.width <= 0 || workArea.height <= 0) {
    throw new Error('system-entry-display-unavailable');
  }
  const margin = Math.min(8, workArea.width / 4, workArea.height / 4);
  const width = Math.min(380, Math.max(1, workArea.width - margin * 2));
  const height = Math.min(600, Math.max(1, workArea.height - margin * 2));
  const below = anchor.y + anchor.height + margin;
  const above = anchor.y - height - margin;
  const preferred = platform === 'darwin' || below + height <= workArea.y + workArea.height - margin
    ? below : above;
  return {
    x: Math.round(Math.max(workArea.x + margin, Math.min(anchor.x + anchor.width / 2 - width / 2, workArea.x + workArea.width - width - margin))),
    y: Math.round(Math.max(workArea.y + margin, Math.min(preferred, workArea.y + workArea.height - height - margin))),
    width: Math.floor(width), height: Math.floor(height),
  };
}

function finiteRect(value: Rectangle): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite);
}
