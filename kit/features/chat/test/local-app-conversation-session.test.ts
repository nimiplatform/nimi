import { describe, it, expect, vi } from 'vitest';
import type { NimiLocalAppConversationClient, NimiLocalAppConversationEvent, NimiLocalAppConversationSnapshot } from '@nimiplatform/kit/core/sdk-contract';
import { observeLocalAppConversation, createCanonicalConversationMediaReader } from '../src/headless/local-app-conversation-session.js';
import type { CanonicalConversationProjection } from '../src/headless/local-app-conversation-projection.js';

const scope = { agentHandle: 'agent_ref_test' as never, conversationAnchorId: 'anchor' };
function snapshot(): NimiLocalAppConversationSnapshot {
  return { conversationAnchorId: 'anchor', throughSequence: '2', truncatedBefore: false,
    state: { textTurnId: 'turn', followUpEnabled: false, followUpPolicyRevision: '0', pendingFollowUp: null, maxFollowUpTurns: 8 },
    turns: [{ turnId: 'turn', origin: 'user', requestId: 'request', retryOfTurnId: null, inputTurnId: 'turn', canRegenerate: false,
      status: 'active', phase: 'started', terminalReason: null, reasonCode: null, message: null }],
    messages: [{ messageId: 'answer', turnId: 'turn', role: 'assistant', partial: true, parts: [{ kind: 'text', text: '已收到' }] }], actions: [], voices: [] };
}
function queue() {
  let wake: ((value: IteratorResult<NimiLocalAppConversationEvent>) => void) | null = null;
  const values: NimiLocalAppConversationEvent[] = [];
  let stopped = false;
  return {
    push(event: NimiLocalAppConversationEvent) { if (wake) { const resolve = wake; wake = null; resolve({ value: event, done: false }); } else values.push(event); },
    async cancel() { stopped = true; wake?.({ value: undefined, done: true }); wake = null; },
    [Symbol.asyncIterator]() { return { next: () => values.length ? Promise.resolve({ value: values.shift()!, done: false as const })
      : stopped ? Promise.resolve({ value: undefined, done: true as const }) : new Promise<IteratorResult<NimiLocalAppConversationEvent>>(resolve => { wake = resolve; }) }; },
  };
}

