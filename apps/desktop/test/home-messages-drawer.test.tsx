import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopAIExecutionRoute, type DesktopAIUsageSummary } from '@nimiplatform/sdk/runtime/generated';
import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import type { HomeMessageCardContext } from '../src/shell/renderer/features/home/home-message-card.js';
import type { HomeMessages } from '../src/shell/renderer/features/home/home-messages-controller.js';
import type { HomeMessage } from '../src/shell/renderer/features/home/home-messages-model.js';
import {
  getHomeMessagesDrawerOpen,
  setHomeMessagesDrawerOpen,
  subscribeHomeMessagesDrawer,
  toggleHomeMessagesDrawer,
} from '../src/shell/renderer/features/home/home-messages-drawer-state.js';
import { systemEntryDayRange } from '../src/shell/renderer/features/system-entry/system-entry-time.js';

const noop = () => undefined;
const PARENTOS = {
  kind: 'app',
  sourceRef: 'src_zhiyu',
  appId: 'app.nimi.zhiyu',
  displayName: '织羽',
  available: true,
} as const;

function makeRecord(n: number): NimiAppActivityRecord {
  const at = new Date(2026, 10, 21, 9, n).toISOString();
  return {
    activityId: `act_${String(n).padStart(26, '0')}`,
    source: PARENTOS,
    key: `chapter-${n}`,
    revision: 1,
    kind: 'todo',
    todoState: 'open',
    attention: true,
    title: `第三章分支待确认 ${n}`,
    summary: `分支 ${n}`,
    objectRef: `branch:${n}`,
    type: 'app.nimi.zhiyu.branch-todo.v1',
    data: null,
    agent: null,
    occurredAt: at,
    publishedAt: at,
    updatedAt: at,
    changeSeq: String(n),
    userView: { readThroughRevision: 0, unread: true, needsAttention: true },
  };
}

function makeMessages(all: HomeMessage[]): HomeMessages {
  const records = all.flatMap((message) =>
    message.sourceKind === 'app' || message.sourceKind === 'runtime-agent' ? [message.record] : [],
  );
  const view = { status: 'ready' as const, complete: true, hasMore: false, error: null };
  return {
    messages: all,
    systemSources: [],
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
      messages: [],
      busy: {},
      errors: {},
      open: noop,
      markRead: noop,
      notifications: {
        complete: true,
        hasMore: false,
        loading: false,
        failed: false,
        loadingMore: false,
        loadMore: noop,
        retry: noop,
      },
      requests: {
        complete: true,
        hasMore: false,
        loading: false,
        failed: false,
        loadingMore: false,
        loadMore: noop,
        retry: noop,
      },
    },
    preferences: {
      state: { status: 'ready', preferences: { hiddenActivities: {}, appSourcesOffHome: [] } },
      saving: false,
      saveFailed: false,
      apply: async () => true,
      retrySave: noop,
      reload: noop,
    },
    placement: () => 'shown',
    open: noop,
    markRead: noop,
    hide: async () => true,
    showOnHome: noop,
  };
}

test('home messages drawer state toggles cleanly and notifies subscribers', () => {
  setHomeMessagesDrawerOpen(false);
  const transitions: boolean[] = [];
  const unsubscribe = subscribeHomeMessagesDrawer(() => {
    transitions.push(getHomeMessagesDrawerOpen());
  });
  try {
    toggleHomeMessagesDrawer();
    assert.equal(getHomeMessagesDrawerOpen(), true);
    toggleHomeMessagesDrawer();
    assert.equal(getHomeMessagesDrawerOpen(), false);
    assert.deepEqual(transitions, [true, false]);
  } finally {
    unsubscribe();
    setHomeMessagesDrawerOpen(false);
  }
});

