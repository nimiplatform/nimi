import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppClient,
  NimiLocalAppConversationEvent,
} from '@nimiplatform/sdk/app';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat';

import type { ZhiyuConversationActionProjection, ZhiyuEvidence } from '../app/evidence.js';
import {
	projectZhiyuLocalAppConversationMessage,
	zhiyuConversationActionKey,
} from './agent-conversation-state.js';

export type ZhiyuAmbientConversationIdentity = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
};

export type ZhiyuAmbientConversationReduction = {
  readonly chat: ZhiyuEvidence['chat'];
  readonly close: boolean;
};

type AmbientTurn = {
  messages: ConversationCanonicalMessage[];
};

type AmbientReducerOptions = {
  readonly throughSequence?: string;
  readonly initialChat?: ZhiyuEvidence['chat'];
  readonly resolveArtifactUrl?: (artifactId: string) => Promise<string>;
};

export function createZhiyuAmbientConversationEventReducer(
  identity: ZhiyuAmbientConversationIdentity,
  now: () => number = Date.now,
	options: AmbientReducerOptions = {},
) {
  const turns = new Map<string, AmbientTurn>();
	const actions = new Map<string, ZhiyuConversationActionProjection>();
  const observedEvents = new Set<string>();
	let throughSequence = conversationSequence(options.throughSequence ?? '0');
	for (const message of options.initialChat?.messages ?? []) {
		const turnId = typeof message.metadata?.runtimeTurnId === 'string' ? message.metadata.runtimeTurnId : '';
		if (!turnId) continue;
		const turn = turns.get(turnId) ?? { messages: [] };
		turn.messages.push(message);
		turns.set(turnId, turn);
		observedEvents.add(`${turnId}\u0000${message.id}`);
	}
	for (const action of options.initialChat?.actions ?? []) {
		actions.set(zhiyuConversationActionKey(action), action);
	}
	const projectedActions = () => Object.freeze([...actions.values()]);

  const failure = (
    reasonCode: string,
    message: string,
    source = 'runtime',
  ): ZhiyuAmbientConversationReduction => ({
    chat: chatUpdate({
      identity,
      ready: false,
      state: 'failed',
      reasonCode,
      actionHint: reasonCode === 'zhiyu-conversation-anchor-mismatch'
        ? 'refresh_runtime_conversation_anchor'
        : 'inspect_local_app_conversation_subscription',
      source,
      message,
      requestId: null,
      runtimeTurnId: null,
      eventType: 'ambient-subscription-failed',
      messages: [],
		actions: projectedActions(),
    }),
    close: true,
  });

  return Object.freeze({
    async reduce(event: NimiLocalAppConversationEvent): Promise<ZhiyuAmbientConversationReduction | null> {
		const eventSequence = conversationSequence(event.sequence);
		if (eventSequence <= throughSequence) return null;
		throughSequence = eventSequence;
      if (event.conversationAnchorId !== identity.conversationAnchorId) {
        return failure(
          'zhiyu-conversation-anchor-mismatch',
          'Runtime Agent conversation event did not match the open conversation anchor.',
        );
      }
      const runtimeTurnId = event.turnId;
      const turn = turns.get(runtimeTurnId) ?? {
        messages: [],
      };

      if (event.type === 'turn-accepted') {
        turns.set(runtimeTurnId, turn);
        return null;
      }

      if (event.type === 'message-committed') {
        const eventKey = `${runtimeTurnId}\u0000${event.message.messageId}`;
        if (observedEvents.has(eventKey)) return null;
        observedEvents.add(eventKey);
        let message = projectZhiyuLocalAppConversationMessage({
          message: event.message,
          agentHandle: identity.agentHandle,
          conversationAnchorId: identity.conversationAnchorId,
          createdAt: new Date(now()).toISOString(),
        });
		const artifactId = typeof message.metadata?.artifactId === 'string' ? message.metadata.artifactId : '';
		if (artifactId && options.resolveArtifactUrl) {
			try {
				const mediaUrl = await options.resolveArtifactUrl(artifactId);
				message = { ...message, metadata: { ...message.metadata, mediaUrl } };
			} catch {
				message = { ...message, metadata: { ...message.metadata, mediaError: 'Conversation image is unavailable.' } };
			}
		}
		turn.messages = [...turn.messages.filter((candidate) => candidate.id !== message.id), message];
        turns.set(runtimeTurnId, turn);
        return {
          chat: chatUpdate({
            identity,
            ready: false,
            state: 'streaming',
            reasonCode: 'runtime-agent-turn-message-committed',
            actionHint: 'wait_runtime_agent_turn_terminal',
            source: 'runtime',
            message: 'Runtime Agent committed a conversation message.',
            requestId: null,
            runtimeTurnId,
            eventType: event.type,
            messages: [message],
			actions: projectedActions(),
          }),
          close: false,
        };
      }

		if (event.type === 'action-planned' || event.type === 'action-started'
			|| event.type === 'action-completed' || event.type === 'action-failed') {
			actions.set(zhiyuConversationActionKey(event.action), {
				actionId: event.action.actionId,
				turnId: event.action.turnId,
				capabilityContract: event.action.capabilityContract,
				status: event.action.status,
				reasonCode: event.action.reasonCode,
				message: event.action.message,
			});
			return {
				chat: chatUpdate({
					identity,
					ready: false,
					state: 'streaming',
					reasonCode: `runtime-agent-${event.type}`,
					actionHint: 'wait_runtime_agent_turn_terminal',
					source: 'runtime',
					message: 'Runtime Agent image action state changed.',
					requestId: null,
					runtimeTurnId,
					eventType: event.type,
					messages: [],
					actions: projectedActions(),
				}),
				close: false,
			};
		}

		if (event.type === 'artifact-ready') {
			return {
				chat: chatUpdate({
					identity, ready: false, state: 'streaming', reasonCode: 'runtime-agent-artifact-ready',
					actionHint: 'wait_runtime_agent_turn_terminal', source: 'runtime',
					message: 'Runtime Agent image artifact is ready.', requestId: null, runtimeTurnId,
					eventType: event.type, messages: [], actions: projectedActions(),
				}),
				close: false,
			};
		}

		if (event.type === 'voice-ready' || event.type === 'voice-failed') {
			const existing = turn.messages.find((message) => message.id === event.voice.messageId);
			if (!existing) return null;
			let message = existing;
			if (event.type === 'voice-failed') {
				message = { ...existing, metadata: { ...existing.metadata, voiceError: event.voice.reasonCode } };
			} else if (event.voice.artifactId && options.resolveArtifactUrl) {
				try {
					const voiceUrl = await options.resolveArtifactUrl(event.voice.artifactId);
					message = {
						...existing,
						kind: 'voice',
						metadata: {
							...existing.metadata,
							voiceArtifactId: event.voice.artifactId,
							voiceUrl,
							voiceTranscript: existing.text,
						},
					};
				} catch {
					message = { ...existing, metadata: { ...existing.metadata, voiceError: 'Conversation voice is unavailable.' } };
				}
			}
			turn.messages = [...turn.messages.filter((candidate) => candidate.id !== message.id), message];
			turns.set(runtimeTurnId, turn);
			return {
				chat: chatUpdate({
					identity, ready: false, state: 'streaming', reasonCode: `runtime-agent-${event.type}`,
					actionHint: 'wait_runtime_agent_turn_terminal', source: 'runtime',
					message: 'Runtime Agent voice state changed.', requestId: null, runtimeTurnId,
					eventType: event.type, messages: [message],
					actions: projectedActions(),
				}),
				close: false,
			};
		}

      if (event.type !== 'turn-completed'
        && event.type !== 'turn-failed'
        && event.type !== 'turn-interrupted') {
        return null;
      }
      const terminalKey = `${event.type}\u0000${runtimeTurnId}`;
      if (observedEvents.has(terminalKey)) return null;
      observedEvents.add(terminalKey);
      turns.set(runtimeTurnId, turn);
      const terminal = terminalProjection(event);
      return {
        chat: chatUpdate({
          identity,
          ...terminal,
          requestId: null,
          runtimeTurnId,
          eventType: event.type,
          messages: [],
			actions: projectedActions(),
        }),
        close: false,
      };
    },
    failure(error: unknown): ZhiyuAmbientConversationReduction {
      const record = recordValue(error);
      if (textValue(record, 'reasonCode') === 'local-app-access-denied') {
        return {
          chat: chatUpdate({
            identity,
            ready: false,
            state: 'idle',
            reasonCode: 'local-app-access-denied',
            actionHint: 'reselect_local_partner',
            source: textValue(record, 'source') || 'runtime',
            message: 'The protected conversation session changed. Reselect the local partner to hydrate current Runtime truth.',
            requestId: null,
            runtimeTurnId: null,
            eventType: 'ambient-subscription-session-refresh-required',
            messages: [],
            actions: projectedActions(),
          }),
          close: true,
        };
      }
      return failure(
        textValue(record, 'reasonCode') || 'zhiyu-conversation-ambient-subscription-failed',
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Runtime Agent ambient conversation subscription failed.',
        textValue(record, 'source') || 'sdk',
      );
    },
  });
}

