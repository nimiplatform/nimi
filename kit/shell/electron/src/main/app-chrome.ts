import { randomUUID } from 'node:crypto';
import { NIMI_APP_COMMAND_IDS, NIMI_APP_COMMAND_LABELS, normalizeNimiAppShortcut, type NimiAppMenu, type NimiAppMetadata } from '@nimiplatform/kit/core/app-commands';
import { NIMI_CHROME_COMMAND_EVENT, NIMI_CHROME_STATE_EVENT, NIMI_CHROME_NATIVE_COMMANDS, type NimiChromeCommandState, type NimiChromeLocale, type NimiChromeNativeCommand, type NimiChromeShortcut, type NimiChromeState } from '@nimiplatform/kit/shell/capabilities';
import { rendererOriginFromUrl } from './diagnostics.js';
import { NimiElectronShellHostError, type NimiElectronIpcMainInvokeEvent } from './types.js';
import type { NimiElectronStandardMenuRole } from './app-menu.js';

type Listener = (...args: unknown[]) => void;
type Emitter = { on(event: string, listener: Listener): unknown; removeListener(event: string, listener: Listener): unknown };
export type NimiElectronChromeWebContents = Emitter & {
  readonly mainFrame: { readonly url: string };
  isDestroyed(): boolean; getURL(): string;
  setZoomMode(mode: 'isolated'): void;
  getZoomFactor(): number; setZoomFactor(factor: number): void;
  setIgnoreMenuShortcuts(ignore: boolean): void;
  undo(): void; redo(): void; cut(): void; copy(): void; paste(): void; selectAll(): void;
};
export type NimiElectronChromeWindow = Emitter & {
  readonly webContents: NimiElectronChromeWebContents;
  isDestroyed(): boolean; isFocused(): boolean; close(): void;
  isFullScreen(): boolean; setFullScreen(fullscreen: boolean): void;
  setMenu(menu: null): void; setMenuBarVisibility(visible: boolean): void;
};
export type NimiElectronChromeMenuItem = {
  id?: string; label?: string; role?: NimiElectronStandardMenuRole;
  type?: 'separator' | 'normal' | 'checkbox';
  submenu?: NimiElectronChromeMenuItem[];
  enabled?: boolean; visible?: boolean; checked?: boolean;
  accelerator?: string; acceleratorWorksWhenHidden?: boolean; click?: () => void;
};
export type NimiElectronChromeAppCommand = {
  readonly id: string; readonly menu: NimiAppMenu;
  readonly labels: Readonly<Record<NimiChromeLocale, string>>;
  readonly shortcut?: string; readonly macShortcut?: string;
};
export type NimiElectronAppChromeHostInput = {
  readonly metadata: NimiAppMetadata;
  readonly allowedRendererUrls: readonly string[];
  readonly platform?: NodeJS.Platform;
  readonly app: { quit(): void };
  readonly menu: {
    buildFromTemplate(template: NimiElectronChromeMenuItem[]): object;
    setApplicationMenu(menu: object | null): void;
  };
  readonly appCommands?: readonly NimiElectronChromeAppCommand[];
};
export type NimiElectronChromeOperation = 'chromeBind' | 'chromeStateSet' | 'chromeCommand' | 'chromeUnbind';
export type NimiElectronAppChromeHost = {
  bindWindow(window: NimiElectronChromeWindow): () => void;
  invoke(operation: NimiElectronChromeOperation, payload: Readonly<Record<string, unknown>>, event: NimiElectronIpcMainInvokeEvent, send: (event: string, payload: unknown) => void): unknown;
  invalidateAll(): void; dispose(): void;
};
type WindowBinding = {
  window: NimiElectronChromeWindow; webContents: NimiElectronChromeWebContents; generation: string | null; loading: boolean;
  locale: NimiChromeLocale; states: Map<string, NimiChromeCommandState>;
  suppress: boolean; send?: (event: string, payload: unknown) => void; cleanup: () => void;
};

