import { describe, it, expect, vi } from 'vitest';
import type { NimiLocalAppConversationEvent, NimiLocalAppConversationSnapshot } from '@nimiplatform/kit/core/sdk-contract';
import { createCanonicalConversationMediaReader, observeLocalAppConversation } from '../src/headless/local-app-conversation-session.js';
import type { CanonicalConversationProjection } from '../src/headless/local-app-conversation-projection.js';

const scope = { agentHandle: 'agent_ref_test' as never, conversationAnchorId: 'anchor' };
const denied = () => Object.assign(new Error('access revoked'), { reasonCode: 'LOCAL_APP_ACCESS_DENIED' });
const snapshot = (text: string): NimiLocalAppConversationSnapshot => ({
  conversationAnchorId: 'anchor', throughSequence: '2', truncatedBefore: false,
  state: { textTurnId: null, freeContactEnabled: false, maxFollowUpTurns: 8, pendingFollowUp: null },
  messages: [{ messageId: 'answer', turnId: 'turn', role: 'assistant', partial: false, quote: null, parts: [{ kind: 'text', text }] }],
  turns: [], actions: [], voices: [],
});
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function stream() {
  const events: NimiLocalAppConversationEvent[] = [];
  let wake: ((value: IteratorResult<NimiLocalAppConversationEvent>) => void) | null = null;
  let stopped = false;
  const cancel = vi.fn(async () => { stopped = true; wake?.({ done: true, value: undefined }); wake = null; });
  return { cancel,
    push(event: NimiLocalAppConversationEvent) { if (wake) { const next = wake; wake = null; next({ value: event, done: false }); } else events.push(event); },
    [Symbol.asyncIterator]() { return { next: () => stopped ? Promise.resolve({ done: true as const, value: undefined })
      : events.length ? Promise.resolve({ done: false as const, value: events.shift()! }) : new Promise<IteratorResult<NimiLocalAppConversationEvent>>(resolve => { wake = resolve; }) }; },
  };
}

describe('Conversation access invalidation', () => {
  it('retires an outstanding snapshot and old subscription until an explicit fresh refresh', async () => {
    const first = stream(), second = stream();
    const oldRead = deferred<NimiLocalAppConversationSnapshot>(), freshRead = deferred<NimiLocalAppConversationSnapshot>();
    const views: CanonicalConversationProjection[] = [];
    const statuses: string[] = [];
    const calls: string[] = [];
    let subscribeCount = 0, readCount = 0;
    const observation = observeLocalAppConversation({ scope, conversation: {
      subscribe: async () => { calls.push('subscribe'); return ++subscribeCount === 1 ? first : second; },
      snapshot: () => { calls.push('snapshot'); return ++readCount === 1 ? oldRead.promise : freshRead.promise; },
    }, onProjection: view => views.push(view), onStatus: status => statuses.push(status) });
    try {
      await vi.waitFor(() => expect(readCount).toBe(1));
      observation.invalidateAccess(denied());
      expect(first.cancel).toHaveBeenCalledTimes(1);
      expect(statuses.at(-1)).toBe('error');
      oldRead.resolve(snapshot('late private text'));
      await Promise.resolve(); await Promise.resolve();
      expect(views).toHaveLength(0);
      expect(subscribeCount).toBe(1);
      expect(statuses.at(-1)).toBe('error');
      await observation.refresh();
      await vi.waitFor(() => expect(readCount).toBe(2));
      expect(calls).toEqual(['subscribe', 'snapshot', 'subscribe', 'snapshot']);
      expect(views).toHaveLength(0);
      freshRead.resolve(snapshot('fresh authorized text'));
      await vi.waitFor(() => expect(views).toHaveLength(1));
      expect(views[0]?.messages[0]?.parts).toEqual([{ kind: 'text', text: 'fresh authorized text' }]);
      expect(statuses.at(-1)).toBe('ready');
    } finally { observation.close(); }
  });

  it('does not interpret transport errors or denied prose as access revocation', async () => {
    const source = stream(); const views: CanonicalConversationProjection[] = [];
    let reads = 0;
    const observation = observeLocalAppConversation({ scope, conversation: {
      subscribe: async () => source,
      snapshot: async () => { if (++reads > 1) throw new Error('permission denied by a proxy'); return snapshot('retained'); },
    }, onProjection: view => views.push(view) });
    try {
      await vi.waitFor(() => expect(views).toHaveLength(1));
      observation.invalidateAccess(new Error('permission denied by a proxy'));
      await observation.refresh();
      expect(source.cancel).not.toHaveBeenCalled();
      source.push({ type: 'state-changed', conversationAnchorId: 'anchor', sequence: '3', state: snapshot('').state });
      await vi.waitFor(() => expect(views.at(-1)?.throughSequence).toBe('3'));
      expect(views.at(-1)?.messages[0]?.parts).toEqual([{ kind: 'text', text: 'retained' }]);
    } finally { observation.close(); }
  });

  it('does not swallow an access denial from an automatic terminal refresh', async () => {
    const source = stream(); const statuses: string[] = []; let reads = 0;
    const initial: NimiLocalAppConversationSnapshot = { ...snapshot('retained'),
      turns: [{ turnId: 'turn', origin: 'user', requestId: null, retryOfTurnId: null, inputTurnId: null, canRegenerate: false, status: 'active', phase: 'started', terminalReason: null, reasonCode: null, message: null }] };
    const observation = observeLocalAppConversation({ scope, conversation: {
      subscribe: async () => source,
      snapshot: async () => { if (++reads > 1) throw denied(); return initial; },
    }, onProjection: () => {}, onStatus: status => statuses.push(status) });
    try {
      await vi.waitFor(() => expect(statuses.at(-1)).toBe('ready'));
      source.push({ type: 'turn-failed', conversationAnchorId: 'anchor', sequence: '3', turnId: 'turn', reasonCode: 'AI_PROVIDER_TIMEOUT', message: null });
      await vi.waitFor(() => expect(statuses.at(-1)).toBe('error'));
      expect(source.cancel).toHaveBeenCalledTimes(1);
      expect(reads).toBe(2);
    } finally { observation.close(); }
  });

  it('clears media bytes and fences other pending reads when one artifact read is denied', async () => {
    const pending = deferred<{ artifactId: string; bytes: Uint8Array; mimeType: string; byteLength: number }>();
    const onChange = vi.fn(), onAccessDenied = vi.fn();
    const media = createCanonicalConversationMediaReader({ scope,
      conversation: { readArtifact: async ({ artifactId }) => {
        if (artifactId === 'denied') throw denied();
        if (artifactId === 'late') return pending.promise;
        return { artifactId, bytes: new Uint8Array([1]), mimeType: 'image/png', byteLength: 1 };
      } }, onChange, onAccessDenied });
    media.get('ready');
    await vi.waitFor(() => expect(media.get('ready').mediaUrl).toMatch(/^data:/));
    media.get('late'); media.get('denied');
    await vi.waitFor(() => expect(onAccessDenied).toHaveBeenCalledTimes(1));
    const publications = onChange.mock.calls.length;
    pending.resolve({ artifactId: 'late', bytes: new Uint8Array([2]), mimeType: 'image/png', byteLength: 1 });
    await Promise.resolve(); await Promise.resolve();
    expect(media.get('ready').mediaUrl).toBeNull();
    expect(media.get('late').mediaUrl).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(publications);
    media.close();
  });
});
