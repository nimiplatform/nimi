import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { MenuItemConstructorOptions, Rectangle } from 'electron';
import { createDesktopSystemEntryHost, type CreateDesktopSystemEntryHostInput } from '../src-electron/system-entry-host.js';
import { positionSystemEntryPopup } from '../src-electron/system-entry-popup-host.js';
import {
  SYSTEM_ENTRY_CHANNELS, SYSTEM_ENTRY_LIVENESS_MS,
  type SystemEntryAdmission, type SystemEntryProjection,
} from '../src/shell/shared/system-entry-types.js';

class TestMenu extends EventEmitter {
  constructor(readonly template: MenuItemConstructorOptions[]) { super(); }
  closePopup(): void { this.emit('menu-will-close'); }
}
class TestTray extends EventEmitter {
  destroyed = false;
  tooltip = '';
  contextMenuCalls = 0;
  currentMenu: TestMenu | undefined;
  bounds = { x: 1300, y: 850, width: 24, height: 24 };
  focused = 0;
  constructor(_icon: unknown) { super(); }
  setContextMenu(): void { this.contextMenuCalls += 1; }
  setToolTip(value: string): void { this.tooltip = value; }
  setIgnoreDoubleClickEvents(): void {}
  popUpContextMenu(menu: TestMenu): void { this.currentMenu = menu; }
  closeContextMenu(): void { this.currentMenu?.closePopup(); this.currentMenu = undefined; }
  getBounds(): Rectangle { return this.bounds; }
  isDestroyed(): boolean { return this.destroyed; }
  destroy(): void { this.destroyed = true; }
  focus(): void { this.focused += 1; }
}
class TestWebContents extends EventEmitter {
  mainFrame = { url: '' };
  url = '';
  destroyed = false;
  messages: Array<{ channel: string; value: unknown }> = [];
  openHandler: (() => { action: string }) | undefined;
  isDestroyed(): boolean { return this.destroyed; }
  getURL(): string { return this.url; }
  send(channel: string, value: unknown): void { this.messages.push({ channel, value }); }
  setWindowOpenHandler(handler: () => { action: string }): void { this.openHandler = handler; }
}
class TestWindow extends EventEmitter {
  webContents = new TestWebContents();
  destroyed = false;
  visible = false;
  configured = false;
  bounds: Rectangle | undefined;
  constructor(readonly options: Record<string, unknown>) { super(); }
  async loadURL(url: string): Promise<void> {
    assert.equal(this.configured, true, 'browser permissions must be configured before document load');
    this.webContents.url = url;
    this.webContents.mainFrame.url = url;
  }
  isDestroyed(): boolean { return this.destroyed; }
  isVisible(): boolean { return this.visible; }
  show(): void { this.visible = true; }
  hide(): void { this.visible = false; }
  focus(): void {}
  setBounds(bounds: Rectangle): void { this.bounds = bounds; }
  destroy(): void { this.destroyed = true; this.webContents.destroyed = true; this.emit('closed'); }
}

function projection(generation = 'account-a', revision = 1): SystemEntryProjection {
  const empty = { status: 'available' as const, observedAt: '2026-10-23T03:00:00.000Z', total: 0, items: [] };
  return {
    generation, revision, locale: 'en', colorScheme: 'light', observedAt: '2026-10-23T03:00:00.000Z', service: 'running',
    attention: empty, work: empty, recent: empty,
    apps: { ...empty, total: 1, items: [{ id: 'app-registration-1', title: 'Notes & Tasks', detail: 'Open', action: { kind: 'focus-app', entryKey: 'owned-entry-1', source: { kind: 'local-development', selector: 'dev-project-one' } } }] },
    downloads: empty,
    usage: { status: 'available', observedAt: empty.observedAt, periodLabel: 'Today', attempts: '0', localAttempts: '0', cloudAttempts: '0', costs: [], partial: false, note: '' },
    notificationsEnabled: true, notificationsPausedUntil: 0,
  };
}

