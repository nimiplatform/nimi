import type {
  NimiRuntimeAgentConsumeClient,
  NimiRuntimeAgentVoiceModule,
  NimiRuntimeAgentScopeRunner,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationSubscription,
} from '@nimiplatform/sdk/app';
import type {
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
  AppOriginEvent,
  DriverStatus,
} from '../driver/types.js';
import { createEventBus } from '../infra/event-bus.js';
import {
  buildNativeVoiceStreamSubscriptionPlan,
  consumeNativeVoiceStream,
} from './sdk-driver-native-voice.js';
import {
  clearTurnCueRecord,
  mapExecutionState,
  mergeCustomRecord,
  mergeHistory,
  normalizeRuntimeTimelineForAvatar,
  optionalRuntimeDetailText,
  optionalRuntimeExecutionState,
  optionalRuntimePreviousEmotion,
  requireRuntimeActivityCategory,
  requireRuntimeActivityIntensity,
  requireRuntimeCurrentEmotion,
  requireRuntimeDetailText,
  requireRuntimePresentationEnvelopeEvidence,
  requireRuntimePostureDetail,
  requireRuntimeProjectionSource,
  requireRuntimeSourceText,
  toRuntimeAgentEvent,
  type RuntimeAgentConsumeEvent,
} from './sdk-driver-event-helpers.js';
import { isKnownActivityId } from '../nas/activity-naming.js';

type InternalEvents = {
  'agent-event': AgentEvent;
  'bundle-change': AgentDataBundle;
  'status-change': DriverStatus;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown avatar sdk driver error');
}

const STREAM_RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;

type AvatarRuntimeStreams = {
  readonly conversation: NimiLocalAppConversationSubscription;
  readonly presentation: AsyncIterable<RuntimeAgentConsumeEvent>;
  readonly signal: AbortSignal;
  readonly close: () => Promise<void>;
};

export type SdkDriverOptions = {
  runtimeAgent: NimiRuntimeAgentConsumeClient;
  conversation: NimiLocalAppConversationClient;
  agentHandle: NimiLocalAppAgentHandle;
  runtimeVoice?: Pick<NimiRuntimeAgentVoiceModule, 'subscribeStream'>;
  withScopes?: NimiRuntimeAgentScopeRunner;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  activeWorldId: string;
  activeUserId: string;
  locale: string;
  sessionId?: string;
  now?: () => number;
  windowInfo?: () => { x: number; y: number; width: number; height: number };
  cursorInfo?: () => { x: number; y: number };
};

export class SdkDriver implements AgentDataDriver {
  readonly kind = 'sdk' as const;
  private _status: DriverStatus = 'idle';
  private readonly runtimeAgent: NimiRuntimeAgentConsumeClient;
  private readonly conversation: NimiLocalAppConversationClient;
  private readonly agentHandle: NimiLocalAppAgentHandle;
  private readonly runtimeVoice?: Pick<NimiRuntimeAgentVoiceModule, 'subscribeStream'>;
  private readonly withScopes?: NimiRuntimeAgentScopeRunner;
  private readonly ownerUserId: string;
  private readonly runtimeSourceRef: string;
  private readonly localAgentRef: string;
  private readonly conversationAnchorId: string;
  private readonly activeWorldId: string;
  private readonly activeUserId: string;
  private readonly locale: string;
  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly windowInfo: () => { x: number; y: number; width: number; height: number };
  private readonly cursorInfo: () => { x: number; y: number };
  private readonly bus = createEventBus<InternalEvents>();
  private streamAbort: AbortController | null = null;
  private readonly nativeVoiceStreamSubscriptions = new Set<string>();
  private bundle: AgentDataBundle;
  private lastError: string | null = null;

