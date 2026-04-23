import type { PlatformClient } from '@nimiplatform/sdk';
import type {
  AgentDataBundle,
  AgentBundleHistory,
  AgentDataDriver,
  AgentEvent,
  AppOriginEvent,
  DriverStatus,
} from '../driver/types.js';
import { createEventBus } from '../infra/event-bus.js';
import { ulid } from '../infra/ids.js';

type InternalEvents = {
  'agent-event': AgentEvent;
  'bundle-change': AgentDataBundle;
  'status-change': DriverStatus;
};

type RuntimeAgentConsumeEvent =
  Awaited<ReturnType<PlatformClient['runtime']['agent']['turns']['subscribe']>> extends AsyncIterable<infer T>
    ? T
    : never;

type RuntimeAgentSessionSnapshot =
  Awaited<ReturnType<PlatformClient['runtime']['agent']['turns']['getSessionSnapshot']>>;

type RuntimeAgentExecutionStateValue =
  | 'idle'
  | 'chat_active'
  | 'life_pending'
  | 'life_running'
  | 'suspended';

type BundleActivitySource = NonNullable<AgentDataBundle['activity']>['source'];
type BundleActivityCategory = NonNullable<AgentDataBundle['activity']>['category'];
type BundleActivityIntensity = NonNullable<AgentDataBundle['activity']>['intensity'];

export type SdkDriverOptions = {
  runtime: PlatformClient['runtime'];
  agentId: string;
  conversationAnchorId: string;
  activeWorldId: string;
  activeUserId: string;
  locale: string;
  sessionId?: string;
  now?: () => number;
  windowInfo?: () => { x: number; y: number; width: number; height: number };
  cursorInfo?: () => { x: number; y: number };
};

function mapExecutionState(value?: RuntimeAgentExecutionStateValue): AgentDataBundle['execution_state'] {
  switch (value) {
    case 'chat_active':
      return 'CHAT_ACTIVE';
    case 'life_pending':
      return 'LIFE_PENDING';
    case 'life_running':
      return 'LIFE_RUNNING';
    case 'suspended':
      return 'SUSPENDED';
    case 'idle':
    default:
      return 'IDLE';
  }
}

function normalizeActivitySource(value: unknown): BundleActivitySource {
  if (value === 'apml_output' || value === 'direct_api' || value === 'mock') {
    return value;
  }
  return 'direct_api';
}

function normalizeActivityCategory(value: unknown): BundleActivityCategory {
  if (value === 'emotion' || value === 'interaction' || value === 'state') {
    return value;
  }
  return 'state';
}

function normalizeActivityIntensity(value: unknown): BundleActivityIntensity {
  if (value === 'weak' || value === 'moderate' || value === 'strong') {
    return value;
  }
  return null;
}

function toRuntimeAgentEvent(
  name: string,
  detail: Record<string, unknown>,
  now: number,
): AgentEvent {
  return {
    event_id: ulid(now),
    name,
    timestamp: new Date(now).toISOString(),
    detail,
  };
}

function mergeHistory(
  current: AgentBundleHistory | undefined,
  next: Partial<AgentBundleHistory>,
): AgentBundleHistory {
  return {
    last_activity: next.last_activity ?? current?.last_activity ?? null,
    last_motion: next.last_motion ?? current?.last_motion ?? null,
    last_expression: next.last_expression ?? current?.last_expression ?? null,
  };
}

function mergeCustomRecord(
  current: AgentDataBundle['custom'],
  next: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current || {}),
    ...next,
  };
}

function clearTurnCueRecord(
  current: AgentDataBundle['custom'],
  next?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current || {}),
    active_turn_id: null,
    active_turn_stream_id: null,
    active_turn_phase: null,
    active_turn_text: null,
    active_turn_updated_at: null,
    ...(next || {}),
  };
}

export class SdkDriver implements AgentDataDriver {
  readonly kind = 'sdk' as const;
  private _status: DriverStatus = 'idle';
  private readonly runtime: PlatformClient['runtime'];
  private readonly agentId: string;
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
  private bundle: AgentDataBundle;