function fixture(platform: NodeJS.Platform = 'win32') {
  let tray!: TestTray;
  let window: TestWindow | undefined;
  let admission: SystemEntryAdmission = { generation: 'account-a', state: 'ready' };
  let readAdmission: () => SystemEntryAdmission | Promise<SystemEntryAdmission> = () => admission;
  let clock = 100;
  let homeOpened = 0;
  let hidden = 0;
  let quit = 0;
  const executed: unknown[] = [];
  const errors: string[] = [];
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const screen = Object.assign(new EventEmitter(), {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 850 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 850 } }),
    getCursorScreenPoint: () => ({ x: 1000, y: 700 }),
  });
  const input: CreateDesktopSystemEntryHostInput = {
    electron: {
      Tray: class extends TestTray { constructor(icon: unknown) { super(icon); tray = this; } },
      Menu: { buildFromTemplate: (template: MenuItemConstructorOptions[]) => new TestMenu(template) },
      BrowserWindow: class extends TestWindow { constructor(options: Record<string, unknown>) { super(options); window = this; } },
      ipcMain: {
        handle(channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) {
          if (handlers.has(channel)) throw new Error('handler-already-installed');
          handlers.set(channel, handler);
        },
        removeHandler(channel: string) { handlers.delete(channel); },
      },
      screen,
    } as unknown as CreateDesktopSystemEntryHostInput['electron'],
    icon: 'test-icon.ico', popup: { url: 'http://127.0.0.1:1420/system-entry.html', preloadPath: 'D:/test/system-entry-preload.cjs' },
    configurePopup: (popup) => { (popup as unknown as TestWindow).configured = true; },
    getAdmission: () => readAdmission(),
    executeAction: async (action, context) => { executed.push({ action, context }); },
    ensureHomeWindow: () => { homeOpened += 1; }, hideHomeWindow: () => { hidden += 1; },
    requestQuit: () => { quit += 1; }, reportError: (operation) => { errors.push(operation); },
    platform, now: () => clock,
  };
  const host = createDesktopSystemEntryHost(input);
  return {
    host, handlers, executed, errors, screen,
    tray: () => tray, window: () => window!,
    setAdmission: (value: SystemEntryAdmission) => { admission = value; },
    setAdmissionReader: (value: typeof readAdmission) => { readAdmission = value; },
    advance: (milliseconds: number) => { clock += milliseconds; },
    counts: () => ({ homeOpened, hidden, quit }),
    sender: () => ({ sender: window!.webContents, senderFrame: window!.webContents.mainFrame }),
  };
}

test('both supported platforms create one recoverable Tray without binding a context menu', async () => {
  for (const platform of ['darwin', 'win32'] as const) {
    const value = fixture(platform);
    try {
      assert.equal(value.host.hideHomeWindowOnClose(), false);
      await value.host.initialize();
      assert.equal(value.host.enabled, true);
      assert.equal(value.tray().contextMenuCalls, 0);
      assert.equal(value.host.hideHomeWindowOnClose(), true);
      value.host.setQuitPending(true);
      assert.equal(value.host.hideHomeWindowOnClose(), false);
      value.host.setQuitPending(false);
      value.tray().bounds = { x: 0, y: 0, width: 0, height: 0 };
      assert.equal(value.host.hideHomeWindowOnClose(), false);
      assert.equal(value.counts().hidden, 1);
    } finally { value.host.dispose(); }
  }
});

test('heartbeat cannot resurrect expired facts and does not rewrite source observation time', async () => {
  const value = fixture();
  try {
    await value.host.initialize();
    await value.host.publish(projection());
    assert.equal(value.tray().tooltip, 'Nimi · Local AI service running');
    value.advance(5_000);
    await value.host.heartbeat({ generation: 'account-a' });
    assert.equal((await value.host.snapshot()).projection?.observedAt, projection().observedAt);
    value.advance(SYSTEM_ENTRY_LIVENESS_MS + 1);
    assert.equal((await value.host.snapshot()).observation, 'unavailable');
    assert.equal(value.tray().tooltip, 'Nimi · Activity awaiting update');
    await value.host.heartbeat({ generation: 'account-a' });
    assert.equal((await value.host.snapshot()).projection, null);
    await assert.rejects(value.host.publish(projection()), /system-entry-view-stale/);
    await value.host.publish(projection('account-a', 2));
    assert.equal((await value.host.snapshot()).observation, 'current');
  } finally { value.host.dispose(); }
});

