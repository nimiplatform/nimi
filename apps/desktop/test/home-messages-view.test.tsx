import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import type { NimiAppActivityRecord, NimiAppActivityViewSnapshot } from '@nimiplatform/sdk/app';
import { changeLocale, i18n, initI18n, productionDesktopI18n } from '../src/shell/renderer/i18n';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context.js';
import type { HomeMessageCardContext } from '../src/shell/renderer/features/home/home-message-card.js';
import { HomeMessageCenter, messageSourceOptions } from '../src/shell/renderer/features/home/home-message-center.js';
import { HomeMessagesColumn } from '../src/shell/renderer/features/home/home-messages-column.js';
import type { HomeMessagePlacement, HomeMessages } from '../src/shell/renderer/features/home/home-messages-controller.js';
import {
  activityMessage,
  realmPostMessage,
  systemMessage,
  type HomeMessage,
  type HomeMessageFilter,
} from '../src/shell/renderer/features/home/home-messages-model.js';
import { DEFAULT_HOME_MESSAGE_PREFERENCES } from '../src/shell/renderer/features/home/home-messages-preferences.js';
import { HomeMessagesSettingsView } from '../src/shell/renderer/features/settings/settings-home-messages-section.js';
import { DesktopMotionProvider } from '../src/shell/renderer/ui/motion/desktop-motion-context.js';

(globalThis as { React?: typeof React }).React = React;

const NOW = new Date(2026, 8, 23, 15, 0, 0);
const PARENTOS = { kind: 'app', sourceRef: 'src_parentos', appId: 'app.nimi.parentos', displayName: 'ParentOS', available: true } as const;
const SHIJING = { kind: 'app', sourceRef: 'src_shijing', appId: 'app.nimi.shijing', displayName: 'ShiJing', available: true } as const;
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
    data: { secret: 'publisher-owned' },
    agent: null,
    occurredAt: at,
    publishedAt: at,
    updatedAt: at,
    changeSeq: String(n),
    userView: { readThroughRevision: 0, unread: true, needsAttention: true },
    ...overrides,
  };
}

function view(records: NimiAppActivityRecord[], overrides: Partial<NimiAppActivityViewSnapshot> = {}): NimiAppActivityViewSnapshot {
  return { status: 'ready', records, complete: true, hasMore: false, error: null, ...overrides };
}

const noop = () => undefined;

function controller(input: {
  messages: HomeMessage[];
  homeMessages?: HomeMessage[] | null;
  offHomeCount?: number;
  pending?: NimiAppActivityViewSnapshot;
  recent?: NimiAppActivityViewSnapshot;
  realm?: Partial<HomeMessages['realm']>;
  preferencesStatus?: 'loading' | 'ready' | 'unavailable';
  placement?: (message: HomeMessage) => HomeMessagePlacement;
  onLoadMore?: (key: 'pending' | 'recent') => void;
}): HomeMessages {
  const records = input.messages.flatMap((message) => (message.sourceKind === 'app' || message.sourceKind === 'runtime-agent' ? [message.record] : []));
  const status = input.preferencesStatus ?? 'ready';
  return {
    messages: input.messages,
    homeMessages: input.homeMessages === undefined ? input.messages : input.homeMessages,
    offHomeCount: input.offHomeCount ?? 0,
    app: {
      pending: input.pending ?? view(records.filter((item) => item.todoState === 'open')),
      recent: input.recent ?? view(records),
      busy: {},
      notices: {},
      open: noop,
      markRead: noop,
      retry: noop,
      loadMore: input.onLoadMore ?? noop,
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
      ...input.realm,
    },
    preferences: {
      state: status === 'ready' ? { status, preferences: DEFAULT_HOME_MESSAGE_PREFERENCES } : { status },
      saving: false,
      saveFailed: false,
      apply: async () => true,
      retrySave: noop,
      reload: noop,
    },
    placement: input.placement ?? (() => 'shown'),
    open: noop,
    markRead: noop,
    hide: noop,
    showOnHome: noop,
  };
}

