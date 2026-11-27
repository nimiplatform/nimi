import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { changeLocale, initI18n } from '../src/shell/renderer/i18n/index.js';
import {
  HOME_PARTNERS_HERO_LIMIT,
  HomePartnersHeroCardView,
} from '../src/shell/renderer/features/home/home-partners-hero-card.js';
import type { HomeRecentChatPartner } from '../src/shell/renderer/features/home/home-recent-conversations-model.js';

(globalThis as { React?: typeof React }).React = React;

const noop = () => {};

function makePartner(index: number, overrides: Partial<HomeRecentChatPartner> = {}): HomeRecentChatPartner {
  return {
    localAgentRef: `partner-${index}`,
    displayName: `伙伴 ${index}`,
    avatarUrl: null,
    lastMessageText: `最近一条消息 ${index}`,
    conversationTitle: null,
    updatedAtMs: 1_700_000_000_000 + index * 60_000,
    hasUnread: false,
    ...overrides,
  };
}

test('partners hero renders warm empty state with explore CTA when user has 0 partners', async () => {
  await initI18n();
  await changeLocale('zh');
  const html = renderToStaticMarkup(
    <HomePartnersHeroCardView
      state="none"
      partners={[]}
      partnersPending={false}
      formatTime={() => '14:29'}
      onOpenChatWithDraft={noop}
      onOpenPartner={noop}
      onOpenAll={noop}
      onExplore={noop}
    />,
  );
  assert.match(html, /data-testid="home-partners-hero"/);
  assert.match(html, /data-testid="home-partners-empty"/);
  assert.match(html, /data-testid="home-agent-explore"/);
  assert.doesNotMatch(html, /data-testid="home-partners-all"/);
});

test('partners hero renders quiet familiar partners as compact avatar + minimal name chips without boilerplate text', async () => {
  await initI18n();
  await changeLocale('zh');

  const quietHtml = renderToStaticMarkup(
    <HomePartnersHeroCardView
      state="ready"
      partners={[
        makePartner(1, {
          displayName: '林听灯',
          lastMessageText: null,
          conversationTitle: 'Agent conversation',
        }),
        makePartner(2, {
          displayName: '甘老杓',
          lastMessageText: null,
          conversationTitle: null,
          updatedAtMs: null,
        }),
      ]}
      partnersPending={false}
      formatTime={() => '昨天 17:51'}
      onOpenChatWithDraft={noop}
      onOpenPartner={noop}
      onOpenAll={noop}
      onExplore={noop}
    />,
  );
  assert.match(quietHtml, /data-testid="home-partners-compact-row"/);
  assert.match(quietHtml, /data-testid="home-partner-card:partner-1"[^>]*data-variant="compact"/);
  assert.match(quietHtml, /data-testid="home-partner-card:partner-2"[^>]*data-variant="compact"/);
  assert.match(quietHtml, /林听灯/);
  assert.match(quietHtml, /甘老杓/);
  assert.doesNotMatch(quietHtml, /继续对话|还没有对话|Agent conversation|本地伙伴|共 2 位|home-partners-explore-tile|home-partners-grid/);
});

test('partners strip renders context partners (real message, unread, or draft) with concise tail previews alongside quiet pills', async () => {
  await initI18n();
  await changeLocale('zh');

  const mixedHtml = renderToStaticMarkup(
    <HomePartnersHeroCardView
      state="ready"
      partners={[
        makePartner(1, { displayName: '林听灯', hasUnread: true, lastMessageText: '刚整理完提纲' }),
        makePartner(2, { displayName: '叶小满', lastMessageText: null }),
        makePartner(3, { displayName: '甘老杓', lastMessageText: null, updatedAtMs: null }),
      ]}
      partnersPending={false}
      formatTime={() => '14:29'}
      draftByPartner={{ 'partner-2': '回头再聊' }}
      onOpenChatWithDraft={noop}
      onOpenPartner={noop}
      onOpenAll={noop}
      onExplore={noop}
    />,
  );
  assert.match(mixedHtml, /data-testid="home-partners-compact-row"/);
  assert.match(mixedHtml, /data-testid="home-partner-card:partner-1"[^>]*data-variant="context"/);
  assert.match(mixedHtml, /data-testid="home-partner-card:partner-2"[^>]*data-variant="context"/);
  assert.match(mixedHtml, /data-testid="home-partner-card:partner-3"[^>]*data-variant="compact"/);
  assert.match(mixedHtml, /data-testid="home-partners-unread-summary"[^>]*>1 位有新回复/);
  assert.match(mixedHtml, /刚整理完提纲/);
  assert.match(mixedHtml, /草稿：回头再聊/);
  assert.doesNotMatch(mixedHtml, /继续对话|还没有对话|home-partners-explore-tile|home-partners-grid|home-partners-rail/);
});

test('partners strip caps visible whisper pills at HOME_PARTNERS_HERO_LIMIT and shows total count in All link when overflowed', async () => {
  await initI18n();
  await changeLocale('zh');

  const total = HOME_PARTNERS_HERO_LIMIT + 3;
  const manyPartners = Array.from({ length: total }, (_, i) =>
    makePartner(i + 1, { hasUnread: i < 2 }),
  );
  const stripHtml = renderToStaticMarkup(
    <HomePartnersHeroCardView
      state="ready"
      partners={manyPartners}
      partnersPending={false}
      formatTime={() => '14:29'}
      onOpenChatWithDraft={noop}
      onOpenPartner={noop}
      onOpenAll={noop}
      onExplore={noop}
    />,
  );
  assert.match(stripHtml, /data-testid="home-partners-compact-row"/);
  assert.match(stripHtml, new RegExp(`data-testid="home-partner-card:partner-${HOME_PARTNERS_HERO_LIMIT}"`));
  assert.doesNotMatch(stripHtml, new RegExp(`data-testid="home-partner-card:partner-${HOME_PARTNERS_HERO_LIMIT + 1}"`));
  assert.match(stripHtml, /data-testid="home-partners-unread-summary"[^>]*>2 位有新回复/);
  assert.match(stripHtml, new RegExp(`data-testid="home-partners-all"[^>]*>全部 ${total} 位 →`));
});
