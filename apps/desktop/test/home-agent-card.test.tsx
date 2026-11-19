import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import { HomeAgentCardView, type HomeAgentCardViewProps } from '../src/shell/renderer/features/home/home-agent-card.js';
import type { HomeRecentChatPartner } from '../src/shell/renderer/features/home/home-recent-conversations-model.js';

(globalThis as { React?: typeof React }).React = React;
const noop = () => undefined;
const PARTNERS: readonly HomeRecentChatPartner[] = [
  { localAgentRef: 'lumi', displayName: 'Lumi', avatarUrl: null, lastMessageText: '我们上次聊到的事情，还想继续吗？', conversationTitle: null, updatedAtMs: 1760614440000, hasUnread: false },
  { localAgentRef: 'aria', displayName: 'Aria', avatarUrl: null, lastMessageText: 'See you tomorrow', conversationTitle: null, updatedAtMs: 1760500000000, hasUnread: true },
  { localAgentRef: 'bo', displayName: 'Bo', avatarUrl: 'https://example.com/bo.png', lastMessageText: null, conversationTitle: null, updatedAtMs: null, hasUnread: false },
];
function view(overrides: Partial<HomeAgentCardViewProps> = {}) {
  const props: HomeAgentCardViewProps = {
    state: 'ready',
    partners: PARTNERS,
    partnersPending: false,
    selectedId: 'lumi',
    visibleCount: 8,
    stripRef: noop,
    formatTime: (ms) => `t:${ms}`,
    onSelectPartner: noop,
    draftText: '',
    onDraftChange: noop,
    onOpenChat: noop,
    onOpenPartner: noop,
    onOpenAll: noop,
    onExplore: noop,
    ...overrides,
  };
  return <HomeAgentCardView {...props} />;
}

function render(overrides: Partial<HomeAgentCardViewProps> = {}): string {
  return renderToStaticMarkup(view(overrides));
}

async function withMountedView(overrides: Partial<HomeAgentCardViewProps>, check: (document: Document) => void) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(view(overrides)); });
    // Radix Avatar mounts its fallback (containing MediaImage) after delayMs.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    check(dom.window.document);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('ready state renders the recent-chats header, compact strip, and one merged mini chat bar', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render();
  assert.match(html, /data-state="ready"/);
  assert.match(html, /data-testid="home-recent-chats-title">最近对话/);
  assert.match(html, /data-testid="home-recent-chats-open-all"[^>]*><span[^>]*>查看全部伙伴/);
  // The open-all action renders as a ghost button without a trailing chevron.
  assert.doesNotMatch(html, /lucide-chevron-right/);
  assert.match(html, /data-testid="home-recent-chat:lumi"/);
  assert.match(html, /data-testid="home-recent-chat:aria"/);
  assert.match(html, /data-testid="home-recent-chat:bo"/);
  assert.match(html, /data-testid="home-recent-chat:lumi"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="home-recent-chat:lumi"/);
  // Message preview and reply composer live in the same mini chat container.
  assert.match(html, /data-testid="home-mini-chat"[\s\S]*data-testid="home-recent-chat-preview"[\s\S]*data-testid="home-agent-composer"/);
  // Preview of the selected partner with its last message and formatted time.
  assert.match(html, /data-testid="home-agent-name">Lumi/);
  assert.match(html, /data-testid="home-recent-chat-message">我们上次聊到的事情，还想继续吗？/);
  assert.match(html, /data-testid="home-recent-chat-time">t:1760614440000/);
  // Reply composer targets the selected partner and submits via a single-line input (Enter).
  assert.match(html, /<label[^>]*for="home-agent-composer-input"/);
  assert.match(html, /<input[^>]*placeholder="回复 Lumi…"/);
  assert.match(html, /data-testid="home-agent-send"/);
  // The send button lives inside the composer capsule, right after the input.
  assert.match(html, /id="home-agent-composer-input"[^>]*>[\s\S]*?data-testid="home-agent-send"/);
  // With an empty draft the send button renders in the muted gray treatment.
  assert.match(html, /class="[^"]*--nimi-surface-active[^"]*--nimi-text-muted[^"]*"[^>]*data-testid="home-agent-send"/);
  assert.doesNotMatch(html, /当前伙伴|切换|去聊天|home-agent-switch|<textarea/);
});

