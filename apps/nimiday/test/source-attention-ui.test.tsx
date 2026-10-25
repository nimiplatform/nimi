// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceAttention } from '../src/nimiday/ui/source-attention.js';
import { SourceBrowser } from '../src/nimiday/ui/source-browser.js';
import { CarePage } from '../src/nimiday/ui/care-page.js';
import { createCircle, emptyState } from '../src/nimiday/domain/defaults.js';
import type { SourceChange } from '../src/nimiday/domain/sources.js';
import type { DayState } from '../src/nimiday/domain/types.js';
import type { NavTarget } from '../src/nimiday/platform/engine.js';
import { copyFor } from '../src/nimiday/i18n/index.js';

// These component regressions check presentation and routes; they are not App acceptance.
const context = vi.hoisted(() => ({ engine: {} as Record<string, unknown>, state: null as DayState | null, navigate: vi.fn(), retry: vi.fn() }));
vi.mock('../src/nimiday/app/context.js', () => ({
  useNimiDay: () => ({ copy: copyFor('zh'), navigate: context.navigate, activity: { retry: context.retry }, engine: {}, actions: {}, store: {} }),
  useDayStore: () => ({ state: context.state }),
  useEngine: () => context.engine,
  useDesk: () => ({ phase: 'unavailable' }),
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
  context.navigate.mockReset();
  context.state = emptyState('zh', new Date('2026-10-23T10:00:00Z'));
  context.engine = { changes: list, sourceChanges: list, sourceApps: [], activityStatus: 'ready', now: new Date('2026-10-23T10:00:00Z'),
    activityCoverage: { openTodos: 'complete', recent: 'complete', recentCount: list.length }, activityHasMore: false };
}
const containers: { root: ReturnType<typeof createRoot>; el: HTMLDivElement }[] = [];
async function render(element: React.ReactNode) {
  const el = document.createElement('div'); document.body.append(el);
  const root = createRoot(el); containers.push({ root, el });
  await act(async () => root.render(element)); return { root, el };
}
afterEach(async () => { for (const { root, el } of containers.splice(0)) { await act(async () => root.unmount()); el.remove(); } });

it('places care-circle navigation inside the content card without the page subtitle', async () => {
  const person = { ...createCircle({ kind: 'child', name: '林知遥' }, new Date('2026-10-23T10:00:00Z')), id: 'person-1' };
  reset([]);
  context.state = { ...context.state!, circles: [person] };
  const { el } = await render(<CarePage />);
  const content = el.querySelector('.nd-care-content')!;
  const contextHead = el.querySelector('.nd-care-context')!;
  const people = el.querySelector('.nd-care-people')!;
  const tabs = el.querySelector('.nd-care-tabs-row')!;
  const children = [...content.children];

  expect(el.querySelector('.nd-page-sub')).toBeNull();
  expect(el.textContent).not.toContain('照看重要的人，记住需要上心的事。');
  expect(el.querySelector('.nd-care-layout')).toBeNull();
  expect(content.parentElement).toBe(el.querySelector('[data-testid="nd-care"]'));
  expect(people.parentElement).toBe(content);
  expect(children.indexOf(people)).toBeGreaterThan(children.indexOf(contextHead));
  expect(children.indexOf(people)).toBeLessThan(children.indexOf(tabs));
});

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

it('opens a Today group in its person workspace and keeps the exact group inside the updates tab', async () => {
  const now = new Date('2026-10-23T10:00:00Z');
  const person = { ...createCircle({ kind: 'child', name: '林知遥' }, now), id: 'person-1' };
  const otherPerson = { ...createCircle({ kind: 'child', name: '林知遥' }, now), id: 'person-2' };
  const list = changes(1).map(change => ({ ...change, circleId: person.id }));
  const unrelatedGroup = { ...list[0]!, id: 'other-group', groupKey: 'other-source\0group', title: 'Other group' };
  const unrelatedPerson = { ...list[0]!, id: 'other-person', circleId: otherPerson.id, title: 'Other person' };
  reset([...list, unrelatedGroup, unrelatedPerson]);
  context.state = { ...context.state!, circles: [person, otherPerson] };
  function Journey() {
    const [nav, navigate] = useState<NavTarget>({ view: 'today' });
    context.navigate.mockImplementation(navigate);
    return nav.view === 'care' ? <CarePage circleId={nav.circleId} sources={nav.sources} /> : <SourceAttention />;
  }
  const { el } = await render(<Journey />);
  await act(async () => el.querySelector<HTMLButtonElement>('.nd-source-summary')!.click());
  expect(context.navigate).toHaveBeenCalledWith({ view: 'care', circleId: person.id, sources: { mode: 'pending', unitKey: expect.any(String) } });
  expect(el.querySelector('.nd-care-people')).not.toBeNull();
  expect(el.querySelector('.nd-care-context h2')!.textContent).toBe(person.name);
  expect(el.querySelectorAll('.nd-care-person')[1]!.getAttribute('aria-current')).toBe('true');
  expect(el.querySelectorAll('.nd-care-person')[2]!.getAttribute('aria-current')).toBeNull();
  expect(el.querySelector('#care-tab-changes')!.getAttribute('aria-selected')).toBe('true');
  const rows = () => [...el.querySelectorAll('#care-panel [data-activity-id]')].map(row => row.getAttribute('data-activity-id'));
  expect(rows()).toEqual(list.map(change => change.id));
  await act(async () => el.querySelector<HTMLButtonElement>('#care-tab-notes')!.click());
  expect(el.querySelector('[data-testid="nd-handbook"]')).not.toBeNull();
  await act(async () => el.querySelector<HTMLButtonElement>('#care-tab-changes')!.click());
  expect(rows()).toEqual(list.map(change => change.id));
  await act(async () => el.querySelector<HTMLButtonElement>('.nd-source-filter-scope button')!.click());
  expect(rows()).toContain('other-group');
  expect(rows()).not.toContain('other-person');
  // jsdom has no layout/scrolling; the real scroll is checked in App acceptance.
  Object.defineProperty(el.querySelector('[data-testid="nd-care"]')!, 'scrollIntoView', { value: vi.fn() });
  await act(async () => el.querySelectorAll<HTMLButtonElement>('.nd-care-person')[2]!.click());
  expect(context.navigate).toHaveBeenLastCalledWith({ view: 'care', circleId: otherPerson.id });
  expect(el.querySelector('.nd-source-filter-scope')).toBeNull();
  expect(rows()).toEqual(['other-person']);
});

it.each(['pending', 'association', 'dynamics'] as const)('keeps the Care workspace for a %s source entry and opens updates from another tab', async mode => {
  reset(changes(1));
  const { root, el } = await render(<CarePage />);
  await act(async () => el.querySelector<HTMLButtonElement>('#care-tab-notes')!.click());
  await act(async () => root.render(<CarePage sources={{ mode }} />));
  expect(el.querySelector('.nd-care-people')).not.toBeNull();
  expect(el.querySelector('#care-tab-changes')!.getAttribute('aria-selected')).toBe('true');
  expect(el.querySelector('#care-panel [data-testid="nd-source-browser"]')).not.toBeNull();
  expect(el.querySelector<HTMLSelectElement>('select[aria-label="显示范围"]')!.value).toBe(mode);
});

it('filters the visible care updates by search text and unread state', async () => {
  const now = new Date('2026-10-23T10:00:00Z');
  const person = { ...createCircle({ kind: 'child', name: '林知遥' }, now), id: 'person-1' };
  const list = changes(1).map((change, index) => ({ ...change, circleId: person.id, unread: index !== 1 }));
  reset(list);
  context.state = { ...context.state!, circles: [person] };
  const { el } = await render(<CarePage />);
  const rows = () => [...el.querySelectorAll('#care-panel [data-activity-id]')].map(row => row.getAttribute('data-activity-id'));
  const search = el.querySelector<HTMLInputElement>('.nd-care-update-search input')!;
  const filter = el.querySelector<HTMLButtonElement>('.nd-care-filter-button')!;
  const setSearch = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value);
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });

  expect(rows()).toHaveLength(6);
  await act(async () => filter.click());
  expect(filter.getAttribute('aria-pressed')).toBe('true');
  expect(rows()).toHaveLength(6);
  expect(rows()).not.toContain('a-1');
  await act(async () => filter.click());
  expect(filter.getAttribute('aria-pressed')).toBe('false');
  await setSearch('Item 1');
  expect(rows()).toEqual(['a-1']);
  await setSearch('missing');
  expect(rows()).toEqual([]);
  expect(el.textContent).toContain('没有找到匹配的动态');
  await setSearch('');
  expect(rows()).toHaveLength(6);
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
