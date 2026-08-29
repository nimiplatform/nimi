import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationSnapshot,
  NimiLocalAppConversationSubscription,
  NimiLocalAppConversationVoice,
  NimiLocalAppEmbodimentClient,
  NimiLocalAppEmbodimentEvent,
  NimiLocalAppEmbodimentSnapshot,
  NimiLocalAppEmbodimentSubscription,
} from '@nimiplatform/sdk/app';
import type {
  ActionFamily,
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
  AppOriginEvent,
  DriverStatus,
  InterruptMode,
} from '../driver/types.js';
import { createEventBus } from '../infra/event-bus.js';
import {
  clearTurnCueRecord,
  mapExecutionState,
  mergeCustomRecord,
  toRuntimeAgentEvent,
} from './sdk-driver-event-helpers.js';
import {
  AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT,
  AVATAR_CONVERSATION_VOICE_FAILED_EVENT,
} from '../voice-lipsync/avatar-conversation-voice.js';

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
  readonly embodiment: NimiLocalAppEmbodimentSubscription;
  readonly signal: AbortSignal;
  readonly close: () => Promise<void>;
};

export type SdkDriverOptions = {
  conversation: NimiLocalAppConversationClient;
  embodiment: NimiLocalAppEmbodimentClient;
  agentHandle: NimiLocalAppAgentHandle;
  runWithAgentHandle?: <T>(
    operation: (agentHandle: NimiLocalAppAgentHandle) => Promise<T>,
  ) => Promise<T>;
  conversationAnchorId: string;
  activeWorldId: string;
  locale: string;
  sessionId?: string;
  now?: () => number;
  windowInfo?: () => { x: number; y: number; width: number; height: number };
  cursorInfo?: () => { x: number; y: number };
};

export class SdkDriver implements AgentDataDriver {
  readonly kind = 'sdk' as const;
  private _status: DriverStatus = 'idle';
  private readonly conversation: NimiLocalAppConversationClient;
  private readonly embodiment: NimiLocalAppEmbodimentClient;
  private agentHandle: NimiLocalAppAgentHandle;
  private readonly runWithAgentHandle: NonNullable<SdkDriverOptions['runWithAgentHandle']>;
  private readonly conversationAnchorId: string;
  private readonly activeWorldId: string;
  private readonly locale: string;
  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly windowInfo: () => { x: number; y: number; width: number; height: number };
  private readonly cursorInfo: () => { x: number; y: number };
  private readonly bus = createEventBus<InternalEvents>();
  private streamAbort: AbortController | null = null;
  private canonicalVoiceGeneration = 0;
  private readonly interruptedCanonicalVoiceTurns = new Set<string>();
  private bundle: AgentDataBundle;
  private lastError: string | null = null;

