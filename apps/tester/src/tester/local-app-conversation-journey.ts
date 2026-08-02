import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';

export type TesterConversationPort = {
  readonly open: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
  }) => Promise<{ readonly conversationAnchorId: string }>;
  readonly send: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
    readonly requestId: string;
    readonly text: string;
    readonly attachments: readonly [];
  }) => Promise<{ readonly messageId: string }>;
  readonly subscribe: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
  }) => Promise<AsyncIterable<NimiLocalAppConversationEvent> & { readonly cancel: () => Promise<void> }>;
  readonly snapshot: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
  }) => Promise<NimiLocalAppConversationSnapshot>;
};

export type TesterConversationJourneyResult = {
  readonly conversationAnchorId: string;
  readonly messageId: string;
  readonly subscribed: true;
  readonly terminalMessageType: 'runtime.agent.turn.completed';
  readonly terminalReason: string;
  readonly assistantText: string;
  readonly snapshot: NimiLocalAppConversationSnapshot;
};

export async function runTesterConversationJourney(input: {
  readonly conversation: TesterConversationPort;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly requestId: string;
  readonly text: string;
}): Promise<TesterConversationJourneyResult> {
  const opened = await input.conversation.open({
    agentHandle: input.agentHandle,
  });
  const scope = {
    agentHandle: input.agentHandle,
    conversationAnchorId: opened.conversationAnchorId,
  } as const;
  const subscription = await input.conversation.subscribe(scope);
  try {
    const sent = await input.conversation.send({
      ...scope,
      requestId: input.requestId,
      text: input.text,
      attachments: [],
    });
    const terminal = await waitForTerminalTurn({
      subscription,
      requestId: input.requestId,
    });
    const snapshot = await input.conversation.snapshot(scope);
    return Object.freeze({
      conversationAnchorId: opened.conversationAnchorId,
      messageId: sent.messageId,
      subscribed: true as const,
      terminalMessageType: terminal.messageType,
      terminalReason: terminal.reason,
      assistantText: terminal.assistantText,
      snapshot,
    });
  } finally {
    await subscription.cancel();
  }
}

async function waitForTerminalTurn(input: {
  readonly subscription: AsyncIterable<NimiLocalAppConversationEvent>;
  readonly requestId: string;
}): Promise<{
  readonly messageType: 'runtime.agent.turn.completed';
  readonly reason: string;
  readonly assistantText: string;
}> {
  let runtimeTurnId = '';
  let assistantText = '';
  for await (const event of input.subscription) {
    const payload = recordValue(event.payload);
    const eventTurnId = stringValue(payload, 'turn_id', 'turnId');
    if (!runtimeTurnId) {
      if (event.messageType !== 'runtime.agent.turn.accepted' || !eventTurnId) continue;
      const detail = recordValue(payload.detail);
      if (stringValue(detail, 'request_id', 'requestId') !== input.requestId) continue;
      runtimeTurnId = eventTurnId;
      continue;
    }
    if (eventTurnId !== runtimeTurnId) continue;
    const detail = recordValue(payload.detail);
    if (event.messageType === 'runtime.agent.turn.message_committed') {
      const committedText = stringValue(detail, 'text');
      if (committedText.trim()) assistantText = committedText;
      continue;
    }
    if (event.messageType === 'runtime.agent.turn.failed') {
      throw terminalFailure(
        stringValue(detail, 'message') || 'Runtime Agent turn failed.',
        stringValue(detail, 'reason_code', 'reasonCode')
          || event.reasonCode
          || 'runtime-agent-turn-failed',
      );
    }
    if (event.messageType === 'runtime.agent.turn.interrupted') {
      throw terminalFailure(
        'Runtime Agent turn was interrupted before completion.',
        stringValue(detail, 'reason', 'terminal_reason', 'terminalReason')
          || event.reasonCode
          || 'runtime-agent-turn-interrupted',
      );
    }
    if (event.messageType !== 'runtime.agent.turn.completed') continue;
    if (!assistantText.trim()) {
      throw terminalFailure(
        'Runtime Agent turn completed without a committed assistant message.',
        'tester-conversation-terminal-message-missing',
      );
    }
    return Object.freeze({
      messageType: 'runtime.agent.turn.completed' as const,
      reason: stringValue(detail, 'terminal_reason', 'terminalReason') || 'completed',
      assistantText,
    });
  }
  throw terminalFailure(
    'Runtime Agent conversation stream ended without a terminal event.',
    'tester-conversation-terminal-missing',
  );
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringValue(
  record: Readonly<Record<string, unknown>>,
  ...keys: readonly string[]
): string {
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key];
  }
  return '';
}

function terminalFailure(message: string, reasonCode: string): Error {
  return Object.assign(new Error(message), {
    reasonCode,
    actionHint: 'inspect_runtime_agent_terminal_event',
    source: 'runtime',
  });
}