export function subscribeZhiyuAmbientConversation(input: {
  readonly conversation: Pick<NimiLocalAppClient['conversation'], 'subscribe'>;
  readonly identity: ZhiyuAmbientConversationIdentity;
  readonly onChat: (chat: ZhiyuEvidence['chat']) => void;
	readonly hydrate: () => Promise<ZhiyuEvidence['chat']>;
	readonly resolveArtifactUrl?: (artifactId: string) => Promise<string>;
  readonly now?: () => number;
}): () => void {
  let active = true;
  let subscription: Awaited<ReturnType<typeof input.conversation.subscribe>> | null = null;
  let cancellation: Promise<void> | null = null;
	const cancelCurrent = (): Promise<void> => {
    if (!subscription) return Promise.resolve();
    cancellation ??= subscription.cancel().catch(() => undefined);
    return cancellation;
  };

  void (async () => {
		for (let attempt = 0; active && attempt < 2; attempt += 1) {
			let reducer: ReturnType<typeof createZhiyuAmbientConversationEventReducer> | null = null;
			let recoverOverflow = false;
			try {
				subscription = await input.conversation.subscribe(input.identity);
				if (!active) return;
				const hydrated = await input.hydrate();
				if (!active) return;
				input.onChat(hydrated);
				const highWater = typeof hydrated.diagnostics?.throughSequence === 'string'
					? hydrated.diagnostics.throughSequence
					: null;
				if (highWater === null) return;
				reducer = createZhiyuAmbientConversationEventReducer(input.identity, input.now, {
					throughSequence: highWater,
					initialChat: hydrated,
					resolveArtifactUrl: input.resolveArtifactUrl,
				});
				for await (const event of subscription) {
					if (!active) return;
					const reduction = await reducer.reduce(event);
					if (!reduction) continue;
					input.onChat(reduction.chat);
					if (reduction.close) return;
				}
				return;
			} catch (error) {
				recoverOverflow = attempt === 0 && retryableConversationOverflow(error);
				if (!recoverOverflow && active) {
					input.onChat((reducer ?? createZhiyuAmbientConversationEventReducer(input.identity, input.now)).failure(error).chat);
				}
			} finally {
				await cancelCurrent();
			}
			if (!recoverOverflow) return;
			subscription = null;
			cancellation = null;
		}
  })();

  return () => {
    if (!active) return;
    active = false;
	void cancelCurrent();
  };
}

