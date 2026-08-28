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
  clearTurnCueRecord,
  mapExecutionState,
  mergeCustomRecord,
  toRuntimeAgentEvent,
} from './sdk-driver-event-helpers.js';

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
  readonly signal: AbortSignal;
  readonly close: () => Promise<void>;
};

export type SdkDriverOptions = {
  conversation: NimiLocalAppConversationClient;
  agentHandle: NimiLocalAppAgentHandle;
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
  private readonly agentHandle: NimiLocalAppAgentHandle;
  private readonly conversationAnchorId: string;
  private readonly activeWorldId: string;
  private readonly locale: string;
  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly windowInfo: () => { x: number; y: number; width: number; height: number };
  private readonly cursorInfo: () => { x: number; y: number };
  private readonly bus = createEventBus<InternalEvents>();
  private streamAbort: AbortController | null = null;
  private bundle: AgentDataBundle;
  private lastError: string | null = null;

  constructor(options: SdkDriverOptions) {
    this.conversation = options.conversation;
    this.agentHandle = options.agentHandle;
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
      const openedConversation = conversation;
      return { conversation: openedConversation, signal: attemptAbort.signal, close };
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
        await this.consumeCanonicalConversationStream(streams.conversation, streams.signal);
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
      active_user_id: this.agentHandle,
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
        agent_id: this.agentHandle,
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