/** Only titlebar options: the App still owns security, creation and lifetime. */
export function createNimiElectronAppChromeWindowOptions(platform: NodeJS.Platform = process.platform) {
  return platform === 'darwin' || platform === 'win32'
    ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#737373', height: 40 } }
    : {};
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-app-chrome-host
export function createNimiElectronAppChromeHost(input: NimiElectronAppChromeHostInput): NimiElectronAppChromeHost {
  const platform = input.platform ?? process.platform;
  const urls = new Set(input.allowedRendererUrls.map(documentUrl));
  const origins = new Set([...urls].map(rendererOriginFromUrl));
  if (!urls.size || !input.metadata.name || !input.metadata.version) throw chromeError('invalid-payload', 'chrome-host-declaration-invalid');
  const appCommands = input.appCommands ?? [];
  const ids = new Set<string>(NIMI_APP_COMMAND_IDS);
  const shortcutKeys = new Set<string>();
  const shortcuts = nativeShortcuts(platform);
  for (const item of shortcuts) shortcutKeys.add(normalizeNimiAppShortcut(item.keys));
  for (const command of appCommands) {
    if (!/^[a-z][a-z0-9.-]{0,95}$/.test(command.id) || command.id.startsWith('nimi.') || ids.has(command.id)
      || !['file', 'edit', 'view', 'help'].includes(command.menu) || !command.labels.en || !command.labels.zh) {
      throw chromeError('invalid-payload', 'chrome-command-declaration-invalid');
    }
    ids.add(command.id);
    const keys = platform === 'darwin' ? command.macShortcut ?? command.shortcut : command.shortcut;
    if (keys) {
      const normalized = normalizeNimiAppShortcut(keys);
      if (shortcutKeys.has(normalized)) throw chromeError('invalid-payload', 'chrome-shortcut-conflict');
      shortcutKeys.add(normalized);
      shortcuts.push({ commandId: command.id, keys, owner: platform === 'darwin' ? 'host' : 'renderer' });
    }
  }
  const bindings = new Map<object, WindowBinding>();
  let disposed = false;
  let focused: WindowBinding | undefined;
  const state = (binding: WindowBinding): NimiChromeState => ({
    generation: binding.generation!, menuPlacement: platform === 'darwin' ? 'system' : 'window',
    windowDrag: platform === 'darwin' || platform === 'win32',
    // Actual caption exclusion comes from Chromium's titlebar-area geometry,
    // including native scale/RTL/fullscreen changes; no per-App fixed inset.
    geometry: { left: 0, right: 0, height: 40 },
    zoomFactor: binding.window.webContents.getZoomFactor(), fullscreen: binding.window.isFullScreen(),
    nativeCommands: [...NIMI_CHROME_NATIVE_COMMANDS], shortcuts,
  });
  const emitState = (binding: WindowBinding) => {
    if (binding.generation && !binding.window.isDestroyed()) binding.send?.(NIMI_CHROME_STATE_EVENT, state(binding));
  };
  const emitCommand = (binding: WindowBinding, id: string) => {
    const command = binding.states.get(id);
    if (binding.window.isDestroyed() || !binding.window.isFocused() || !binding.generation || !command?.visible || !command.enabled) return;
    binding.send?.(NIMI_CHROME_COMMAND_EVENT, { generation: binding.generation, commandId: id });
  };
  const executeNative = (binding: WindowBinding, command: NimiChromeNativeCommand) => {
    const window = binding.window;
    const wc = window.webContents;
    if (command === 'close-window') window.close();
    else if (command === 'quit-app') input.app.quit();
    else if (command === 'toggle-fullscreen') window.setFullScreen(!window.isFullScreen());
    else if (command.startsWith('zoom-')) {
      wc.setZoomFactor(command === 'zoom-reset' ? 1 : Math.min(5, Math.max(0.25, wc.getZoomFactor() * (command === 'zoom-in' ? 1.2 : 1 / 1.2))));
    } else if (command === 'select-all') wc.selectAll();
    else if (command === 'undo') wc.undo();
    else if (command === 'redo') wc.redo();
    else if (command === 'cut') wc.cut();
    else if (command === 'copy') wc.copy();
    else if (command === 'paste') wc.paste();
    if (!window.isDestroyed()) emitState(binding);
  };
  const projectMenu = () => {
    if (platform !== 'darwin') { input.menu.setApplicationMenu(null); return; }
    const binding = focused;
    const locale = binding?.locale ?? 'en';
    const label = (id: typeof NIMI_APP_COMMAND_IDS[number]) => NIMI_APP_COMMAND_LABELS[id][locale === 'zh' ? 1 : 0];
    const item = (id: string, title: string): NimiElectronChromeMenuItem => {
      // A trusted application menu owns process Quit even when no window exists.
      // Renderer-originated Quit still requires the exact live binding below.
      if (id === 'nimi.file.quit') return {
        id, label: title, enabled: !disposed, visible: true,
        accelerator: 'Command+Q', acceleratorWorksWhenHidden: false,
        click: () => { if (!disposed) input.app.quit(); },
      };
      const projected = binding?.states.get(id);
      const generation = binding?.generation;
      const shortcut = shortcuts.find(s => s.commandId === id);
      const native = nativeCommandFor(id);
      return {
        id, label: title, type: id === 'nimi.sidebar.toggle' || id === 'nimi.view.fullscreen' ? 'checkbox' : 'normal',
        enabled: Boolean(binding?.generation && projected?.enabled), visible: projected?.visible ?? !isOptional(id), checked: projected?.checked ?? false,
        accelerator: shortcut?.keys.replace(/Cmd/g, 'Command').replace(/Ctrl/g, 'Control'),
        acceleratorWorksWhenHidden: false,
        click: () => {
          if (!generation || binding?.generation !== generation || focused !== binding || !binding.window.isFocused()) return;
          const current = binding.states.get(id);
          if (!current?.enabled || !current.visible) return;
          if (native) executeNative(binding, native); else emitCommand(binding, id);
        },
      };
    };
    const standardFor = (menu: NimiAppMenu) => NIMI_APP_COMMAND_IDS.filter(id => menuFor(id) === menu).map(id => item(id, label(id)));
    const appFor = (menu: NimiAppMenu) => appCommands.filter(c => c.menu === menu).map(c => item(c.id, c.labels[locale]));
    // Edit uses the system responder; never a click callback or renderer mirror.
    const edit: NimiElectronChromeMenuItem[] = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map(role => ({ role: role as NimiElectronStandardMenuRole }));
    input.menu.setApplicationMenu(input.menu.buildFromTemplate([
      { label: input.metadata.name, submenu: [item('nimi.help.about', label('nimi.help.about')), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, item('nimi.file.quit', label('nimi.file.quit'))] },
      { label: locale === 'zh' ? '文件' : 'File', submenu: [...appFor('file'), ...standardFor('file').filter(i => i.id !== 'nimi.file.quit')] },
      { label: locale === 'zh' ? '编辑' : 'Edit', submenu: [...edit, ...appFor('edit')] },
      { label: locale === 'zh' ? '视图' : 'View', submenu: [...standardFor('view'), ...appFor('view')] },
      { label: locale === 'zh' ? '帮助' : 'Help', submenu: [...standardFor('help').filter(i => i.id !== 'nimi.help.about'), ...appFor('help')] },
    ]));
  };
  const revoke = (binding: WindowBinding) => {
    binding.generation = null; binding.states.clear(); binding.send = undefined; binding.suppress = false;
    // BrowserWindow.webContents itself can throw once the native window is
    // destroyed, including will-quit before our closed listener has run.
    if (!binding.window.isDestroyed() && !binding.webContents.isDestroyed()) binding.webContents.setIgnoreMenuShortcuts(false);
    projectMenu();
  };
  const authorize = (event: NimiElectronIpcMainInvokeEvent): WindowBinding => {
    const binding = event.sender && bindings.get(event.sender);
    if (disposed || !binding || binding.loading || binding.window.isDestroyed() || binding.window.webContents.isDestroyed()
      || event.sender !== binding.window.webContents || event.senderFrame !== binding.window.webContents.mainFrame) {
      throw chromeError('forbidden-renderer-access', 'chrome-exact-main-frame-required');
    }
    const url = documentUrl(event.senderFrame?.url ?? '');
    if (!urls.has(url) || !origins.has(rendererOriginFromUrl(url)) || documentUrl(binding.window.webContents.getURL()) !== url) {
      throw chromeError('forbidden-renderer-access', 'chrome-renderer-location-rejected');
    }
    return binding;
  };
  const bindWindow = (window: NimiElectronChromeWindow) => {
    if (disposed || window.isDestroyed() || window.webContents.isDestroyed() || bindings.has(window.webContents)) throw chromeError('invalid-payload', 'chrome-window-binding-invalid');
    const webContents = window.webContents;
    webContents.setZoomMode('isolated');
    if (platform !== 'darwin') { window.setMenu(null); window.setMenuBarVisibility(false); }
    const cleanup: (() => void)[] = [];
    const binding: WindowBinding = { window, webContents, generation: null, loading: false, locale: 'en', states: new Map(), suppress: false, cleanup: () => undefined };
    const on = (target: Emitter, event: string, listener: Listener) => { target.on(event, listener); cleanup.push(() => { target.removeListener(event, listener); }); };
    const remove = () => {
      // closed, WebContents.destroyed and host disposal can overlap. Detach
      // this exact binding before callbacks, without reading a dead Window.
      // An old returned cleanup must also leave a later binding untouched.
      if (bindings.get(webContents) !== binding) return;
      bindings.delete(webContents);
      if (focused === binding) focused = undefined;
      for (const off of cleanup.splice(0)) off();
      revoke(binding);
    };
    binding.cleanup = remove;
    bindings.set(webContents, binding);
    on(window, 'focus', () => { focused = binding; projectMenu(); });
    for (const event of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) on(window, event, () => emitState(binding));
    on(window, 'closed', remove);
    on(webContents, 'destroyed', remove);
    on(webContents, 'render-process-gone', () => { binding.loading = true; revoke(binding); });
    on(webContents, 'did-start-navigation', (...args) => {
      const details = args[0] as { isMainFrame?: boolean; isSameDocument?: boolean };
      if (details?.isMainFrame !== false && details?.isSameDocument !== true) { binding.loading = true; revoke(binding); }
    });
    on(webContents, 'did-finish-load', () => { binding.loading = false; });
    on(webContents, 'before-input-event', (_event, value) => {
      const key = value as { isComposing?: boolean; key?: string; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean };
      const editingConflict = binding.suppress && shortcuts.some(shortcut =>
        (shortcut.commandId.startsWith('nimi.navigation.') || shortcut.commandId === 'nimi.sidebar.toggle' || !shortcut.commandId.startsWith('nimi.'))
        && matchesInput(shortcut.keys, key));
      webContents.setIgnoreMenuShortcuts(Boolean(key.isComposing || editingConflict));
    });
    if (window.isFocused()) focused = binding;
    projectMenu();
    return remove;
  };
  return {
    bindWindow,
    invoke(operation, payload, event, send) {
      const binding = authorize(event);
      if (operation === 'chromeBind') {
        exact(payload, ['locale']);
        binding.locale = localeValue(payload.locale);
        revoke(binding); binding.generation = randomUUID(); binding.send = send;
        if (binding.window.isFocused()) focused = binding;
        projectMenu(); return state(binding);
      }
      const allowed = operation === 'chromeStateSet' ? ['generation', 'locale', 'commands', 'suppressMenuShortcuts'] : operation === 'chromeCommand' ? ['generation', 'command'] : ['generation'];
      exact(payload, allowed);
      if (!binding.generation || payload.generation !== binding.generation) throw chromeError('session-invalid', 'chrome-binding-generation-expired');
      if (operation === 'chromeUnbind') { revoke(binding); return { released: true }; }
      if (operation === 'chromeCommand') {
        if (!NIMI_CHROME_NATIVE_COMMANDS.includes(payload.command as NimiChromeNativeCommand)) throw chromeError('invalid-payload', 'chrome-native-command-invalid');
        executeNative(binding, payload.command as NimiChromeNativeCommand); return { executed: true };
      }
      const locale = localeValue(payload.locale);
      if (!Array.isArray(payload.commands) || payload.commands.length > ids.size || typeof payload.suppressMenuShortcuts !== 'boolean') throw chromeError('invalid-payload', 'chrome-command-state-invalid');
      const next = new Map<string, NimiChromeCommandState>();
      for (const value of payload.commands) {
        exact(value as Record<string, unknown>, ['id', 'enabled', 'visible', 'checked']);
        const command = value as NimiChromeCommandState;
        if (!ids.has(command.id) || next.has(command.id) || typeof command.enabled !== 'boolean' || typeof command.visible !== 'boolean' || typeof command.checked !== 'boolean') throw chromeError('invalid-payload', 'chrome-command-state-invalid');
        next.set(command.id, { ...command });
      }
      binding.states = next; binding.locale = locale; binding.suppress = payload.suppressMenuShortcuts;
      projectMenu(); return { updated: true };
    },
    invalidateAll() { for (const binding of bindings.values()) revoke(binding); },
    dispose() { if (disposed) return; for (const binding of [...bindings.values()]) binding.cleanup(); disposed = true; input.menu.setApplicationMenu(null); },
  };
}

function exact(value: Readonly<Record<string, unknown>>, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw chromeError('invalid-payload', 'chrome-extra-or-missing-field');
}
function localeValue(value: unknown): NimiChromeLocale { if (value !== 'en' && value !== 'zh') throw chromeError('invalid-payload', 'chrome-locale-invalid'); return value; }
function documentUrl(url: string) { try { const parsed = new URL(url); parsed.hash = ''; return parsed.toString(); } catch { throw chromeError('forbidden-renderer-access', 'chrome-renderer-location-invalid'); } }
function chromeError(code: 'invalid-payload' | 'forbidden-renderer-access' | 'session-invalid', reasonCode: string) { return new NimiElectronShellHostError({ code, message: reasonCode, reasonCode, actionHint: 'rebind_current_registered_window_chrome' }); }
function isOptional(id: string) { return id.startsWith('nimi.navigation.') || id === 'nimi.sidebar.toggle'; }
function menuFor(id: string): NimiAppMenu { return id.includes('.edit.') ? 'edit' : id.includes('.file.') ? 'file' : id.includes('.help.') ? 'help' : 'view'; }
function nativeCommandFor(id: string): NimiChromeNativeCommand | undefined {
  const map: Record<string, NimiChromeNativeCommand> = { 'nimi.file.close': 'close-window', 'nimi.file.quit': 'quit-app', 'nimi.view.fullscreen': 'toggle-fullscreen', 'nimi.view.zoom-in': 'zoom-in', 'nimi.view.zoom-out': 'zoom-out', 'nimi.view.zoom-reset': 'zoom-reset' };
  return map[id];
}
function nativeShortcuts(platform: NodeJS.Platform): NimiChromeShortcut[] {
  const modifier = platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const owner = platform === 'darwin' ? 'host' as const : 'renderer' as const;
  const items = [
    ['nimi.navigation.back', platform === 'darwin' ? 'Cmd+[' : 'Alt+Left'], ['nimi.navigation.forward', platform === 'darwin' ? 'Cmd+]' : 'Alt+Right'],
    ['nimi.sidebar.toggle', `${modifier}+B`], ['nimi.view.zoom-in', `${modifier}+Plus`], ['nimi.view.zoom-out', `${modifier}+Minus`],
    ['nimi.view.zoom-reset', `${modifier}+0`], ['nimi.view.fullscreen', platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11'],
    ['nimi.file.close', `${modifier}+W`], ['nimi.file.quit', `${modifier}+Q`],
    ['nimi.edit.undo', `${modifier}+Z`], ['nimi.edit.redo', platform === 'darwin' ? 'Cmd+Shift+Z' : 'Ctrl+Y'], ['nimi.edit.cut', `${modifier}+X`],
    ['nimi.edit.copy', `${modifier}+C`], ['nimi.edit.paste', `${modifier}+V`], ['nimi.edit.select-all', `${modifier}+A`],
  ];
  return items.map(([commandId, keys]) => ({ commandId: commandId!, keys: keys!, owner: commandId!.startsWith('nimi.edit.') ? 'native-edit' : owner }));
}
function matchesInput(keys: string, input: { key?: string; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }) {
  const parts = keys.toLowerCase().split('+'); const key = parts.pop();
  const aliases: Record<string, string> = { left: 'arrowleft', right: 'arrowright', plus: '+', minus: '-' };
  return input.key?.toLowerCase() === (aliases[key!] ?? key) && Boolean(input.control) === parts.includes('ctrl')
    && Boolean(input.meta) === parts.includes('cmd') && Boolean(input.alt) === parts.includes('alt')
    && (key === 'plus' || Boolean(input.shift) === parts.includes('shift'));
}
