import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import {
  HOME_RECENT_CONVERSATIONS_LIMIT,
  HomeAgentCardView,
  type HomeAgentCardViewProps,
} from '../src/shell/renderer/features/home/home-agent-card.js';
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
    visibleCount: HOME_RECENT_CONVERSATIONS_LIMIT,
    formatTime: (ms) => `t:${ms}`,
    draftText: '',
    onOpenChatWithDraft: noop,
    onOpenPartner: noop,
    onManagePartner: noop,
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
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(view(overrides));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
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

test('ready state renders multiple recent conversations simultaneously with messages, timestamps, continue/manage actions, and no inline input', async () => {
  await initI18n();
  await changeLocale('zh');
  const html = render();
  assert.match(html, /data-state="ready"/);
  assert.match(html, /data-testid="home-recent-chats-title">最近对话/);
  assert.match(html, /data-testid="home-recent-chats-open-all"[^>]*><span[^>]*>查看全部伙伴/);
  // Independent Nimi Chat entry is retired in v2.1 (replaced by Home Omni-Composer).
  assert.doesNotMatch(html, /data-testid="home-recent-chats-assistant"/);
  // All 3 conversations render simultaneously in the vertical list!
  assert.match(html, /data-testid="home-recent-chat-row:lumi"/);
  assert.match(html, /data-testid="home-recent-chat-row:aria"/);
  assert.match(html, /data-testid="home-recent-chat-row:bo"/);
  assert.match(html, /我们上次聊到的事情，还想继续吗？/);
  assert.match(html, /See you tomorrow/);
  assert.match(html, /还没有对话，来说第一句吧/);
  assert.match(html, /data-testid="home-recent-chat-time">t:1760614440000/);
  assert.match(html, /data-testid="home-agent-manage"/);
  assert.match(html, /data-testid="home-agent-open-chat"/);
  assert.doesNotMatch(html, /home-agent-composer|<input|<textarea/);
  assert.doesNotMatch(html, /home-agent-prompts/, 'when conversation history exists, cold-start prompt chips stay hidden');
});

test('multi-row list caps at 5 recent conversations when many partners exist', async () => {
  await initI18n();
  await changeLocale('zh');
  const sevenPartners: HomeRecentChatPartner[] = Array.from({ length: 7 }, (_, i) => ({
    localAgentRef: `partner-${i + 1}`,
    displayName: `Partner ${i + 1}`,
    avatarUrl: null,
    lastMessageText: `Message ${i + 1}`,
    conversationTitle: null,
    updatedAtMs: 1760614440000 - i * 1000,
    hasUnread: false,
  }));
  const html = render({ partners: sevenPartners });
  assert.match(html, /最近 5 \/ 7/);
  assert.match(html, /data-testid="home-recent-chat-row:partner-1"/);
  assert.match(html, /data-testid="home-recent-chat-row:partner-5"/);
  assert.doesNotMatch(html, /data-testid="home-recent-chat-row:partner-6"/);
});

test('cold-start unchatted partner surfaces icebreaker prompt chips that pass the chosen prompt into conversation draft', async () => {
  await initI18n();
  await changeLocale('zh');
  const unchattedOnly = [PARTNERS[2]!];
  const html = render({ partners: unchattedOnly });
  assert.match(html, /data-testid="home-agent-prompts"/);
  assert.match(html, /data-testid="home-agent-prompt:introduce"[^>]*>介绍一下你自己/);
  assert.match(html, /data-testid="home-agent-prompt:thinking"[^>]*>你今天在想什么/);
  assert.match(html, /data-testid="home-agent-prompt:story"[^>]*>给我讲个故事/);

  const opened: Array<{ id: string; text: string }> = [];
  await withMountedView(
    {
      partners: unchattedOnly,
      onOpenChatWithDraft: (id, text) => opened.push({ id, text }),
    },
    (document) => {
      const promptBtn = document.querySelector<HTMLButtonElement>('[data-testid="home-agent-prompt:story"]');
      assert.ok(promptBtn);
      act(() => promptBtn.click());
      assert.deepEqual(opened, [{ id: 'bo', text: '给我讲个故事' }]);
    },
  );
});

test('recent chat avatars render Realm-managed images when the runtime URL is absent', async () => {
  await initI18n();
  for (const kind of ['avatar', 'portrait'] as const) {
    const purpose = kind === 'avatar' ? 'avatar' : 'card';
    const media: NonNullable<HomeRecentChatPartner['media']> = {
      assets: {
        avatar: null,
        portrait: null,
        referenceImage: null,
        profileCover: null,
        voiceSample: null,
        [kind]: {
          id: 'character-image',
          kind: 'image',
          externalUrl: null,
          delivery: {
            resourceId: 'character-image',
            contentVersion: 'a'.repeat(64),
            publicationGeneration: 1,
            policyVersion: 'v1',
            expiresAt: null,
            previewUrl: null,
            video: null,
            originalUrl: 'https://media.example/original.png',
            images: [
              {
                purpose,
                families: [
                  {
                    mimeType: 'image/webp',
                    sources: [{ url: 'https://media.example/character.webp', width: 96, height: 96, mimeType: 'image/webp' }],
                  },
                ],
              },
            ],
          },
        },
      },
      external: { avatarUrl: null, portraitUrl: null, referenceImageUrl: null, profileCoverUrl: null, voiceSampleUrl: null },
      unavailableResourceRefs: [],
    };
    await withMountedView({ partners: [{ ...PARTNERS[0]!, media }] }, (document) => {
      const image = document.querySelector('[data-testid="home-recent-chat:lumi"] img');
      assert.equal(image?.getAttribute('src'), 'https://media.example/character.webp');
      assert.equal(image?.getAttribute('alt'), 'Lumi');
      assert.equal(image?.getAttribute('sizes'), '40px');
      assert.ok(!document.body.innerHTML.includes('original.png'));
    });
  }
});

