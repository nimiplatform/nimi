import { describe, expect, it } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSubscription,
} from '@nimiplatform/sdk/app';
import { SdkDriver, type SdkDriverOptions } from './SdkDriver.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const ANCHOR = 'anchor-1';

function conversation(events: readonly NimiLocalAppConversationEvent[]): NimiLocalAppConversationClient {
  let release: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => { release = resolve; });
  const subscription: NimiLocalAppConversationSubscription = Object.assign({
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
      await closed;
    },
  }, {
    async cancel() { release?.(); },
  });
  return {
    async subscribe() { return subscription; },
    async snapshot() {
      return {
        conversationAnchorId: ANCHOR,
        throughSequence: '0',
        turns: [], messages: [], actions: [], voices: [], truncatedBefore: false,
      };
    },
  } as unknown as NimiLocalAppConversationClient;
}

describe('SdkDriver canonical App Product Plane', () => {
  it('binds only agentHandle + Conversation anchor and consumes canonical events', async () => {
    const driver = new SdkDriver({
      conversation: conversation([{
        type: 'message-committed',
        conversationAnchorId: ANCHOR,
        sequence: '1',
        turnId: 'turn-1',
        message: {
          messageId: 'message-1', turnId: 'turn-1', role: 'assistant',
          parts: [{ kind: 'text', text: 'Hello from canonical Conversation' }],
        },
      }]),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
    });

    await driver.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(driver.getBundle()).toMatchObject({
      active_user_id: AGENT_HANDLE,
      status_text: 'Hello from canonical Conversation',
      custom: {
        agent_id: AGENT_HANDLE,
        conversation_anchor_id: ANCHOR,
        latest_committed_message_text: 'Hello from canonical Conversation',
      },
    });
    expect(JSON.stringify(driver.getBundle())).not.toMatch(/local-agent:|ownerUserId|runtimeSourceRef|localAgentRef/u);
    await driver.stop();
  });

  it('rejects the retired raw identity option shape at compile time', () => {
    const options: SdkDriverOptions = {
      conversation: conversation([]),
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: ANCHOR,
      activeWorldId: '',
      locale: 'en-US',
      // @ts-expect-error raw owner identity is not part of the canonical driver contract.
      ownerUserId: 'owner-1',
    };
    expect(options.agentHandle).toBe(AGENT_HANDLE);
  });
});