test('HomeMessagesDrawer renders pending items, quick preferences, and closes on View all or Permissions', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub,
    matchMedia: () => ({
      matches: true,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
    }),
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (/^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in values)) {
      values[name] = (dom.window as unknown as Record<string, unknown>)[name];
    }
  }
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { HomeMessagesDrawer } = await import('../src/shell/renderer/features/home/home-messages-drawer.js');
  const { activityMessage } = await import('../src/shell/renderer/features/home/home-messages-model.js');

  await initI18n();
  await changeLocale('zh');

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: noop });
  const bindings = { sdk: { appProduct: () => ({ storage: {} }) } } as never;
  const todoItem = activityMessage(makeRecord(1));
  const inbox = makeMessages([todoItem]);
  const cardContext: HomeMessageCardContext = {
    now: new Date(2026, 10, 21, 10, 0, 0),
    busy: {},
    notices: {},
    appIconUrl: () => null,
    canHide: true,
    onOpen: noop,
    onMarkRead: noop,
    onHide: noop,
  };

  const actions: string[] = [];
  const root = createRoot(dom.window.document.getElementById('root')!);

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <DesktopRendererBindingProvider bindings={bindings}>
            <AppStoreProvider store={store}>
              <DesktopI18nResourceProvider resource={productionDesktopI18n}>
                <HomeMessagesDrawer
                  open
                  messages={inbox}
                  context={cardContext}
                  onClose={() => actions.push('close')}
                  onViewAll={() => actions.push('viewAll')}
                  onOpenSettings={() => actions.push('settings')}
                  onOpenPermissions={() => actions.push('permissions')}
                />
              </DesktopI18nResourceProvider>
            </AppStoreProvider>
          </DesktopRendererBindingProvider>
        </QueryClientProvider>,
      );
    });

    const drawer = dom.window.document.querySelector('[data-testid="home-messages-drawer"]');
    assert.ok(drawer, 'expected the non-blocking right-edge messages side sheet');
    assert.equal(drawer.getAttribute('role'), 'complementary');
    assert.equal(dom.window.document.querySelector('.nimi-overlay-backdrop'), null, 'side sheet must not render a blocking backdrop scrim');
    const title = dom.window.document.getElementById(drawer.getAttribute('aria-labelledby') ?? '');
    assert.equal(title?.textContent, '消息与事项');
    assert.ok(drawer.contains(title));
    assert.match(drawer.textContent ?? '', /待处理 1/);
    assert.match(drawer.textContent ?? '', /第三章分支待确认 1/);

    const prefsToggle = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-testid="home-messages-drawer-preferences-toggle"]',
    );
    assert.ok(prefsToggle);
    await act(async () => prefsToggle.click());
    assert.ok(dom.window.document.querySelector('[data-testid="home-messages-drawer-preferences"]'));

    const viewAll = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="home-messages-drawer-view-all"]');
    assert.ok(viewAll);
    await act(async () => viewAll.click());
    assert.deepEqual(actions, ['close', 'viewAll']);

    await act(async () => {
      dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.deepEqual(actions, ['close', 'viewAll', 'close']);
  } finally {
    await act(async () => root.unmount());
    // Radix restores focus in a timer after unmount. Keep the test document alive for it.
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
    client.clear();
    store.navigation.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('HomeHostStatusCardView presents unified Pure Porcelain host gauges and today usage summary', async () => {
  (globalThis as { React?: typeof React }).React = React;
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { HomeHostStatusCardView } = await import('../src/shell/renderer/features/home/home-host-status-card.js');
  await initI18n();
  await changeLocale('zh');

  const range = systemEntryDayRange(Date.UTC(2026, 10, 21, 2, 0, 0), 'Asia/Shanghai');
  const summary: DesktopAIUsageSummary = {
    fromTime: range.fromTime,
    toTime: range.toTime,
    readAt: range.toTime,
    coverageFrom: range.fromTime,
    coverageTo: range.toTime,
    sourceComplete: true,
    timeComplete: true,
    quantityComplete: true,
    groupsComplete: true,
    partialReasons: [],
    sourceCoverage: [{ source: 'app', activityComplete: true, usageComplete: true }],
    totals: { attemptCount: '0', pendingUsageCount: '0', unpricedAttemptCount: '0' },
    estimates: [],
    groups: [
      {
        sourceKind: 'app',
        capability: 'audio.synthesize',
        route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL,
        models: [],
        totals: { attemptCount: '0', pendingUsageCount: '0', unpricedAttemptCount: '0' },
        estimates: [],
      },
    ],
  };

  const GB = 1024 ** 3;
  const html = renderToStaticMarkup(
    <HomeHostStatusCardView
      runtime="ready"
      resources={{
        status: 'ready',
        snapshot: {
          cpuPercent: 7,
          memoryUsedBytes: 25.9 * GB,
          memoryTotalBytes: 32 * GB,
          memoryPressure: 'normal',
          diskUsedBytes: 375 * GB,
          diskTotalBytes: 500 * GB,
          capturedAtMs: Date.now(),
          source: 'test',
        },
      }}
      remote={{
        primaryState: 'other-pc',
        remoteEnabled: false,
        connectedClientCount: 0,
        pendingConfirmCount: 1,
      }}
      ai={{
        range,
        activity: { status: 'ready', value: null, error: null },
        usage: { status: 'ready', value: summary, error: null },
      }}
      cloudConnectorCount={3}
      onOpenDiagnostics={noop}
      onOpenConnections={noop}
      onOpenStorage={noop}
      onOpenUsageDetails={noop}
    />,
  );

  assert.match(html, /本机状态与用量/);
  assert.match(html, /7%/);
  assert.match(html, /81%/);
  assert.match(html, /75%/);
  assert.match(html, /已接入 3 个云服务 · 今日暂无 AI 调用/);
  assert.match(html, /data-testid="home-host-connections"/);
});