  constructor(options: SdkDriverOptions) {
    this.runtime = options.runtime;
    this.agentId = options.agentId;
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

  async start(): Promise<void> {
    if (this._status === 'starting' || this._status === 'running') {
      return;
    }
    this.setStatus('starting');
    this.streamAbort = new AbortController();
    this.publishBundle();
    try {
      const snapshot = await this.runtime.agent.turns.getSessionSnapshot(
        {
          agentId: this.agentId,
          conversationAnchorId: this.conversationAnchorId,
        },
        { signal: this.streamAbort.signal },
      );
      this.applySessionSnapshot(snapshot);
      const stream = await this.runtime.agent.turns.subscribe(
        {
          agentId: this.agentId,
          conversationAnchorId: this.conversationAnchorId,
        },
        { signal: this.streamAbort.signal },
      );
      this.setStatus('running');
      const abortController = this.streamAbort;
      void this.consumeStream(stream, abortController).catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        console.error(`[avatar:sdk] consume stream failed: ${error instanceof Error ? error.message : String(error)}`);
        this.setStatus('error');
      });
    } catch (error) {
      this.streamAbort = null;
      this.setStatus('error');
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
    this.emitAgentEvent(
      toRuntimeAgentEvent(event.name, event.detail, this.now()),
    );
  }

