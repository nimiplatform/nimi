import { seedCanonicalConversationProjection, localAppConversationMessageState, type CanonicalConversationProjection, type createCanonicalConversationMediaReader } from '@nimiplatform/kit/features/chat/headless';
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
  if (input.snapshot.conversationAnchorId !== input.conversationAnchorId) return input.current;
  return projectZhiyuConversation({ ...input, projection: seedCanonicalConversationProjection(input.snapshot) });
}

// App-specific names, diagnostics and view model; Kit owns lifecycle and reduction.
export function projectZhiyuConversation(input: {
  agentHandle: NimiLocalAppAgentHandle;
  conversationAnchorId: string;
  projection: CanonicalConversationProjection;
  media?: Pick<ReturnType<typeof createCanonicalConversationMediaReader>, 'get'>;
}): ZhiyuAgentChatStatus {
  const { projection } = input;
  const messages = projection.messages.map(message => {
    const view = projectZhiyuLocalAppConversationMessage({ ...input, message, createdAt: '' });
    const presentation = localAppConversationMessageState(projection, message);
    const artifact = message.parts.find(part => part.kind === 'artifact-ref');
    const voice = projection.voices.find(value => value.messageId === message.messageId);
    return {
      ...view,
      status: presentation.partial ? presentation.textPending ? 'streaming' as const : presentation.stopped ? 'canceled' as const : 'error' as const : 'complete' as const,
      metadata: { ...view.metadata,
        canonicalPartial: presentation.partial,
        canonicalTurnId: message.turnId,
        canonicalConversationAnchorId: input.conversationAnchorId,
        canonicalTurnStatus: presentation.turn?.status,
        canonicalTerminalReason: presentation.turn?.terminalReason,
        canonicalCanRegenerate: presentation.canRegenerate,
        canonicalMediaRunning: presentation.mediaRunning,
        canonicalImageFailures: message.role === 'assistant' && message.parts.some(part => part.kind === 'text')
          ? projection.actions.filter(action => action.turnId === message.turnId && action.status === 'failed').map(action => ({ actionId: action.actionId, reasonCode: action.reasonCode, message: action.message })) : [],
        canonicalVoiceState: voice?.state,
        canonicalVoiceArtifactId: voice?.artifactId,
        ...(voice?.state === 'failed' ? { voiceError: voice.reasonCode, voiceErrorMessage: voice.message } : {}),
        ...(artifact ? { mediaUrl: input.media?.get(artifact.artifactId).mediaUrl } : {}),
      },
    } as ConversationCanonicalMessage;
  });
  for (const turn of projection.turns) {
    const transient = projection.transientByTurn[turn.turnId];
    if (messages.some(message => message.role === 'agent' && message.kind === 'text' && message.metadata?.runtimeTurnId === turn.turnId)) continue;
    if (turn.status === 'completed' || (!transient && !turn.inputTurnId && projection.state.textTurnId !== turn.turnId)) continue;
    const view: ConversationCanonicalMessage = {
      id: `canonical-turn:${turn.turnId}`, sessionId: input.conversationAnchorId, targetId: input.agentHandle,
      source: 'agent', role: 'agent', kind: 'text', text: transient?.text || '', createdAt: '',
      status: turn.status === 'active' ? 'streaming' : turn.terminalReason === 'user_cancel' ? 'canceled' : 'error',
      metadata: { runtimeTurnId: turn.turnId, canonicalTurnId: turn.turnId, canonicalPartial: true,
        canonicalTurnStatus: turn.status, canonicalTerminalReason: turn.terminalReason, canonicalCanRegenerate: turn.canRegenerate },
    };
    const order = projection.turns.indexOf(turn);
    const next = messages.findIndex(message => projection.turns.findIndex(t => t.turnId === message.metadata?.runtimeTurnId) > order);
    messages.splice(next < 0 ? messages.length : next, 0, view);
  }
  const textTurn = projection.turns.find(turn => turn.turnId === projection.state.textTurnId);
  const latestTurn = textTurn ?? projection.turns.at(-1);
  const state = textTurn ? 'streaming' : latestTurn?.status === 'active' ? 'media-pending' : latestTurn?.status === 'failed' ? 'failed' : latestTurn?.status === 'interrupted' ? 'canceled' : 'completed';
  const outputText = [...messages].reverse().find(message => message.role === 'agent' && message.kind === 'text')?.text || null;
  return {
    transport: 'electron-ipc', ready: !projection.state.textTurnId, state,
    textTurnId: projection.state.textTurnId, controlState: projection.state,
    regenerateTurnId: projection.turns.find(turn => turn.canRegenerate)?.turnId ?? null,
    reasonCode: latestTurn?.reasonCode || 'runtime-agent-conversation-projected',
    actionHint: textTurn ? 'wait_runtime_agent_turn_terminal' : 'continue_runtime_agent_conversation',
    source: 'runtime', message: textTurn ? '正在回复。' : '对话已同步。',
    agentHandle: input.agentHandle, conversationAnchorId: input.conversationAnchorId,
    requestId: latestTurn?.requestId ?? null, runtimeTurnId: latestTurn?.turnId ?? null, runtimeStreamId: null,
    eventTypes: [], messageCount: messages.length, messages,
    actions: projection.actions, latestAssistantText: outputText, reasoningText: null, outputText,
    diagnostics: { source: 'runtime.agent.local-app.conversation', throughSequence: projection.throughSequence, truncatedBefore: projection.truncatedBefore },
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
    status: input.message.partial ? 'error' : 'complete',
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

export type ZhiyuRuntimeAgentChatAttachment = { readonly bytes: Uint8Array; readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; readonly displayName: string };
