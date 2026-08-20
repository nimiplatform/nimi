import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';

export type LabConversationPort = {
  readonly open: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
  }) => Promise<{ readonly conversationAnchorId: string }>;
  readonly send: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
    readonly requestId: string;
    readonly text: string;
  }) => Promise<{ readonly turnId: string }>;
  readonly interruptTurn: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
  }) => Promise<{ readonly turnId: string }>;
  readonly subscribe: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
  }) => Promise<AsyncIterable<NimiLocalAppConversationEvent> & { readonly cancel: () => Promise<void> }>;
  readonly snapshot: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
  }) => Promise<NimiLocalAppConversationSnapshot>;
};

export type LabConversationJourneyResult = {
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly subscribed: true;
  readonly terminalType: 'turn-completed';
  readonly terminalReason: string;
  readonly assistantText: string;
  readonly snapshot: NimiLocalAppConversationSnapshot;
};

export type LabConversationInterruptJourneyResult = {
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly subscribed: true;
  readonly terminalType: 'turn-interrupted';
  readonly terminalReason: string;
};

export async function runLabConversationJourney(input: {
  readonly conversation: LabConversationPort;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly requestId: string;
  readonly text: string;
}): Promise<LabConversationJourneyResult> {
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
    });
    const terminal = await waitForTerminalTurn({
      subscription,
      requestId: input.requestId,
      turnId: sent.turnId,
      conversationAnchorId: opened.conversationAnchorId,
    });
    const snapshot = await input.conversation.snapshot(scope);
    return Object.freeze({
      conversationAnchorId: opened.conversationAnchorId,
      turnId: sent.turnId,
      subscribed: true as const,
      terminalType: terminal.type,
      terminalReason: terminal.reason,
      assistantText: terminal.assistantText,
      snapshot,
    });
  } finally {
    await subscription.cancel();
  }
}

export async function runLabConversationInterruptJourney(input: {
  readonly conversation: LabConversationPort;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly requestId: string;
  readonly text: string;
}): Promise<LabConversationInterruptJourneyResult> {
  const opened = await input.conversation.open({
    agentHandle: input.agentHandle,
  });
  const scope = {
    agentHandle: input.agentHandle,
    conversationAnchorId: opened.conversationAnchorId,
  } as const;
  const subscription = await input.conversation.subscribe(scope);
  const iterator = subscription[Symbol.asyncIterator]();
  try {
    const sent = await input.conversation.send({
      ...scope,
      requestId: input.requestId,
      text: input.text,
    });
    await waitForAcceptedTurn({
      iterator,
      requestId: input.requestId,
      turnId: sent.turnId,
      conversationAnchorId: opened.conversationAnchorId,
    });
    const interrupted = await input.conversation.interruptTurn(scope);
    if (interrupted.turnId !== sent.turnId) {
      throw terminalFailure(
        'Runtime Agent interrupted a different turn.',
        'lab-conversation-interrupt-turn-mismatch',
      );
    }
    const terminalReason = await waitForInterruptedTurn({
      iterator,
      turnId: sent.turnId,
      conversationAnchorId: opened.conversationAnchorId,
    });
    return Object.freeze({
      conversationAnchorId: opened.conversationAnchorId,
      turnId: sent.turnId,
      subscribed: true as const,
      terminalType: 'turn-interrupted' as const,
      terminalReason,
    });
  } finally {
    await subscription.cancel();
  }
}

async function waitForAcceptedTurn(input: {
  readonly iterator: AsyncIterator<NimiLocalAppConversationEvent>;
  readonly requestId: string;
  readonly turnId: string;
  readonly conversationAnchorId: string;
}): Promise<void> {
  for (;;) {
    const next = await input.iterator.next();
    if (next.done) {
      throw terminalFailure(
        'Runtime Agent conversation stream ended before turn acceptance.',
        'lab-conversation-acceptance-missing',
      );
    }
    const event = next.value;
    if (event.conversationAnchorId !== input.conversationAnchorId || event.turnId !== input.turnId) {
      continue;
    }
    if (event.type === 'turn-accepted' && event.requestId === input.requestId) return;
    if (event.type === 'turn-failed') {
      throw terminalFailure(event.message || 'Runtime Agent turn failed.', event.reasonCode);
    }
    if (event.type === 'turn-interrupted') {
      throw terminalFailure('Runtime Agent turn was interrupted before acceptance.', event.reason);
    }
    if (event.type === 'turn-completed') {
      throw terminalFailure(
        'Runtime Agent turn completed before acceptance was observed.',
        'lab-conversation-acceptance-missing',
      );
    }
  }
}

async function waitForInterruptedTurn(input: {
  readonly iterator: AsyncIterator<NimiLocalAppConversationEvent>;
  readonly turnId: string;
  readonly conversationAnchorId: string;
}): Promise<string> {
  for (;;) {
    const next = await input.iterator.next();
    if (next.done) {
      throw terminalFailure(
        'Runtime Agent conversation stream ended without an interrupted terminal event.',
        'lab-conversation-interrupt-terminal-missing',
      );
    }
    const event = next.value;
    if (event.conversationAnchorId !== input.conversationAnchorId || event.turnId !== input.turnId) {
      continue;
    }
    if (event.type === 'turn-interrupted') return event.reason;
    if (event.type === 'turn-failed') {
      throw terminalFailure(event.message || 'Runtime Agent turn failed.', event.reasonCode);
    }
    if (event.type === 'turn-completed') {
      throw terminalFailure(
        'Runtime Agent turn completed before interruption was observed.',
        'lab-conversation-interrupt-not-observed',
      );
    }
  }
}

async function waitForTerminalTurn(input: {
  readonly subscription: AsyncIterable<NimiLocalAppConversationEvent>;
  readonly requestId: string;
  readonly turnId: string;
  readonly conversationAnchorId: string;
}): Promise<{
  readonly type: 'turn-completed';
  readonly reason: string;
  readonly assistantText: string;
}> {
  let accepted = false;
  let assistantText = '';
  for await (const event of input.subscription) {
    if (event.conversationAnchorId !== input.conversationAnchorId || event.turnId !== input.turnId) {
      continue;
    }
    switch (event.type) {
      case 'turn-accepted':
        if (event.requestId === input.requestId) accepted = true;
        break;
      case 'message-committed':
        if (accepted && event.text.trim()) assistantText = event.text;
        break;
      case 'turn-failed':
        if (accepted) {
          throw terminalFailure(
            event.message || 'Runtime Agent turn failed.',
            event.reasonCode,
          );
        }
        break;
      case 'turn-interrupted':
        if (accepted) {
          throw terminalFailure(
            'Runtime Agent turn was interrupted before completion.',
            event.reason,
          );
        }
        break;
      case 'turn-completed':
        if (!accepted) break;
        if (!assistantText.trim()) {
          throw terminalFailure(
            'Runtime Agent turn completed without a committed assistant message.',
            'lab-conversation-terminal-message-missing',
          );
        }
        return Object.freeze({
          type: 'turn-completed' as const,
          reason: event.terminalReason || 'completed',
          assistantText,
        });
      case 'turn-started':
      case 'text-delta':
        break;
    }
  }
  throw terminalFailure(
    'Runtime Agent conversation stream ended without a terminal event.',
    'lab-conversation-terminal-missing',
  );
}

function terminalFailure(message: string, reasonCode: string): Error {
  return Object.assign(new Error(message), {
    reasonCode,
    actionHint: 'inspect_runtime_agent_terminal_event',
    source: 'runtime',
  });
}