  constructor(options: SdkDriverOptions) {
    this.runtimeAgent = options.runtimeAgent;
    this.conversation = options.conversation;
    this.agentHandle = options.agentHandle;
    this.runtimeVoice = options.runtimeVoice;
    this.withScopes = options.withScopes;
    this.ownerUserId = options.ownerUserId;
    this.runtimeSourceRef = options.runtimeSourceRef;
    this.localAgentRef = options.localAgentRef;
    this.conversationAnchorId = options.conversationAnchorId;
    this.activeWorldId = options.activeWorldId;
    this.activeUserId = options.activeUserId;
    this.locale = options.locale;
    this.sessionId = options.sessionId ?? options.conversationAnchorId;
    this.now = options.now ?? (() => Date.now());
    this.windowInfo = options.windowInfo ?? (() => ({ x: 0, y: 0, width: 400, height: 600 }));
    this.cursorInfo = options.cursorInfo ?? (() => ({ x: 0, y: 0 }));
    this.bundle = this.createInitialBundle();
  }

  get status(): DriverStatus {
    return this._status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  async start(): Promise<void> {
    if (this._status === 'starting' || this._status === 'running') {
      return;
    }
    this.setStatus('starting');
    this.streamAbort = new AbortController();
    this.publishBundle();
    try {
      const streams = await this.connectRuntimeStreams(this.streamAbort);
      this.setStatus('running');
      const abortController = this.streamAbort;
      void this.consumeStreamsWithResync(streams, abortController);
    } catch (error) {
      this.streamAbort = null;
      this.setStatus('error', errorMessage(error));
      throw error instanceof Error
        ? error
        : new Error(`avatar sdk driver failed to start: ${String(error)}`);
    }
  }

  async stop(): Promise<void> {
    if (this._status === 'stopping' || this._status === 'stopped' || this._status === 'idle') {
      return;
    }
    this.setStatus('stopping');
    this.streamAbort?.abort();
    this.streamAbort = null;
    this.nativeVoiceStreamSubscriptions.clear();
    this.setStatus('stopped');
  }

  getBundle(): AgentDataBundle {
    return this.bundle;
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    return this.bus.on('agent-event', handler);
  }

  onBundleChange(handler: (bundle: AgentDataBundle) => void): () => void {
    return this.bus.on('bundle-change', handler);
  }

  onStatusChange(handler: (status: DriverStatus) => void): () => void {
    return this.bus.on('status-change', handler);
  }

  emit(event: AppOriginEvent): void {
    void this.emitCancelable(event);
  }

  emitCancelable(event: AppOriginEvent): AgentEvent {
    const agentEvent = toRuntimeAgentEvent(event.name, event.detail, this.now());
    this.emitAgentEvent(agentEvent);
    return agentEvent;
  }

  private setStatus(status: DriverStatus, error: string | null = null): void {
    this._status = status;
    this.lastError = status === 'error' ? error : null;
    this.bus.emit('status-change', status);
  }

  private withRuntimeAgentTurnSubscribe<T>(
    operation: (options: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> {
    if (!this.withScopes) {
      return operation({});
    }
    return this.withScopes(['runtime.agent.read', 'runtime.agent.turn.read'], operation);
  }

  private async connectRuntimeStreams(
    parentAbort: AbortController,
  ): Promise<AvatarRuntimeStreams> {
    const attemptAbort = new AbortController();
    const abortAttempt = () => attemptAbort.abort();
    parentAbort.signal.addEventListener('abort', abortAttempt, { once: true });
    let conversation: NimiLocalAppConversationSubscription | null = null;
    const close = async () => {
      attemptAbort.abort();
      parentAbort.signal.removeEventListener('abort', abortAttempt);
      await conversation?.cancel().catch(() => undefined);
    };
    try {
      conversation = await this.conversation.subscribe({
        agentHandle: this.agentHandle,
        conversationAnchorId: this.conversationAnchorId,
      });
      const snapshot = await this.conversation.snapshot({
        agentHandle: this.agentHandle,
        conversationAnchorId: this.conversationAnchorId,
      });
      this.applyCanonicalConversationSnapshot(snapshot);
      const presentation = await this.withRuntimeAgentTurnSubscribe(
        (options) => this.runtimeAgent.turns.subscribe(
          {
            ownerUserId: this.ownerUserId,
            runtimeSourceRef: this.runtimeSourceRef,
            localAgentRef: this.localAgentRef,
            conversationAnchorId: this.conversationAnchorId,
            includeTurnEvents: false,
          },
          { ...options, signal: attemptAbort.signal },
        ),
      );
      const openedConversation = conversation;
      return { conversation: openedConversation, presentation, signal: attemptAbort.signal, close };
    } catch (error) {
      await close();
      throw error;
    }
  }

  private async consumeStreamsWithResync(
    initialStreams: AvatarRuntimeStreams,
    abortController: AbortController,
  ): Promise<void> {
    let streams = initialStreams;
    let retryAttempt = 0;
    while (!abortController.signal.aborted) {
      try {
        await Promise.race([
          this.consumeCanonicalConversationStream(streams.conversation, streams.signal),
          this.consumePresentationStream(streams.presentation, streams.signal),
        ]);
      } catch (error) {
        if (abortController.signal.aborted) return;
        const message = errorMessage(error);
        console.error(`[avatar:sdk] consume stream failed: ${message}`);
        this.setStatus('error', message);
      } finally {
        await streams.close();
      }
      while (!abortController.signal.aborted) {
        await abortableDelay(
          STREAM_RECONNECT_DELAYS_MS[Math.min(retryAttempt, STREAM_RECONNECT_DELAYS_MS.length - 1)]!,
          abortController.signal,
        );
        if (abortController.signal.aborted) return;
        retryAttempt += 1;
        try {
          streams = await this.connectRuntimeStreams(abortController);
          retryAttempt = 0;
          this.setStatus('running');
          break;
        } catch (error) {
          if (abortController.signal.aborted) return;
          const message = errorMessage(error);
          console.error(`[avatar:sdk] stream resync failed: ${message}`);
          this.setStatus('error', message);
        }
      }
    }
  }

  private createInitialBundle(): AgentDataBundle {
    const windowInfo = this.windowInfo();
    const cursor = this.cursorInfo();
    return {
      posture: {
        posture_class: 'baseline_observer',
        action_family: 'observe',
        interrupt_mode: 'welcome',
        transition_reason: 'sdk_bootstrap',
        truth_basis_ids: [],
      },
      status_text: '',
      execution_state: 'IDLE',
      active_world_id: this.activeWorldId,
      active_user_id: this.activeUserId,
      app: {
        namespace: 'avatar',
        surface_id: 'avatar-window',
        visible: true,
        focused: true,
        window: windowInfo,
        cursor_x: cursor.x,
        cursor_y: cursor.y,
      },
      runtime: {
        now: new Date(this.now()).toISOString(),
        session_id: this.sessionId,
        locale: this.locale,
      },
      custom: {
        agent_id: this.localAgentRef,
        conversation_anchor_id: this.conversationAnchorId,
      },
    };
  }

  private publishBundle(): void {
    this.bus.emit('bundle-change', this.bundle);
  }

  private touchRuntimeNow(): void {
    this.bundle = {
      ...this.bundle,
      runtime: {
        ...this.bundle.runtime,
        now: new Date(this.now()).toISOString(),
      },
    };
  }

  private setActiveTurnCue(input: {
    turnId: string;
    streamId: string;
    phase: 'accepted' | 'started' | 'streaming' | 'committed';
    text?: string;
    at: string;
  }): void {
    this.bundle = {
      ...this.bundle,
      custom: mergeCustomRecord(this.bundle.custom, {
        active_turn_id: input.turnId,
        active_turn_stream_id: input.streamId,
        active_turn_phase: input.phase,
        active_turn_text: input.text ?? null,
        active_turn_updated_at: input.at,
        last_turn_terminal_phase: null,
        last_turn_terminal_id: null,
        last_turn_terminal_at: null,
        last_turn_terminal_reason: null,
        last_interrupted_turn_id: null,
      }),
    };
  }

  private updateActiveTurnText(input: {
    turnId: string;
    streamId: string;
    text: string;
    at: string;
  }): void {
    const currentCustom = this.bundle.custom || {};
    const previousText = String(currentCustom['active_turn_text'] || '');
    this.bundle = {
      ...this.bundle,
      custom: mergeCustomRecord(this.bundle.custom, {
        active_turn_id: input.turnId,
        active_turn_stream_id: input.streamId,
        active_turn_phase: 'streaming',
        active_turn_text: previousText + input.text,
        active_turn_updated_at: input.at,
      }),
    };
  }

  private clearActiveTurnCue(input: {
    phase: 'completed' | 'failed' | 'interrupted' | 'interrupt_ack';
    turnId: string;
    at: string;
    reason?: string | null;
    interruptedTurnId?: string | null;
  }): void {
    this.bundle = {
      ...this.bundle,
      custom: clearTurnCueRecord(this.bundle.custom, {
        last_turn_terminal_phase: input.phase,
        last_turn_terminal_id: input.turnId,
        last_turn_terminal_at: input.at,
        last_turn_terminal_reason: input.reason ?? null,
        last_interrupted_turn_id: input.interruptedTurnId ?? null,
      }),
    };
  }

  private setLatestCommittedMessage(input: {
    messageId?: string;
    turnId?: string;
    text?: string;
    at: string;
  }): void {
    if (!String(input.text || '').trim()) {
      return;
    }
    this.bundle = {
      ...this.bundle,
      custom: mergeCustomRecord(this.bundle.custom, {
        latest_committed_message_id: input.messageId ?? null,
        latest_committed_turn_id: input.turnId ?? null,
        latest_committed_message_text: input.text ?? '',
        latest_committed_message_at: input.at,
      }),
    };
  }

  private applyCanonicalConversationSnapshot(snapshot: NimiLocalAppConversationSnapshot): void {
    if (snapshot.conversationAnchorId !== this.conversationAnchorId) {
      throw new Error('Avatar canonical Conversation snapshot identity mismatch.');
    }
    const activeTurn = snapshot.turns.find((turn) => turn.status === 'active') || null;
    const latestAssistant = [...snapshot.messages].reverse().find((message) => (
      message.role === 'assistant'
    )) || null;
    const latestAssistantText = latestAssistant?.parts.find((part) => part.kind === 'text')?.text || '';
    const observedAt = new Date(this.now()).toISOString();
    this.bundle = {
      ...this.bundle,
      status_text: latestAssistantText || this.bundle.status_text,
      execution_state: mapExecutionState(activeTurn ? 'chat_active' : undefined),
      custom: mergeCustomRecord(this.bundle.custom, {
        session_status: 'canonical-conversation',
        transcript_message_count: snapshot.messages.length,
        conversation_through_sequence: snapshot.throughSequence,
      }),
    };
    if (activeTurn) {
      this.setActiveTurnCue({
        turnId: activeTurn.turnId,
        streamId: activeTurn.turnId,
        phase: activeTurn.phase === 'accepted' ? 'accepted' : 'started',
        at: observedAt,
      });
    } else {
      this.bundle = {
        ...this.bundle,
        custom: clearTurnCueRecord(this.bundle.custom),
      };
    }
    this.setLatestCommittedMessage({
      messageId: latestAssistant?.messageId,
      turnId: latestAssistant?.turnId,
      text: latestAssistantText,
      at: observedAt,
    });
    this.touchRuntimeNow();
    this.publishBundle();
  }

  private async consumeCanonicalConversationStream(
    stream: NimiLocalAppConversationSubscription,
    signal: AbortSignal,
  ): Promise<void> {
    for await (const event of stream) {
      if (signal.aborted) return;
      this.applyCanonicalConversationEvent(event);
    }
    if (!signal.aborted) {
      throw new Error('Avatar canonical Conversation stream closed unexpectedly.');
    }
  }

  private applyCanonicalConversationEvent(event: NimiLocalAppConversationEvent): void {
    if (event.conversationAnchorId !== this.conversationAnchorId) {
      throw new Error('Avatar canonical Conversation event identity mismatch.');
    }
    const at = new Date(this.now()).toISOString();
    switch (event.type) {
      case 'turn-accepted':
        this.setActiveTurnCue({ turnId: event.turnId, streamId: event.turnId, phase: 'accepted', at });
        break;
      case 'turn-started':
        this.setActiveTurnCue({ turnId: event.turnId, streamId: event.turnId, phase: 'started', at });
        break;
      case 'text-delta':
        this.updateActiveTurnText({
          turnId: event.turnId,
          streamId: event.turnId,
          text: event.delta,
          at,
        });
        break;
      case 'reasoning-status':
        this.bundle = {
          ...this.bundle,
          custom: mergeCustomRecord(this.bundle.custom, {
            active_reasoning_state: event.state,
            active_reasoning_turn_id: event.turnId,
          }),
        };
        break;
      case 'message-committed': {
        if (event.message.role !== 'assistant') break;
        const text = event.message.parts.find((part) => part.kind === 'text')?.text || '';
        this.setActiveTurnCue({
          turnId: event.turnId,
          streamId: event.turnId,
          phase: 'committed',
          text,
          at,
        });
        this.setLatestCommittedMessage({
          messageId: event.message.messageId,
          turnId: event.turnId,
          text,
          at,
        });
        this.bundle = {
          ...this.bundle,
          status_text: text || this.bundle.status_text,
        };
        break;
      }
      case 'action-planned':
      case 'action-started':
      case 'action-completed':
      case 'action-failed':
        this.bundle = {
          ...this.bundle,
          custom: mergeCustomRecord(this.bundle.custom, {
            last_conversation_action_id: event.action.actionId,
            last_conversation_action_status: event.action.status,
            last_conversation_action_reason: event.action.reasonCode,
          }),
        };
        break;
      case 'live-action':
        this.bundle = {
          ...this.bundle,
          custom: mergeCustomRecord(this.bundle.custom, {
            active_action_id: event.action.actionId,
            active_action_name: event.action.name,
            active_action_lifecycle: event.action.lifecycle,
            active_action_progress: event.action.progress,
          }),
        };
        break;
      case 'live-tool':
        this.bundle = {
          ...this.bundle,
          custom: mergeCustomRecord(this.bundle.custom, {
            active_tool_id: event.tool.toolId,
            active_tool_name: event.tool.name,
            active_tool_lifecycle: event.tool.lifecycle,
            active_tool_progress: event.tool.progress,
          }),
        };
        break;
      case 'artifact-ready':
        this.bundle = {
          ...this.bundle,
          custom: mergeCustomRecord(this.bundle.custom, {
            last_conversation_artifact_id: event.artifactId,
            last_conversation_artifact_turn_id: event.turnId,
          }),
        };
        break;
      case 'voice-ready':
      case 'voice-failed':
        this.bundle = {
          ...this.bundle,
          custom: mergeCustomRecord(this.bundle.custom, {
            last_conversation_voice_id: event.voice.voiceId,
            last_conversation_voice_state: event.voice.state,
            last_conversation_voice_reason: event.voice.reasonCode,
          }),
        };
        break;
      case 'turn-completed':
        this.clearActiveTurnCue({
          phase: 'completed', turnId: event.turnId, at, reason: event.terminalReason,
        });
        break;
      case 'turn-failed':
        this.clearActiveTurnCue({
          phase: 'failed', turnId: event.turnId, at,
          reason: event.message || event.reasonCode,
        });
        break;
      case 'turn-interrupted':
        this.clearActiveTurnCue({
          phase: 'interrupted', turnId: event.turnId, at,
          reason: event.reason, interruptedTurnId: event.turnId,
        });
        break;
    }
    this.bundle = {
      ...this.bundle,
      custom: mergeCustomRecord(this.bundle.custom, {
        conversation_sequence: event.sequence,
      }),
    };
    this.touchRuntimeNow();
    this.publishBundle();
  }

  private async consumePresentationStream(
    stream: AsyncIterable<RuntimeAgentConsumeEvent>,
    signal: AbortSignal,
  ): Promise<void> {
    for await (const event of stream) {
      if (signal.aborted) {
        return;
      }
      this.applyRuntimeEvent(event);
    }
    if (!signal.aborted) {
      throw new Error('Avatar Runtime presentation stream closed unexpectedly.');
    }
  }

  private applyRuntimeEvent(event: RuntimeAgentConsumeEvent): void {
    if (event.eventName.startsWith('runtime.agent.turn.')) {
      // Canonical turn/message/action/tool truth arrives only through the
      // handle-scoped Conversation stream. This carrier is presentation-only.
      return;
    }
    const runtimeTimeline = normalizeRuntimeTimelineForAvatar(event);
    if (runtimeTimeline) {
      this.bundle = {
        ...this.bundle,
        custom: mergeCustomRecord(this.bundle.custom, {
          last_runtime_timeline: runtimeTimeline,
        }),
      };
    }
    switch (event.eventName) {
      case 'runtime.agent.presentation.activity_requested': {
        const timestampNow = this.now();
        const activityName = requireRuntimeDetailText(event.detail.activityName, 'runtime activity name');
        if (!isKnownActivityId(activityName)) {
          return;
        }
        const category = requireRuntimeActivityCategory(event.detail.category);
        const intensity = requireRuntimeActivityIntensity(event.detail.intensity);
        const runtimeSource = requireRuntimeProjectionSource(event.detail.source, 'runtime activity projection');
        const envelope = requireRuntimePresentationEnvelopeEvidence(event);
        this.bundle = {
          ...this.bundle,
          activity: {
            name: activityName,
            category,
            intensity,
            source: runtimeSource,
          },
          history: mergeHistory(this.bundle.history, {
            last_activity: {
              name: activityName,
              at: new Date(timestampNow).toISOString(),
            },
          }),
          custom: mergeCustomRecord(this.bundle.custom, {
            last_runtime_activity_source: runtimeSource,
            last_runtime_activity_category: category,
            last_runtime_activity_intensity: intensity,
          }),
        };
        this.touchRuntimeNow();
        this.publishBundle();
        this.emitAgentEvent(toRuntimeAgentEvent(event.eventName, {
          activity_name: activityName,
          category,
          intensity,
          source: runtimeSource,
          ...envelope,
        }, timestampNow));
        return;
      }
      case 'runtime.agent.presentation.motion_requested': {
        const at = new Date(this.now()).toISOString();
        const motionId = requireRuntimeDetailText(event.detail.motionId, 'runtime motion id');
        this.bundle = {
          ...this.bundle,
          history: mergeHistory(this.bundle.history, {
            last_motion: { group: motionId, at },
          }),
        };
        break;
      }
      case 'runtime.agent.presentation.expression_requested': {
        const timestampNow = this.now();
        const at = new Date(timestampNow).toISOString();
        const expressionId = requireRuntimeDetailText(event.detail.expressionId, 'runtime expression id');
        const envelope = requireRuntimePresentationEnvelopeEvidence(event);
        this.bundle = {
          ...this.bundle,
          history: mergeHistory(this.bundle.history, {
            last_expression: { name: expressionId, at },
          }),
        };
        this.touchRuntimeNow();
        this.publishBundle();
        this.emitAgentEvent(toRuntimeAgentEvent(event.eventName, {
          expression_id: expressionId,
          expected_duration_ms: event.detail.expectedDurationMs ?? null,
          ...envelope,
        }, timestampNow));
        return;
      }
      case 'runtime.agent.state.status_text_changed':
        this.bundle = {
          ...this.bundle,
          status_text: requireRuntimeDetailText(event.detail.currentStatusText, 'runtime status text'),
        };
        break;
      case 'runtime.agent.state.execution_state_changed':
        this.bundle = {
          ...this.bundle,
          execution_state: mapExecutionState(optionalRuntimeExecutionState(event.detail.currentExecutionState)),
        };
        break;
      case 'runtime.agent.state.emotion_changed': {
        const currentEmotion = requireRuntimeCurrentEmotion(event.detail.currentEmotion);
        const previousEmotion = optionalRuntimePreviousEmotion(event.detail.previousEmotion);
        const runtimeSource = requireRuntimeSourceText(event.detail.source, 'runtime emotion projection');
        this.bundle = {
          ...this.bundle,
          emotion: {
            current: currentEmotion,
            previous: previousEmotion,
            source: runtimeSource,
          },
          custom: mergeCustomRecord(this.bundle.custom, {
            runtime_current_emotion: currentEmotion,
            runtime_previous_emotion: previousEmotion,
            runtime_emotion_source: runtimeSource,
          }),
        };
        break;
      }
      case 'runtime.agent.state.posture_changed': {
        const posture = requireRuntimePostureDetail(event.detail.currentPosture);
        this.bundle = {
          ...this.bundle,
          posture: {
            posture_class: `${posture.actionFamily}_${posture.interruptMode}`,
            action_family: posture.actionFamily as AgentDataBundle['posture']['action_family'],
            interrupt_mode: posture.interruptMode as AgentDataBundle['posture']['interrupt_mode'],
            transition_reason: event.eventName,
            truth_basis_ids: [event.originatingTurnId].filter((value): value is string => Boolean(value)),
          },
        };
        break;
      }
      case 'runtime.agent.avatar_debug.probe_requested':
      case 'runtime.agent.avatar_debug.probe_result':
      case 'runtime.agent.avatar_debug.replay_linked':
      case 'runtime.agent.presentation.pose_requested':
      case 'runtime.agent.presentation.pose_cleared':
      case 'runtime.agent.presentation.lookat_requested':
      case 'runtime.agent.presentation.voice_playback_requested':
      case 'runtime.agent.presentation.voice_stream_chunk_available':
        this.startNativeVoiceStreamSubscription(event);
        break;
      case 'runtime.agent.presentation.voice_playback_terminal':
        break;
      case 'runtime.agent.hook.intent_proposed':
      case 'runtime.agent.hook.pending':
      case 'runtime.agent.hook.rejected':
      case 'runtime.agent.hook.running':
      case 'runtime.agent.hook.completed':
      case 'runtime.agent.hook.failed':
      case 'runtime.agent.hook.canceled':
      case 'runtime.agent.hook.rescheduled':
        break;
      default:
        return;
    }
    this.touchRuntimeNow();
    this.publishBundle();
    this.emitAgentEvent(this.toPassthroughAgentEvent(event));
  }

  private startNativeVoiceStreamSubscription(event: RuntimeAgentConsumeEvent): void {
    const plan = buildNativeVoiceStreamSubscriptionPlan({
      event,
      runtimeVoice: this.runtimeVoice,
      nativeVoiceStreamSubscriptions: this.nativeVoiceStreamSubscriptions,
      abortController: this.streamAbort,
    });
    if (!plan) {
      return;
    }
    this.nativeVoiceStreamSubscriptions.add(plan.voiceStreamId);
    void consumeNativeVoiceStream({
      ...plan,
      runtimeVoice: this.runtimeVoice,
      ownerUserId: this.ownerUserId,
      runtimeSourceRef: this.runtimeSourceRef,
      localAgentRef: this.localAgentRef,
      now: this.now,
      emitAgentEvent: (agentEvent) => this.emitAgentEvent(agentEvent),
      setLastError: (message) => {
        this.lastError = message;
      },
    }).finally(() => {
      this.nativeVoiceStreamSubscriptions.delete(plan.voiceStreamId);
    });
  }

  private toPassthroughAgentEvent(event: RuntimeAgentConsumeEvent): AgentEvent {
    const runtimeTimeline = normalizeRuntimeTimelineForAvatar(event);
    return toRuntimeAgentEvent(event.eventName, {
      ...event.detail,
      agent_id: event.localAgentRef,
      conversation_anchor_id: event.conversationAnchorId,
      originating_turn_id: 'originatingTurnId' in event ? event.originatingTurnId ?? null : null,
      originating_stream_id: 'originatingStreamId' in event ? event.originatingStreamId ?? null : null,
      turn_id: 'turnId' in event ? event.turnId : null,
      stream_id: 'streamId' in event ? event.streamId : null,
      ...(runtimeTimeline ? { runtime_timeline: runtimeTimeline } : {}),
    }, this.now());
  }

  private emitAgentEvent(event: AgentEvent): void {
    this.bus.emit('agent-event', event);
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(finish, ms);
    function finish() {
      globalThis.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}