test('external artwork and missing-image initials preserve conversation actions', async () => {
  await initI18n();
  await withMountedView({}, (document) => {
    assert.equal(document.querySelector('[data-testid="home-recent-chat:bo"] img')?.getAttribute('src'), 'https://example.com/bo.png');
    const row = document.querySelector('[data-testid="home-recent-chat:lumi"]');
    assert.equal(row?.querySelector('img'), null);
    assert.equal(row?.querySelector('[aria-hidden="true"]')?.textContent, 'L');
    assert.ok(document.querySelector('[data-testid="home-agent-open-chat"]'));
  });
});

test('unread partners carry a dot on the avatar corner', async () => {
  await initI18n();
  await changeLocale('zh');
  const html = render();
  assert.match(html, /data-testid="home-recent-chat-unread:aria"/);
  assert.doesNotMatch(html, /data-testid="home-recent-chat-unread:lumi"/);
  assert.doesNotMatch(html, /data-testid="home-recent-chat-unread:bo"/);
});

test('preview falls back to the conversation title, then to continue-chat guidance, and hides prompts when preview is unavailable', async () => {
  await initI18n();
  await changeLocale('zh');
  const titled = render({
    partners: [{ localAgentRef: 'mei', displayName: 'Mei', avatarUrl: null, lastMessageText: null, conversationTitle: '周末计划', updatedAtMs: 1760614440000, hasUnread: false }],
  });
  assert.match(titled, /data-testid="home-recent-chat-message">周末计划/);
  const textless = render({
    partners: [{ localAgentRef: 'mei', displayName: 'Mei', avatarUrl: null, lastMessageText: null, conversationTitle: null, updatedAtMs: 1760614440000, hasUnread: false }],
  });
  assert.match(textless, /data-testid="home-recent-chat-message">继续对话/);
  assert.doesNotMatch(textless, /还没有对话/);
  const defaultTitle = render({
    partners: [{ localAgentRef: 'mei', displayName: 'Mei', avatarUrl: null, lastMessageText: null, conversationTitle: 'Agent conversation', updatedAtMs: 1760614440000, hasUnread: false }],
  });
  assert.match(defaultTitle, /data-testid="home-recent-chat-message">继续对话/);
  assert.doesNotMatch(defaultTitle, /Agent conversation/);
  const unavailable = render({
    partners: [{ localAgentRef: 'mei', displayName: 'Mei', avatarUrl: null, lastMessageText: null, previewUnavailable: true, conversationTitle: null, updatedAtMs: null, hasUnread: false }],
  });
  assert.match(unavailable, /暂时无法读取对话预览/);
  assert.doesNotMatch(unavailable, /还没有对话|home-agent-prompts/);
});

test('pending partners show a skeleton instead of stale rows', async () => {
  await initI18n();
  await changeLocale('en');
  const html = render({ partners: [], partnersPending: true });
  assert.match(html, /data-testid="home-recent-chats-title">Recent chats/);
  assert.doesNotMatch(html, /home-recent-chats-list|home-agent-open-chat/);
});

test('no agent replaces the conversation action with explore guidance', async () => {
  await initI18n();
  await changeLocale('zh');
  const html = render({ state: 'none', partners: [] });
  assert.match(html, /还没有 Agent/);
  assert.match(html, /data-testid="home-agent-explore"/);
  assert.doesNotMatch(html, /home-agent-open-chat|home-recent-chats-title/);
});

test('loading and unavailable states do not offer a conversation with stale agent data', async () => {
  await initI18n();
  await changeLocale('en');
  for (const state of ['loading', 'unavailable'] as const) {
    const html = render({ state, partners: [] });
    assert.doesNotMatch(html, /home-agent-open-chat|home-recent-chats-list/);
    if (state === 'unavailable') assert.match(html, /Agent status is temporarily unavailable/);
  }
});

test('Home forwards any saved unsent draft when opening chat and leaves clearing to the source owner', async () => {
  await initI18n();
  const draft = '  Keep this text, including its spacing.  ';
  const opened: Array<{ id: string; text: string }> = [];
  await withMountedView(
    {
      draftByPartner: { aria: draft },
      onOpenChatWithDraft: (id, text) => opened.push({ id, text }),
    },
    (document) => {
      const btn = document.querySelector<HTMLButtonElement>('[data-testid="home-agent-open-chat:aria"]')!;
      act(() => btn.click());
      assert.deepEqual(opened, [{ id: 'aria', text: draft }]);
    },
  );
});

test('Home shortcut drafts keep their partner and account through navigation and an outage', async () => {
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { homePartnerDraftKey } = await import('../src/shell/renderer/features/home/home-partner-draft.js');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const first = JSON.stringify(['home', 'realm-a', 'local-agent:a']);
  const second = JSON.stringify(['home', 'realm-a', 'local-agent:b']);
  const read = (account: string, partner: string) => store.getState().homePartnerDrafts[homePartnerDraftKey(account, partner)!];
  const project = (account: string | null) =>
    store.getState().applyRuntimeAccountProjection({
      status: account ? 'authenticated' : 'unavailable',
      user: account ? { id: account, realmEnvironmentId: 'realm-a' } : null,
      sequence: '1',
      authorizationRevision: account ? 'authorized' : '',
      reasonCode: 0,
      accountReasonCode: 0,
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
  } finally {
    store.navigation.dispose();
  }
});
