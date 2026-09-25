import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import { RelationshipHoverCard } from '../src/shell/renderer/features/chat/chat-relationship-hover-card.js';
import {
  toAgentReferenceTargetSummary,
  toHumanFriendTargetSummary,
} from '../src/shell/renderer/features/chat/chat-sidebar-targets.js';

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;
const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;

function render(target: ConversationTargetSummary, subtitle?: string): string {
  return renderToStaticMarkup(
    <RelationshipHoverCard
      target={target}
      selected={false}
      pos={{ top: 120, right: 96 }}
      onMouseEnter={noop}
      onMouseLeave={noop}
      onSelect={noop}
      subtitle={subtitle}
    />,
  );
}

test('partner card hides the opaque agent handle and the empty recent line', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render(toAgentReferenceTargetSummary({
    agentHandle: AGENT_HANDLE,
    displayName: '柯九思',
    avatarUrl: null,
  }));
  assert.match(html, />柯九思</);
  assert.match(html, />伙伴</);
  assert.doesNotMatch(html, /agent_ref_/);
  assert.doesNotMatch(html, /最近：/);
});

test('partner card shows the character hero subtitle when resolved', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render(
    toAgentReferenceTargetSummary({
      agentHandle: AGENT_HANDLE,
      displayName: '柯九思',
      avatarUrl: null,
    }),
    '元代 · 权威的书画鉴赏家与艺术家',
  );
  assert.match(html, />柯九思</);
  assert.match(html, />伙伴</);
  assert.match(html, /data-chat-contact-hover-card-subtitle="true"[^>]*>元代 · 权威的书画鉴赏家与艺术家</);
});

test('contact card without a handle does not fall back to the account id', async () => {
  await initI18n(); await changeLocale('zh');
  const target = toHumanFriendTargetSummary({ id: 'account-bo-1', displayName: 'Bo' });
  assert.ok(target);
  const html = render(target);
  assert.match(html, />Bo</);
  assert.doesNotMatch(html, /account-bo-1/);
  assert.doesNotMatch(html, /最近：/);
});

test('contact card keeps its handle and recent message when both exist', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render({
    id: 'account-aria-1',
    source: 'human',
    canonicalSessionId: 'chat-aria-1',
    title: 'Aria',
    handle: '@aria',
    previewText: '明天见',
  });
  assert.match(html, />aria</);
  assert.match(html, />最近：<\/span><span[^>]*>明天见</);
});
