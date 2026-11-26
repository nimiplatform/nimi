import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';

export type NativeEditContextMenuParams = Pick<
  ContextMenuParams,
  'isEditable' | 'selectionText' | 'misspelledWord' | 'dictionarySuggestions' | 'editFlags'
>;

export type NativeEditContextMenuActions = {
  readonly replaceMisspelling?: (suggestion: string) => void;
  readonly addWordToDictionary?: (word: string) => void;
};

export type NativeEditContextMenuLocale = 'zh' | 'en';

export type NativeEditContextMenuWebContentsLike = {
  isDestroyed: () => boolean;
  on: (event: 'context-menu', listener: (event: unknown, params: NativeEditContextMenuParams) => void) => unknown;
  removeListener: (event: 'context-menu', listener: (event: unknown, params: NativeEditContextMenuParams) => void) => unknown;
  replaceMisspelling: (suggestion: string) => void;
  session: {
    addWordToSpellCheckerDictionary: (word: string) => boolean;
  };
};

const MAX_SPELLING_SUGGESTIONS = 5;

const LABELS: Record<NativeEditContextMenuLocale, {
  readonly undo: string;
  readonly redo: string;
  readonly cut: string;
  readonly copy: string;
  readonly paste: string;
  readonly delete: string;
  readonly selectAll: string;
  readonly addToDictionary: (word: string) => string;
}> = {
  zh: {
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    delete: '删除',
    selectAll: '全选',
    addToDictionary: (word) => `将“${word}”添加到词典`,
  },
  en: {
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    delete: 'Delete',
    selectAll: 'Select All',
    addToDictionary: (word) => `Add "${word}" to dictionary`,
  },
};

export function buildNativeEditContextMenuTemplate(
  params: NativeEditContextMenuParams,
  actions: NativeEditContextMenuActions = {},
  locale: NativeEditContextMenuLocale = 'en',
): MenuItemConstructorOptions[] {
  const labels = LABELS[locale];
  const hasSelection = params.selectionText.trim().length > 0;
  const editFlags = params.editFlags;

  if (!params.isEditable && !hasSelection) {
    return [];
  }

  const items: MenuItemConstructorOptions[] = [];

  if (params.isEditable) {
    const misspelled = params.misspelledWord?.trim() ?? '';
    const suggestions = (params.dictionarySuggestions ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, MAX_SPELLING_SUGGESTIONS);

    if (misspelled && (suggestions.length > 0 || actions.addWordToDictionary)) {
      for (const suggestion of suggestions) {
        items.push({
          label: suggestion,
          click: () => actions.replaceMisspelling?.(suggestion),
        });
      }
      if (actions.addWordToDictionary) {
        items.push({
          label: labels.addToDictionary(misspelled),
          click: () => actions.addWordToDictionary?.(misspelled),
        });
      }
      items.push({ type: 'separator' });
    }

    items.push(
      { role: 'undo', label: labels.undo, enabled: Boolean(editFlags.canUndo) },
      { role: 'redo', label: labels.redo, enabled: Boolean(editFlags.canRedo) },
      { type: 'separator' },
      { role: 'cut', label: labels.cut, enabled: Boolean(editFlags.canCut) },
      { role: 'copy', label: labels.copy, enabled: Boolean(editFlags.canCopy) },
      { role: 'paste', label: labels.paste, enabled: Boolean(editFlags.canPaste) },
      { role: 'delete', label: labels.delete, enabled: Boolean(editFlags.canDelete) },
      { type: 'separator' },
      { role: 'selectAll', label: labels.selectAll, enabled: Boolean(editFlags.canSelectAll) },
    );
    return items;
  }

  items.push({
    role: 'copy',
    label: labels.copy,
    enabled: editFlags.canCopy !== false,
  });
  if (editFlags.canSelectAll) {
    items.push({
      role: 'selectAll',
      label: labels.selectAll,
      enabled: true,
    });
  }
  return items;
}

export function bindNativeEditContextMenu(
  webContents: NativeEditContextMenuWebContentsLike,
  options: {
    readonly isWindowDestroyed: () => boolean;
    readonly popupMenu: (template: MenuItemConstructorOptions[]) => void;
    readonly getLocale?: () => NativeEditContextMenuLocale;
  },
): () => void {
  const handleContextMenu = (_event: unknown, params: NativeEditContextMenuParams) => {
    if (options.isWindowDestroyed() || webContents.isDestroyed()) return;
    const template = buildNativeEditContextMenuTemplate(
      params,
      {
        replaceMisspelling: (suggestion) => {
          if (!webContents.isDestroyed()) {
            webContents.replaceMisspelling(suggestion);
          }
        },
        addWordToDictionary: (word) => {
          if (!webContents.isDestroyed()) {
            webContents.session.addWordToSpellCheckerDictionary(word);
          }
        },
      },
      options.getLocale?.() ?? 'en',
    );
    if (template.length === 0) return;
    options.popupMenu(template);
  };

  webContents.on('context-menu', handleContextMenu);
  return () => {
    if (!webContents.isDestroyed()) {
      webContents.removeListener('context-menu', handleContextMenu);
    }
  };
}
