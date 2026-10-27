import { localAppConversationMessageState } from '@nimiplatform/kit/features/chat/headless';
import type { AgentLocalMessageRecord, AgentLocalThreadBundle, AgentLocalThreadSummary, JsonObject } from '../../bridge/runtime-bridge/types';
import type { CanonicalConversationProjection, createCanonicalConversationMediaReader } from '@nimiplatform/kit/features/chat/headless';

function actionIdentity(action: { readonly turnId: string; readonly actionId: string }): string {
  return JSON.stringify([action.turnId, action.actionId]);
}

function baseMessage(input: {
  id: string;
  threadId: string;
  turnId: string;
  role: AgentLocalMessageRecord['role'];
  kind: 'text' | 'image' | 'voice';
  contentText: string;
  status: 'pending' | 'complete' | 'error';
  nowMs: number;
  metadata: JsonObject;
}): AgentLocalMessageRecord {
  return {
    id: input.id,
    threadId: input.threadId,
    role: input.role,
    status: input.status,
    kind: input.kind,
    contentText: input.contentText,
    reasoningText: null,
    error: null,
    traceId: null,
    parentMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: input.metadata,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}

function insertConversationChild(messages: AgentLocalMessageRecord[], child: AgentLocalMessageRecord): void {
  const turnId = child.metadataJson?.canonicalTurnId;
  let index = messages.length;
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.metadataJson?.canonicalTurnId === turnId) { index = cursor + 1; break; }
  }
  messages.splice(index, 0, child);
}

