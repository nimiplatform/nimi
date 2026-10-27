// @vitest-environment jsdom
import React, { act, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemEditor } from '../src/nimiday/ui/item-editor.js';
import type { ItemComposerState } from '../src/nimiday/ui/item-composer-state.js';
import { copyFor } from '../src/nimiday/i18n/index.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import type { DayStore } from '../src/nimiday/store/day-store.js';
import { createTestDayStore, readCollection } from './persistence-fixture.js';
import type { JsonDocumentStore } from '../src/nimiday/store/json-documents.js';

// Real form and store with a test document adapter. Supervised acceptance is separate.
const context = vi.hoisted(() => ({ store: null as DayStore | null }));
vi.mock('../src/nimiday/app/context.js', () => ({
  useNimiDay: () => ({ copy: copyFor('zh'), store: context.store, actions: dayActions(context.store!) }),
  useDayStore: () => useSyncExternalStore(context.store!.subscribe, context.store!.getSnapshot),
  useEngine: () => ({ now: new Date(), changes: [] }),
  useCopy: () => copyFor('zh'),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let el: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  el?.remove(); context.store?.close();
});
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(e => e.textContent === label || e.getAttribute('aria-label') === label);
  expect(found, label).toBeDefined(); return found!;
}
async function input(value: string) {
  const field = document.querySelector<HTMLInputElement>('[aria-label="要记的事"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}
async function setup() {
  const data = new Map<string, unknown>();
  let fail = false;
  let gate: Promise<void> | null = null;
  const documents: JsonDocumentStore = {
    read: async path => data.has(path) ? structuredClone(data.get(path)) : undefined,
    write: async (path, value) => {
      await gate;
      if (fail) throw Object.assign(new Error('operation temporarily unavailable'), { reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE' });
      data.set(path, structuredClone(value));
    },
    remove: async path => { data.delete(path); },
  };
  const store = createTestDayStore(documents, { language: () => 'zh' });
  context.store = store; await store.load(); await store.persist();
  const created = vi.fn();
  let saved: ItemComposerState | undefined;
  function Journey() {
    const [open, setOpen] = useState(true);
    return <><button onClick={() => setOpen(true)}>重新打开</button>{open ? <ItemEditor itemId={null}
      savedDraft={saved} onDraftChange={value => { saved = value ?? undefined; }} onCreated={created} onClose={() => setOpen(false)} /> : null}</>;
  }
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  await act(async () => root.render(<Journey />));
  return { store, documents, created, fail: (value: boolean) => { fail = value; }, gate: (value: Promise<void>) => { gate = value; } };
}

it('keeps the sentence and details after closing, and does not save while choosing an IME candidate', async () => {
  const { store } = await setup();
  const field = await input('买牛奶');
  await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
  expect(store.getSnapshot().state.items).toHaveLength(0);
  await act(async () => button('稍后继续').click());
  await act(async () => button('重新打开').click());
  expect(document.querySelector<HTMLInputElement>('[aria-label="要记的事"]')!.value).toBe('买牛奶');
  expect(document.querySelector<HTMLInputElement>('[placeholder="未定日期"]')!.value).toBe('');
  await act(async () => button('记下').click());
  expect(store.getSnapshot().state.items[0]).toMatchObject({ title: '买牛奶', date: null, time: null });
});

it('keeps failed saves open and retries the same item, confirming only after persistence', async () => {
  const { store, documents, created, fail } = await setup();
  await input('保存失败后重试');
  fail(true);
  await act(async () => button('记下').click());
  expect(created).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('尚未确认保存成功');
  expect(store.getSnapshot().state.items).toHaveLength(1);
  const id = store.getSnapshot().state.items[0]!.id;
  await act(async () => button('稍后继续').click());
  await act(async () => button('重新打开').click());
  await input('保存失败后修改再重试');
  fail(false);
  await act(async () => button('记下').click());
  expect(created).toHaveBeenCalledOnce();
  expect(await readCollection(documents, 'items')).toMatchObject([{ id, title: '保存失败后修改再重试' }]);
  expect(store.getSnapshot().state.items).toHaveLength(1);
});

it('prevents repeated submission while storage is pending', async () => {
  const { store, created, gate } = await setup();
  await input('只保存一次');
  let release!: () => void;
  gate(new Promise<void>(resolve => { release = resolve; }));
  const save = button('记下');
  await act(async () => { save.click(); save.click(); });
  expect(store.getSnapshot().state.items).toHaveLength(1);
  expect(created).not.toHaveBeenCalled();
  expect(save.disabled).toBe(true);
  await act(async () => release());
  expect(created).toHaveBeenCalledOnce();
});

it('does not announce completion from a storage session that has ended', async () => {
  const { store, created, gate } = await setup();
  await input('旧会话的事项');
  let release!: () => void;
  gate(new Promise<void>(resolve => { release = resolve; }));
  await act(async () => button('记下').click());
  await act(async () => { store.close(); release(); });
  expect(created).not.toHaveBeenCalled();
});
