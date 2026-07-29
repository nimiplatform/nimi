import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';

export type TesterConversationPort = {
  readonly open: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly disposition: 'create-or-resume';
  }) => Promise<{ readonly conversationAnchorId: string }>;
  readonly send: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
    readonly requestId: string;
    readonly text: string;
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
    disposition: 'create-or-resume',
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
    const snapshot = await input.conversation.snapshot(scope);
    return Object.freeze({
      conversationAnchorId: opened.conversationAnchorId,
      messageId: sent.messageId,
      subscribed: true as const,
      snapshot,
    });
  } finally {
    await subscription.cancel();
  }
}
