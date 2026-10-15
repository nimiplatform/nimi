import { afterEach, expect, it } from 'vitest';
import { createNimiLocalAppStandardShellSurface } from '../src/bridge/local-app.js';
import { getNimiContentRefusalNotice, retireNimiContentRefusalPresentation } from '../src/bridge/content-refusal.js';

afterEach(() => {
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
  retireNimiContentRefusalPresentation();
});

const cases = (['text', 'conversation', 'realtime'] as const).flatMap(kind =>
  [false, true].flatMap(retire => (kind === 'realtime' ? ['error'] as const : ['error', 'next'] as const)
    .map(carrier => ({ kind, retire, carrier }))));

it.each(cases)('preserves the opening scope without replacing the original failure: $kind / $carrier / retire=$retire', async ({ kind, retire, carrier }) => {
  let resolveOpen!: (value: unknown) => void;
  let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const opening = new Promise(resolve => { resolveOpen = resolve; });
  let emit: ((event: { payload: unknown }) => void) | undefined;
  (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
    invoke: async (_command: string, input: { payload: { action?: string } }) => {
      if (input.payload.action === 'cancel') return { subscriptionId: 'old-stream', closed: true };
      started();
      return opening;
    },
    listen: (_name: string, handler: typeof emit) => { emit = handler; return () => {}; },
  };
  const surface = createNimiLocalAppStandardShellSurface();
  const promise = kind === 'text'
    ? surface.ai.text.streamTurn({ messages: [{ role: 'user', text: 'ordinary request' }] })
    : kind === 'conversation'
      ? surface.conversation.subscribe({ agentHandle: 'old-handle', conversationAnchorId: 'old-anchor' })
      : surface.agentRealtime.subscribe({ agentHandle: 'old-handle', realtimeSessionId: 'old-session', generation: '1' });
  await began;
  if (retire) retireNimiContentRefusalPresentation();
  resolveOpen({ subscriptionId: 'old-stream', eventName: 'old-events' });
  const subscription = await promise;
  const iterator = subscription.events[Symbol.asyncIterator]();
  try {
    if (carrier === 'error') {
      const pending = iterator.next();
      emit!({ payload: { subscriptionId: 'old-stream', eventType: 'error', error: {
        code: 'runtime-permission-denied', reasonCode: 'AI_CONTENT_FILTER_BLOCKED', actionHint: 'review_input_or_context', source: 'host',
      } } });
      await expect(pending).rejects.toMatchObject({ reasonCode: 'AI_CONTENT_FILTER_BLOCKED' });
    } else {
      // Conversation may subscribe while a turn is already active; Runtime
      // does not replay the turn-started event to the new subscription.
      const failure = kind === 'text'
        ? { type: 'failed', sequence: '2', traceId: 'trace', reasonCode: 'ai-content-filter-blocked', actionHint: '' }
        : { type: 'turn-failed', sequence: '2', conversationAnchorId: 'old-anchor', turnId: 'old-turn', reasonCode: 'AI_CONTENT_FILTER_BLOCKED', message: null };
      emit!({ payload: { subscriptionId: 'old-stream', eventType: 'next', event: failure } });
      await expect(iterator.next()).resolves.toMatchObject({ done: false, value: failure });
    }
    if (retire) expect(getNimiContentRefusalNotice()).toBeNull();
    else expect(getNimiContentRefusalNotice()?.reasonCode).toBe('AI_CONTENT_FILTER_BLOCKED');
  } finally { await subscription.cancel(); }
});
