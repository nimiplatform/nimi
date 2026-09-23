import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import {
  HomeAgentCardView,
  type HomeAgentCardViewProps,
} from '../src/shell/renderer/features/home/home-agent-card.js';

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;

function render(overrides: Partial<HomeAgentCardViewProps> = {}): string {
  const props: HomeAgentCardViewProps = {
    state: 'ready',
    agent: { displayName: 'Lumi', avatarUrl: null },
    otherAgents: [],
    hiddenAgentCount: 0,
    heading: <h1>Good afternoon, Halliday</h1>,
    status: <p>3 capabilities ready</p>,
    onContinueChat: noop,
    onSendMessage: noop,
    onExplore: noop,
    onOpenAgent: noop,
    onViewAllAgents: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<HomeAgentCardView {...props} />);
}

test('ready agent shows greeting, status, composer with prompts, and the agent panel', async () => {
  await initI18n(); await changeLocale('en');
  const html = render();
  assert.match(html, /data-testid="home-agent-card" data-state="ready"/);
  assert.match(html, /Good afternoon, Halliday/);
  assert.match(html, /3 capabilities ready/);
  assert.match(html, /data-testid="home-agent-composer"/);
  assert.match(html, /placeholder="Chat with Lumi…"/);
  assert.match(html, /data-testid="home-agent-send"/);
  assert.match(html, /data-testid="home-agent-prompt:introduce"[^>]*>Tell me about yourself</);
  assert.match(html, /Current agent/);
  assert.match(html, /data-testid="home-agent-name">Lumi</);
  // Ready is carried by the avatar dot alone, not a separate text row.
  assert.match(html, /role="img" aria-label="Ready" title="Ready"/);
  assert.doesNotMatch(html, />Ready</);
  assert.match(html, /data-testid="home-agent-chat"/);
  assert.doesNotMatch(html, /runtimeConfig\.overview\./);
});

test('no agent keeps the greeting but replaces the composer with explore guidance', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render({ state: 'none', agent: null });
  assert.match(html, /Good afternoon, Halliday/);
  assert.match(html, /还没有 agent/);
  assert.match(html, /data-testid="home-agent-explore"/);
  assert.doesNotMatch(html, /data-testid="home-agent-composer"/);
  assert.doesNotMatch(html, /data-testid="home-agent-chat"/);
});

test('loading and unavailable states keep the hero text and hide the composer', async () => {
  await initI18n(); await changeLocale('en');
  const loading = render({ state: 'loading', agent: null });
  assert.match(loading, /data-state="loading"/);
  assert.match(loading, /Good afternoon, Halliday/);
  assert.doesNotMatch(loading, /data-testid="home-agent-composer"/);
  const unavailable = render({ state: 'unavailable', agent: null });
  assert.match(unavailable, /Agent status is temporarily unavailable/);
  assert.doesNotMatch(unavailable, /data-testid="home-agent-composer"/);
});

test('other agents show as avatars with view-all on the right', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render({
    otherAgents: [
      { id: 'agent-a', displayName: 'Aria', avatarUrl: null },
      { id: 'agent-b', displayName: 'Bo', avatarUrl: null },
    ],
    hiddenAgentCount: 0,
  });
  assert.match(html, /aria-label="和 Aria 聊聊"[^>]*data-testid="home-agent-other:agent-a"/);
  assert.match(html, /aria-label="和 Bo 聊聊"[^>]*data-testid="home-agent-other:agent-b"/);
  assert.match(html, /data-testid="home-agent-view-all">查看全部</);
  assert.doesNotMatch(html, />\+\d+</);
  assert.match(render({
    otherAgents: [{ id: 'agent-a', displayName: 'Aria', avatarUrl: null }],
    hiddenAgentCount: 2,
  }), />\+2</);
  assert.doesNotMatch(render(), /data-testid="home-agent-more"/);
});

test('composer copy uses the picked wording in both locales', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render();
  assert.match(html, /placeholder="和 Lumi 聊聊…"/);
  assert.match(html, />发送</);
  assert.match(html, />试试</);
  assert.match(html, />介绍一下你自己</);
  assert.match(html, />你今天在想什么</);
  assert.match(html, />给我讲个故事</);
});
