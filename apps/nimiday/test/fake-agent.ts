// Test-only stand-in for the public agent.local client. It lets a test push
// Conversation events and inspect what NimiDay sent; it never ships in the App.

import type { NimiLocalAppConversationEvent, NimiLocalAppConversationMessage } from '@nimiplatform/sdk/app';

type Reference = { agentHandle: string; displayName: string; avatarUrl: string | null; agentBinding?: string };

export type FakeCall = { callId: string; turnId: string; name: string; argumentsJson: string };

export function handle(suffix: string): string {
  return `agent_ref_${suffix.padEnd(43, 'x').slice(0, 43)}`;
}

export function createFakeAgentClient(options: {
  references: Reference[];
  withWork?: boolean;
  busy?: () => boolean;
  /** The agent is listed but its conversation cannot be opened right now. */
  openFails?: () => boolean;
  /** Opening the conversation waits for this, like a slow restore. */
  openGate?: Promise<void>;
}) {
  const anchor = 'anchor_1';
  let sequence = 10;
  let turn = 0;
  const messages: NimiLocalAppConversationMessage[] = [];
  const queue: NimiLocalAppConversationEvent[] = [];
  let wake: (() => void) | null = null;
  const sent: Record<string, unknown>[] = [];
  const pendingCalls: FakeCall[] = [];
  const submitted: { callId: string; resultJson: string; isError: boolean }[] = [];
  const interrupts: { expectedTurnId?: string }[] = [];
  let interruptNotActive = false;
  let references = options.references;
  // Handles belong to one technical session; a renewed session invalidates the old ones.
  const staleHandles = new Set<string>();
  let endCurrentStream: (() => void) | null = null;
  const requireHandle = (input: { agentHandle?: string }) => {
    if (input.agentHandle && staleHandles.has(input.agentHandle)) throw Object.assign(new Error('stale agent handle'), { reasonCode: 'local-app-selector-invalid' });
  };

  const push = (event: Record<string, unknown>) => {
    sequence += 1;
    queue.push({ conversationAnchorId: anchor, sequence: String(sequence), ...event } as NimiLocalAppConversationEvent);
    wake?.();
  };

  const conversation: Record<string, unknown> = {
    open: async (input: { agentHandle: string }) => {
      requireHandle(input);
      if (options.openGate) await options.openGate;
      if (options.openFails?.()) throw Object.assign(new Error('conversation unavailable'), { reasonCode: 'runtime-service-untrusted' });
      return { conversationAnchorId: anchor, activeTurnId: null };
    },
    subscribe: async (input: { agentHandle: string }) => {
      requireHandle(input);
      let cancelled = false;
      endCurrentStream = () => { cancelled = true; wake?.(); };
      const iterator: AsyncIterableIterator<NimiLocalAppConversationEvent> = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          while (!cancelled) {
            const event = queue.shift();
            if (event) return { value: event, done: false };
            await new Promise<void>((resolve) => { wake = resolve; });
          }
          return { value: undefined, done: true };
        },
      };
      return Object.assign(iterator, { cancel: async () => { cancelled = true; wake?.(); } });
    },
    snapshot: async (input: { agentHandle: string }) => (requireHandle(input), {
      conversationAnchorId: anchor,
      throughSequence: String(sequence),
      turns: [],
      messages: [...messages],
      actions: [],
      voices: [],
      truncatedBefore: false,
    }),
    send: async (input: Record<string, unknown>) => {
      if (options.busy?.()) throw Object.assign(new Error('agent busy'), { reasonCode: 'agent-busy' });
      sent.push(input);
      turn += 1;
      const turnId = `turn_${turn}`;
      return { turnId };
    },
    interruptTurn: async (input: { expectedTurnId?: string }) => {
      interrupts.push({ ...(input.expectedTurnId !== undefined ? { expectedTurnId: input.expectedTurnId } : {}) });
      if (interruptNotActive) throw Object.assign(new Error('turn not active'), { reasonCode: 'agent-turn-not-active' });
      return { turnId: input.expectedTurnId ?? `turn_${turn}` };
    },
    readArtifact: async () => { throw new Error('no artifacts'); },
    renderVoice: async () => ({ status: 'unavailable', voiceId: 'v', turnId: 't', messageId: 'm', reasonCode: 'VOICE_UNAVAILABLE', message: null }),
    transcribeVoice: async () => ({ text: '' }),
    uploadAttachment: async () => { throw new Error('unused'); },
  };
  if (options.withWork) {
    conversation.listToolCalls = async (input: { turnId: string }) => pendingCalls.filter((call) => call.turnId === input.turnId && !submitted.some((entry) => entry.callId === call.callId));
    conversation.submitToolResult = async (input: { callId: string; resultJson: string; isError: boolean }) => {
      submitted.push({ callId: input.callId, resultJson: input.resultJson, isError: input.isError });
      return { callId: input.callId };
    };
  }

  return {
    client: {
      agents: { listReferences: async () => references },
      conversation,
    } as never,
    anchor,
    sent,
    submitted,
    interrupts,
    setInterruptNotActive: (value: boolean) => { interruptNotActive = value; },
    /** Close the live event stream from the Runtime side. */
    endStream: () => endCurrentStream?.(),
    /** Renew the technical session: every Agent gets a new handle, the old ones stop working. */
    renewSession: (suffix: string) => {
      for (const reference of references) staleHandles.add(reference.agentHandle);
      references = references.map((reference) => ({ ...reference, agentHandle: handle(`${suffix}${reference.displayName}`) }));
    },
    push,
    addMessage: (message: NimiLocalAppConversationMessage) => messages.push(message),
    requestCall: (call: FakeCall) => {
      pendingCalls.push(call);
      push({ type: 'live-tool', turnId: call.turnId, tool: { turnId: call.turnId, toolId: call.callId, name: call.name, lifecycle: 'started', progress: null, result: null, reasonCode: null } });
    },
  };
}

export async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}
