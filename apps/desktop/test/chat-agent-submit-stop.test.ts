import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';

import { submitAgentConversationTurn } from '../src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.js';
import { createRuntimeAgentChatConversationProvider } from '../src/shell/renderer/features/chat/chat-agent-runtime-provider.js';
import { createAgentVisibleProjectionStore } from '../src/shell/renderer/features/chat/chat-agent-visible-projection-store.js';
import { RUNTIME_AGENT_CHAT_MODE_ID } from '../src/shell/renderer/features/chat/chat-agent-runtime-mode.js';
import type { AgentSubmitDriverEffectQueue } from '../src/shell/renderer/features/chat/chat-agent-shell-submit-driver.js';
import { createTestStreamController } from './helpers/test-stream-controller.js';

const TARGET = {
  agentHandle: 'agent-a',
  conversationAnchorId: 'anchor-1',
  displayName: 'Agent A',
  handle: '',
  avatarUrl: null,
  worldId: null,
  worldName: null,
  bio: null,
  ownershipType: null,
  greeting: null,
  builtinDocsContext: null,
} as const;

// Runs the real submit, provider and Runtime-turn chain against a scripted
// Conversation. `stopBeforeSend` holds the subscription open so the user can
// stop before send(); otherwise Runtime accepts the turn first.
function createSubmitHarness(input: { stopBeforeSend: boolean; loseAck?: boolean }) {
  const streamController = createTestStreamController();
  const draft = { current: '' };
  const reported: unknown[] = [];
  let ended = false;
  let finishSubscription: (() => void) | undefined;
  let releaseSubscribe: (() => void) | undefined;
  let subscribes = 0;
  let sends = 0;
  let rejectSend: (() => void) | undefined;
  const endSubscription = () => { ended = true; finishSubscription?.(); };
  const conversation = {
    open: async () => ({ conversationAnchorId: TARGET.conversationAnchorId }),
    subscribe: async () => {
      subscribes += 1;
      if (input.stopBeforeSend) await new Promise<void>((resolve) => { releaseSubscribe = resolve; });
      return {
        cancel: async () => { endSubscription(); },
        [Symbol.asyncIterator]: () => ({
          next: () => (ended
            ? Promise.resolve<IteratorResult<never>>({ done: true, value: undefined })
            : new Promise<IteratorResult<never>>((resolve) => {
              finishSubscription = () => resolve({ done: true, value: undefined });
            })),
        }),
      };
    },
    send: async () => {
      sends += 1;
      if (input.loseAck) await new Promise<void>((_resolve, reject) => { rejectSend = () => reject(new Error('accepted reply lost')); });
      return { turnId: 'runtime-turn-1' };
    },
    // Runtime ends the turn's events after an interrupt.
    interruptTurn: async () => { endSubscription(); return {}; },
    readArtifact: async () => { throw new Error('unused'); },
  };
  const sdk = { conversation: () => conversation } as never;
  const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as never;
  const provider = createRuntimeAgentChatConversationProvider({ streamController, t, sdk, now: Date.now });
  const hostInput = {
    now: Date.now,
    sdk,
    subjectUserId: 'account-1',
    streamController,
    activeTarget: TARGET,
    activeThreadId: null,
    applyDriverEffects: (threadId: string, effects: AgentSubmitDriverEffectQueue) => {
      for (const streamEffect of effects.streamEffects) streamController.feedStreamEvent(threadId, streamEffect);
      if (effects.hostPatchEffect) draft.current = effects.hostPatchEffect.composerText;
      return effects.finalSession;
    },
    bundle: null,
    currentComposerTextRef: draft,
    queryClient: new QueryClient(),
    reportHostError: (error: unknown) => { reported.push(error); },
    runAgentTurn: (turn: { threadId: string; turnId: string; userMessage: never; signal: AbortSignal; conversationAnchorId: string; runtimeThreadId: string }) => provider.runTurn({
      modeId: RUNTIME_AGENT_CHAT_MODE_ID,
      threadId: turn.threadId,
      turnId: turn.turnId,
      userMessage: turn.userMessage,
      history: [],
      signal: turn.signal,
      metadata: {
        agentHandle: TARGET.agentHandle,
        conversationAnchorId: turn.conversationAnchorId,
        runtimeThreadId: turn.runtimeThreadId,
        reasoningPreference: 'off',
        textMaxOutputTokensRequested: null,
      },
    }),
    selectedAgentHandle: TARGET.agentHandle,
    selectedThreadRecord: null,
    setBundleCache: () => undefined,
    setFooterHostState: () => undefined,
    setSelectionForAgentHandle: () => undefined,
    setSubmittingThreadId: () => undefined,
    clearSelectedTarget: () => undefined,
    submittingThreadId: null,
    syncSelectionToThread: () => undefined,
    t,
    textModelContextTokens: null,
    textMaxOutputTokensRequested: null,
    targetByAgentHandle: new Map([[TARGET.agentHandle, TARGET]]),
    targetsReady: true,
    threads: [],
    threadsReady: true,
  };
  const submit = () => submitAgentConversationTurn({
    hostInput: hostInput as never,
    payload: { text: 'hello there', attachments: [] },
    activeSubmitsByThreadRef: { current: new Map() },
    submittingLockTokenRef: { current: 0 },
    visibleProjections: createAgentVisibleProjectionStore(),
  });
  const stop = async () => {
    const reached = () => (input.stopBeforeSend ? subscribes > 0 : sends > 0);
    for (let attempt = 0; attempt < 100 && !reached(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(reached(), 'the turn did not reach the point to stop at');
    // The composer's Stop control cancels the thread's stream.
    streamController.cancelStream(`agent-thread:${TARGET.conversationAnchorId}`);
    releaseSubscribe?.();
    rejectSend?.();
  };
  return { draft, reported, submit, stop, streamController, sendCount: () => sends, dispose: () => { streamController.clearAllStreams(); hostInput.queryClient.clear(); } };
}

test('stopping a reply Runtime already accepted ends the turn without an error or a resend', async (t) => {
  const harness = createSubmitHarness({ stopBeforeSend: false });
  t.after(harness.dispose);
  const submitted = harness.submit();
  await harness.stop();
  await submitted;
  assert.equal(harness.sendCount(), 1);
  assert.equal(harness.draft.current, '', 'accepted text came back into the composer');
  assert.deepEqual(harness.reported, []);
});

test('stopping before Runtime accepted the text keeps it for the user without an error', async (t) => {
  const harness = createSubmitHarness({ stopBeforeSend: true });
  t.after(harness.dispose);
  const submitted = harness.submit();
  await harness.stop();
  await submitted;
  assert.equal(harness.sendCount(), 0);
  assert.equal(harness.draft.current, 'hello there');
  assert.deepEqual(harness.reported, []);
});

test('stopping after admission with a lost reply preserves the draft and reports uncertainty', async (t) => {
  const harness = createSubmitHarness({ stopBeforeSend: false, loseAck: true });
  t.after(harness.dispose);
  const submitted = harness.submit();
  const rejected = assert.rejects(submitted, /may have been accepted/);
  await harness.stop();
  await rejected;
  assert.equal(harness.sendCount(), 1);
  assert.equal(harness.draft.current, 'hello there');
  assert.equal(harness.reported.length, 1);
});
