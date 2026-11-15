import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiAppRuntimeClient } from '@nimiplatform/sdk/app';
import { parseZhiyuConversationOpenTarget } from '../src/shell/app/conversation-open.js';
import { resolveZhiyuConversationOpen } from '../src/production/conversation-open-bridge.js';

test('conversation handoff accepts correlation and an unchanged draft, never caller credentials or handles', () => {
  assert.deepEqual(parseZhiyuConversationOpenTarget({ conversationAnchorId: 'anchor', messageId: 'reply', text: '  draft\n' }),
    { conversationAnchorId: 'anchor', messageId: 'reply', text: '  draft\n' });
  for (const input of [null, {}, { conversationAnchorId: ' ' }, { conversationAnchorId: 'a', agentHandle: 'foreign' },
    { conversationAnchorId: 'a', accountId: 'foreign' }, { conversationAnchorId: 'a', text: 'x'.repeat(16385) },
    { conversationAnchorId: 'a', messageId: '\n' }]) assert.throws(() => parseZhiyuConversationOpenTarget(input));
});

test('destination resolves its own App reference and verifies the requested reply', async () => {
  const calls: unknown[] = [];
  const client = {
    agents: { listReferences: async () => [{ agentHandle: 'own-a' }, { agentHandle: 'own-b' }] },
    conversation: {
      snapshot: async (input: { agentHandle: string }) => {
        calls.push(input);
        return { conversationAnchorId: input.agentHandle === 'own-b' ? 'requested' : 'other' };
      },
      readMessage: async (input: unknown) => { calls.push(input); return {}; },
    },
  } as unknown as NimiAppRuntimeClient;
  assert.deepEqual(await resolveZhiyuConversationOpen(client, { requestId: 'request', conversationAnchorId: 'requested', messageId: 'reply' }, () => true),
    { agentHandle: 'own-b', conversationAnchorId: 'requested' });
  assert.deepEqual(calls.at(-1), { agentHandle: 'own-b', conversationAnchorId: 'requested', messageId: 'reply' });
  await assert.rejects(resolveZhiyuConversationOpen(client, { requestId: 'request', conversationAnchorId: 'foreign' }, () => true), /unavailable/);
  await assert.rejects(resolveZhiyuConversationOpen(client, { requestId: 'request', conversationAnchorId: 'requested' }, () => false), /superseded/);
  client.conversation.readMessage = async () => { throw new Error('Reply no longer available'); };
  await assert.rejects(resolveZhiyuConversationOpen(client, { requestId: 'request', conversationAnchorId: 'requested', messageId: 'missing' }, () => true), /Reply no longer available/);
});
