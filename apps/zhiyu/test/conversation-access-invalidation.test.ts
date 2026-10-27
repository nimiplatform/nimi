import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiLocalAppConversationClient, NimiLocalAppConversationSnapshot } from '@nimiplatform/sdk/app';
import { subscribeZhiyuAmbientConversation } from '../src/shell/agent-chat/ambient-conversation-subscription.js';

const scope = { agentHandle: 'agent_ref_test' as never, conversationAnchorId: 'anchor' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const snapshot = (text: string): NimiLocalAppConversationSnapshot => ({
  conversationAnchorId: 'anchor', throughSequence: '2', truncatedBefore: false,
  state: { textTurnId: null, freeContactEnabled: false, maxFollowUpTurns: 8, pendingFollowUp: null },
  messages: [
    { messageId: 'answer', turnId: 'turn', role: 'assistant', partial: false, quote: null, parts: [{ kind: 'text', text }] },
    { messageId: 'image', turnId: 'turn', role: 'assistant', partial: false, quote: null, parts: [{ kind: 'artifact-ref', artifactId: 'artifact', mediaKind: 'image', mimeType: 'image/png', displayName: null }] },
  ], turns: [], actions: [], voices: [],
});

test('Zhiyu invalidates the same identity and rebuilds private media only after a fresh authorized snapshot', async () => {
  const oldArtifact = deferred<{ artifactId: string; bytes: Uint8Array; mimeType: string; byteLength: number }>();
  const freshSnapshot = deferred<NimiLocalAppConversationSnapshot>();
  let subscriptions = 0, reads = 0, artifacts = 0, cancellations = 0;
  const chats: Parameters<Parameters<typeof subscribeZhiyuAmbientConversation>[0]['onChat']>[0][] = [];
  const errors: unknown[] = [];
  const statuses: string[] = [];
  const observation = subscribeZhiyuAmbientConversation({ identity: scope,
    conversation: {
      subscribe: async () => {
        subscriptions++; const stopped = deferred<void>();
        return { cancel: async () => { cancellations++; stopped.resolve(); }, async *[Symbol.asyncIterator]() { await stopped.promise; } };
      },
      snapshot: () => ++reads === 1 ? Promise.resolve(snapshot('old authorized text')) : freshSnapshot.promise,
      readArtifact: async () => ++artifacts === 1 ? oldArtifact.promise : { artifactId: 'artifact', bytes: new Uint8Array([2]), mimeType: 'image/png', byteLength: 1 },
    } as unknown as NimiLocalAppConversationClient,
    onChat: chat => chats.push(chat), onStatus: (status, error) => { statuses.push(status); if (error) errors.push(error); },
  });
  try {
    await tick(); await tick();
    assert.equal(chats.at(-1)?.messages[0]?.text, 'old authorized text');
    const error = Object.assign(new Error('access revoked'), { reasonCode: 'LOCAL_APP_ACCESS_DENIED' });
    observation.invalidateAccess(error);
    assert.equal(errors.at(-1), error, 'typed rejection reaches the App');
    assert.deepEqual(chats.at(-1)?.messages, []);
    assert.equal(chats.at(-1)?.canonicalProjection, undefined);
    assert.equal(cancellations, 1);
    const clearedCount = chats.length;
    oldArtifact.resolve({ artifactId: 'artifact', bytes: new Uint8Array([1]), mimeType: 'image/png', byteLength: 1 });
    await tick(); await tick();
    assert.equal(chats.length, clearedCount, 'late bytes cannot republish old conversation');
    assert.equal(statuses.at(-1), 'error');
    assert.equal(subscriptions, 1, 'permission loss never reconnects automatically');
    await observation.refresh(); await tick();
    assert.equal(subscriptions, 2);
    assert.equal(reads, 2);
    assert.deepEqual(chats.at(-1)?.messages, [], 'new subscription alone does not unlock old content');
    freshSnapshot.resolve(snapshot('fresh authorized text'));
    await tick(); await tick();
    assert.equal(statuses.at(-1), 'ready');
    assert.equal(chats.at(-1)?.messages[0]?.text, 'fresh authorized text');
    assert.equal(artifacts, 2, 'fresh reader cannot reuse retired private bytes');
    assert.match(String(chats.at(-1)?.messages[1]?.metadata?.mediaUrl), /^data:/);
  } finally { observation.close(); }
});

test('Zhiyu does not clear a conversation on a non-authoritative transport error', async () => {
  let rejectSubscription!: (error: unknown) => void;
  const chats: Parameters<Parameters<typeof subscribeZhiyuAmbientConversation>[0]['onChat']>[0][] = [];
  const observation = subscribeZhiyuAmbientConversation({ identity: scope,
    conversation: {
      subscribe: async () => ({ cancel: async () => {}, [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>((_resolve, reject) => { rejectSubscription = reject; }) }) }),
      snapshot: async () => ({ ...snapshot('keep text'), messages: [snapshot('keep text').messages[0]!] }),
    } as unknown as NimiLocalAppConversationClient,
    onChat: chat => chats.push(chat),
  });
  try {
    await tick(); await tick();
    rejectSubscription(new Error('connection interrupted'));
    await tick(); await tick();
    assert.equal(chats.at(-1)?.messages[0]?.text, 'keep text');
    observation.invalidateAccess(new Error('access denied in arbitrary prose'));
    assert.equal(chats.at(-1)?.messages[0]?.text, 'keep text');
  } finally { observation.close(); }
});
