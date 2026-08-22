import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationSnapshot } from '@nimiplatform/sdk/app';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuAgentChatStatus = ZhiyuEvidence['chat'];

export type ZhiyuLocalAppConversationSnapshotInput = {
  readonly current: ZhiyuAgentChatStatus;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly snapshot: NimiLocalAppConversationSnapshot;
};

export function hydrateZhiyuAgentChatFromLocalAppConversationSnapshot(
  input: ZhiyuLocalAppConversationSnapshotInput,
): ZhiyuAgentChatStatus {
  if (input.snapshot.conversationAnchorId !== input.conversationAnchorId) {
    return input.current;
  }
  const messages: ConversationCanonicalMessage[] = input.snapshot.messages.map((message, index) => ({
    id: `local-app-snapshot:${message.turnId}:${index}`,
    sessionId: input.conversationAnchorId,
    targetId: input.agentHandle,
    source: 'agent',
    role: message.role === 'assistant' ? 'agent' : 'user',
    text: message.text,
    createdAt: '',
    updatedAt: '',
    status: 'complete',
    kind: 'text',
    senderName: message.role === 'assistant' ? 'Zhiyu Agent' : 'You',
    senderKind: message.role === 'assistant' ? 'agent' : 'human',
    metadata: { runtimeTurnId: message.turnId },
  }));
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'agent');
  const outputText = latestAssistant?.text || null;
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'completed',
    reasonCode: 'runtime-agent-conversation-snapshot-hydrated',
    actionHint: 'continue_runtime_agent_conversation',
    source: 'runtime',
    message: 'Runtime Agent conversation snapshot was hydrated through the typed local App projection.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: input.conversationAnchorId,
    requestId: null,
    runtimeTurnId: input.snapshot.activeTurnId
      || input.snapshot.messages.at(-1)?.turnId
      || null,
    runtimeStreamId: null,
    eventTypes: ['conversation-snapshot-hydrated'],
    messageCount: messages.length,
    messages,
    latestAssistantText: outputText,
    reasoningText: null,
    outputText,
    diagnostics: {
      source: 'runtime.agent.local-app.conversation.snapshot',
      transcriptMessageCount: messages.length,
      truncatedBefore: input.snapshot.truncatedBefore,
    },
  };
}
