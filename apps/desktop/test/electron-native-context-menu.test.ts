import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindNativeEditContextMenu,
  buildNativeEditContextMenuTemplate,
  type NativeEditContextMenuParams,
} from '../src-electron/context-menu-template.js';

function makeParams(overrides: Partial<NativeEditContextMenuParams> = {}): NativeEditContextMenuParams {
  return {
    isEditable: false,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canDelete: false,
      canSelectAll: false,
      canEditRichly: false,
    },
    ...overrides,
  };
}

test('returns empty template for blank non-editable targets', () => {
  assert.deepEqual(buildNativeEditContextMenuTemplate(makeParams()), []);
  assert.deepEqual(buildNativeEditContextMenuTemplate(makeParams({ selectionText: '   \n\t  ' })), []);
});

test('builds copy-only menu for read-only non-empty selection', () => {
  const template = buildNativeEditContextMenuTemplate(
    makeParams({
      isEditable: false,
      selectionText: 'Hello Nimi',
      editFlags: { ...makeParams().editFlags, canCopy: true, canSelectAll: true },
    }),
    {},
    'zh',
  );
  assert.deepEqual(
    template.map((item) => ({ role: item.role, label: item.label, enabled: item.enabled })),
    [
      { role: 'copy', label: '复制', enabled: true },
      { role: 'selectAll', label: '全选', enabled: true },
    ],
  );
});

test('builds full native edit menu with spelling suggestions and editFlags gating', () => {
  const replaced: string[] = [];
  const added: string[] = [];
  const template = buildNativeEditContextMenuTemplate(
    makeParams({
      isEditable: true,
      selectionText: 'helo',
      misspelledWord: 'helo',
      dictionarySuggestions: ['hello', 'halo', 'help', 'helm', 'held', 'ignored-sixth'],
      editFlags: {
        ...makeParams().editFlags,
        canUndo: true,
        canRedo: false,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canDelete: true,
        canSelectAll: true,
      },
    }),
    {
      replaceMisspelling: (word) => replaced.push(word),
      addWordToDictionary: (word) => added.push(word),
    },
    'en',
  );

  // Up to 5 suggestions + add to dictionary + separator + standard edit items
  const suggestionItems = template.slice(0, 5);
  assert.deepEqual(suggestionItems.map((item) => item.label), ['hello', 'halo', 'help', 'helm', 'held']);
  suggestionItems[0]?.click?.({} as never, undefined, {} as never);
  assert.deepEqual(replaced, ['hello']);

  assert.equal(template[5]?.label, 'Add "helo" to dictionary');
  template[5]?.click?.({} as never, undefined, {} as never);
  assert.deepEqual(added, ['helo']);

  const roles = template.filter((item) => item.role).map((item) => ({ role: item.role, enabled: item.enabled }));
  assert.deepEqual(roles, [
    { role: 'undo', enabled: true },
    { role: 'redo', enabled: false },
    { role: 'cut', enabled: true },
    { role: 'copy', enabled: true },
    { role: 'paste', enabled: true },
    { role: 'delete', enabled: true },
    { role: 'selectAll', enabled: true },
  ]);
});

test('bindNativeEditContextMenu pops up menu for editable targets and suppresses blank clicks', () => {
  let listener: ((event: unknown, params: NativeEditContextMenuParams) => void) | undefined;
  const popped: number[] = [];
  const replaced: string[] = [];
  const added: string[] = [];
  const webContents = {
    isDestroyed: () => false,
    on: (_event: 'context-menu', fn: (event: unknown, params: NativeEditContextMenuParams) => void) => {
      listener = fn;
    },
    removeListener: (_event: 'context-menu', fn: (event: unknown, params: NativeEditContextMenuParams) => void) => {
      if (listener === fn) listener = undefined;
    },
    replaceMisspelling: (word: string) => { replaced.push(word); },
    session: {
      addWordToSpellCheckerDictionary: (word: string) => {
        added.push(word);
        return true;
      },
    },
  };

  const dispose = bindNativeEditContextMenu(webContents, {
    isWindowDestroyed: () => false,
    getLocale: () => 'zh',
    popupMenu: (template) => {
      popped.push(template.length);
      template[0]?.click?.({} as never, undefined, {} as never);
    },
  });

  assert.ok(listener);
  listener!({}, makeParams());
  assert.deepEqual(popped, [], 'non-editable blank target must not open a popup menu');

  listener!({}, makeParams({
    isEditable: true,
    misspelledWord: 'teh',
    dictionarySuggestions: ['the'],
    editFlags: { ...makeParams().editFlags, canPaste: true, canSelectAll: true },
  }));
  assert.equal(popped.length, 1);
  assert.deepEqual(replaced, ['the']);
  assert.deepEqual(added, []);

  dispose();
  assert.equal(listener, undefined);
});