function context(overrides: Partial<HomeMessageCardContext> = {}): HomeMessageCardContext {
  return {
    now: NOW,
    busy: {},
    notices: {},
    appIconUrl: () => null,
    canHide: true,
    onOpen: noop,
    onMarkRead: noop,
    onHide: noop,
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return <DesktopI18nResourceProvider resource={productionDesktopI18n}>{node}</DesktopI18nResourceProvider>;
}

/** The markup of one card, from its test id to the end of its article. */
function cardHtml(html: string, key: string): string {
  const start = html.indexOf(`data-testid="home-message:${key}"`);
  assert.ok(start >= 0, `expected card ${key}`);
  return html.slice(start, html.indexOf('</article>', start));
}

function renderColumn(messages: HomeMessages, cardContext = context()) {
  return renderToStaticMarkup(wrap(
    <HomeMessagesColumn
      messages={messages}
      context={cardContext}
      onViewAll={noop}
      onViewPending={noop}
      onViewActivity={noop}
      onOpenSettings={noop}
    />,
  ));
}

function renderCenter(messages: HomeMessages, filter: HomeMessageFilter = 'all', sourceKey: string | null = null) {
  return renderToStaticMarkup(wrap(
    <HomeMessageCenter
      messages={messages}
      context={context()}
      filter={filter}
      sourceKey={sourceKey}
      onFilterChange={noop}
      onSourceChange={noop}
      onBack={noop}
      onOpenSettings={noop}
    />,
  ));
}

const growthOpen = activityMessage(record(1));
const growthRead = activityMessage(record(2, { userView: { readThroughRevision: 1, unread: false, needsAttention: false } }));
const rijing = activityMessage(record(3, {
  source: SHIJING, kind: 'activity', todoState: null, objectRef: null, title: 'Daily mirror for Sep 23',
  summary: 'Geng-Zi day · Bazi', type: 'app.nimi.shijing.rijing.v1',
}));
const turn = activityMessage(record(4, {
  source: RUNTIME, kind: 'activity', todoState: null, objectRef: null, summary: null,
  type: 'nimi.runtime.agent-conversation.turn-completed.v1', agent: { agentRef: 'agr_qilan', displayName: 'Qilan' },
}));
const agentPost = realmPostMessage({
  id: 'post_1', authorKind: 'personaCharacter', authorRef: 'persona_qilan', authorName: 'Qilan', authorAvatarUrl: null,
  caption: 'Practised calligraphy this afternoon.', createdAt: new Date(2026, 8, 22, 21, 5).toISOString(), media: [],
});
const download = systemMessage({
  kind: 'download', id: 'install-1', title: 'Qwen3 8B', detail: '2.1 GB / 4.9 GB',
  progress: { value: 43, max: 100 }, time: new Date(2026, 8, 20).toISOString(), app: null, open: noop,
});

test('Home shows one Messages list: system first, stacked source groups, and only real actions', async () => {
  await initI18n(); await changeLocale('en');
  const html = renderColumn(controller({
    messages: [growthOpen, growthRead, rijing, turn, agentPost, download],
    pending: view([growthOpen.record, growthRead.record], { complete: false, hasMore: true }),
  }));
  assert.match(html, /data-testid="home-messages"/);
  assert.ok(html.indexOf('home-message:system:download:install-1') < html.indexOf('home-message-stack:app:src_parentos'), 'work in progress leads');
  assert.match(html, /data-testid="home-message-stack:app:src_parentos"/);
  assert.match(html, /1 more · Expand/);
  assert.match(html, />43%</, 'download progress comes from real totals');
  assert.match(html, /3\+ pending/, 'an incomplete open-todo listing never claims a total');
  // ShiJing and Runtime summaries have no open target; the Realm Post opens that Post.
  assert.doesNotMatch(cardHtml(html, rijing.key), />Open</);
  assert.match(cardHtml(html, rijing.key), /Mark as read/);
  assert.doesNotMatch(cardHtml(html, turn.key), />Open</);
  assert.match(cardHtml(html, agentPost.key), /View post/);
  assert.match(html, /Runtime · Qilan/);
  assert.match(html, /Replied in a conversation/);
  assert.doesNotMatch(html, /publisher-owned/, 'publisher data is never parsed or shown');
  assert.equal((html.match(/aria-label="Hide from Home"/g) ?? []).length, 3, 'ShiJing, Runtime and Realm cards can be hidden');
  assert.match(html, /aria-label="Hide these 2 messages from Home"/, 'a stack hides its counted members');
  assert.match(html, /View all messages/);
  assert.match(html, /View activity/);
  assert.doesNotMatch(html, /runtimeConfig\.overview\./);
});

test('one unavailable source keeps the others and never claims an empty list', async () => {
  await initI18n(); await changeLocale('zh');
  const html = renderColumn(controller({
    messages: [agentPost],
    pending: view([], { status: 'unavailable', complete: false }),
    recent: view([], { status: 'unavailable', complete: false }),
  }));
  assert.match(html, /data-testid="home-messages-app-unavailable"/);
  assert.match(html, /暂时无法读取应用消息/);
  assert.match(html, /其他来源照常显示。/);
  assert.match(html, /发布了动态/);
  assert.doesNotMatch(html, /没有消息/);
});

test('Home limits item and Activity previews independently', async () => {
  await initI18n(); await changeLocale('en');
  const items = Array.from({ length: 6 }, (_, index) => activityMessage(record(index + 10, {
    source: { ...PARENTOS, sourceRef: `src_${index}`, appId: `app.example.${index}` },
  })));
  const html = renderColumn(controller({ messages: [...items, agentPost] }));
  assert.match(cardHtml(html, agentPost.key), /Practised calligraphy/);
  assert.equal(items.filter((item) => html.includes(`data-testid="home-message:${item.key}"`)).length, 5);
  assert.doesNotMatch(html, /No activity yet/);
});

test('Home empty states distinguish hidden, complete and not yet loaded', async () => {
  await initI18n(); await changeLocale('zh');
  const hidden = renderColumn(controller({ messages: [growthOpen], homeMessages: [], offHomeCount: 1 }));
  assert.match(hidden, /首页消息已隐藏，可在消息中心查看。/);
  const empty = renderColumn(controller({ messages: [] }));
  assert.match(empty, /暂无消息与事项/);
  assert.match(empty, /暂无动态/);
  const partial = renderColumn(controller({ messages: [], realm: { hasMore: true } }));
  assert.match(partial, /尚未加载到匹配事项/);
  assert.doesNotMatch(partial, /没有消息/);
  const loading = renderColumn(controller({ messages: [growthOpen], homeMessages: null, preferencesStatus: 'loading' }));
  assert.doesNotMatch(loading, /data-testid="home-message-stack/, 'no card flashes before display preferences are known');
  assert.match(loading, /data-testid="home-messages-view-activity"/, 'Activity stays reachable while display preferences load');
  assert.doesNotMatch(loading, /暂无消息与事项|暂无动态/);
  const unreadable = renderColumn(controller({ messages: [growthOpen], preferencesStatus: 'unavailable' }), context({ canHide: false }));
  assert.match(unreadable, /data-testid="home-messages-preferences-unavailable"/);
  assert.match(unreadable, /身高|Growth record 1/, 'messages stay visible when preferences cannot be read');
  assert.doesNotMatch(unreadable, /从首页隐藏/);
});

test('the center reads summaries in full, keeps read and hidden open todos pending, and states completeness', async () => {
  await initI18n(); await changeLocale('en');
  const longSummary = 'Two articles about walking cities were finished. '.repeat(12).trim();
  const reading = activityMessage(record(5, {
    source: SHIJING, kind: 'activity', todoState: null, objectRef: null, title: 'Weekly reading review', summary: longSummary,
  }));
  const hiddenOpen = activityMessage(record(6));
  const all = renderCenter(controller({ messages: [reading, growthRead, hiddenOpen, agentPost] }));
  assert.ok(all.includes(longSummary), 'the whole summary is rendered');
  assert.doesNotMatch(all, /line-clamp-3/);
  const pending = renderCenter(controller({
    messages: [reading, growthRead, hiddenOpen, agentPost],
    placement: (message) => (message.key === hiddenOpen.key ? 'hidden' : message.key === growthRead.key ? 'source-off' : 'shown'),
    pending: view([growthRead.record, hiddenOpen.record], { complete: false, hasMore: true }),
  }), 'pending');
  assert.match(pending, /Pending 2\+/);
  assert.match(pending, /Growth record 2/);
  assert.match(pending, /Growth record 6/);
  assert.doesNotMatch(pending, /Weekly reading review|Practised calligraphy/, 'summaries and Posts are never pending');
  assert.match(pending, /Hidden from Home/);
  assert.match(pending, /Show on Home/);
  assert.match(pending, /This source is hidden from Home/);
  assert.match(pending, /Message settings/);
  assert.match(pending, /Load more app messages/);
  assert.doesNotMatch(pending, /Load more posts/, 'Pending never loads Realm posts');
});

test('center empty results are definite only after the relevant listing is complete', async () => {
  await initI18n(); await changeLocale('en');
  const incomplete = renderCenter(controller({
    messages: [rijing],
    pending: view([], { complete: false, hasMore: true }),
  }), 'pending');
  assert.match(incomplete, /No matching items loaded yet/);
  assert.doesNotMatch(incomplete, /Nothing pending/);
  const complete = renderCenter(controller({ messages: [rijing] }), 'pending');
  assert.match(complete, /Nothing pending/);
  const posts = renderCenter(controller({ messages: [], realm: { hasMore: true } }), 'all', 'realm-author:personaCharacter:persona_qilan');
  assert.match(posts, /Load more posts/);
  assert.match(posts, /No matching items loaded yet/);
});

test('same-named registrations stay distinct source options', async () => {
  await initI18n(); await changeLocale('en');
  const t = i18n.t.bind(i18n) as never;
  const current = activityMessage(record(7, { source: { ...PARENTOS, sourceRef: 'src_rws_now', appId: 'app.rws', displayName: 'Realm World Studio' } }));
  const previous = activityMessage(record(8, { source: { ...PARENTOS, sourceRef: 'src_rws_old', appId: 'app.rws', displayName: 'Realm World Studio', available: false } }));
  const options = messageSourceOptions([current, previous], t);
  assert.deepEqual(options.map((option) => option.value).sort(), ['app:src_rws_now', 'app:src_rws_old']);
  assert.equal(new Set(options.map((option) => option.label)).size, 2);
  assert.ok(options.some((option) => option.label === 'Realm World Studio (unavailable)'));
});

test('Settings can reach an off-Home source beyond the first activity page without claiming no sources', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  const values = { window: dom.window, document: dom.window.document, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  await initI18n(); await changeLocale('en');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const changes: unknown[] = [];
  const preferences: HomeMessages['preferences'] = {
    ...controller({ messages: [] }).preferences,
    state: { status: 'ready', preferences: { ...DEFAULT_HOME_MESSAGE_PREFERENCES, appSourcesOffHome: [PARENTOS.sourceRef] } },
    apply: async (change) => { changes.push(change); return true; },
  };
  let loadMoreCalls = 0;
  const render = (complete: boolean, hasSource = false) => wrap(
    <DesktopMotionProvider>
      <HomeMessagesSettingsView
        preferences={preferences}
        sources={hasSource ? [{ sourceRef: PARENTOS.sourceRef, label: PARENTOS.displayName, available: true }] : []}
        sourcesStatus="ready"
        sourcesComplete={complete}
        hasMoreSources={!complete}
        onLoadMoreSources={() => { loadMoreCalls += 1; }}
        onRetrySources={noop}
      />
    </DesktopMotionProvider>,
  );
  try {
    // A first page of Runtime activity has no App sources, but the listing is incomplete.
    await act(async () => { root.render(render(false)); });
    assert.doesNotMatch(dom.window.document.body.textContent ?? '', /No app has published/);
    const loadMore = [...dom.window.document.querySelectorAll('button')].find((button) => button.textContent === 'Load more app sources');
    assert.ok(loadMore);
    await act(async () => { loadMore.click(); });
    assert.equal(loadMoreCalls, 1);
    await act(async () => { root.render(render(true, true)); });
    const sourceToggle = dom.window.document.querySelector('[role="switch"][aria-checked="false"]');
    assert.ok(sourceToggle, 'the previously hidden App source can be enabled after loading more');
    await act(async () => { sourceToggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    assert.deepEqual(changes, [{ kind: 'app-source', sourceRef: PARENTOS.sourceRef, onHome: true }]);
    await act(async () => { root.render(render(true)); });
    assert.match(dom.window.document.body.textContent ?? '', /No app has published messages yet/);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});

test('a collapsed stack only expands, and a group hide covers exactly its shown members', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  await initI18n(); await changeLocale('en');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const opened: HomeMessage[] = [];
  const hidden: (readonly HomeMessage[])[] = [];
  try {
    await act(async () => {
      root.render(wrap(
        <HomeMessagesColumn
          messages={controller({ messages: [growthOpen, growthRead, rijing] })}
          context={context({
            onOpen: (message) => opened.push(message),
            onHide: async (messages) => {
              hidden.push(messages);
              return true;
            },
          })}
          onViewAll={noop}
          onViewPending={noop}
          onViewActivity={noop}
          onOpenSettings={noop}
        />,
      ));
    });
    const { document } = dom.window;
    const stack = document.querySelector('[data-testid="home-message-stack:app:src_parentos"] button[aria-expanded="false"]');
    assert.ok(stack, 'expected the collapsed ParentOS stack');
    await act(async () => { stack.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    assert.equal(opened.length, 0, 'expanding never opens the source object');
    const group = document.querySelector('[data-testid="home-message-group:app:src_parentos"]');
    assert.ok(group, 'the group is expanded');
    assert.equal(document.activeElement?.textContent, 'Collapse', 'focus follows the replaced control');
    assert.equal(group.querySelectorAll('article').length, 2);
    const hideGroup = [...group.querySelectorAll('button')].find((button) => button.textContent === 'Hide these 2 messages from Home');
    assert.ok(hideGroup);
    await act(async () => { hideGroup.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    // Newest first: the group snapshot as shown, nothing that arrives later.
    assert.deepEqual(hidden.map((members) => members.map((message) => message.key)), [[growthRead.key, growthOpen.key]]);
    assert.equal(document.activeElement?.getAttribute('data-testid'), 'home-messages-list', 'a saved hide keeps focus in the list');
    const collapse = [...group.querySelectorAll('button')].find((button) => button.textContent === 'Collapse');
    await act(async () => { collapse!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    assert.ok(document.querySelector('[data-testid="home-message-stack:app:src_parentos"]'), 'collapsing restores the stack');
    assert.equal(document.activeElement?.getAttribute('aria-expanded'), 'false', 'focus returns to the stack');
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
