import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { DemoChatSurface } from '../src/landing/components/demo-chat.js';
import { materializeChatMessages, resolveDemoChatTarget } from '../src/landing/content/demo-chat-model.js';

test('Home chat resolves the assistant, people and LocalAgents into separate conversation sources', async () => {
  const {
    hero: { demo },
  } = await loadLandingContent('zh');
  const { chat } = demo;
  assert.equal(resolveDemoChatTarget(chat, null).mode, 'ai');
  assert.equal(resolveDemoChatTarget(chat, 'human:contacts').target, undefined);
  assert.equal(resolveDemoChatTarget(chat, chat.people[0]!.id).mode, 'human');
  assert.equal(resolveDemoChatTarget(chat, chat.agents[0]!.id).mode, 'agent');
  const messages = materializeChatMessages(chat);
  for (const peer of [...chat.agents, ...chat.people, ...chat.assistantThreads]) {
    const mode = resolveDemoChatTarget(chat, peer.id).mode;
    for (const message of messages[peer.id]!) {
      assert.equal(message.targetId, peer.id);
      assert.equal(message.source, mode);
      assert.equal(
        message.senderName,
        message.role === 'user' ? chat.userName : mode === 'ai' ? 'Nimi' : peer.name,
      );
    }
  }
});

test('seeded user and LocalAgent chats render their real text and the correct input tools', async () => {
  for (const locale of ['zh', 'en'] as const) {
    const {
      hero: { demo },
    } = await loadLandingContent(locale);
    const baseMessages = materializeChatMessages(demo.chat);
    const common = {
      demo,
      draft: '',
      onDraftChange() {},
      baseMessages,
      localMessages: {},
      onSelectTarget() {},
      onSwitchSide() {},
      onSubmit() {},
      onCreateThread() {},
      onNavigate() {},
    };
    const fresh = demo.chat.agents[0]!;
    const freshHtml = renderToStaticMarkup(
      createElement(DemoChatSurface, { ...common, selectedTargetId: fresh.id }),
    );
    assert.ok(freshHtml.includes('data-agent-introduction="true"'));
    assert.ok(freshHtml.includes(fresh.greeting!));
    assert.ok(freshHtml.includes('data-agent-empty-suggestions="true"'));
    const agent = demo.chat.agents[1]!;
    const agentHtml = renderToStaticMarkup(
      createElement(DemoChatSurface, { ...common, selectedTargetId: agent.id }),
    );
    assert.ok(agentHtml.includes(agent.messages[0]!.text));
    assert.ok(agentHtml.includes('data-chat-composer-layout="stacked"'));
    assert.ok(agentHtml.includes(locale === 'zh' ? '伙伴中心' : 'Agent Center'));
    assert.ok(agentHtml.includes(agent.avatarUrl!));
    const person = demo.chat.people[0]!;
    const humanHtml = renderToStaticMarkup(
      createElement(DemoChatSurface, { ...common, selectedTargetId: person.id }),
    );
    assert.ok(humanHtml.includes(person.messages[0]!.text));
    assert.ok(humanHtml.includes('data-demo-chat-mode="human"'));
    assert.ok(!humanHtml.includes('aria-label="Agent Center"'));
    assert.ok(!humanHtml.includes('aria-label="伙伴中心"'));
    const contacts = renderToStaticMarkup(
      createElement(DemoChatSurface, { ...common, selectedTargetId: 'human:contacts' }),
    );
    assert.ok(contacts.includes(person.handle!));
    assert.ok(contacts.includes(locale === 'zh' ? '好友申请' : 'Requests'));
  }
});

test('demo users have complete localized profiles and conversation times follow the latest message', async () => {
  const { existsSync } = await import('node:fs');
  const { demoHumanConversationRows } = await import('../src/landing/components/demo-chat-contacts.js');
  for (const locale of ['zh', 'en'] as const) {
    const {
      hero: { demo },
    } = await loadLandingContent(locale);
    const { chat } = demo;
    assert.equal(chat.people.length, 6);
    for (const person of [chat.self, ...chat.people]) {
      assert.ok(person.bio && person.handle && person.city && person.countryCode);
      assert.ok(person.languages?.length && person.tags?.length);
      assert.ok(person.avatarUrl?.startsWith('/demo/users/'));
      assert.ok(existsSync(new URL(`../public${person.avatarUrl}`, import.meta.url)));
    }
    const base = materializeChatMessages(chat);
    const original = demoHumanConversationRows(chat.people, base, {});
    assert.equal(original[0]!.person.id, 'human:lin');
    const oldest = original.at(-1)!;
    assert.equal(oldest.person.id, 'human:zhou');
    const newest = {
      ...oldest.latest!,
      id: 'just-sent',
      role: 'user' as const,
      text: 'A new demo message',
      createdAt: new Date(Date.now() + 1000).toISOString(),
    };
    const updated = demoHumanConversationRows(chat.people, base, { [oldest.person.id]: [newest] });
    assert.equal(updated[0]!.person.id, oldest.person.id);
    assert.equal(updated[0]!.latest?.createdAt, newest.createdAt);
    assert.equal(updated.length, chat.people.length);
    assert.notEqual(base[oldest.person.id]?.at(-1)?.id, 'just-sent');
  }
});
