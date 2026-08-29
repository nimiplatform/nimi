import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationMessage,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuAgentChatStatus = ZhiyuEvidence['chat'];

export type ZhiyuLocalAppConversationSnapshotInput = {
  readonly current: ZhiyuAgentChatStatus;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly snapshot: NimiLocalAppConversationSnapshot;
};

export function zhiyuConversationActionKey(action: {
	readonly turnId: string;
	readonly actionId: string;
}): string {
	return `${action.turnId}\u0000${action.actionId}`;
}

export function hydrateZhiyuAgentChatFromLocalAppConversationSnapshot(
  input: ZhiyuLocalAppConversationSnapshotInput,
): ZhiyuAgentChatStatus {
  if (input.snapshot.conversationAnchorId !== input.conversationAnchorId) {
    return input.current;
  }
  const messages = input.snapshot.messages.map((message) => projectZhiyuLocalAppConversationMessage({
    message,
    agentHandle: input.agentHandle,
    conversationAnchorId: input.conversationAnchorId,
    createdAt: '',
  }));
	const actions = input.snapshot.actions.map((action) => ({
		actionId: action.actionId,
		turnId: action.turnId,
		capabilityContract: action.capabilityContract,
		status: action.status,
		reasonCode: action.reasonCode,
		message: action.message,
	}));
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'agent');
  const outputText = latestAssistant?.text || null;
  const activeTurn = input.snapshot.turns.find((turn) => turn.status === 'active');
	const projectedTurn = activeTurn ?? input.snapshot.turns.at(-1);
	const projectedState = projectedTurn?.status === 'active'
		? 'streaming'
		: projectedTurn?.status === 'failed'
			? 'failed'
			: projectedTurn?.status === 'interrupted'
				? 'canceled'
				: 'completed';
	const ready = projectedState === 'completed';
  return {
    transport: 'electron-ipc',
	ready,
	state: projectedState,
	reasonCode: projectedTurn?.reasonCode
		|| (projectedState === 'completed' ? 'runtime-agent-conversation-snapshot-hydrated' : `runtime-agent-turn-${projectedState}`),
	actionHint: projectedState === 'streaming'
		? 'wait_runtime_agent_turn_terminal'
		: projectedState === 'completed'
			? 'continue_runtime_agent_conversation'
			: 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: 'Runtime Agent conversation snapshot was hydrated through the typed local App projection.',
    agentHandle: input.agentHandle,
    conversationAnchorId: input.conversationAnchorId,
    requestId: null,
	runtimeTurnId: projectedTurn?.turnId
      || null,
    runtimeStreamId: null,
    eventTypes: ['conversation-snapshot-hydrated'],
    messageCount: messages.length,
    messages,
	actions,
    latestAssistantText: outputText,
    reasoningText: null,
    outputText,
    diagnostics: {
      source: 'runtime.agent.local-app.conversation.snapshot',
      throughSequence: input.snapshot.throughSequence,
      transcriptMessageCount: messages.length,
      truncatedBefore: input.snapshot.truncatedBefore,
    },
  };
}

export function projectZhiyuLocalAppConversationMessage(input: {
  readonly message: NimiLocalAppConversationMessage;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly createdAt: string;
}): ConversationCanonicalMessage {
  const textPart = input.message.parts.find((part) => part.kind === 'text');
  const artifactPart = input.message.parts.find((part) => part.kind === 'artifact-ref');
  const assistant = input.message.role === 'assistant';
  return {
    id: input.message.messageId,
    sessionId: input.conversationAnchorId,
    targetId: input.agentHandle,
    source: 'agent',
    role: assistant ? 'agent' : 'user',
    text: textPart?.text || artifactPart?.displayName || (assistant ? 'Generated image' : 'Attached image'),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    status: 'complete',
    kind: artifactPart ? 'image' : 'text',
    senderName: assistant ? 'Zhiyu Agent' : 'You',
    senderKind: assistant ? 'agent' : 'human',
    metadata: {
      runtimeTurnId: input.message.turnId,
      ...(artifactPart ? {
        artifactProjection: 'runtime.agent.local-app.conversation.message',
        artifactId: artifactPart.artifactId,
        mimeType: artifactPart.mimeType,
        displayName: artifactPart.displayName,
      } : {}),
    },
  };
}