  constructor(options: SdkDriverOptions) {
    this.conversation = options.conversation;
    this.embodiment = options.embodiment;
    this.agentHandle = options.agentHandle;
    this.runWithAgentHandle = options.runWithAgentHandle
      ?? (<T>(operation: (agentHandle: NimiLocalAppAgentHandle) => Promise<T>) => (
        operation(this.agentHandle)
      ));
    this.conversationAnchorId = options.conversationAnchorId;
    this.activeWorldId = options.activeWorldId;
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
    this.invalidateCanonicalVoiceReads();
    this.streamAbort?.abort();
    this.streamAbort = null;
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

  private async connectRuntimeStreams(
    parentAbort: AbortController,
  ): Promise<AvatarRuntimeStreams> {
    this.invalidateCanonicalVoiceReads();
    const attemptAbort = new AbortController();
    const abortAttempt = () => attemptAbort.abort();
    parentAbort.signal.addEventListener('abort', abortAttempt, { once: true });
    let conversation: NimiLocalAppConversationSubscription | null = null;
    let embodiment: NimiLocalAppEmbodimentSubscription | null = null;
    const close = async () => {
      attemptAbort.abort();
      parentAbort.signal.removeEventListener('abort', abortAttempt);
      await Promise.allSettled([
        conversation?.cancel(),
        embodiment?.cancel(),
      ]);
    };
    try {
      const opened = await this.runWithAgentHandle(async (agentHandle) => {
        const openedConversation = await this.conversation.subscribe({
          agentHandle,
          conversationAnchorId: this.conversationAnchorId,
        });
        let openedEmbodiment: NimiLocalAppEmbodimentSubscription | null = null;
        try {
          openedEmbodiment = await this.embodiment.subscribe({
            agentHandle,
            conversationAnchorId: this.conversationAnchorId,
          });
          const [conversationSnapshot, embodimentSnapshot] = await Promise.all([
            this.conversation.snapshot({
              agentHandle,
              conversationAnchorId: this.conversationAnchorId,
            }),
            this.embodiment.snapshot({
              agentHandle,
              conversationAnchorId: this.conversationAnchorId,
            }),
          ]);
          this.setCurrentAgentHandle(agentHandle);
          this.applyCanonicalConversationSnapshot(conversationSnapshot);
          this.applyEmbodimentSnapshot(embodimentSnapshot);
          return { conversation: openedConversation, embodiment: openedEmbodiment };
        } catch (error) {
          await Promise.allSettled([
            openedConversation.cancel(),
            openedEmbodiment?.cancel(),
          ]);
          throw error;
        }
      });
      conversation = opened.conversation;
      embodiment = opened.embodiment;
      return { conversation, embodiment, signal: attemptAbort.signal, close };
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
        await Promise.all([
          this.consumeCanonicalConversationStream(streams.conversation, streams.signal),
          this.consumeEmbodimentStream(streams.embodiment, streams.signal),
        ]);
      } catch (error) {
        if (abortController.signal.aborted) return;
        const message = errorMessage(error);
        console.error(`[avatar:sdk] consume stream failed: ${message}`);
        this.setStatus('error', message);
      } finally {
        this.invalidateCanonicalVoiceReads();
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
      active_agent_handle: this.agentHandle,
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
        agent_handle: this.agentHandle,
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

  private setCurrentAgentHandle(agentHandle: NimiLocalAppAgentHandle): void {
    if (agentHandle === this.agentHandle) return;
    this.agentHandle = agentHandle;
    this.bundle = {
      ...this.bundle,
      active_agent_handle: agentHandle,
      custom: mergeCustomRecord(this.bundle.custom, {
        agent_handle: agentHandle,
      }),
    };
  }

  private invalidateCanonicalVoiceReads(): void {
    this.canonicalVoiceGeneration += 1;
    this.interruptedCanonicalVoiceTurns.clear();
  }

  private canonicalVoiceReadIsCurrent(
    voice: NimiLocalAppConversationVoice,
    voiceGeneration: number,
  ): boolean {
    return voiceGeneration === this.canonicalVoiceGeneration
      && !this.interruptedCanonicalVoiceTurns.has(voice.turnId)
      && Boolean(this.streamAbort && !this.streamAbort.signal.aborted);
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

  private applyEmbodimentSnapshot(snapshot: NimiLocalAppEmbodimentSnapshot): void {
    const at = embodimentObservedAt(snapshot.observedAt, this.now());
    if (snapshot.activity) this.applyEmbodimentActivity(snapshot.activity, at);
    if (snapshot.emotion) this.applyEmbodimentEmotion(snapshot.emotion, at);
    if (snapshot.posture) this.applyEmbodimentPosture(snapshot.posture, at);
    if (snapshot.voiceTiming) this.applyEmbodimentVoiceTiming(snapshot.voiceTiming, at);
    this.bundle = {
      ...this.bundle,
      custom: mergeCustomRecord(this.bundle.custom, {
        embodiment_sequence: snapshot.sequence,
        embodiment_provenance: snapshot.provenance,
      }),
    };
    this.touchRuntimeNow();
    this.publishBundle();
  }

  private async consumeEmbodimentStream(
    stream: NimiLocalAppEmbodimentSubscription,
    signal: AbortSignal,
  ): Promise<void> {
    for await (const event of stream) {
      if (signal.aborted) return;
      this.applyEmbodimentEvent(event);
    }
    if (!signal.aborted) throw new Error('Avatar embodiment stream closed unexpectedly.');
  }

  private applyEmbodimentEvent(event: NimiLocalAppEmbodimentEvent): void {
    const at = embodimentObservedAt(event.observedAt, this.now());
    switch (event.kind) {
      case 'activity':
        this.applyEmbodimentActivity(event.payload, at);
        break;
      case 'emotion':
        this.applyEmbodimentEmotion(event.payload, at);
        break;
      case 'posture':
        this.applyEmbodimentPosture(event.payload, at);
        break;
      case 'voice-timing':
        this.applyEmbodimentVoiceTiming(event.payload, at);
        break;
    }
    this.bundle = {
      ...this.bundle,
      custom: mergeCustomRecord(this.bundle.custom, {
        embodiment_sequence: event.sequence,
        embodiment_provenance: event.provenance,
      }),
    };
    this.touchRuntimeNow();
    this.publishBundle();
  }

  private applyEmbodimentActivity(
    activity: NimiLocalAppEmbodimentSnapshot['activity'] & {},
    at: string,
  ): void {
    const intensity = activity.intensity === 'weak'
      || activity.intensity === 'moderate'
      || activity.intensity === 'strong'
      ? activity.intensity
      : null;
    const category = activity.category === 'emotion'
      || activity.category === 'interaction'
      || activity.category === 'state'
      ? activity.category
      : 'state';
    this.bundle = {
      ...this.bundle,
      activity: {
        name: activity.name,
        category,
        intensity,
        source: 'runtime',
      },
      history: {
        last_activity: { name: activity.name, at },
        last_motion: this.bundle.history?.last_motion ?? null,
        last_expression: this.bundle.history?.last_expression ?? null,
      },
    };
    this.emitAgentEvent(toRuntimeAgentEvent('runtime.agent.presentation.activity_requested', {
      agent_handle: this.agentHandle,
      conversation_anchor_id: this.conversationAnchorId,
      activity_name: activity.name,
      category,
      intensity,
      source: 'runtime',
      turn_ref: activity.turnRef,
    }, Date.parse(at)));
  }

  private applyEmbodimentEmotion(
    emotion: NimiLocalAppEmbodimentSnapshot['emotion'] & {},
    at: string,
  ): void {
    const previous = this.bundle.emotion?.current ?? null;
    this.bundle = {
      ...this.bundle,
      emotion: {
        current: emotion.name as NonNullable<AgentDataBundle['emotion']>['current'],
        previous,
        source: emotion.source,
      },
      history: {
        last_activity: this.bundle.history?.last_activity ?? null,
        last_motion: this.bundle.history?.last_motion ?? null,
        last_expression: { name: emotion.name, at },
      },
    };
    this.emitAgentEvent(toRuntimeAgentEvent('runtime.agent.state.emotion_changed', {
      emotion_name: emotion.name,
      previous_emotion: previous,
      source: emotion.source,
    }, Date.parse(at)));
  }

  private applyEmbodimentPosture(
    posture: NimiLocalAppEmbodimentSnapshot['posture'] & {},
    at: string,
  ): void {
    this.bundle = {
      ...this.bundle,
      posture: {
        posture_class: 'runtime_semantic',
        action_family: posture.actionFamily as ActionFamily,
        interrupt_mode: posture.interruptMode as InterruptMode,
        transition_reason: 'runtime_embodiment',
        truth_basis_ids: [],
      },
    };
    this.emitAgentEvent(toRuntimeAgentEvent('runtime.agent.state.posture_changed', {
      action_family: posture.actionFamily,
      interrupt_mode: posture.interruptMode,
    }, Date.parse(at)));
  }

  private applyEmbodimentVoiceTiming(
    timing: NimiLocalAppEmbodimentSnapshot['voiceTiming'] & {},
    at: string,
  ): void {
    this.bundle = {
      ...this.bundle,
      custom: mergeCustomRecord(this.bundle.custom, {
        semantic_voice_phase: timing.phase,
        semantic_voice_duration_millis: timing.durationMillis,
        semantic_voice_deadline_offset_millis: timing.deadlineOffsetMillis,
        semantic_voice_turn_ref: timing.turnRef,
        semantic_voice_correlation_ref: timing.correlationRef,
        semantic_voice_observed_at: at,
      }),
    };
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
        this.bundle = {
          ...this.bundle,
          custom: mergeCustomRecord(this.bundle.custom, {
            last_conversation_voice_id: event.voice.voiceId,
            last_conversation_voice_state: event.voice.state,
            last_conversation_voice_reason: event.voice.reasonCode,
          }),
        };
        void this.playCanonicalConversationVoice(
          event.voice,
        this.canonicalVoiceGeneration,
        ).catch((error) => {
          this.emitAgentEvent(toRuntimeAgentEvent(AVATAR_CONVERSATION_VOICE_FAILED_EVENT, {
            voice_id: event.voice.voiceId,
            reason: errorMessage(error),
          }, this.now()));
        });
        break;
      case 'voice-failed':
        this.bundle = {
          ...this.bundle,
          custom: mergeCustomRecord(this.bundle.custom, {
            last_conversation_voice_id: event.voice.voiceId,
            last_conversation_voice_state: event.voice.state,
            last_conversation_voice_reason: event.voice.reasonCode,
          }),
        };
        this.emitAgentEvent(toRuntimeAgentEvent(AVATAR_CONVERSATION_VOICE_FAILED_EVENT, {
          voice_id: event.voice.voiceId,
          reason: event.voice.reasonCode ?? event.voice.message ?? 'conversation_voice_failed',
        }, this.now()));
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
        this.interruptedCanonicalVoiceTurns.add(event.turnId);
        this.emitAgentEvent(toRuntimeAgentEvent('runtime.agent.turn.interrupted', {
          turn_id: event.turnId,
          stream_id: event.turnId,
          reason: event.reason,
        }, this.now()));
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

  // @nimi-authority: rule.nimi.avatar.embodiment.r010
  private async playCanonicalConversationVoice(
    voice: NimiLocalAppConversationVoice,
    voiceGeneration: number,
  ): Promise<void> {
    const artifactId = voice.artifactId;
    if (!artifactId) {
      throw new Error('Canonical Conversation voice is ready without an artifact.');
    }
    let artifact: Awaited<ReturnType<NimiLocalAppConversationClient['readArtifact']>>;
    try {
      artifact = await this.runWithAgentHandle((agentHandle) => (
        this.conversation.readArtifact({
          agentHandle,
          conversationAnchorId: this.conversationAnchorId,
          artifactId,
        })
      ));
    } catch (error) {
      if (!this.canonicalVoiceReadIsCurrent(voice, voiceGeneration)) return;
      throw error;
    }
    if (!this.canonicalVoiceReadIsCurrent(voice, voiceGeneration)) return;
    this.emitAgentEvent(toRuntimeAgentEvent(AVATAR_CONVERSATION_VOICE_AUDIO_CHUNK_EVENT, {
      voice_id: voice.voiceId,
      chunk_sequence: 1,
      audio_mime_type: artifact.mimeType,
      chunk_bytes: artifact.bytes,
      turn_id: voice.turnId,
      conversation_anchor_id: this.conversationAnchorId,
      source: 'canonical_conversation',
    }, this.now()));
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

function embodimentObservedAt(
  value: Readonly<{ readonly seconds: string; readonly nanos: number }>,
  fallbackNow: number,
): string {
  try {
    const millis = Number((BigInt(value.seconds) * 1_000n) + BigInt(Math.floor(value.nanos / 1_000_000)));
    if (Number.isSafeInteger(millis)) return new Date(millis).toISOString();
  } catch {
    // The SDK has already validated the timestamp; retain a local diagnostic
    // fallback only if the host Date range cannot represent it.
  }
  return new Date(fallbackNow).toISOString();
}