  private setStatus(status: DriverStatus): void {
    this._status = status;
    this.bus.emit('status-change', status);
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
        agent_id: this.agentId,
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
        execution_binding: snapshot.executionBinding ?? null,
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
    switch (event.eventName) {
      case 'runtime.agent.session.snapshot':
        this.applySessionSnapshot(event.detail.snapshot);
        return;
      case 'runtime.agent.presentation.activity_requested': {
        const timestampNow = this.now();
        this.bundle = {
          ...this.bundle,
          activity: {
            name: event.detail.activityName,
            category: normalizeActivityCategory(event.detail.category),
            intensity: normalizeActivityIntensity(event.detail.intensity),
            source: normalizeActivitySource(event.detail.source),
          },
          history: mergeHistory(this.bundle.history, {
            last_activity: {
              name: event.detail.activityName,
              at: new Date(timestampNow).toISOString(),
            },
          }),
        };
        this.touchRuntimeNow();
        this.publishBundle();
        this.emitAgentEvent(toRuntimeAgentEvent(event.eventName, {
          activity_name: event.detail.activityName,
          category: event.detail.category,
          intensity: event.detail.intensity ?? null,
          source: event.detail.source,
          agent_id: event.agentId,
          conversation_anchor_id: event.conversationAnchorId,
          turn_id: event.turnId,
          stream_id: event.streamId,
        }, timestampNow));
        this.emitAgentEvent(toRuntimeAgentEvent('apml.state.activity', {
          activity_name: event.detail.activityName,
          category: event.detail.category,
          intensity: event.detail.intensity ?? null,
          source: event.detail.source,
          agent_id: event.agentId,
          conversation_anchor_id: event.conversationAnchorId,
          turn_id: event.turnId,
          stream_id: event.streamId,
        }, timestampNow));
        return;
      }
      case 'runtime.agent.presentation.motion_requested': {
        const at = new Date(this.now()).toISOString();
        this.bundle = {
          ...this.bundle,
          history: mergeHistory(this.bundle.history, {
            last_motion: { group: event.detail.motionId, at },
          }),
        };
        break;
      }
      case 'runtime.agent.presentation.expression_requested': {
        const at = new Date(this.now()).toISOString();
        this.bundle = {
          ...this.bundle,
          history: mergeHistory(this.bundle.history, {
            last_expression: { name: event.detail.expressionId, at },
          }),
        };
        break;
      }
      case 'runtime.agent.state.status_text_changed':
        this.bundle = {
          ...this.bundle,
          status_text: event.detail.currentStatusText,
        };
        break;
      case 'runtime.agent.state.execution_state_changed':
        this.bundle = {
          ...this.bundle,
          execution_state: mapExecutionState(event.detail.currentExecutionState),
        };
        break;
      case 'runtime.agent.state.emotion_changed':
        this.bundle = {
          ...this.bundle,
          activity: {
            name: event.detail.currentEmotion,
            category: 'emotion',
            intensity: null,
            source: normalizeActivitySource(event.detail.source),
          },
        };
        break;
      case 'runtime.agent.state.posture_changed':
        this.bundle = {
          ...this.bundle,
          posture: {
            posture_class: `${event.detail.currentPosture.actionFamily}_${event.detail.currentPosture.interruptMode}`,
            action_family: event.detail.currentPosture.actionFamily as AgentDataBundle['posture']['action_family'],
            interrupt_mode: event.detail.currentPosture.interruptMode as AgentDataBundle['posture']['interrupt_mode'],
            transition_reason: event.eventName,
            truth_basis_ids: [event.originatingTurnId].filter((value): value is string => Boolean(value)),
          },
        };
        break;
      case 'runtime.agent.turn.message_committed':
        this.setActiveTurnCue({
          turnId: event.turnId,
          streamId: event.streamId,
          phase: 'committed',
          text: event.detail.text || '',
          at: new Date(this.now()).toISOString(),
        });
        this.setLatestCommittedMessage({
          messageId: event.detail.messageId,
          turnId: event.turnId,
          text: event.detail.text,
          at: new Date(this.now()).toISOString(),
        });
        this.bundle = {
          ...this.bundle,
          status_text: event.detail.text || this.bundle.status_text,
          custom: mergeCustomRecord(this.bundle.custom, {
            last_committed_message_id: event.detail.messageId,
            last_committed_turn_id: event.turnId,
          }),
        };
        break;
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
          text: event.detail.text || '',
          at: new Date(this.now()).toISOString(),
        });
        break;
      case 'runtime.agent.turn.completed':
        this.clearActiveTurnCue({
          phase: 'completed',
          turnId: event.turnId,
          at: new Date(this.now()).toISOString(),
          reason: event.detail.terminalReason ?? null,
        });
        break;
      case 'runtime.agent.turn.failed':
        this.clearActiveTurnCue({
          phase: 'failed',
          turnId: event.turnId,
          at: new Date(this.now()).toISOString(),
          reason: event.detail.message ?? event.detail.reasonCode,
        });
        break;
      case 'runtime.agent.turn.interrupted':
        this.clearActiveTurnCue({
          phase: 'interrupted',
          turnId: event.turnId,
          at: new Date(this.now()).toISOString(),
          reason: event.detail.reason,
          interruptedTurnId: event.turnId,
        });
        break;
      case 'runtime.agent.turn.interrupt_ack':
        this.clearActiveTurnCue({
          phase: 'interrupt_ack',
          turnId: event.turnId,
          at: new Date(this.now()).toISOString(),
          interruptedTurnId: event.detail.interruptedTurnId,
        });
        break;
      case 'runtime.agent.turn.reasoning_delta':
      case 'runtime.agent.turn.structured':
      case 'runtime.agent.turn.post_turn':
      case 'runtime.agent.presentation.pose_requested':
      case 'runtime.agent.presentation.pose_cleared':
      case 'runtime.agent.presentation.lookat_requested':
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

  private toPassthroughAgentEvent(event: RuntimeAgentConsumeEvent): AgentEvent {
    return toRuntimeAgentEvent(event.eventName, {
      ...event.detail,
      agent_id: event.agentId,
      conversation_anchor_id: event.conversationAnchorId,
      originating_turn_id: 'originatingTurnId' in event ? event.originatingTurnId ?? null : null,
      originating_stream_id: 'originatingStreamId' in event ? event.originatingStreamId ?? null : null,
      turn_id: 'turnId' in event ? event.turnId : null,
      stream_id: 'streamId' in event ? event.streamId : null,
    }, this.now());
  }

  private emitAgentEvent(event: AgentEvent): void {
    this.bus.emit('agent-event', event);
  }
}
