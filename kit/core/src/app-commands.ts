// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-app-chrome
export const NIMI_APP_COMMAND_IDS = [
  'nimi.navigation.back', 'nimi.navigation.forward', 'nimi.sidebar.toggle',
  'nimi.edit.undo', 'nimi.edit.redo', 'nimi.edit.cut', 'nimi.edit.copy',
  'nimi.edit.paste', 'nimi.edit.select-all',
  'nimi.view.zoom-in', 'nimi.view.zoom-out', 'nimi.view.zoom-reset', 'nimi.view.fullscreen',
  'nimi.file.close', 'nimi.file.quit', 'nimi.help.shortcuts', 'nimi.help.about',
] as const;
export type NimiStandardAppCommandId = typeof NIMI_APP_COMMAND_IDS[number];
export const NIMI_APP_COMMAND_LABELS: Record<NimiStandardAppCommandId, readonly [string, string]> = {
  'nimi.navigation.back': ['Back', '后退'], 'nimi.navigation.forward': ['Forward', '前进'],
  'nimi.sidebar.toggle': ['Show sidebar', '显示侧栏'],
  'nimi.edit.undo': ['Undo', '撤销'], 'nimi.edit.redo': ['Redo', '重做'],
  'nimi.edit.cut': ['Cut', '剪切'], 'nimi.edit.copy': ['Copy', '复制'],
  'nimi.edit.paste': ['Paste', '粘贴'], 'nimi.edit.select-all': ['Select all', '全选'],
  'nimi.view.zoom-in': ['Zoom in', '放大'], 'nimi.view.zoom-out': ['Zoom out', '缩小'],
  'nimi.view.zoom-reset': ['Actual size', '实际大小'], 'nimi.view.fullscreen': ['Full screen', '全屏'],
  'nimi.file.close': ['Close window', '关闭窗口'], 'nimi.file.quit': ['Quit', '退出应用'],
  'nimi.help.shortcuts': ['Keyboard shortcuts', '快捷键说明'], 'nimi.help.about': ['About', '关于'],
};
export type NimiAppMenu = 'file' | 'edit' | 'view' | 'help';
export type NimiAppCommandState = {
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly checked?: boolean;
  readonly busy?: boolean;
  readonly reason?: string;
};
export type NimiAppCommand = {
  readonly id: string;
  readonly label: string;
  readonly menu: NimiAppMenu;
  readonly shortcut?: string;
  readonly state: () => NimiAppCommandState;
  readonly execute: () => void | Promise<void>;
};
export type NimiAppMetadata = {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
};
/** Optional layout state only; never a business controller or page writer. */
export type NimiAppSidebar = {
  readonly visible: boolean;
  readonly enabled?: boolean;
  readonly reason?: string;
  readonly onVisibleChange: (visible: boolean) => void;
};

export type NimiAppCommandResult = 'executed' | 'unavailable' | 'busy' | 'disposed';

/** A window/scope-local command set; it is never a global command registry. */
export function createNimiAppCommandSet(standard: readonly NimiAppCommand[], app: readonly NimiAppCommand[] = []) {
  const commands = new Map<string, NimiAppCommand>();
  const shortcuts = new Set<string>();
  for (const [items, isStandard] of [[standard, true], [app, false]] as const) {
    for (const command of items) {
      if (!/^[a-z][a-z0-9.-]{0,95}$/.test(command.id) || commands.has(command.id)) {
        throw new Error(`Invalid or duplicate command ID: ${command.id}`);
      }
      if (isStandard ? !NIMI_APP_COMMAND_IDS.includes(command.id as NimiStandardAppCommandId) : command.id.startsWith('nimi.')) {
        throw new Error(`Reserved or unknown standard command ID: ${command.id}`);
      }
      if (!['file', 'edit', 'view', 'help'].includes(command.menu)) throw new Error('Unknown menu.');
      if (command.shortcut) {
        const key = normalizeNimiAppShortcut(command.shortcut);
        if (shortcuts.has(key)) throw new Error(`Conflicting shortcut: ${command.shortcut}`);
        shortcuts.add(key);
      }
      commands.set(command.id, command);
    }
  }
  let disposed = false;
  const running = new Set<string>();
  const get = (id: string) => {
    const command = commands.get(id);
    if (!command) throw new Error(`Unknown command reference: ${id}`);
    return command;
  };
  return Object.freeze({
    commands: Object.freeze([...commands.values()]),
    state: (id: string): NimiAppCommandState => {
      const value = get(id).state();
      if (typeof value.enabled !== 'boolean' || typeof value.visible !== 'boolean') throw new Error('Invalid command state.');
      return Object.freeze({ ...value, enabled: !disposed && value.enabled && !running.has(id), busy: Boolean(value.busy || running.has(id)) });
    },
    execute: async (id: string): Promise<NimiAppCommandResult> => {
      const command = get(id);
      if (disposed) return 'disposed';
      if (running.has(id)) return 'busy';
      const state = command.state();
      if (!state.visible || !state.enabled || state.busy) return 'unavailable';
      running.add(id);
      try { await command.execute(); return disposed ? 'disposed' : 'executed'; } finally { running.delete(id); }
    },
    dispose: () => { disposed = true; running.clear(); },
  });
}

export function normalizeNimiAppShortcut(value: string): string {
  const parts = value.toLowerCase().split('+').map(part => part.trim());
  const key = parts.pop();
  if (!key || parts.some(part => !['ctrl', 'cmd', 'shift', 'alt'].includes(part)) || new Set(parts).size !== parts.length) {
    throw new Error(`Invalid shortcut: ${value}`);
  }
  return [...parts.sort(), key].join('+');
}
