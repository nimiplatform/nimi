import { createNimiClientId } from '@nimiplatform/sdk';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationEvent } from '@nimiplatform/sdk/app';
import { NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type {
  AgentRuntimeChatTurnRequest,
  AgentRuntimeChatTurnStreamPart,
} from './chat-agent-runtime-turn-types';
import { normalizeText } from './chat-agent-runtime-normalize';
import { safeLogRuntimeAgentEvent } from './chat-agent-runtime-agent-utils';

// @nimi-authority: definition.nimi.desktop.agent-projection.agent-chat
// @nimi-authority: rule.nimi.desktop.agent-projection.r001
// @nimi-authority: rule.nimi.runtime.agent-participation.r175
export async function streamChatAgentRuntimeAgentTurn(
  request: AgentRuntimeChatTurnRequest,
  sdk: DesktopRendererSdkPort,
  _now?: () => number,
): Promise<{ stream: AsyncIterable<AgentRuntimeChatTurnStreamPart> }> {
  const agentHandle = normalizeText(request.agentHandle) as NimiLocalAppAgentHandle;
  if (!agentHandle) throw new Error('Desktop canonical Agent turn requires agentHandle');
	const conversation = sdk.conversation();
  const requestId = createNimiClientId('runtime-agent-turn-request');
  const parts = [
    ...(normalizeText(request.userText) ? [{ kind: 'text' as const, text: normalizeText(request.userText) }] : []),
    ...((request.userAttachments || []).map((attachment) => ({ kind: 'artifact-ref' as const, artifactId: attachment.artifactId }))),
  ];
  if (parts.length === 0) throw new Error('Desktop canonical Agent turn requires input');

  return {
    stream: runCanonicalDesktopAgentTurn({
      conversation,
      agentHandle,
      conversationAnchorId: request.conversationAnchorId,
      requestId,
      parts,
      signal: request.signal,
    }),
  };
}

async function* runCanonicalDesktopAgentTurn(input: {
	readonly conversation: ReturnType<DesktopRendererSdkPort['conversation']>;
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly requestId: string;
  readonly parts: readonly ({ readonly kind: 'text'; readonly text: string } | { readonly kind: 'artifact-ref'; readonly artifactId: string })[];
  readonly signal?: AbortSignal;
}): AsyncIterable<AgentRuntimeChatTurnStreamPart> {
	if (input.signal?.aborted) {
		throw new DOMException('Agent turn was canceled before admission.', 'AbortError');
	}
  const scope = { agentHandle: input.agentHandle, conversationAnchorId: input.conversationAnchorId };
  const subscription = await input.conversation.subscribe(scope);
  let outputText = '';
  let interrupted = false;
  let terminal = false;
  let interrupt = () => undefined;
  try {
	if (input.signal?.aborted) {
		throw new DOMException('Agent turn was canceled before admission.', 'AbortError');
	}
    const accepted = await input.conversation.send({ ...scope, requestId: input.requestId, parts: input.parts });
    const runtimeTurnId = accepted.turnId;
	interrupt = () => {
		interrupted = true;
		void input.conversation.interruptTurn(scope).catch(() => undefined);
	};
	input.signal?.addEventListener('abort', interrupt, { once: true });
	if (input.signal?.aborted) interrupt();
    safeLogRuntimeAgentEvent({
      level: 'info', area: 'agent-chat-runtime', message: 'action:canonical-agent-turn:start',
      details: { conversationAnchorId: input.conversationAnchorId, runtimeTurnId },
    });
    for await (const event of subscription) {
      if (event.turnId !== runtimeTurnId) continue;
      const projected = canonicalEventPart(event, outputText);
      if (projected.outputText !== undefined) outputText = projected.outputText;
      if (projected.part) yield projected.part;
      if (event.type === 'turn-completed' || event.type === 'turn-failed' || event.type === 'turn-interrupted') {
        terminal = true;
        return;
      }
    }
    if (!terminal && !interrupted) throw new Error('Desktop canonical Agent stream ended without terminal');
  } finally {
    input.signal?.removeEventListener('abort', interrupt);
    await subscription.cancel().catch(() => undefined);
  }
}

function canonicalEventPart(
  event: NimiLocalAppConversationEvent,
  outputText: string,
): { readonly part: AgentRuntimeChatTurnStreamPart | null; readonly outputText?: string } {
  switch (event.type) {
    case 'text-delta':
      return { part: { type: 'text-delta', textDelta: event.delta }, outputText: outputText + event.delta };
    case 'message-committed': {
      if (event.message.role !== 'assistant') return { part: null };
      const text = event.message.parts.find((part) => part.kind === 'text');
      if (text) {
        return {
          outputText: text.text,
          part: {
            type: 'message-sealed',
            envelope: {
              schemaId: NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
              message: { messageId: event.message.messageId, text: text.text },
              statusCue: null,
              actions: [],
            },
            metadataJson: null,
            diagnostics: { canonicalConversationAnchorId: event.conversationAnchorId },
          },
        };
      }
      const artifact = event.message.parts.find((part) => part.kind === 'artifact-ref');
      if (artifact) {
        return { part: {
          type: 'artifact-ready', beatId: artifact.artifactId, turnId: event.turnId,
          artifactId: artifact.artifactId, mimeType: artifact.mimeType,
          projectionMessageId: event.message.messageId,
        } };
      }
      return { part: null };
    }
    case 'action-planned':
      return { part: { type: 'beat-planned', beatId: event.action.actionId, turnId: event.turnId, projectionMessageId: event.action.projectionMessageId || undefined } };
    case 'action-started':
      return { part: { type: 'beat-delivery-started', beatId: event.action.actionId, turnId: event.turnId, projectionMessageId: event.action.projectionMessageId || undefined } };
    case 'action-completed':
      return { part: { type: 'beat-delivered', beatId: event.action.actionId, turnId: event.turnId, projectionMessageId: event.action.projectionMessageId || undefined } };
    case 'action-failed':
      return { part: {
        type: 'beat-delivery-failed', beatId: event.action.actionId, turnId: event.turnId,
        operation: event.action.capabilityContract, modality: 'image', reasonCode: event.action.reasonCode || 'LOCAL_APP_OWNER_UNAVAILABLE',
        reason: event.action.message || '', message: event.action.message || '', projectionMessageId: event.action.projectionMessageId || undefined,
      } };
    case 'turn-completed':
      return { part: { type: 'turn-completed', outputText, finishReason: event.terminalReason, diagnostics: { runtimeTurnId: event.turnId } } };
    case 'turn-failed':
      return { part: { type: 'turn-failed', outputText, error: { code: event.reasonCode, message: event.message || 'Runtime Agent turn failed.' }, diagnostics: { runtimeTurnId: event.turnId } } };
    case 'turn-interrupted':
      return { part: { type: 'turn-canceled', scope: 'turn', outputText, diagnostics: { runtimeTurnId: event.turnId } } };
    case 'reasoning-status':
      return { part: { type: 'reasoning-status', state: event.state } };
    case 'live-action':
      return { part: {
        type: 'live-child', childKind: 'action', childId: event.action.actionId,
        name: event.action.name, lifecycle: event.action.lifecycle,
        progress: event.action.progress || undefined, result: event.action.result || undefined,
        reasonCode: event.action.reasonCode || undefined,
      } };
    case 'live-tool':
      return { part: {
        type: 'live-child', childKind: 'tool', childId: event.tool.toolId,
        name: event.tool.name, lifecycle: event.tool.lifecycle,
        progress: event.tool.progress || undefined, result: event.tool.result || undefined,
        reasonCode: event.tool.reasonCode || undefined,
      } };
    case 'turn-accepted':
    case 'turn-started':
    case 'artifact-ready':
    case 'voice-ready':
    case 'voice-failed':
      return { part: null };
  }
}
