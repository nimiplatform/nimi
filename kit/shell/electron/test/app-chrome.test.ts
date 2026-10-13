import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createNimiElectronAppChromeHost, type NimiElectronChromeMenuItem } from '../src/main/app-chrome.js';
import type { NimiChromeState } from '@nimiplatform/kit/shell/capabilities';

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
  webContents = new Contents(); destroyed = false; focused = true; fullscreen = false; closes = 0; menuVisible = true;
  isDestroyed() { return this.destroyed; } isFocused() { return this.focused; } isFullScreen() { return this.fullscreen; }
  setFullScreen(value: boolean) { this.fullscreen = value; } close() { this.closes++; }
  setMenu(_menu: null) {} setMenuBarVisibility(value: boolean) { this.menuVisible = value; }
}
const event = (window: Window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
const fixture = (platform: 'win32' | 'darwin' = 'win32') => {
  let menu: NimiElectronChromeMenuItem[] = []; let quits = 0;
  const events: [string, unknown][] = [];
  const host = createNimiElectronAppChromeHost({ metadata: { name: 'App', version: '1' }, platform,
    allowedRendererUrls: [url], app: { quit() { quits++; } },
    menu: { buildFromTemplate(value) { menu = value; return {}; }, setApplicationMenu() {} },
  });
  const window = new Window(); host.bindWindow(window);
  const send = (name: string, value: unknown) => events.push([name, value]);
  const bind = () => host.invoke('chromeBind', { locale: 'en' }, event(window), send) as NimiChromeState;
  return { host, window, bind, send, events, get menu() { return menu; }, get quits() { return quits; } };
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
    const fresh = f.bind().generation; f.window.destroyed = true; f.window.emit('closed');
    expect(() => f.host.invoke('chromeCommand', { generation: fresh, command: 'copy' }, event(f.window), f.send)).toThrow('exact-main-frame');
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
});