function retryableConversationOverflow(error: unknown): boolean {
	const record = recordValue(error);
	const details = recordValue(record.details);
	if (details.retryable !== true) return false;
	const reasonCode = textValue(record, 'reasonCode');
	if (reasonCode === 'renderer-local-app-conversation-buffer-exhausted') {
		return details.diagnosticStage === 'renderer_local_app_conversation_buffer_overflow';
	}
	const reasonMetadata = recordValue(details.reasonMetadata);
	return reasonCode === 'local-app-owner-unavailable'
		&& reasonMetadata.diagnostic_stage === 'local_app_conversation_subscription_overflow';
}

function conversationSequence(value: string): bigint {
	if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new Error('Conversation sequence is invalid.');
	return BigInt(value);
}

function chatUpdate(input: {
  readonly identity: ZhiyuAmbientConversationIdentity;
  readonly ready: boolean;
  readonly state: ZhiyuEvidence['chat']['state'];
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly runtimeTurnId: string | null;
  readonly eventType: string;
  readonly messages: ZhiyuEvidence['chat']['messages'];
	readonly actions: ZhiyuEvidence['chat']['actions'];
}): ZhiyuEvidence['chat'] {
  const latestAssistant = [...input.messages].reverse().find((message) => message.role === 'agent') ?? null;
  return {
    transport: 'electron-ipc',
    ready: input.ready,
    state: input.state,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: input.identity.conversationAnchorId,
    requestId: input.requestId,
    runtimeTurnId: input.runtimeTurnId,
    runtimeStreamId: null,
    eventTypes: [input.eventType],
    messageCount: input.messages.length,
    messages: input.messages,
	actions: input.actions,
    latestAssistantText: latestAssistant?.text || null,
    reasoningText: null,
    outputText: latestAssistant?.text || null,
    diagnostics: {
      ambientConversationSubscription: true,
    },
  };
}

function terminalProjection(
  event: Extract<NimiLocalAppConversationEvent, {
    type: 'turn-completed' | 'turn-failed' | 'turn-interrupted';
  }>,
): Pick<
  Parameters<typeof chatUpdate>[0],
  'ready' | 'state' | 'reasonCode' | 'actionHint' | 'source' | 'message'
> {
  if (event.type === 'turn-completed') {
    return {
      ready: true,
      state: 'completed',
      reasonCode: 'runtime-agent-turn-completed',
      actionHint: 'review_runtime_agent_chat_message',
      source: 'runtime',
      message: 'Runtime Agent turn completed.',
    };
  }
  if (event.type === 'turn-interrupted') {
    return {
      ready: false,
      state: 'canceled',
      reasonCode: event.reason,
      actionHint: 'send_runtime_agent_turn',
      source: 'runtime',
      message: 'Runtime Agent turn was interrupted.',
    };
  }
  return {
    ready: false,
    state: 'failed',
    reasonCode: event.reasonCode,
    actionHint: 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: event.message || 'Runtime Agent turn failed.',
  };
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function textValue(record: Readonly<Record<string, unknown>>, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
