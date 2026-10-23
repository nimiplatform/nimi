// @vitest-environment jsdom
import React, { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { nimiToast } from '@nimiplatform/kit/ui';
import { ItemRow } from '../src/nimiday/ui/item-row.js';
import { createItem } from '../src/nimiday/domain/items.js';
import { copyFor } from '../src/nimiday/i18n/index.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import type { DayStore } from '../src/nimiday/store/day-store.js';
import { createTestDayStore } from './persistence-fixture.js';

// Component regressions for save feedback and recovery, not supervised App acceptance.
const context = vi.hoisted(() => ({ store: null as DayStore | null, chat: vi.fn(), navigate: vi.fn() }));
vi.mock('../src/nimiday/app/context.js', () => ({
  useNimiDay: () => ({ copy: copyFor('zh'), store: context.store, actions: dayActions(context.store!), engine: { chat: context.chat }, navigate: context.navigate }),
  useDayStore: () => useSyncExternalStore(context.store!.subscribe, context.store!.getSnapshot),
  useDesk: () => ({ phase: 'ready', agent: { displayName: '助理' } }),
  useEngine: () => ({ now: new Date('2026-10-24T10:00:00Z'), changes: [] }),
  useCopy: () => copyFor('zh'),
}));
vi.mock('../src/nimiday/ui/ui-context.js', () => ({ useUi: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | undefined;
let el: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  el?.remove();
  context.store?.close();
  vi.restoreAllMocks();
  context.chat.mockReset();
  context.navigate.mockReset();
});

async function setup() {
  let writeGate: Promise<void> | null = null;
  const store = createTestDayStore({ read: async () => undefined, write: async () => { await writeGate; }, remove: async () => {} }, { language: () => 'zh' });
  context.store = store;
  await store.load();
  const item = createItem({ title: 'Choose', decision: { question: 'Which plan?', options: ['Plan A', 'Plan B'], choice: null } }, { by: 'agent', agentName: '助理', runId: null }, new Date());
  store.update(state => ({ ...state, items: [item] }), ['items']);
  await store.persist();
  const toast = vi.spyOn(nimiToast, 'show');
  toast.mockImplementation(() => 'test-toast');
  function Row() {
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return <ItemRow item={snapshot.state.items[0]!} />;
  }
  el = document.createElement('div'); document.body.append(el);
  root = createRoot(el);
  await act(async () => root!.render(<Row />));
  return { store, toast, gate: (promise: Promise<void> | null) => { writeGate = promise; } };
}

function button(label: string) {
  const found = [...el.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label);
  expect(found, `button ${label}`).toBeDefined();
  return found!;
}

it('announces a decision only after persistence, keeps follow-up reachable, and ignores an obsolete toast after reconsidering', async () => {
  const { store, toast, gate } = await setup();
  let release!: () => void;
  gate(new Promise<void>(resolve => { release = resolve; }));
  await act(async () => button('Plan A').click());
  expect(store.getSnapshot().unsaved).toBe(true);
  expect(toast).not.toHaveBeenCalled();
  await act(async () => release());
  expect(store.getSnapshot().unsaved).toBe(false);
  expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'success', message: '已选「Plan A」' }));
  expect(button('让 助理 接着安排')).toBeDefined();
  const oldAction = toast.mock.calls[0]![0].action!;
  await act(async () => button('重新选择').click());
  expect(button('Plan B')).toBeDefined();
  await act(async () => oldAction.onClick());
  expect(context.chat).not.toHaveBeenCalled();
});

it('reports a definite save refusal and only sends saved decisions to the assistant after an explicit retry', async () => {
  const { store, toast, gate } = await setup();
  let reject!: (error: Error) => void;
  gate(new Promise<void>((_, fail) => { reject = fail; }));
  await act(async () => button('Plan A').click());
  await act(async () => reject(Object.assign(new Error('storage quota exceeded'), { reasonCode: 'APP_STORAGE_QUOTA_EXCEEDED' })));
  expect(store.getSnapshot().saving).toBe('error');
  expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'warning', message: copyFor('zh').common.saveCapacityFailed }));
  expect(toast.mock.calls.some(([value]) => value.tone === 'success')).toBe(false);
  await act(async () => button('让 助理 接着安排').click());
  expect(context.chat).not.toHaveBeenCalled();
  gate(null);
  await act(async () => { await store.persist(); });
  expect(store.getSnapshot().unsaved).toBe(false);
  expect(button('让 助理 接着安排')).toBeDefined();
});

it('does not send a choice reconsidered while follow-up waits for persistence', async () => {
  const { store, gate } = await setup();
  await act(async () => button('Plan A').click());
  let release!: () => void;
  gate(new Promise<void>(resolve => { release = resolve; }));
  await act(async () => {
    store.update(state => ({ ...state, items: state.items.map(item => ({ ...item, notes: 'Updated notes' })) }), ['items']);
    button('让 助理 接着安排').click();
  });
  expect(store.getSnapshot().saving).toBe('saving');
  await act(async () => button('重新选择').click());
  await act(async () => release());
  expect(context.chat).not.toHaveBeenCalled();
  expect(store.getSnapshot().state.items[0]!.state).toBe('waiting');
});

it('preserves an uncertain decision in the window and requires reopening instead of retrying the same storage scope', async () => {
  const { store, toast, gate } = await setup();
  let reject!: (error: Error) => void;
  gate(new Promise<void>((_, fail) => { reject = fail; }));
  await act(async () => button('Plan A').click());
  await act(async () => reject(new Error('transport disconnected')));
  expect(store.getSnapshot()).toMatchObject({ saving: 'error', saveErrorKind: 'uncertain', unsaved: true, recoveryRequired: true });
  expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'warning', message: copyFor('zh').common.saveUncertain }));
  gate(null);
  await act(async () => button('让 助理 接着安排').click());
  expect(context.chat).not.toHaveBeenCalled();
  expect(store.getSnapshot().unsaved).toBe(true);
  expect(store.getSnapshot().state.items[0]!.decision!.choice).toBe('Plan A');
  expect(toast.mock.calls.some(([value]) => value.tone === 'success')).toBe(false);
});
