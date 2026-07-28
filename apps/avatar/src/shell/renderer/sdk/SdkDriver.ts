import type {
  NimiRuntimeAgentConsumeClient,
  NimiRuntimeAgentVoiceModule,
  NimiRuntimeAgentScopeRunner,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
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
  readSnapshotStatusCue,
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
  type RuntimeAgentSessionSnapshot,
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

export type SdkDriverOptions = {
  runtimeAgent: NimiRuntimeAgentConsumeClient;
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
      const snapshot = await this.withRuntimeAgentRead(
        (options) => this.runtimeAgent.turns.getSessionSnapshot(
          {
            ownerUserId: this.ownerUserId,
            runtimeSourceRef: this.runtimeSourceRef,
            localAgentRef: this.localAgentRef,
            conversationAnchorId: this.conversationAnchorId,
            ...(this.activeWorldId ? { worldId: this.activeWorldId } : {}),
          },
          { ...options, signal: this.streamAbort?.signal },
        ),
      );
      this.applySessionSnapshot(snapshot);
      const stream = await this.withRuntimeAgentTurnSubscribe(
        (options) => this.runtimeAgent.turns.subscribe(
          {
            ownerUserId: this.ownerUserId,
            runtimeSourceRef: this.runtimeSourceRef,
            localAgentRef: this.localAgentRef,
            conversationAnchorId: this.conversationAnchorId,
          },
          { ...options, signal: this.streamAbort?.signal },
        ),
      );
      this.setStatus('running');
      const abortController = this.streamAbort;
      void this.consumeStream(stream, abortController).catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        const message = errorMessage(error);
        console.error(`[avatar:sdk] consume stream failed: ${message}`);
        this.setStatus('error', message);
      });
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

  private withRuntimeAgentRead<T>(
    operation: (options: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> {
    if (!this.withScopes) {
      return operation({});
    }
    return this.withScopes(['runtime.agent.read'], operation);
  }

  private withRuntimeAgentTurnSubscribe<T>(
    operation: (options: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> {
    if (!this.withScopes) {
      return operation({});
    }
    return this.withScopes(['runtime.agent.read', 'runtime.agent.turn.read'], operation);
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

  private applySessionSnapshot(snapshot: RuntimeAgentSessionSnapshot): void {
    const lastTurnUpdatedAt = snapshot.lastTurn?.updatedAt || new Date(this.now()).toISOString();
    const activeTurnUpdatedAt = snapshot.activeTurn?.updatedAt || new Date(this.now()).toISOString();
    this.bundle = {
      ...this.bundle,
      status_text: String(snapshot.activeTurn?.text || snapshot.lastTurn?.text || this.bundle.status_text || ''),
      execution_state: mapExecutionState(snapshot.activeTurn ? 'chat_active' : undefined),
      custom: mergeCustomRecord(this.bundle.custom, {
        session_status: snapshot.sessionStatus || null,
        transcript_message_count: snapshot.transcriptMessageCount ?? null,
        execution_bindings: snapshot.executionBindings ?? null,
      }),
    };
    if (snapshot.activeTurn?.turnId) {
      this.setActiveTurnCue({
        turnId: snapshot.activeTurn.turnId,
        streamId: snapshot.activeTurn.turnId,
        phase: 'started',
        text: snapshot.activeTurn.text || '',
        at: activeTurnUpdatedAt,
      });
    } else {
      this.bundle = {
        ...this.bundle,
        custom: clearTurnCueRecord(this.bundle.custom),
      };
    }
    this.setLatestCommittedMessage({
      messageId: snapshot.lastTurn?.messageId,
      turnId: snapshot.lastTurn?.turnId,
      text: snapshot.lastTurn?.text,
      at: lastTurnUpdatedAt,
    });
    this.touchRuntimeNow();
    this.publishBundle();
    this.emitSnapshotStatusCueCatchup(snapshot);
  }

  private emitSnapshotStatusCueCatchup(snapshot: RuntimeAgentSessionSnapshot): void {
    const cue = readSnapshotStatusCue(snapshot);
    if (!cue) {
      return;
    }
    const timestampNow = this.now();
    const envelope = requireRuntimePresentationEnvelopeEvidence({
      localAgentRef: this.localAgentRef,
      conversationAnchorId: this.conversationAnchorId,
      turnId: cue.turnId,
      streamId: cue.streamId,
    });
    if (cue.expressionId) {
      requireRuntimeCurrentEmotion(cue.expressionId);
      this.emitAgentEvent(toRuntimeAgentEvent('runtime.agent.presentation.expression_requested', {
        expression_id: cue.expressionId,
        expected_duration_ms: null,
        ...envelope,
        source: 'apml_output',
        catchup_source: 'session_snapshot',
      }, timestampNow));
    }
    if (cue.activityName) {
      const category = requireRuntimeActivityCategory(cue.activityCategory);
      const intensity = requireRuntimeActivityIntensity(cue.activityIntensity);
      this.emitAgentEvent(toRuntimeAgentEvent('runtime.agent.presentation.activity_requested', {
        activity_name: cue.activityName,
        category,
        intensity,
        source: 'apml_output',
        ...envelope,
        catchup_source: 'session_snapshot',
      }, timestampNow));
    }
  }

  private async consumeStream(
    stream: AsyncIterable<RuntimeAgentConsumeEvent>,
    abortController: AbortController,
  ): Promise<void> {
    for await (const event of stream) {
      if (abortController.signal.aborted) {
        return;
      }
      this.applyRuntimeEvent(event);
    }
    if (!abortController.signal.aborted) {
      throw new Error('avatar runtime event stream closed unexpectedly');
    }
  }

  private applyRuntimeEvent(event: RuntimeAgentConsumeEvent): void {
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
      case 'runtime.agent.turn.message_committed': {
        const text = requireRuntimeDetailText(event.detail.text, 'runtime committed message text');
        const messageId = optionalRuntimeDetailText(event.detail.messageId) ?? undefined;
        this.setActiveTurnCue({
          turnId: event.turnId,
          streamId: event.streamId,
          phase: 'committed',
          text,
          at: new Date(this.now()).toISOString(),
        });
        this.setLatestCommittedMessage({
          messageId,
          turnId: event.turnId,
          text,
          at: new Date(this.now()).toISOString(),
        });
        this.bundle = {
          ...this.bundle,
          status_text: text || this.bundle.status_text,
          custom: mergeCustomRecord(this.bundle.custom, {
            last_committed_message_id: messageId ?? null,
            last_committed_turn_id: event.turnId,
          }),
        };
        break;
      }
      case 'runtime.agent.turn.accepted':
        this.setActiveTurnCue({
          turnId: event.turnId,
          streamId: event.streamId,
          phase: 'accepted',
          at: new Date(this.now()).toISOString(),
        });
        break;
      case 'runtime.agent.turn.started':
        this.setActiveTurnCue({
          turnId: event.turnId,
          streamId: event.streamId,
          phase: 'started',
          at: new Date(this.now()).toISOString(),
        });
        break;
      case 'runtime.agent.turn.text_delta':
        this.updateActiveTurnText({
          turnId: event.turnId,
          streamId: event.streamId,
          text: requireRuntimeDetailText(event.detail.text, 'runtime turn text delta'),
          at: new Date(this.now()).toISOString(),
        });
        break;
      case 'runtime.agent.turn.completed':
        this.clearActiveTurnCue({
          phase: 'completed',
          turnId: event.turnId,
          at: new Date(this.now()).toISOString(),
          reason: optionalRuntimeDetailText(event.detail.terminalReason),
        });
        break;
      case 'runtime.agent.turn.failed':
        this.clearActiveTurnCue({
          phase: 'failed',
          turnId: event.turnId,
          at: new Date(this.now()).toISOString(),
          reason: optionalRuntimeDetailText(event.detail.message)
            ?? optionalRuntimeDetailText(event.detail.reasonCode),
        });
        break;
      case 'runtime.agent.turn.interrupted':
        this.clearActiveTurnCue({
          phase: 'interrupted',
          turnId: event.turnId,
          at: new Date(this.now()).toISOString(),
          reason: optionalRuntimeDetailText(event.detail.reason),
          interruptedTurnId: event.turnId,
        });
        break;
      case 'runtime.agent.turn.interrupt_ack':
        this.clearActiveTurnCue({
          phase: 'interrupt_ack',
          turnId: event.turnId,
          at: new Date(this.now()).toISOString(),
          interruptedTurnId: optionalRuntimeDetailText(event.detail.interruptedTurnId),
        });
        break;
      case 'runtime.agent.turn.reasoning_delta':
      case 'runtime.agent.turn.structured':
      case 'runtime.agent.turn.post_turn':
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