test('recent chat avatars render Realm-managed images when the runtime URL is absent', async () => {
  await initI18n();
  for (const kind of ['avatar', 'portrait'] as const) {
    const purpose = kind === 'avatar' ? 'avatar' : 'card';
    const media: NonNullable<HomeRecentChatPartner['media']> = {
      assets: { avatar: null, portrait: null, referenceImage: null, profileCover: null, voiceSample: null,
        [kind]: { id: 'character-image', kind: 'image', externalUrl: null, delivery: {
          resourceId: 'character-image', contentVersion: 'a'.repeat(64), publicationGeneration: 1,
          policyVersion: 'v1', expiresAt: null, previewUrl: null, video: null,
          originalUrl: 'https://media.example/original.png',
          images: [{ purpose, families: [{ mimeType: 'image/webp', sources: [
            { url: 'https://media.example/character.webp', width: 96, height: 96, mimeType: 'image/webp' },
          ] }] }],
        } },
      },
      external: { avatarUrl: null, portraitUrl: null, referenceImageUrl: null, profileCoverUrl: null, voiceSampleUrl: null },
      unavailableResourceRefs: [],
    };
    await withMountedView({ partners: [{ ...PARTNERS[0]!, media }] }, document => {
      assert.equal(document.querySelector('[data-testid="home-recent-chats-strip"]'), null, 'a lone partner needs no switcher');
      const image = document.querySelector('[data-testid="home-recent-chat-preview"] img');
      assert.equal(image?.getAttribute('src'), 'https://media.example/character.webp');
      assert.equal(image?.getAttribute('alt'), 'Lumi');
      assert.equal(image?.getAttribute('sizes'), '34px');
      assert.ok(!document.body.innerHTML.includes('original.png'));
    });
  }
});

test('external artwork and missing-image initials preserve conversation actions', async () => {
  await initI18n();
  await withMountedView({}, document => {
    assert.equal(document.querySelector('[data-testid="home-recent-chat:bo"] img')?.getAttribute('src'), 'https://example.com/bo.png');
    const tile = document.querySelector('[data-testid="home-recent-chat:lumi"]');
    assert.equal(tile?.querySelector('img'), null);
    assert.equal(tile?.querySelector('[aria-hidden="true"]')?.textContent, 'L');
    assert.ok(document.querySelector('[data-testid="home-agent-send"]'));
  });
});

test('unread partners carry a dot on the avatar corner', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render();
  assert.match(html, /data-testid="home-recent-chat-unread:aria"/);
  assert.doesNotMatch(html, /data-testid="home-recent-chat-unread:lumi"/);
  assert.doesNotMatch(html, /data-testid="home-recent-chat-unread:bo"/);
});

test('the strip slices partner tiles to the measured visible count', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({ visibleCount: 2 });
  assert.match(html, /data-testid="home-recent-chat:lumi"/);
  assert.match(html, /data-testid="home-recent-chat:aria"/);
  assert.doesNotMatch(html, /data-testid="home-recent-chat:bo"/);
  // The selected partner stays previewable even when its tile is clipped.
  const clipped = render({ visibleCount: 1, selectedId: 'bo' });
  assert.doesNotMatch(clipped, /data-testid="home-recent-chat:aria"/);
  assert.match(clipped, /data-testid="home-agent-name">Bo/);
  assert.match(clipped, /No conversation yet/);
  assert.match(clipped, /placeholder="Reply to Bo…"/);
});

