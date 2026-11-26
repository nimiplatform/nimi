import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  resolveNimiElectronTitleBarOverlay,
  type NimiElectronChromeMenuItem,
  type NimiElectronTitleBarOverlayOptions,
} from '../src/main/app-chrome.js';
import type { NimiChromeState } from '@nimiplatform/kit/shell/capabilities';
import { NIMI_CHROME_COMMAND_EVENT } from '@nimiplatform/kit/shell/capabilities';

const url = 'https://app.invalid/index.html';
class Contents extends EventEmitter {
  mainFrame = { url }; destroyed = false; factor = 1; mode = ''; ignored = false; edits: string[] = [];
  isDestroyed() { return this.destroyed; } getURL() { return this.mainFrame.url; }
  setZoomMode(mode: string) { this.mode = mode; } getZoomFactor() { return this.factor; } setZoomFactor(factor: number) { this.factor = factor; }
  setIgnoreMenuShortcuts(value: boolean) { this.ignored = value; }
  undo() { this.edits.push('undo'); } redo() { this.edits.push('redo'); } copy() { this.edits.push('copy'); }
  cut() { this.edits.push('cut'); } paste() { this.edits.push('paste'); } selectAll() { this.edits.push('select-all'); }
}
class Window extends EventEmitter {
  readonly contents = new Contents(); destroyed = false; focused = true; fullscreen = false; closes = 0; menuVisible = true;
  get webContents() {
    if (this.destroyed) throw new TypeError('Object has been destroyed');
    return this.contents;
  }
  isDestroyed() { return this.destroyed; } isFocused() { return this.focused; } isFullScreen() { return this.fullscreen; }
  setFullScreen(value: boolean) { this.fullscreen = value; } close() { this.closes++; }
  setMenu(_menu: null) {} setMenuBarVisibility(value: boolean) { this.menuVisible = value; }
}
const event = (window: Window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
const fixture = (platform: 'win32' | 'darwin' = 'win32', titleBarStyle?: 'native' | 'hidden') => {
  let menu: NimiElectronChromeMenuItem[] = []; let quits = 0;
  const events: [string, unknown][] = [];
  const host = createNimiElectronAppChromeHost({ metadata: { name: 'App', version: '1' }, platform, titleBarStyle,
    allowedRendererUrls: [url], app: { quit() { quits++; } },
    menu: { buildFromTemplate(value) { menu = value; return {}; }, setApplicationMenu() {} },
  });
  const window = new Window(); const remove = host.bindWindow(window);
  const send = (name: string, value: unknown) => events.push([name, value]);
  const bind = () => host.invoke('chromeBind', { locale: 'en' }, event(window), send) as NimiChromeState;
  return { host, window, remove, bind, send, events, get menu() { return menu; }, get quits() { return quits; } };
};
const states = (generation: string, visible = true) => ({ generation, locale: 'en', commands: [{ id: 'nimi.sidebar.toggle', enabled: true, visible, checked: false }], suppressMenuShortcuts: false });

describe('exact native chrome binding', () => {
  it('macOS application Quit follows App cleanup with a hidden, unfocused or closed last window', () => {
    const f = fixture('darwin'); f.bind();
    const quit = () => f.menu[0]!.submenu!.find(item => item.id === 'nimi.file.quit')!;
    f.window.focused = false; f.window.emit('hide');
    expect(quit().enabled).toBe(true); quit().click!();
    f.window.emit('blur'); quit().click!();
    f.window.destroyed = true; f.window.emit('closed');
    expect(quit().enabled).toBe(true); quit().click!();
    expect(f.quits).toBe(3); expect(f.window.closes).toBe(0);
    const previous = quit(); f.host.dispose(); previous.click!(); expect(f.quits).toBe(3);
  });
  it('accepts only a bound live main frame, even when other frames/windows use the same allowed URL', () => {
    const f = fixture(); const generation = f.bind().generation;
    expect(() => f.host.invoke('chromeCommand', { generation, command: 'copy' }, event(new Window()), f.send)).toThrow('exact-main-frame');
    expect(() => f.host.invoke('chromeCommand', { generation, command: 'copy' }, { sender: f.window.webContents, senderFrame: { url } }, f.send)).toThrow('exact-main-frame');
    f.window.webContents.mainFrame.url = 'https://foreign.invalid/index.html';
    expect(() => f.bind()).toThrow('location-rejected');
  });
  it('rejects unknown commands/IDs and extra fields before effects, with atomic state projection', () => {
    const f = fixture(); const generation = f.bind().generation;
    expect(() => f.host.invoke('chromeCommand', { generation, command: 'script', script: 'x' }, event(f.window), f.send)).toThrow('extra-or-missing');
    expect(() => f.host.invoke('chromeStateSet', { ...states(generation), commands: [{ id: 'app.unregistered', enabled: true, visible: true, checked: false }] }, event(f.window), f.send)).toThrow('state-invalid');
    expect(f.window.webContents.edits).toEqual([]);
  });
  it('rotates generations and refuses late updates, native calls and callbacks', () => {
    const f = fixture('darwin'); const old = f.bind().generation;
    f.host.invoke('chromeStateSet', states(old), event(f.window), f.send);
    const stale = f.menu.find(item => item.label === 'View')!.submenu!.find(item => item.id === 'nimi.sidebar.toggle')!.click!;
    const fresh = f.bind().generation;
    f.host.invoke('chromeStateSet', states(fresh), event(f.window), f.send);
    expect(fresh).not.toBe(old);
    expect(() => f.host.invoke('chromeStateSet', states(old), event(f.window), f.send)).toThrow('generation-expired');
    expect(() => f.host.invoke('chromeCommand', { generation: old, command: 'close-window' }, event(f.window), f.send)).toThrow('generation-expired');
    stale(); expect(f.events).toEqual([]);
  });
  it('revokes on document navigation, excludes an in-progress document and revokes on real destruction', () => {
    const f = fixture(); const old = f.bind().generation;
    f.window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    expect(() => f.bind()).toThrow('exact-main-frame');
    f.window.webContents.emit('did-finish-load');
    expect(() => f.host.invoke('chromeCommand', { generation: old, command: 'copy' }, event(f.window), f.send)).toThrow('generation-expired');
    const fresh = f.bind().generation; const sender = event(f.window);
    f.window.destroyed = true; f.window.emit('closed');
    expect(() => f.host.invoke('chromeCommand', { generation: fresh, command: 'copy' }, sender, f.send)).toThrow('exact-main-frame');
  });
  it.each(['closed-first', 'contents-first', 'quit-before-closed'] as const)('cleans up once when destruction arrives %s', (order) => {
    const f = fixture(); const generation = f.bind().generation;
    const sender = event(f.window); const contents = f.window.contents;
    contents.on('unrelated', () => undefined);
    f.window.on('unrelated', () => undefined);
    contents.setIgnoreMenuShortcuts = () => { throw new Error('native shortcut setter must not run during destruction'); };
    if (order === 'contents-first') {
      contents.destroyed = true; contents.emit('destroyed');
      f.window.destroyed = true; f.window.emit('closed');
    } else {
      f.window.destroyed = true;
      // Electron can emit window-all-closed -> quit -> will-quit before our
      // closed/destroyed listeners. The Window getter already throws then.
      if (order === 'quit-before-closed') { f.host.invalidateAll(); f.host.dispose(); }
      f.window.emit('closed'); contents.destroyed = true; contents.emit('destroyed');
    }
    f.remove(); f.remove(); f.host.invalidateAll(); f.host.dispose(); f.host.dispose();
    expect(f.window.eventNames()).toEqual(['unrelated']);
    expect(contents.eventNames()).toEqual(['unrelated']);
    expect(() => f.host.invoke('chromeCommand', { generation, command: 'copy' }, sender, f.send)).toThrow('exact-main-frame');
    expect(f.events).toEqual([]);
  });
  it('does not let an old cleanup remove a later binding on the same live window', () => {
    const f = fixture(); f.bind(); f.remove();
    const removeCurrent = f.host.bindWindow(f.window); const generation = f.bind().generation;
    f.remove();
    f.host.invoke('chromeCommand', { generation, command: 'copy' }, event(f.window), f.send);
    expect(f.window.contents.edits).toEqual(['copy']);
    removeCurrent(); f.host.dispose();
  });
  it('retains a binding after cancelled close/hide and preserves App quit ownership', () => {
    const f = fixture(); const generation = f.bind().generation;
    f.host.invoke('chromeCommand', { generation, command: 'close-window' }, event(f.window), f.send);
    f.window.emit('hide');
    f.host.invoke('chromeCommand', { generation, command: 'copy' }, event(f.window), f.send);
    f.host.invoke('chromeCommand', { generation, command: 'quit-app' }, event(f.window), f.send);
    expect(f.window.closes).toBe(1); expect(f.quits).toBe(1); expect(f.window.webContents.edits).toEqual(['copy']);
  });
  it('uses isolated per-window zoom and independent native/menu behavior facts', () => {
    const f = fixture(); const other = new Window(); f.host.bindWindow(other);
    const generation = f.bind().generation;
    f.host.invoke('chromeCommand', { generation, command: 'zoom-in' }, event(f.window), f.send);
    expect(f.window.webContents.mode).toBe('isolated'); expect(other.webContents.mode).toBe('isolated');
    expect(f.window.webContents.factor).toBe(1.2); expect(other.webContents.factor).toBe(1);
    const projection = f.bind(); expect(projection).not.toHaveProperty('presentation'); expect(projection).not.toHaveProperty('platform');
  });
  it.each(['win32', 'darwin'] as const)('binds Kit commands inside a native frame on %s', (platform) => {
    const f = fixture(platform, 'native');
    const menuLabels = () => f.menu.map(item => item.label);
    if (platform === 'darwin') expect(menuLabels()).toEqual(['App', 'Edit']);
    const state = f.bind();
    expect(state.windowDrag).toBe(false);
    expect(state.menuPlacement).toBe(platform === 'darwin' ? 'system' : 'window');
    if (platform === 'darwin') expect(menuLabels()).toContain('File');
    f.host.invoke('chromeCommand', { generation: state.generation, command: 'zoom-in' }, event(f.window), f.send);
    expect(f.window.contents.factor).toBe(1.2);
    f.host.invoke('chromeUnbind', { generation: state.generation }, event(f.window), f.send);
    if (platform === 'darwin') expect(menuLabels()).toEqual(['App', 'Edit']);
    f.host.dispose();
  });
  it('keeps macOS system Edit roles callback-free, stops hidden accelerators and honors IME suppression', () => {
    const f = fixture('darwin'); const generation = f.bind().generation;
    f.host.invoke('chromeStateSet', states(generation, false), event(f.window), f.send);
    const edit = f.menu.find(item => item.label === 'Edit')!.submenu!;
    expect(edit.every(item => item.role && !item.click)).toBe(true);
    const fold = f.menu.find(item => item.label === 'View')!.submenu!.find(item => item.id === 'nimi.sidebar.toggle')!;
    expect(fold.visible).toBe(false); expect(fold.acceleratorWorksWhenHidden).toBe(false);
    fold.click!(); expect(f.events).toEqual([]);
    f.window.webContents.emit('before-input-event', {}, { isComposing: true });
    expect(f.window.webContents.ignored).toBe(true);
  });
  it('hides defaultVisible=false app commands until projected, activates when projected, and rejects invalid defaultVisible', () => {
    expect(() => createNimiElectronAppChromeHost({
      metadata: { name: 'App', version: '1' },
      platform: 'darwin',
      allowedRendererUrls: [url],
      app: { quit() {} },
      menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
      appCommands: [{ id: 'app.nimi-account', menu: 'file', labels: { en: 'Nimi account', zh: 'Nimi 账号' }, defaultVisible: 'no' as unknown as boolean }],
    })).toThrow('chrome-command-declaration-invalid');

    let menu: NimiElectronChromeMenuItem[] = [];
    const events: [string, unknown][] = [];
    const host = createNimiElectronAppChromeHost({
      metadata: { name: 'SharedCarrier', version: '1' },
      platform: 'darwin',
      allowedRendererUrls: ['nimi-app://nimi.odd-bureau/index.html'],
      allowEntryQueryRouting: true,
      app: { quit() {} },
      menu: { buildFromTemplate(value) { menu = value; return {}; }, setApplicationMenu() {} },
      appCommands: [{ id: 'app.nimi-account', menu: 'file', labels: { en: 'Nimi account', zh: 'Nimi 账号' }, defaultVisible: false }],
    });
    const win = new Window();
    win.contents.mainFrame.url = 'nimi-app://nimi.odd-bureau/index.html?tab=play#room';
    host.bindWindow(win);
    const send = (name: string, value: unknown) => events.push([name, value]);
    const fileAccount = () => menu.find(item => item.label === 'File')!.submenu!.find(item => item.id === 'app.nimi-account')!;

    // Before bind and when omitted by apps like shijing, the command stays hidden.
    expect(fileAccount().visible).toBe(false);
    expect(fileAccount().enabled).toBe(false);
    const generation = (host.invoke('chromeBind', { locale: 'en' }, event(win), send) as NimiChromeState).generation;
    host.invoke('chromeStateSet', states(generation, true), event(win), send);
    expect(fileAccount().visible).toBe(false);
    fileAccount().click!();
    expect(events).toEqual([]);

    // When projected by odd-bureau / default-starter, it becomes visible and dispatches.
    host.invoke('chromeStateSet', {
      generation,
      locale: 'en',
      commands: [{ id: 'app.nimi-account', enabled: true, visible: true, checked: false }],
      suppressMenuShortcuts: false,
    }, event(win), send);
    expect(fileAccount().visible).toBe(true);
    expect(fileAccount().enabled).toBe(true);
    fileAccount().click!();
    expect(events).toEqual([[NIMI_CHROME_COMMAND_EVENT, { generation, commandId: 'app.nimi-account' }]]);

    // Unbind hides it again.
    host.invoke('chromeUnbind', { generation }, event(win), send);
    expect(fileAccount().visible).toBe(false);
    host.dispose();
  });
  it('allows query routing on opted-in entries while preserving exact path, host, and credentials', () => {
    const events: [string, unknown][] = [];
    const send = (name: string, value: unknown) => events.push([name, value]);
    const devHost = createNimiElectronAppChromeHost({
      metadata: { name: 'DevApp', version: '1' },
      platform: 'win32',
      allowedRendererUrls: ['http://127.0.0.1:1485/', 'nimi-app://nimi.shijing/index.html'],
      allowEntryQueryRouting: true,
      app: { quit() {} },
      menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
    });
    const win = new Window();
    devHost.bindWindow(win);

    win.contents.mainFrame.url = 'http://127.0.0.1:1485/?tab=1#hash';
    expect((devHost.invoke('chromeBind', { locale: 'zh' }, event(win), send) as NimiChromeState).generation).toBeTruthy();

    win.contents.mainFrame.url = 'nimi-app://nimi.shijing/index.html?view=chart#top';
    expect((devHost.invoke('chromeBind', { locale: 'zh' }, event(win), send) as NimiChromeState).generation).toBeTruthy();

    win.contents.mainFrame.url = 'http://127.0.0.1:1485/other?tab=1';
    expect(() => devHost.invoke('chromeBind', { locale: 'zh' }, event(win), send)).toThrow('location-rejected');

    win.contents.mainFrame.url = 'nimi-app://nimi.shijing/other.html?view=chart';
    expect(() => devHost.invoke('chromeBind', { locale: 'zh' }, event(win), send)).toThrow('location-rejected');

    win.contents.mainFrame.url = 'http://user:pass@127.0.0.1:1485/?tab=1'; // pragma: allowlist secret
    expect(() => devHost.invoke('chromeBind', { locale: 'zh' }, event(win), send)).toThrow('location-rejected');
    devHost.dispose();
  });
  it.each([false, true])('preserves explicit entry queries with query routing set to %s', (allowEntryQueryRouting) => {
    const entry = 'https://app.invalid/?view=editor';
    const plain = 'nimi-app://app/index.html';
    const host = createNimiElectronAppChromeHost({
      metadata: { name: 'App', version: '1' }, allowedRendererUrls: [entry, plain],
      ...(allowEntryQueryRouting ? { allowEntryQueryRouting } : {}),
      app: { quit() {} }, menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
    });
    const win = new Window();
    host.bindWindow(win);
    const bind = (location: string) => {
      win.contents.mainFrame.url = location;
      return host.invoke('chromeBind', { locale: 'en' }, event(win), () => {});
    };
    expect(bind(entry + '#section')).toHaveProperty('generation');
    expect(() => bind('https://app.invalid/')).toThrow('location-rejected');
    expect(() => bind('https://app.invalid/?view=other')).toThrow('location-rejected');
    if (allowEntryQueryRouting) expect(bind(plain + '?tab=1')).toHaveProperty('generation');
    else expect(() => bind(plain + '?tab=1')).toThrow('location-rejected');
    win.contents.getURL = () => plain + '?tab=2';
    expect(() => bind(plain)).toThrow('location-rejected');
    host.dispose();
  });
  it('syncs Windows titleBarOverlay symbolColor with dark and light theme updates', () => {
    expect(resolveNimiElectronTitleBarOverlay('light').symbolColor).toBe('#334155');
    expect(resolveNimiElectronTitleBarOverlay('dark').symbolColor).toBe('#e5e7eb');
    expect(createNimiElectronAppChromeWindowOptions('win32', { scheme: 'dark' }).titleBarOverlay?.symbolColor).toBe('#e5e7eb');

    const theme = Object.assign(new EventEmitter(), { shouldUseDarkColors: true });
    const overlays: NimiElectronTitleBarOverlayOptions[] = [];
    const win = Object.assign(new Window(), {
      setTitleBarOverlay(next: NimiElectronTitleBarOverlayOptions) { overlays.push(next); },
    });
    const host = createNimiElectronAppChromeHost({
      metadata: { name: 'App', version: '1' },
      platform: 'win32',
      allowedRendererUrls: [url],
      app: { quit() {} },
      menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
      nativeTheme: theme,
    });
    const unbind = host.bindWindow(win);
    expect(overlays.at(-1)?.symbolColor).toBe('#e5e7eb');
    theme.shouldUseDarkColors = false;
    theme.emit('updated');
    expect(overlays.at(-1)?.symbolColor).toBe('#334155');
    unbind();
    theme.shouldUseDarkColors = true;
    theme.emit('updated');
    expect(overlays).toHaveLength(2);
    host.dispose();
  });
});