test('old native-menu actions and invented object identities fail current-scope checks', async () => {
  const value = fixture();
  try {
    await value.host.initialize();
    await value.host.publish(projection());
    value.host.openMenu();
    const oldMenu = value.tray().currentMenu!;
    assert.match(JSON.stringify(oldMenu.template), /Notes && Tasks/);
    value.setAdmission({ generation: 'account-b', state: 'ready' });
    const appsSubmenu = oldMenu.template.find((item) => item.id === 'system-entry-apps')!.submenu as MenuItemConstructorOptions[];
    (appsSubmenu[0]!.click as () => void)();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(value.errors.includes('system-entry-action'), true);
    assert.equal(value.executed.length, 0);
    await value.host.publish(projection('account-b', 1));
    await assert.rejects(value.host.act({ generation: 'account-b', revision: 1, action: { kind: 'focus-app', entryKey: 'invented-entry', source: { kind: 'local-development', selector: 'dev-project-one' } } }), /system-entry-action-unavailable/);
    assert.deepEqual(value.executed, []);
    await value.host.act({ generation: 'account-b', revision: 1, action: { kind: 'focus-app', entryKey: 'owned-entry-1', source: { kind: 'local-development', selector: 'dev-project-one' } } });
    assert.equal(value.executed.length, 1);
  } finally { value.host.dispose(); }
});

test('invalidation fences a pending old-account publication', async () => {
  const value = fixture();
  try {
    await value.host.initialize();
    let resolve!: (admission: SystemEntryAdmission) => void;
    value.setAdmissionReader(() => new Promise<SystemEntryAdmission>((accept) => { resolve = accept; }));
    const publishing = value.host.publish(projection());
    await Promise.resolve();
    value.host.invalidate('account-changed');
    resolve({ generation: 'account-a', state: 'ready' });
    await assert.rejects(publishing, /system-entry-view-stale/);
    value.setAdmissionReader(() => ({ generation: 'account-b', state: 'ready' }));
    assert.equal((await value.host.snapshot()).projection, null);
  } finally { value.host.dispose(); }
});

test('native Home and Quit remain available when formal reads fail', async () => {
  const value = fixture();
  try {
    value.setAdmissionReader(() => { throw new Error('runtime-offline'); });
    await value.host.initialize();
    value.host.openMenu();
    assert.equal(value.tray().currentMenu?.template.find(item => item.id === 'system-entry-home')?.enabled, undefined);
    await value.host.act({ generation: 'old', revision: 99, action: { kind: 'home' } });
    await value.host.act({ generation: 'old', revision: 99, action: { kind: 'quit' } });
    assert.deepEqual(value.counts(), { homeOpened: 1, hidden: 0, quit: 1 });
    assert.equal((await value.host.snapshot()).admission.state, 'unknown');
  } finally { value.host.dispose(); }
});

test('popup is lazy, isolated and denies foreign frames, paths and arbitrary operations', async () => {
  const value = fixture();
  try {
    await value.host.initialize();
    assert.equal(value.window(), undefined);
    await value.host.publish(projection());
    await value.host.openOverview();
    const popup = value.window();
    const preferences = popup.options.webPreferences as Record<string, unknown>;
    assert.equal(preferences.preload, 'D:/test/system-entry-preload.cjs');
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.webviewTag, false);
    assert.equal(preferences.backgroundThrottling, true);
    assert.deepEqual(popup.webContents.openHandler?.(), { action: 'deny' });
    const read = value.handlers.get(SYSTEM_ENTRY_CHANNELS.snapshot)!;
    await assert.rejects(read({ sender: new TestWebContents(), senderFrame: popup.webContents.mainFrame }), /system-entry-sender-rejected/);
    await assert.rejects(read({ sender: popup.webContents, senderFrame: { url: popup.webContents.url } }), /system-entry-sender-rejected/);
    popup.webContents.mainFrame.url = 'http://127.0.0.1:1420/index.html';
    await assert.rejects(read(value.sender()), /system-entry-sender-rejected/);
    popup.webContents.mainFrame.url = popup.webContents.url;
    await assert.rejects(read(value.sender(), {}), /system-entry-payload-invalid/);
    await assert.rejects(value.handlers.get(SYSTEM_ENTRY_CHANNELS.action)!(value.sender(), { generation: 'account-a', revision: 1, action: { kind: 'data-root-delete' } }), /system-entry-payload-invalid/);
    assert.equal(value.executed.length, 0);
    let prevented = false;
    popup.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.invalid/');
    assert.equal(prevented, true);
  } finally {
    value.host.dispose();
    assert.equal(value.handlers.size, 0);
    assert.equal(value.screen.listenerCount('display-removed'), 0);
  }
});

