// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceAttention } from '../src/nimiday/ui/source-attention.js';
import { SourceBrowser } from '../src/nimiday/ui/source-browser.js';
import { emptyState } from '../src/nimiday/domain/defaults.js';
import type { SourceChange } from '../src/nimiday/domain/sources.js';
import { copyFor } from '../src/nimiday/i18n/index.js';

// These component regressions check presentation and routes; they are not App acceptance.
const context = vi.hoisted(() => ({ engine: {} as Record<string, unknown>, navigate: vi.fn(), retry: vi.fn() }));
vi.mock('../src/nimiday/app/context.js', () => ({
  useNimiDay: () => ({ copy: copyFor('zh'), navigate: context.navigate, activity: { retry: context.retry }, engine: {}, actions: {}, store: {} }),
  useDayStore: () => ({ state: emptyState('zh', new Date('2026-10-23T10:00:00Z')) }),
  useEngine: () => context.engine,
}));
vi.mock('../src/nimiday/ui/ui-context.js', () => ({ useUi: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function changes(apps = 6): SourceChange[] {
  return Array.from({ length: apps * 10 }, (_, i) => ({
    id: `a-${i}`, appId: `app-${Math.floor(i / 10)}`, appName: `App ${Math.floor(i / 10)}`, type: 'reminder', nature: 'reminder',
    title: `Item ${i}`, summary: null, occurredAt: '2026-10-23T09:00:00Z', todoState: 'open', unread: true, needsAttention: false,
    sourceAvailable: true, openable: true, revision: 1, circleId: null, known: null, groupKey: `source-${Math.floor(i / 10)}\0group`,
  }));
}
function reset(list: SourceChange[]) {
  context.navigate.mockClear();
  context.engine = { sourceChanges: list, sourceApps: [], activityStatus: 'ready', now: new Date('2026-10-23T10:00:00Z'),
    activityCoverage: { openTodos: 'complete', recent: 'complete', recentCount: list.length }, activityHasMore: false };
}
const containers: { root: ReturnType<typeof createRoot>; el: HTMLDivElement }[] = [];
async function render(element: React.ReactNode) {
  const el = document.createElement('div'); document.body.append(el);
  const root = createRoot(el); containers.push({ root, el });
  await act(async () => root.render(element)); return { root, el };
}
afterEach(async () => { for (const { root, el } of containers.splice(0)) { await act(async () => root.unmount()); el.remove(); } });

it('uses exactly five units for a burst and routes a group to its exact complete-list selection', async () => {
  const list = changes();
  list.push({ ...list[0]!, id: 'unassociated', appId: 'nimi.parentos', groupKey: null });
  list.push({ ...list[0]!, id: 'news', nature: 'record', todoState: null });
  reset(list);
  const { el } = await render(<SourceAttention />);
  expect(el.querySelectorAll('[data-testid="nd-source-unit"]')).toHaveLength(5);
  expect(el.textContent).toContain('还有 30 项需要关注');
  await act(async () => el.querySelector<HTMLButtonElement>('.nd-source-summary')!.click());
  expect(context.navigate.mock.calls[0]![0]).toMatchObject({ view: 'care', sources: { mode: 'pending', unitKey: expect.any(String) } });
});

it('retains reading order until refresh while immediately hiding stale data on permission loss', async () => {
  reset(changes());
  const { root, el } = await render(<SourceAttention />);
  const previous = [...el.querySelectorAll('.nd-source-summary strong')].map(node => node.textContent);
  context.engine = { ...context.engine, sourceChanges: changes().map(change => ({ ...change, needsAttention: change.appId === 'app-5' })) };
  await act(async () => root.render(<SourceAttention />));
  expect([...el.querySelectorAll('.nd-source-summary strong')].map(node => node.textContent)).toEqual(previous);
  expect(el.querySelector('.nd-source-refresh')).not.toBeNull();
  await act(async () => el.querySelector<HTMLButtonElement>('.nd-source-refresh')!.click());
  expect(el.querySelector('.nd-source-summary strong')!.textContent).toContain('App 5');
  context.engine = { ...context.engine, activityStatus: 'no-access' };
  await act(async () => root.render(<SourceAttention />));
  expect(el.querySelectorAll('[data-testid="nd-source-unit"]')).toHaveLength(0);
  expect(el.textContent).not.toContain('Item');
});

it('keeps See all available when empty and never calls partial coverage an exact total', async () => {
  reset([]);
  context.engine = { ...context.engine, activityCoverage: { openTodos: 'partial', recent: 'partial', recentCount: 0 } };
  const { el } = await render(<SourceAttention />);
  expect(el.textContent).toContain('列表可能不全');
  await act(async () => [...el.querySelectorAll('button')].find(button => button.textContent === '查看全部')!.click());
  expect(context.navigate).toHaveBeenCalledWith({ view: 'care', sources: { mode: 'pending' } });
});

it('waits for the initial listing step before fixing the attention reading order', async () => {
  reset(changes(1));
  context.engine = { ...context.engine, activityCoverage: { openTodos: 'loading', recent: 'loading', recentCount: 10 } };
  const { root, el } = await render(<SourceAttention />);
  expect(el.querySelectorAll('[data-testid="nd-source-unit"]')).toHaveLength(1);
  context.engine = { ...context.engine, sourceChanges: changes(), activityCoverage: { openTodos: 'complete', recent: 'partial', recentCount: 60 } };
  await act(async () => root.render(<SourceAttention />));
  expect(el.querySelectorAll('[data-testid="nd-source-unit"]')).toHaveLength(3);
  expect(el.querySelector('.nd-source-refresh')).toBeNull();
});

it('shows all loaded sources with usable filters and separates unknown identities from association actions', async () => {
  const list = changes(1).map(change => ({ ...change, appId: 'nimi.parentos', groupKey: null, openable: false }));
  reset(list);
  const { el } = await render(<SourceBrowser target={{ mode: 'association' }} />);
  expect(el.querySelector('select[aria-label="显示范围"]')).not.toBeNull();
  expect(el.querySelector('input[type="search"]')).not.toBeNull();
  expect(el.textContent).toContain('无法确认来源孩子');
  expect([...el.querySelectorAll('button')].some(button => button.textContent === '关联孩子')).toBe(false);
  expect(el.querySelectorAll('[data-testid="nd-source-row"]')).toHaveLength(10);
});

it('keeps complete-list reading order across updates and new arrivals while removing terminal pending actions', async () => {
  const list = changes(1);
  reset(list);
  const { root, el } = await render(<SourceBrowser target={{ mode: 'pending' }} />);
  const titles = () => [...el.querySelectorAll('.nd-row-title')].map(node => node.textContent);
  const before = titles();
  const incoming = { ...list[0]!, id: 'a-000', title: 'New item', occurredAt: '2026-10-23T10:00:00Z' };
  context.engine = { ...context.engine, sourceChanges: [incoming, ...list.slice().reverse().map(change => ({ ...change, revision: 2 }))] };
  await act(async () => root.render(<SourceBrowser target={{ mode: 'pending' }} />));
  expect(titles()).toEqual([...before, 'New item']);
  context.engine = { ...context.engine, sourceChanges: list.map((change, index) => index === 0 ? { ...change, todoState: 'completed', openable: false } : change) };
  await act(async () => root.render(<SourceBrowser target={{ mode: 'pending' }} />));
  expect(titles()).toEqual(before.slice(1));
});
