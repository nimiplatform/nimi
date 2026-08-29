import { describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationSubscription,
  NimiLocalAppEmbodimentClient,
} from '@nimiplatform/sdk/app';
import { SdkDriver } from './SdkDriver.js';

const STALE_HANDLE = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const CURRENT_HANDLE = `agent_ref_${'b'.repeat(43)}` as NimiLocalAppAgentHandle;
const ANCHOR = 'anchor-1';

describe('SdkDriver current App-session Agent binding', () => {
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
