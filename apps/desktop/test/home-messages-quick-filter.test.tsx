/**
 * Home messages quick filter menu under a live DOM.
 *
 * Kit overlays portal through Radix, whose layout effect binds at import
 * time, so jsdom globals are installed before the view is imported.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import type { HomeMessageCardContext } from '../src/shell/renderer/features/home/home-message-card.js';
import type { HomeMessages } from '../src/shell/renderer/features/home/home-messages-controller.js';
import type { HomeMessage } from '../src/shell/renderer/features/home/home-messages-model.js';

const noop = () => undefined;
const PARENTOS = { kind: 'app', sourceRef: 'src_parentos', appId: 'app.nimi.parentos', displayName: 'ParentOS', available: true } as const;
const RUNTIME = { kind: 'runtime-agent', sourceRef: 'src_runtime', appId: null, displayName: null, available: true } as const;

function record(n: number, overrides: Partial<NimiAppActivityRecord> = {}): NimiAppActivityRecord {
  const at = new Date(2026, 8, 23, 10, n).toISOString();
  return {
    activityId: `act_${String(n).padStart(26, '0')}`,
    source: PARENTOS,
    key: `growth-${n}`,
    revision: 1,
    kind: 'todo',
    todoState: 'open',
    attention: true,
    title: `Growth record ${n}`,
    summary: `Round ${n}`,
    objectRef: `reminder:${n}`,
    type: 'app.nimi.parentos.growth-reminder.v1',
    data: null,
    agent: null,
    occurredAt: at,
    publishedAt: at,
    updatedAt: at,
    changeSeq: String(n),
    userView: { readThroughRevision: 0, unread: true, needsAttention: true },
    ...overrides,
  };
}

function messages(all: HomeMessage[]): HomeMessages {
  const records = all.flatMap((message) => (message.sourceKind === 'app' || message.sourceKind === 'runtime-agent' ? [message.record] : []));
  const view = { status: 'ready' as const, complete: true, hasMore: false, error: null };
  return {
    messages: all,
    homeMessages: all,
    offHomeCount: 0,
    app: {
      pending: { ...view, records: records.filter((item) => item.todoState === 'open') },
      recent: { ...view, records },
      busy: {},
      notices: {},
      open: noop,
      markRead: noop,
      retry: noop,
      loadMore: noop,
    },
    realm: {
      status: 'ready',
      posts: [],
      stale: false,
      hasMore: false,
      loadingMore: false,
      loadMoreFailed: false,
      loadMore: noop,
      retry: noop,
    },
    preferences: {
      state: { status: 'ready', preferences: { version: 1, hiddenActivities: {}, hiddenRealmPosts: [], appSourcesOffHome: [], realmPostsOnHome: true } },
      saving: false,
      saveFailed: false,
      apply: async () => true,
      retrySave: noop,
      reload: noop,
    },
    placement: () => 'shown',
    open: noop,
    markRead: noop,
    hide: noop,
    showOnHome: noop,
  };
}

test('the quick filter menu applies one preset and names it under the toolbar', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  const values: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (/^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in values)) {
      values[name] = (dom.window as unknown as Record<string, unknown>)[name];
    }
  }
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { HomeMessagesColumn } = await import('../src/shell/renderer/features/home/home-messages-column.js');
  const { activityMessage } = await import('../src/shell/renderer/features/home/home-messages-model.js');
  await initI18n();
  await changeLocale('en');

  const growthOpen = activityMessage(record(1));
  const turn = activityMessage(record(4, {
    source: RUNTIME, kind: 'activity', todoState: null, objectRef: null, summary: null,
    type: 'nimi.runtime.agent-conversation.turn-completed.v1', agent: { agentRef: 'agr_qilan', displayName: 'Qilan' },
  }));
  const cardContext: HomeMessageCardContext = {
    now: new Date(2026, 8, 23, 15, 0, 0),
    busy: {},
    notices: {},
    appIconUrl: () => null,
    canHide: true,
    onOpen: noop,
    onMarkRead: noop,
    onHide: noop,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const openMenu = async () => {
    const trigger = dom.window.document.querySelector<HTMLElement>('[data-testid="home-messages-filter"]');
    assert.ok(trigger, 'expected the filter trigger');
    await act(async () => trigger.click());
  };
  const menuItem = (label: string) => [...dom.window.document.querySelectorAll('[role="menuitem"]')]
    .find((item) => item.textContent === label);
  const cardShown = (key: string) => Boolean(dom.window.document.querySelector(`[data-testid="home-message:${key}"]`));
  // Kit popovers unmount through an exit motion; wait it out before judging.
  const settle = async (ms = 600) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <DesktopI18nResourceProvider resource={productionDesktopI18n}>
            <HomeMessagesColumn
              messages={messages([growthOpen, turn])}
              context={cardContext}
              onViewAll={noop}
            />
          </DesktopI18nResourceProvider>
        </QueryClientProvider>,
      );
    });
    const { document } = dom.window;
    assert.ok(cardShown(growthOpen.key) && cardShown(turn.key));
    await openMenu();
    assert.ok(menuItem('All')?.querySelector('svg'), 'the active preset carries the check');
    assert.ok(!menuItem('Unread')?.querySelector('svg'), 'inactive presets carry no check');
    assert.ok(menuItem('Pending') && menuItem('Messages only') && menuItem('Items only'), 'every preset is listed');
    assert.ok(document.querySelector('[role="separator"]'), 'activity presets sit behind a separator');
    assert.equal(menuItem('View activity'), undefined, 'the filter menu has no activity navigation');
    assert.equal(menuItem('Message settings'), undefined, 'settings remain in the message center');
    await act(async () => { (menuItem('Unread') as HTMLElement).click(); });
    assert.ok(cardShown(growthOpen.key) && cardShown(turn.key), 'unread app items stay');
    assert.equal(menuItem('Activity only'), undefined, 'the deferred Post filter is absent');
    assert.ok(document.querySelector('[role="status"]')?.textContent?.includes('Unread'), 'the active preset is named under the toolbar');
    assert.ok(document.querySelector('[data-testid="home-messages-filter"]')?.getAttribute('aria-label')?.includes('active'), 'the trigger marks the active filter');
    await settle();
    assert.ok(!document.querySelector('[role="menuitem"]'), 'choosing a preset closes the menu');
    await openMenu();
    assert.ok(menuItem('Unread')?.querySelector('svg'), 'the check follows the active preset');
    await act(async () => { (menuItem('All') as HTMLElement).click(); });
    assert.ok(cardShown(growthOpen.key) && cardShown(turn.key), 'all messages restores every source');
    assert.ok(!document.querySelector('[role="status"]'), 'no preset label once the filter is cleared');
    await settle();
    await openMenu();
    await act(async () => { (menuItem('Messages only') as HTMLElement).click(); });
    assert.ok(cardShown(turn.key));
    assert.ok(!cardShown(growthOpen.key));
    await settle();
  } finally {
    await act(async () => { root.unmount(); });
    // Radix focus scopes dispatch their unmount events on a timer; let them
    // land on jsdom before the Node globals come back.
    await new Promise((resolve) => setTimeout(resolve, 50));
    dom.window.close();
    client.clear();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