test('Escape returns Windows tray focus while outside-click and menu handoff do not steal it', async () => {
  const value = fixture();
  try {
    await value.host.initialize();
    await value.host.publish(projection());
    await value.host.openOverview();
    value.window().webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'Escape' });
    assert.equal(value.window().visible, false);
    assert.equal(value.tray().focused, 1);
    await value.host.openOverview();
    value.window().emit('blur');
    assert.equal(value.window().visible, false);
    assert.equal(value.tray().focused, 1);
    await value.host.openOverview();
    value.host.openMenu();
    assert.equal(value.window().visible, false);
    assert.equal(value.tray().focused, 1);
    assert.ok(value.tray().currentMenu);
  } finally { value.host.dispose(); }
});

test('locale replacement rebuilds native commands and removes an already-open old menu', async () => {
  const value = fixture('darwin');
  try {
    await value.host.initialize();
    await value.host.publish(projection());
    value.host.openMenu();
    assert.equal(value.tray().currentMenu?.template.find(item => item.id === 'system-entry-home')?.label, 'Open Nimi Home');
    value.host.setLocale('zh');
    assert.equal(value.tray().currentMenu, undefined);
    value.host.openMenu();
    assert.equal(value.tray().currentMenu?.template.find(item => item.id === 'system-entry-home')?.label, '打开 Nimi Home');
    assert.equal(value.tray().contextMenuCalls, 0);
  } finally { value.host.dispose(); }
});

test('overview keeps the Home display scheme when private activity is invalidated', async () => {
  const value = fixture('darwin');
  try {
    await value.host.initialize();
    assert.equal((await value.host.snapshot()).colorScheme, null);
    await value.host.publish({ ...projection(), colorScheme: 'dark' });
    await value.host.openOverview();
    assert.deepEqual(value.window().webContents.messages.at(-1)?.value, await value.host.snapshot());
    assert.equal((await value.host.snapshot()).colorScheme, 'dark');
    value.host.invalidate();
    value.setAdmission({ generation: 'locked-generation', state: 'locked' });
    const locked = await value.host.snapshot();
    assert.equal(locked.projection, null);
    assert.equal(locked.colorScheme, 'dark');
    value.setAdmission({ generation: 'ready-generation', state: 'ready' });
    await value.host.publish({ ...projection('ready-generation'), colorScheme: 'light' });
    assert.equal((await value.host.snapshot()).colorScheme, 'light');
  } finally { value.host.dispose(); }
});

test('popup positioning stays in the selected work area across screen edges and negative origins', () => {
  const cases = [
    { area: { x: -1920, y: 0, width: 1920, height: 1040 }, anchor: { x: -20, y: 1040, width: 20, height: 40 }, platform: 'win32' as const },
    { area: { x: 0, y: 24, width: 1280, height: 776 }, anchor: { x: 1200, y: 0, width: 22, height: 24 }, platform: 'darwin' as const },
    { area: { x: 100, y: -900, width: 320, height: 480 }, anchor: { x: 400, y: -425, width: 20, height: 20 }, platform: 'win32' as const },
  ];
  for (const { area, anchor, platform } of cases) {
    const bounds = positionSystemEntryPopup(anchor, area, platform);
    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
    assert.ok(bounds.x + bounds.width <= area.x + area.width);
    assert.ok(bounds.y + bounds.height <= area.y + area.height);
  }
});
