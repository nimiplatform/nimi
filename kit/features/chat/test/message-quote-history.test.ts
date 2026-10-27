import { describe, expect, it, vi } from 'vitest';
import type { NimiJsonObject, NimiLocalAppConversationClient, NimiLocalAppConversationMessageReadResult } from '@nimiplatform/kit/core/sdk-contract';
import { createLocalAppConversationQuote } from '../src/runtime/local-app-conversation-quote.js';
import { createLocalAppConversationHistory, projectConversationHistoryWindow } from '../src/runtime/local-app-conversation-history.js';
import { seedCanonicalConversationProjection } from '../src/headless/local-app-conversation-projection.js';
import { createAgentComposerPersistence } from '../src/headless/local-app-conversation-draft.js';
import { reconcileAgentSubmission } from '../src/headless/local-app-conversation-submission.js';
import { isLocalAppConversationAccessDenied } from '../src/headless/local-app-conversation-access.js';
import type { ConversationCanonicalMessage } from '../src/types.js';

const canonical = (id: string): ConversationCanonicalMessage => ({ id, sessionId: 'anchor', targetId: 'agent', source: 'agent', role: 'assistant', text: id, status: 'complete', createdAt: 'now', metadata: { canonicalMessageCommitted: true } });
function result(id: string, text = id, watermark = '10'): NimiLocalAppConversationMessageReadResult {
  const message = { messageId: id, turnId: `turn-${id}`, role: 'assistant' as const, partial: false, parts: [{ kind: 'text' as const, text }], quote: null };
  return { conversationAnchorId: 'anchor', readWatermark: watermark, message, quoteFormat: 'nimi.quote-text.v1', quoteText: text,
    window: { messages: [message], turns: [{ turnId: message.turnId, origin: 'user', requestId: null, retryOfTurnId: null, inputTurnId: message.turnId, canRegenerate: false, status: 'completed', phase: 'started', terminalReason: 'stop', reasonCode: null, message: null }], actions: [], voices: [], truncatedBefore: true, truncatedAfter: true } };
}
function live(id: string, sequence = '10') {
  const read = result(id);
  return seedCanonicalConversationProjection({ conversationAnchorId: 'anchor', throughSequence: sequence, state: { textTurnId: null, freeContactEnabled: false, pendingFollowUp: null, maxFollowUpTurns: 8 }, ...read.window });
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const options = (client: Partial<NimiLocalAppConversationClient>) => ({ scopeKey: 'scope', agentHandle: 'agent', conversationAnchorId: 'anchor', conversation: () => client as NimiLocalAppConversationClient });

describe('canonical quotation preparation', () => {
  it('rejects late preparation after replacement and cancel without changing the newer quotation', async () => {
    const a = deferred<NimiLocalAppConversationMessageReadResult>(); const b = deferred<NimiLocalAppConversationMessageReadResult>();
    const readMessage = vi.fn(input => input.messageId === 'a' ? a.promise : b.promise);
    const quote = createLocalAppConversationQuote(options({ readMessage }));
    const first = quote.prepare(canonical('a')); const second = quote.prepare(canonical('b'));
    b.resolve(result('b')); await second; a.resolve(result('a')); await first;
    expect(quote.getSnapshot().input?.sourceMessageId).toBe('b');
    quote.cancel(); expect(quote.draftRef.current).toBeNull(); expect(quote.getSnapshot().status).toBe('empty'); quote.dispose();
  });
  it('does not revive a canceled pending preparation', async () => {
    const pending = deferred<NimiLocalAppConversationMessageReadResult>();
    const quote = createLocalAppConversationQuote(options({ readMessage: () => pending.promise }));
    const work = quote.prepare(canonical('a')); quote.cancel(); pending.resolve(result('a')); await work;
    expect(quote.getSnapshot().status).toBe('empty'); expect(quote.draftRef.current).toBeNull(); quote.dispose();
  });
  it('preserves exact UTF-8 second occurrence and rejects a changed representation', async () => {
    const text = '🙂 same 🙂 same'; const start = new TextEncoder().encode('🙂 same 🙂 ').length;
    const quote = createLocalAppConversationQuote(options({ readMessage: async () => result('source', text) }));
    await quote.prepare(canonical('source'), { sourceText: text, text: 'same', startUtf16: 11, endUtf16: 15, startByte: start, endByte: start + 4 });
    expect(quote.getSnapshot()).toMatchObject({ status: 'ready', text: 'same', input: { startByte: start, endByte: start + 4 } });
    await quote.prepare(canonical('source'), { sourceText: 'changed', text: 'same', startUtf16: 0, endUtf16: 4, startByte: 0, endByte: 4 });
    expect(quote.getSnapshot()).toMatchObject({ status: 'error', failure: 'selection-changed' }); quote.dispose();
  });
  it('gives a specific long-quote recovery instead of silently truncating', async () => {
    const quote = createLocalAppConversationQuote(options({ readMessage: async () => result('long', 'a'.repeat(4097)) }));
    await quote.prepare(canonical('long')); expect(quote.getSnapshot()).toMatchObject({ status: 'error', failure: 'too-long' }); expect(quote.draftRef.current).toBeNull(); quote.dispose();
  });
  it('revalidates restored quotations and clears restricted preview on access loss', async () => {
    const input = options({ readMessage: async () => result('old', 'saved excerpt') });
    const quote = createLocalAppConversationQuote(input); await quote.prepare(canonical('old'));
    const saved = quote.draftRef.current!; quote.cancel(); quote.draftRef.current = saved;
    expect(quote.getSnapshot().status).toBe('preparing'); await Promise.resolve();
    expect(quote.getSnapshot().status).toBe('ready');
    quote.update({ ...input, agentHandle: null });
    expect(quote.getSnapshot()).toMatchObject({ status: 'error', failure: 'access', text: '' }); expect(quote.draftRef.current?.preview.text).toBe(''); quote.dispose();
  });
  it('retains the quoted selector as blocked while clearing the excerpt on typed access revocation', async () => {
    const deny = Object.assign(new Error('Access revoked'), { reasonCode: 'LOCAL_APP_ACCESS_DENIED' });
    const onAccessDenied = vi.fn();
    const readMessage = vi.fn().mockResolvedValueOnce(result('old', 'private excerpt')).mockRejectedValue(deny);
    const input = { ...options({ readMessage }), onAccessDenied };
    const quote = createLocalAppConversationQuote(input); await quote.prepare(canonical('old'));
    const retained = quote.draftRef.current!; quote.draftRef.current = retained; await Promise.resolve(); await Promise.resolve();
    expect(quote.getSnapshot()).toMatchObject({ status: 'error', failure: 'access', text: '', input: { sourceMessageId: 'old' } });
    expect(quote.draftRef.current?.preview.text).toBe(''); expect(onAccessDenied).toHaveBeenCalledWith(deny);
    quote.update({ ...input, accessDenied: true });
    expect(quote.getSnapshot().status).toBe('error'); quote.dispose();
  });
});

describe('bounded history navigation', () => {
  it('lets only the newest navigation move the view, retaining the original return position', async () => {
    const a = deferred<NimiLocalAppConversationMessageReadResult>(); const b = deferred<NimiLocalAppConversationMessageReadResult>();
    const history = createLocalAppConversationHistory({ ...options({ readMessage: input => input.messageId === 'a' ? a.promise : b.promise }), liveProjection: live('tail'), capturePosition: () => ({ messageId: 'tail', offset: 17 }) });
    const first = history.locate('a'); const second = history.locate('b');
    b.resolve(result('b')); await second; a.resolve(result('a')); await first;
    expect(history.getSnapshot().positionRequest?.messageId).toBe('b'); expect(history.getSnapshot().returnPosition).toEqual({ messageId: 'tail', offset: 17 });
    await history.returnToPrevious(); expect(history.getSnapshot().positionRequest).toMatchObject({ messageId: 'tail', offset: 17 }); history.dispose();
  });
  it('ignores an outstanding lookup after manual reading and can retry a real lookup failure', async () => {
    const pending = deferred<NimiLocalAppConversationMessageReadResult>();
    const readMessage = vi.fn().mockImplementationOnce(() => pending.promise).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result('old'));
    const history = createLocalAppConversationHistory({ ...options({ readMessage }), liveProjection: live('tail') });
    const first = history.locate('old'); history.cancelNavigation(); pending.resolve(result('old')); await first;
    expect(history.getSnapshot().result).toBeNull();
    await history.locate('old'); expect(history.getSnapshot().status).toBe('error');
    await history.retry(); expect(history.getSnapshot().status).toBe('history'); history.dispose();
  });
  it('keeps newer live facts and never advances the live reducer from a historical watermark', () => {
    const current = live('same', '15'); const read = result('same', 'older', '10');
    const combined = projectConversationHistoryWindow(current, read)!;
    expect(combined.messages[0]).toBe(current.messages[0]); expect(combined.throughSequence).toBe('15');
    expect(current.messages[0]!.parts).toEqual([{ kind: 'text', text: 'same' }]);
  });
  it('includes later committed media for a turn already in the window without appending unrelated live history', () => {
    const current = live('same', '15'); const read = result('same', 'same', '10');
    const voice = { voiceId: 'voice', messageId: 'same', turnId: 'turn-same', state: 'ready' as const, artifactId: 'audio', reasonCode: null, message: null };
    const image = { ...current.messages[0]!, messageId: 'image', parts: [{ kind: 'artifact-ref' as const, artifactId: 'image', mediaKind: 'image' as const, mimeType: 'image/png', displayName: null }] };
    const unrelated = { ...image, messageId: 'unrelated', turnId: 'different-turn' };
    const combined = projectConversationHistoryWindow({ ...current, messages: [...current.messages, image, unrelated], voices: [voice] }, read)!;
    expect(combined.messages.map(item => item.messageId)).toEqual(['same', 'image']);
    expect(combined.voices).toEqual([voice]); expect(combined.throughSequence).toBe('15');
  });
  it('clears an existing history window only for canonical access failures, not transport errors or matching prose', async () => {
    const denied = Object.assign(new Error('revoked'), { reasonCode: 'LOCAL_APP_SESSION_REVOKED' });
    const onAccessDenied = vi.fn();
    const readMessage = vi.fn().mockResolvedValueOnce(result('old')).mockRejectedValueOnce(new Error('LOCAL_APP_ACCESS_DENIED is only prose')).mockRejectedValueOnce(denied);
    const history = createLocalAppConversationHistory({ ...options({ readMessage }), liveProjection: live('tail'), onAccessDenied });
    await history.locate('old'); await history.locate('other');
    expect(history.getSnapshot().result?.message.messageId).toBe('old'); expect(onAccessDenied).not.toHaveBeenCalled();
    await history.retry();
    expect(history.getSnapshot()).toMatchObject({ accessDenied: true, status: 'error', result: null, positionRequest: null });
    expect(onAccessDenied).toHaveBeenCalledWith(denied); history.dispose();
    expect(isLocalAppConversationAccessDenied({ reasonCode: 'SESSION_EXPIRED' })).toBe(true);
    expect(isLocalAppConversationAccessDenied({ reasonCode: 'LOCAL_APP_SESSION_EXPIRED' })).toBe(false);
    expect(isLocalAppConversationAccessDenied(new Error('LOCAL_APP_ACCESS_DENIED'))).toBe(false);
  });
});

