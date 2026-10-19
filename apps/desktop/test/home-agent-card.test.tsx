import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
function render(overrides: Partial<HomeAgentCardViewProps> = {}): string {
  const props: HomeAgentCardViewProps = {
    state: 'ready',
    partners: PARTNERS,
    partnersPending: false,
    selectedId: 'lumi',
    visibleCount: 8,
    stripRef: noop,
    formatTime: (ms) => `t:${ms}`,
    onSelectPartner: noop,
    onOpenChat: noop,
    onOpenPartner: noop,
    onOpenAll: noop,
    onExplore: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<HomeAgentCardView {...props} />);
}

test('ready state renders the recent-chats header, compact strip, and one merged mini chat bar', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render();
  assert.match(html, /data-state="ready"/);
  assert.match(html, /data-testid="home-recent-chats-title">最近对话/);
  assert.match(html, /data-testid="home-recent-chats-open-all"[^>]*><span[^>]*>打开全部对话/);
  // The open-all action renders as a ghost button without a trailing chevron.
  assert.doesNotMatch(html, /lucide-chevron-right/);
  assert.match(html, /data-testid="home-recent-chat:lumi"/);
  assert.match(html, /data-testid="home-recent-chat:aria"/);
  assert.match(html, /data-testid="home-recent-chat:bo"/);
  assert.match(html, /data-testid="home-recent-chat:lumi"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="home-recent-chat:lumi"/);
  // Kit Avatar resolves image loading and fallback after mounting; this SSR
  // check covers the partner identity and composition, not image loading.
  // Message preview and reply composer live in the same mini chat container.
  assert.match(html, /data-testid="home-mini-chat"[\s\S]*data-testid="home-recent-chat-preview"[\s\S]*data-testid="home-agent-composer"/);
  // Preview of the selected partner with its last message and formatted time.
  assert.match(html, /data-testid="home-agent-name">Lumi/);
  assert.match(html, /data-testid="home-recent-chat-message">我们上次聊到的事情，还想继续吗？/);
  assert.match(html, /data-testid="home-recent-chat-time">t:1760614440000/);
  // Reply composer targets the selected partner and submits via a single-line input (Enter).
  assert.match(html, /<label[^>]*for="home-agent-composer-input"/);
  assert.match(html, /<input[^>]*placeholder="回复Lumi…"/);
  assert.match(html, /data-testid="home-agent-send"/);
  // The send button lives inside the composer capsule, right after the input.
  assert.match(html, /id="home-agent-composer-input"[^>]*>[\s\S]*?data-testid="home-agent-send"/);
  // With an empty draft the send button renders in the muted gray treatment.
  assert.match(html, /class="[^"]*--nimi-surface-active[^"]*--nimi-text-muted[^"]*"[^>]*data-testid="home-agent-send"/);
  assert.doesNotMatch(html, /当前伙伴|切换|去聊天|home-agent-switch|<textarea/);
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
