import { describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationSubscription,
  NimiLocalAppEmbodimentClient,
  NimiLocalAppEmbodimentEvent,
  NimiLocalAppConversationEvent,
} from '@nimiplatform/sdk/app';
import { SdkDriver } from './SdkDriver.js';

const STALE_HANDLE = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const CURRENT_HANDLE = `agent_ref_${'b'.repeat(43)}` as NimiLocalAppAgentHandle;
const ANCHOR = 'anchor-1';

function waitingSubscription<T>() {
  let end!: () => void;
  const ended = new Promise<void>(resolve => { end = resolve; });
  const cancel = vi.fn(async () => { end(); });
  return {
    cancel,
    [Symbol.asyncIterator]: () => ({ next: async (): Promise<IteratorResult<T>> => {
      await ended; return { done: true, value: undefined };
    } }),
  };
}

describe('SdkDriver current App-session Agent binding', () => {
  it.each(['success', 'failure', 'sender invalidated'] as const)('keeps the restarted generation intact when an old subscribe returns %s', async (outcome) => {
    let resolveOld!: (value: NimiLocalAppConversationSubscription) => void;
    let rejectOld!: (error: Error) => void;
    const pendingOld = new Promise<NimiLocalAppConversationSubscription>((resolve, reject) => {
      resolveOld = resolve; rejectOld = reject;
    });
    const oldStream = waitingSubscription<NimiLocalAppConversationEvent>();
    const currentStream = waitingSubscription<NimiLocalAppConversationEvent>();
    const currentEmbodiment = waitingSubscription<NimiLocalAppEmbodimentEvent>();
    const subscribe = vi.fn().mockImplementationOnce(() => pendingOld).mockResolvedValue(currentStream);
    const snapshot = vi.fn(async () => ({
      conversationAnchorId: ANCHOR, throughSequence: '7',
      turns: [], messages: [], actions: [], voices: [], truncatedBefore: false,
    }));
    const driver = new SdkDriver({
      conversation: { subscribe, snapshot } as unknown as NimiLocalAppConversationClient,
      embodiment: {
        snapshot: async () => ({ sequence: '7', observedAt: { seconds: '1', nanos: 0 }, provenance: 'runtime_agent_owner',
          activity: null, emotion: null, posture: null, voiceTiming: null }),
        subscribe: async () => currentEmbodiment,
      },
      agentHandle: CURRENT_HANDLE, conversationAnchorId: ANCHOR, activeWorldId: '', locale: 'en-US',
    });
    const statuses: string[] = [];
    driver.onStatusChange(status => statuses.push(status));
    const startingOld = driver.start().then(() => null, (error: unknown) => error);
    try {
      await driver.stop();
      await driver.start();
      const currentBundle = driver.getBundle();
      const currentStatuses = [...statuses];
      if (outcome === 'success') resolveOld(oldStream);
      else if (outcome === 'sender invalidated') rejectOld(Object.assign(new Error('old sender invalidated'), {
        reasonCode: 'electron-bundled-avatar-sender-invalidated',
      }));
      else rejectOld(new Error('old transport failure'));
      const oldError = await startingOld;
      if (outcome === 'success') expect(oldError).toMatchObject({ name: 'AbortError' });
      else if (outcome === 'sender invalidated') expect(oldError).toMatchObject({ reasonCode: 'electron-bundled-avatar-sender-invalidated' });
      else expect(oldError).toMatchObject({ message: 'old transport failure' });
      expect(driver.status).toBe('running');
      expect(driver.getLastError()).toBeNull();
      expect(driver.getBundle()).toBe(currentBundle);
      expect(statuses).toEqual(currentStatuses);
      expect(snapshot).toHaveBeenCalledOnce();
      expect(currentStream.cancel).not.toHaveBeenCalled();
      expect(currentEmbodiment.cancel).not.toHaveBeenCalled();
      if (outcome === 'success') expect(oldStream.cancel).toHaveBeenCalledOnce();
    } finally {
      resolveOld(oldStream);
      await driver.stop();
      await oldStream.cancel(); await currentStream.cancel(); await currentEmbodiment.cancel();
    }
  });

  it('uses the current handle supplied by the session binding', async () => {
    let release: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => { release = resolve; });
    const subscription: NimiLocalAppConversationSubscription = Object.assign({
      async *[Symbol.asyncIterator]() { await closed; },
    }, {
      async cancel() { release?.(); },
    });
    const subscribe = vi.fn(async () => subscription);
    const snapshot = vi.fn(async () => ({
      conversationAnchorId: ANCHOR,
      throughSequence: '0',
      turns: [], messages: [], actions: [], voices: [], truncatedBefore: false,
    }));
    const driver = new SdkDriver({
      conversation: { subscribe, snapshot } as unknown as NimiLocalAppConversationClient,
      embodiment: {
        async snapshot() {
          return {
            sequence: '1', observedAt: { seconds: '1', nanos: 0 }, provenance: 'runtime_agent_owner',
            activity: null, emotion: null, posture: null, voiceTiming: null,
          };
        },
        async subscribe() {
          return Object.assign({ async *[Symbol.asyncIterator]() { await closed; } }, {
            async cancel() { release?.(); },
          });
        },
      } as NimiLocalAppEmbodimentClient,
      agentHandle: STALE_HANDLE,
      runWithAgentHandle: (operation) => operation(CURRENT_HANDLE),
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });

    await driver.start();
    expect(subscribe).toHaveBeenCalledWith({
      agentHandle: CURRENT_HANDLE,
      conversationAnchorId: ANCHOR,
    });
    expect(snapshot).toHaveBeenCalledWith({
      agentHandle: CURRENT_HANDLE,
      conversationAnchorId: ANCHOR,
    });
    expect(driver.getBundle()).toMatchObject({
      active_agent_handle: CURRENT_HANDLE,
      custom: { agent_handle: CURRENT_HANDLE },
    });
    await driver.stop();
  });
});