// @nimi-authority: rule.nimi.desktop.agent-projection.r029
export function materializeCanonicalConversationBundle(input: {
  media?: Pick<ReturnType<typeof createCanonicalConversationMediaReader>, 'get'>;
  thread: AgentLocalThreadSummary;
  projection: CanonicalConversationProjection;
  nowMs: number;
}): AgentLocalThreadBundle {
  const messages: AgentLocalMessageRecord[] = [];
  for (const message of input.projection.messages) {
    const presentation = localAppConversationMessageState(input.projection, message);
    const { turn } = presentation;
    const text = message.parts.find((part) => part.kind === 'text');
    const artifact = message.parts.find((part) => part.kind === 'artifact-ref');
    const resolved = artifact
      ? input.media?.get(artifact.artifactId) ?? { mediaUrl: null, mimeType: null }
      : { mediaUrl: null, mimeType: null };
    const projected: AgentLocalMessageRecord = {
      ...baseMessage({
        id: message.messageId,
        threadId: input.thread.id,
        turnId: message.turnId,
        role: message.role === 'app' ? 'system' : message.role,
        kind: artifact ? 'image' : 'text',
        contentText: text?.text || '',
        status: message.partial ? presentation.textPending ? 'pending' : 'error' : 'complete',
        nowMs: input.nowMs,
        metadata: {
          canonicalMessageCommitted: true,
          canonicalQuote: message.quote ? { ...message.quote } : null,
          canonicalPartial: message.partial,
          canonicalTurnStatus: turn?.status ?? null,
          canonicalTerminalReason: turn?.terminalReason ?? null,
          canonicalCanRegenerate: turn?.canRegenerate || false,
          canonicalInputTurnId: turn?.inputTurnId || null,
          canonicalOrigin: turn?.origin || 'user',
          canonicalMediaRunning: presentation.mediaRunning,
          canonicalControlRejected: !message.partial && turn?.status === 'completed' && turn.reasonCode === 'AI_OUTPUT_INVALID'
            && !input.projection.actions.some(action => action.turnId === message.turnId),
          canonicalConversationAnchorId: input.projection.conversationAnchorId,
          canonicalTurnId: message.turnId,
          canonicalThroughSequence: input.projection.throughSequence,
          canonicalTruncatedBefore: input.projection.truncatedBefore,
        },
      }),
      mediaUrl: resolved.mediaUrl,
      mediaMimeType: artifact?.mimeType || resolved.mimeType,
      artifactId: artifact?.artifactId || null,
      error: message.partial && turn?.status !== 'active' && turn?.terminalReason !== 'user_cancel'
        ? { code: turn?.reasonCode || 'AI_STREAM_BROKEN', message: turn?.message || 'The reply is incomplete.' }
        : null,
    };
    if (artifact && message.role === 'assistant') insertConversationChild(messages, projected);
    else messages.push(projected);
  }

  const messageIds = new Set(messages.map((message) => message.id));
  for (const action of input.projection.actions) {
    const messageId = action.projectionMessageId || `canonical-action:${actionIdentity(action)}`;
    if (messageIds.has(messageId) || (action.status === 'completed' && !action.artifactId)) continue;
    const original = input.projection.messages.find(message => message.turnId === action.turnId && message.role === 'user');
    const textOnlyInput = original?.parts.length === 1 && original.parts[0]?.kind === 'text' ? original.parts[0].text : '';
    const resolved = action.artifactId
      ? input.media?.get(action.artifactId) ?? { mediaUrl: null, mimeType: null }
      : { mediaUrl: null, mimeType: null };
    insertConversationChild(messages, {
      ...baseMessage({
        id: messageId,
        threadId: input.thread.id,
        turnId: action.turnId,
        role: 'assistant',
        kind: 'image',
        contentText: action.status === 'failed' ? action.message || 'Image generation failed.' : '',
        status: action.status === 'failed' ? 'error' : action.status === 'completed' ? 'complete' : 'pending',
        nowMs: input.nowMs,
        metadata: {
          canonicalTurnId: action.turnId,
          canonicalActionId: action.actionId,
          canonicalActionStatus: action.status,
          canonicalThroughSequence: input.projection.throughSequence,
          ...(action.status === 'failed' ? {
            imageFailureReasonCode: action.reasonCode,
            imageOperationId: action.actionId,
            ...(textOnlyInput ? { retryPrompt: textOnlyInput } : {}),
          } : {}),
        },
      }),
      artifactId: action.artifactId,
      mediaUrl: resolved.mediaUrl,
      mediaMimeType: resolved.mimeType,
      error: action.status === 'failed'
        ? { code: action.reasonCode || 'RUNTIME_CALL_FAILED', message: action.message || 'Image generation failed.' }
        : null,
    });
    messageIds.add(messageId);
  }

  for (const voice of input.projection.voices) {
    const parent = messages.find(message => message.id === voice.messageId && message.kind === 'text' && message.role === 'assistant');
    if (!parent) continue; // The canonical sidecar remains in the bounded snapshot even when its text is outside it.
    parent.metadataJson = {
      ...parent.metadataJson,
      canonicalVoiceId: voice.voiceId,
      canonicalVoiceState: voice.state,
      canonicalVoiceArtifactId: voice.artifactId,
      canonicalVoiceReasonCode: voice.reasonCode,
    };
  }

  const turnOrder = new Map(input.projection.turns.map((turn, index) => [turn.turnId, index]));
  for (const turn of input.projection.turns) {
    const transient = input.projection.transientByTurn[turn.turnId];
    if (turn.origin !== 'user' && turn.origin !== 'app' && !transient?.text?.trim()) continue;
    if (messages.some(message => message.role === 'assistant' && message.kind === 'text' && message.metadataJson?.canonicalTurnId === turn.turnId)) continue;
    if (!transient && !turn.inputTurnId && input.projection.state.textTurnId !== turn.turnId && turn.origin !== 'app') continue;
    if (turn.status === 'completed') continue;
    const placeholder = {
      ...baseMessage({
        id: `canonical-turn:${turn.turnId}`,
        threadId: input.thread.id,
        turnId: turn.turnId,
        role: 'assistant',
        kind: 'text',
        contentText: transient?.text || '',
        status: turn.status === 'active' ? 'pending' : 'error',
        nowMs: input.nowMs,
        metadata: {
          canonicalTurnId: turn.turnId,
          canonicalTurnPhase: turn.phase,
          canonicalTerminalReason: turn.terminalReason,
          canonicalFailureReasonCode: turn.reasonCode,
          canonicalCanRegenerate: turn.canRegenerate,
          canonicalInputTurnId: turn.inputTurnId,
          canonicalPartial: true,
          canonicalReasoningState: transient?.reasoningState || null,
          canonicalThroughSequence: input.projection.throughSequence,
        },
      }),
      error: turn.status !== 'active' && turn.terminalReason !== 'user_cancel' ? { code: turn.reasonCode || 'AI_STREAM_BROKEN', message: turn.message || 'The reply is incomplete.' } : null,
    };
    // Empty failed attempts have no canonical text message. Keep their status
    // at the Runtime's turn position, before any later successful retry.
    const nextMessage = messages.findIndex(message => {
      const order = turnOrder.get(String(message.metadataJson?.canonicalTurnId));
      return order !== undefined && order > turnOrder.get(turn.turnId)!;
    });
    messages.splice(nextMessage < 0 ? messages.length : nextMessage, 0, placeholder);
  }

  return {
    thread: {
      ...input.thread,
      createdAtMs: typeof (input.thread as unknown as { createdAtMs?: unknown }).createdAtMs === 'number'
        ? (input.thread as unknown as { createdAtMs: number }).createdAtMs
        : input.nowMs,
      updatedAtMs: input.nowMs,
      lastMessageAtMs: messages.length > 0 ? input.nowMs : input.thread.lastMessageAtMs,
    },
    messages,
    canonicalProjection: input.projection,
    canonicalConversation: {
      state: input.projection.state,
      conversationAnchorId: input.projection.conversationAnchorId,
      throughSequence: input.projection.throughSequence,
      truncatedBefore: input.projection.truncatedBefore,
      turns: input.projection.turns,
      actions: input.projection.actions,
      voices: input.projection.voices,
    },
  };
}
