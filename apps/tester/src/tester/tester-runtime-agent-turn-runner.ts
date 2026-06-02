import {
  runRuntimeAgentTurn,
  type RuntimeAgentConsumeEvent,
  type RuntimeAgentTurnsModule,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeAgentTurnRunnerProjection = {
  partTypes: string[];
  outputText: string;
  sealedMessageId: string;
  ignoredBacklog: boolean;
  requestCount: number;
  snapshotQueryCount: number;
};

export async function inspectTesterRuntimeAgentTurnRunnerProjection(): Promise<TesterRuntimeAgentTurnRunnerProjection> {
  const requestIds: string[] = [];
  let snapshotQueryCount = 0;
  const turns: RuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<RuntimeAgentConsumeEvent> {
        yield {
          eventName: 'runtime.agent.turn.accepted',
          localAgentRef: 'local-agent:tester-owner:tester-agent',
          conversationAnchorId: 'tester-anchor',
          turnId: 'tester-backlog-turn',
          streamId: 'tester-backlog-stream',
          detail: { requestId: 'tester-backlog-request' },
        } as RuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.text_delta',
          localAgentRef: 'local-agent:tester-owner:tester-agent',
          conversationAnchorId: 'tester-anchor',
          turnId: 'tester-backlog-turn',
          streamId: 'tester-backlog-stream',
          detail: { text: 'backlog' },
        } as RuntimeAgentConsumeEvent;
        while (!requestIds[0]) {
          await Promise.resolve();
        }
        yield {
          eventName: 'runtime.agent.turn.accepted',
          localAgentRef: 'local-agent:tester-owner:tester-agent',
          conversationAnchorId: 'tester-anchor',
          turnId: 'tester-turn',
          streamId: 'tester-stream',
          detail: { requestId: requestIds[0] },
        } as RuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.structured',
          localAgentRef: 'local-agent:tester-owner:tester-agent',
          conversationAnchorId: 'tester-anchor',
          turnId: 'tester-turn',
          streamId: 'tester-stream',
          detail: {
            kind: 'agent_resolved_message_action_envelope',
            payload: {
              message: {
                message_id: 'tester-assistant-message',
                text: 'tester runtime runner complete',
              },
              actions: [],
            },
          },
        } as RuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.message_committed',
          localAgentRef: 'local-agent:tester-owner:tester-agent',
          conversationAnchorId: 'tester-anchor',
          turnId: 'tester-turn',
          streamId: 'tester-stream',
          messageId: 'tester-assistant-message',
          detail: {
            messageId: 'tester-assistant-message',
            text: 'tester runtime runner complete',
          },
        } as RuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.completed',
          localAgentRef: 'local-agent:tester-owner:tester-agent',
          conversationAnchorId: 'tester-anchor',
          turnId: 'tester-turn',
          streamId: 'tester-stream',
          detail: { terminalReason: 'stop' },
        } as RuntimeAgentConsumeEvent;
      })();
    },
    async request(request) {
      requestIds.push(request.requestId || '');
      return { messageId: 'tester-request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'tester-interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      snapshotQueryCount += 1;
      return {};
    },
  };

  const result = await runRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'tester-owner',
      realmAgentId: 'tester-agent',
      localAgentRef: 'local-agent:tester-owner:tester-agent',
      conversationAnchorId: 'tester-anchor',
      threadId: 'tester-runtime-runner-thread',
      requestId: 'tester-runtime-runner-request',
      messages: [{
        role: 'user',
        content: 'tester runtime runner',
      }],
    },
    route: 'runtime-owned',
    modelId: 'runtime-owned',
    buildMetadata: () => ({
      debugType: 'tester-runtime-agent-turn-runner',
    }),
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }
  const sealed = parts.find((part) => part.type === 'message-sealed');
  const completed = parts.find((part) => part.type === 'turn-completed');

  return {
    partTypes: parts.map((part) => part.type),
    outputText: completed?.type === 'turn-completed' ? completed.outputText : '',
    sealedMessageId: sealed?.type === 'message-sealed' ? sealed.envelope.message.messageId : '',
    ignoredBacklog: !parts.some((part) => part.type === 'text-delta' && part.textDelta === 'backlog'),
    requestCount: requestIds.length,
    snapshotQueryCount,
  };
}