describe('quotation submission persistence', () => {
  for (const replacement of ['b', 'a']) it(`preserves ${replacement === 'a' ? 'a new same-selector intent' : 'another quotation'} selected while attachments upload`, async () => {
    const quote = createLocalAppConversationQuote(options({ readMessage: async input => result(input.messageId) }));
    await quote.prepare(canonical('a'));
    const capturedRevision = quote.draftRef.revision;
    const frozenQuote = quote.getSnapshot().input!;
    const draft = { current: 'original', revision: 0 };
    let stored: NimiJsonObject = { version: 1, draft: '' };
    const persistence = createAgentComposerPersistence({ agentBinding: `agent_binding_${'a'.repeat(43)}`, draft, quoteDraft: quote.draftRef, subscribeQuote: quote.subscribe,
      isCurrent: () => true, subscribe: () => () => {}, onState: () => {}, onRestored: () => {},
      storage: { readJson: async () => ({ value: stored, sizeBytes: 1 }), writeJson: async (_path, value) => { stored = value as NimiJsonObject; return { value, sizeBytes: 1 }; } } });
    await persistence.ready;
    // The send intent already exists; its attachment work has not reached prepare.
    quote.cancel(); await quote.prepare(canonical(replacement));
    await persistence.prepare({ requestId: 'old-request', conversationAnchorId: 'anchor', text: 'original', artifactIds: ['uploaded'], quote: frozenQuote }, { quoteRevision: capturedRevision, textRevision: 0 });
    expect((stored.quoteDraft as { input: { sourceMessageId: string } }).input.sourceMessageId).toBe(replacement);
    await persistence.acknowledge('old-request');
    expect(quote.getSnapshot().input?.sourceMessageId).toBe(replacement);
    expect((stored.quoteDraft as { input: { sourceMessageId: string } }).input.sourceMessageId).toBe(replacement);
    persistence.close(); quote.dispose();
  });
  it('freezes the quote envelope, preserves newer draft quotations, and sends the same reference on reconciliation', async () => {
    const quote = createLocalAppConversationQuote(options({ readMessage: async input => result(input.messageId) }));
    await quote.prepare(canonical('a'));
    const writes: unknown[] = [];
    const draft = { current: 'original input', revision: 0 };
    const persistence = createAgentComposerPersistence({ agentBinding: `agent_binding_${'a'.repeat(43)}`, draft, quoteDraft: quote.draftRef, subscribeQuote: quote.subscribe,
      isCurrent: () => true, subscribe: () => () => {}, onState: () => {}, onRestored: () => {},
      storage: { readJson: async () => ({ value: { version: 1, draft: '' }, sizeBytes: 1 }), writeJson: async (_path, value) => { writes.push(value); return { value, sizeBytes: 1 }; } } });
    await persistence.ready;
    const submission = { requestId: 'request', conversationAnchorId: 'anchor', text: draft.current, artifactIds: [], quote: quote.getSnapshot().input! };
    await persistence.prepare(submission); expect(quote.getSnapshot().input?.sourceMessageId).toBe('a');
    await quote.prepare(canonical('b')); await persistence.acknowledge('request');
    expect(quote.getSnapshot().input?.sourceMessageId).toBe('b');
    const send = vi.fn(async () => ({ turnId: 'turn' }));
    await reconcileAgentSubmission({ agentHandle: 'agent' as never, conversation: { send } as unknown as NimiLocalAppConversationClient, submission, sendIfMissing: true, isCurrent: () => true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request', quote: expect.objectContaining({ sourceMessageId: 'a' }) }));
    expect(writes.length).toBeGreaterThan(0); persistence.close(); quote.dispose();
  });
});