describe('shared LocalAgent observation', () => {
  it('subscribes before hydration and adds only newer deltas, including legal public gaps', async () => {
    const stream = queue();
    let release!: (value: NimiLocalAppConversationSnapshot) => void;
    const calls: string[] = [];
    const views: CanonicalConversationProjection[] = [];
    const observation = observeLocalAppConversation({ scope,
      conversation: { subscribe: async () => { calls.push('subscribe'); return stream; },
        snapshot: () => { calls.push('snapshot'); return new Promise(resolve => { release = resolve; }); } },
      onProjection: value => views.push(value),
    });
    try {
      await vi.waitFor(() => expect(calls).toEqual(['subscribe', 'snapshot']));
      stream.push({ type: 'text-delta', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '1', delta: '不能重复' });
      await Promise.resolve();
      stream.push({ type: 'text-delta', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '5', delta: '的正文' });
      await Promise.resolve();
      release(snapshot());
      await vi.waitFor(() => expect(views.at(-1)?.throughSequence).toBe('5'));
      expect(views.at(-1)?.messages[0]?.parts).toEqual([{ kind: 'text', text: '已收到的正文' }]);
      stream.push({ type: 'state-changed', conversationAnchorId: 'anchor', sequence: '9', state: { ...snapshot().state, textTurnId: null } });
      await vi.waitFor(() => expect(views.at(-1)?.state.textTurnId).toBeNull());
      expect(views.at(-1)?.turns[0]?.status).toBe('active');
      expect(calls).toEqual(['subscribe', 'snapshot']);
    } finally { observation.close(); }
  });

  it('keeps partial text on denial, does not resend, and fences a late snapshot after close', async () => {
    const stream = queue();
    const views: CanonicalConversationProjection[] = [];
    const statuses: string[] = [];
    let reads = 0;
    const observation = observeLocalAppConversation({ scope, conversation: {
      subscribe: async () => stream,
      snapshot: async () => { if (++reads > 1) throw Object.assign(new Error('denied'), { retryable: false }); return snapshot(); },
    }, onProjection: value => views.push(value), onStatus: status => statuses.push(status) });
    await vi.waitFor(() => expect(views).toHaveLength(1));
    await observation.refresh();
    expect(statuses.at(-1)).toBe('error');
    expect(views[0]?.messages[0]?.partial).toBe(true);
    observation.close();
    let release!: (value: NimiLocalAppConversationSnapshot) => void;
    const late = observeLocalAppConversation({ scope, conversation: {
      subscribe: async () => queue(), snapshot: () => new Promise(resolve => { release = resolve; }),
    }, onProjection: value => views.push(value) });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    late.close(); release(snapshot()); await Promise.resolve();
    expect(views).toHaveLength(1);
  });

  it('keeps consuming released occupancy and new text while terminal eligibility is being read', async () => {
    const stream = queue();
    const views: CanonicalConversationProjection[] = [];
    let release!: (value: NimiLocalAppConversationSnapshot) => void;
    let reads = 0;
    const observation = observeLocalAppConversation({ scope, conversation: {
      subscribe: async () => stream,
      snapshot: () => ++reads === 1 ? Promise.resolve(snapshot()) : new Promise(resolve => { release = resolve; }),
    }, onProjection: value => views.push(value) });
    try {
      await vi.waitFor(() => expect(views).toHaveLength(1));
      stream.push({ type: 'turn-failed', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '3', reasonCode: 'AI_PROVIDER_TIMEOUT', message: null });
      await vi.waitFor(() => expect(reads).toBe(2));
      stream.push({ type: 'state-changed', conversationAnchorId: 'anchor', sequence: '4', state: { ...snapshot().state, textTurnId: null } });
      await vi.waitFor(() => expect(views.at(-1)?.state.textTurnId).toBeNull());
      stream.push({ type: 'turn-accepted', conversationAnchorId: 'anchor', turnId: 'next', sequence: '5', origin: 'user', requestId: 'next-request' });
      stream.push({ type: 'state-changed', conversationAnchorId: 'anchor', sequence: '6', state: { ...snapshot().state, textTurnId: 'next' } });
      stream.push({ type: 'text-delta', conversationAnchorId: 'anchor', turnId: 'next', sequence: '7', delta: '下一条正文' });
      await vi.waitFor(() => expect(views.at(-1)?.transientByTurn.next?.text).toBe('下一条正文'));
      release({ ...snapshot(), throughSequence: '3', state: { ...snapshot().state, textTurnId: null },
        turns: snapshot().turns.map(turn => ({ ...turn, status: 'failed', canRegenerate: true })) });
      await observation.refresh();
      expect(views.at(-1)?.throughSequence).toBe('7');
      expect(views.at(-1)?.state.textTurnId).toBe('next');
      expect(views.at(-1)?.transientByTurn.next?.text).toBe('下一条正文');
      expect(views.at(-1)?.turns[0]?.canRegenerate).toBe(false);
      expect(reads).toBe(2);
    } finally { observation.close(); }
  });

  it('merges eligibility from a read-start snapshot with newer live state without accepting an older read', async () => {
    const stream = queue();
    const views: CanonicalConversationProjection[] = [];
    let release!: (value: NimiLocalAppConversationSnapshot) => void;
    let reads = 0;
    const observation = observeLocalAppConversation({ scope, conversation: {
      subscribe: async () => stream,
      snapshot: () => ++reads === 2 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(snapshot()),
    }, onProjection: value => views.push(value) });
    try {
      await vi.waitFor(() => expect(views).toHaveLength(1));
      stream.push({ type: 'turn-failed', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '3', reasonCode: 'AI_PROVIDER_TIMEOUT', message: null });
      await vi.waitFor(() => expect(reads).toBe(2));
      stream.push({ type: 'state-changed', conversationAnchorId: 'anchor', sequence: '4', state: { ...snapshot().state, textTurnId: null } });
      await vi.waitFor(() => expect(views.at(-1)?.throughSequence).toBe('4'));
      release({ ...snapshot(), throughSequence: '3', state: { ...snapshot().state, textTurnId: null },
        turns: snapshot().turns.map(turn => ({ ...turn, status: 'failed', canRegenerate: true })) });
      await observation.refresh();
      expect(views.at(-1)?.turns[0]?.canRegenerate).toBe(true);
      expect(views.at(-1)?.throughSequence).toBe('4');
      expect(views.at(-1)?.state.textTurnId).toBeNull();
      expect(reads).toBe(2);
      await observation.refresh(); // seq 2 is older than this read's starting seq 4.
      expect(views.at(-1)?.turns[0]?.canRegenerate).toBe(true);
      expect(views.at(-1)?.throughSequence).toBe('4');
      expect(reads).toBe(3);
    } finally { observation.close(); }
  });

  it('coalesces an applied terminal during initial or active hydration into an owner eligibility read', async () => {
    for (const initial of [true, false]) {
      const stream = queue();
      const views: CanonicalConversationProjection[] = [];
      let release!: (value: NimiLocalAppConversationSnapshot) => void;
      let reads = 0;
      const deferredRead = initial ? 1 : 2;
      const terminal: NimiLocalAppConversationSnapshot = { ...snapshot(), throughSequence: '4',
        state: { ...snapshot().state, textTurnId: null },
        turns: snapshot().turns.map(turn => ({ ...turn, status: 'interrupted', terminalReason: 'user_cancel', canRegenerate: true })) };
      const observation = observeLocalAppConversation({ scope, conversation: {
        subscribe: async () => stream,
        snapshot: () => {
          reads++;
          if (reads === deferredRead) return new Promise(resolve => { release = resolve; });
          return Promise.resolve(reads > deferredRead ? terminal : snapshot());
        },
      }, onProjection: value => views.push(value) });
      try {
        if (!initial) {
          await vi.waitFor(() => expect(views).toHaveLength(1));
          void observation.refresh();
        }
        await vi.waitFor(() => expect(reads).toBe(deferredRead));
        const event: NimiLocalAppConversationEvent = { type: 'turn-interrupted', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '3', reason: 'user_cancel' };
        stream.push(event);
        stream.push(event); // A replay does not create another eligibility read.
        stream.push({ type: 'state-changed', conversationAnchorId: 'anchor', sequence: '4', state: terminal.state });
        await Promise.resolve();
        release(snapshot());
        await vi.waitFor(() => expect(views.at(-1)?.turns[0]?.canRegenerate).toBe(true));
        expect(views.at(-1)?.throughSequence).toBe('4');
        expect(views.at(-1)?.state.textTurnId).toBeNull();
        expect(views.at(-1)?.messages[0]?.parts).toEqual(snapshot().messages[0]?.parts);
        expect(reads).toBe(deferredRead + 1);
      } finally { observation.close(); }
    }
  });

  it('keeps a healthy stream ready for the next turn when a background eligibility read fails', async () => {
    const stream = queue();
    const views: CanonicalConversationProjection[] = [];
    const statuses: string[] = [];
    let reject!: (error: Error) => void;
    let reads = 0;
    const subscribe = vi.fn(async () => stream);
    const observation = observeLocalAppConversation({ scope, conversation: {
      subscribe,
      snapshot: () => ++reads === 1 ? Promise.resolve(snapshot()) : new Promise((_resolve, rejectRead) => { reject = rejectRead; }),
    }, onProjection: value => views.push(value), onStatus: status => statuses.push(status) });
    try {
      await vi.waitFor(() => expect(views).toHaveLength(1));
      stream.push({ type: 'turn-failed', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '3', reasonCode: 'AI_PROVIDER_TIMEOUT', message: null });
      stream.push({ type: 'state-changed', conversationAnchorId: 'anchor', sequence: '4', state: { ...snapshot().state, textTurnId: null } });
      await vi.waitFor(() => expect(views.at(-1)?.state.textTurnId).toBeNull());
      const statusesBeforeFailure = [...statuses];
      reject(Object.assign(new Error('snapshot temporarily unavailable'), { retryable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(statuses).toEqual(statusesBeforeFailure);
      expect(views.at(-1)?.turns[0]?.canRegenerate).toBe(false);
      stream.push({ type: 'turn-accepted', conversationAnchorId: 'anchor', turnId: 'next', sequence: '5', origin: 'user', requestId: 'next-request' });
      stream.push({ type: 'state-changed', conversationAnchorId: 'anchor', sequence: '6', state: { ...snapshot().state, textTurnId: 'next' } });
      stream.push({ type: 'text-delta', conversationAnchorId: 'anchor', turnId: 'next', sequence: '7', delta: '仍可继续' });
      await vi.waitFor(() => expect(views.at(-1)?.transientByTurn.next?.text).toBe('仍可继续'));
      expect(statuses.at(-1)).toBe('ready');
      expect(statuses).not.toContain('error');
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(reads).toBe(2);
    } finally { observation.close(); }
  });

  it('isolates unreadable optional media and never blocks text on artifact bytes', async () => {
    let reject!: (error: Error) => void;
    const readArtifact = vi.fn(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const change = vi.fn();
    const media = createCanonicalConversationMediaReader({ scope, conversation: { readArtifact } as unknown as NimiLocalAppConversationClient, onChange: change });
    expect(media.get('image')).toEqual({ mediaUrl: null, mimeType: null });
    media.get('image'); expect(readArtifact).toHaveBeenCalledTimes(1);
    reject(new Error('optional media unavailable'));
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(media.get('image').mediaUrl).toBeNull();
    expect(readArtifact).toHaveBeenCalledTimes(1);
    media.close();
  });
});