test('preview falls back to the conversation title, then to continue-chat guidance', async () => {
  await initI18n(); await changeLocale('zh');
  const titled = render({
    partners: [{ localAgentRef: 'mei', displayName: 'Mei', avatarUrl: null, lastMessageText: null, conversationTitle: '周末计划', updatedAtMs: 1760614440000, hasUnread: false }],
    selectedId: 'mei',
  });
  assert.match(titled, /data-testid="home-recent-chat-message">周末计划/);
  const textless = render({
    partners: [{ localAgentRef: 'mei', displayName: 'Mei', avatarUrl: null, lastMessageText: null, conversationTitle: null, updatedAtMs: 1760614440000, hasUnread: false }],
    selectedId: 'mei',
  });
  assert.match(textless, /data-testid="home-recent-chat-message">继续对话/);
  assert.doesNotMatch(textless, /还没有对话/);
  const unavailable = render({
    partners: [{ localAgentRef: 'mei', displayName: 'Mei', avatarUrl: null, lastMessageText: null, previewUnavailable: true, conversationTitle: null, updatedAtMs: null, hasUnread: false }],
    selectedId: 'mei',
  });
  assert.match(unavailable, /暂时无法读取对话预览/);
  assert.doesNotMatch(unavailable, /还没有对话/);
});

test('pending partners show a skeleton instead of a stale strip', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({ partners: [], partnersPending: true, selectedId: null });
  assert.match(html, /data-testid="home-recent-chats-title">Recent chats/);
  assert.doesNotMatch(html, /home-recent-chats-strip|home-agent-composer/);
});

test('no agent replaces the conversation action with explore guidance', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render({ state: 'none', partners: [], selectedId: null });
  assert.match(html, /还没有 Agent/);
  assert.match(html, /data-testid="home-agent-explore"/);
  assert.doesNotMatch(html, /home-agent-composer|data-testid="home-agent-send"|home-recent-chats-title/);
});

test('loading and unavailable states do not offer a conversation with stale agent data', async () => {
  await initI18n(); await changeLocale('en');
  for (const state of ['loading', 'unavailable'] as const) {
    const html = render({ state, partners: [], selectedId: null });
    assert.doesNotMatch(html, /home-agent-composer|data-testid="home-agent-send"|home-recent-chats-strip/);
    if (state === 'unavailable') assert.match(html, /Agent status is temporarily unavailable/);
  }
});


test('Home passes the complete unsent draft and leaves clearing to the source owner', async () => {
  await initI18n();
  const draft = '  Keep this text, including its spacing.  ';
  const opened: string[] = [];
  const edits: string[] = [];
  await withMountedView({ draftText: draft, onDraftChange: text => edits.push(text), onOpenChat: text => opened.push(text) }, document => {
    const input = document.querySelector<HTMLInputElement>('#home-agent-composer-input')!;
    assert.equal(input.value, draft);
    act(() => document.querySelector('form')!.dispatchEvent(new document.defaultView!.Event('submit', { bubbles: true, cancelable: true })));
    assert.deepEqual(opened, [draft]);
    assert.deepEqual(edits, []);
    assert.equal(input.value, draft);
  });
});

test('Home shortcut drafts keep their partner and account through navigation and an outage', async () => {
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { homePartnerDraftKey } = await import('../src/shell/renderer/features/home/home-partner-draft.js');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const first = JSON.stringify(['home', 'realm-a', 'local-agent:a']);
  const second = JSON.stringify(['home', 'realm-a', 'local-agent:b']);
  const read = (account: string, partner: string) => store.getState().homePartnerDrafts[homePartnerDraftKey(account, partner)!];
  const project = (account: string | null) => store.getState().applyRuntimeAccountProjection({
    status: account ? 'authenticated' : 'unavailable', user: account ? { id: account, realmEnvironmentId: 'realm-a' } : null,
    sequence: '1', authorizationRevision: account ? 'authorized' : '', reasonCode: 0, accountReasonCode: 0,
  });
  try {
    project('account-a');
    store.getState().setHomePartnerDraft('account-a', first, '  Original draft  ');
    store.getState().setHomePartnerDraft('account-a', second, 'Another partner');
    await store.navigation.push({ id: 'contacts', contactView: 'partners', partner: { localAgentRef: 'local-agent:a' } });
    await store.navigation.back();
    assert.equal(read('account-a', first), '  Original draft  ');
    assert.equal(read('account-a', second), 'Another partner');
    project(null);
    project('account-b');
    assert.equal(read('account-b', first), undefined);
    project('account-a');
    assert.equal(read('account-a', first), '  Original draft  ');
    store.getState().clearAuthSession();
    assert.deepEqual(store.getState().homePartnerDrafts, {});
  } finally { store.navigation.dispose(); }
});
