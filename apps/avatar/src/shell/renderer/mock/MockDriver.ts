import type {
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
  AppOriginEvent,
  DriverStatus,
} from '../driver/types.js';
import { createEventBus } from '../infra/event-bus.js';
import { ulid } from '../infra/ids.js';
import type { MockEvent, MockScenario, MockTrigger, MockTriggerFilter } from './scenario-types.js';

type InternalEvents = {
  'agent-event': AgentEvent;
  'bundle-change': AgentDataBundle;
  'status-change': DriverStatus;
};

type MockDriverOptions = {
  scenario: MockScenario;
  sessionId?: string;
  now?: () => number;
  setTimeoutImpl?: (fn: () => void, ms: number) => number;
  clearTimeoutImpl?: (id: number) => void;
  windowInfo?: () => { x: number; y: number; width: number; height: number };
  cursorInfo?: () => { x: number; y: number };
};

export class MockDriver implements AgentDataDriver {
  readonly kind = 'mock' as const;
  private _status: DriverStatus = 'idle';
  private readonly bus = createEventBus<InternalEvents>();
  private readonly scenario: MockScenario;
  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => number;
  private readonly unschedule: (id: number) => void;
  private readonly windowInfo: () => { x: number; y: number; width: number; height: number };
  private readonly cursorInfo: () => { x: number; y: number };
  private readonly timers = new Set<number>();
  private readonly emittedIds = new Map<string, AgentEvent>();
  private bundle!: AgentDataBundle;
  private loopTimer: number | null = null;

  constructor(options: MockDriverOptions) {
    this.scenario = options.scenario;
    this.sessionId = options.sessionId ?? ulid();
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.setTimeoutImpl ?? ((fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number);
    this.unschedule = options.clearTimeoutImpl ?? ((id) => globalThis.clearTimeout(id));
    this.windowInfo = options.windowInfo ?? (() => ({ x: 0, y: 0, width: 400, height: 600 }));
    this.cursorInfo = options.cursorInfo ?? (() => ({ x: 0, y: 0 }));
  }

  get status(): DriverStatus {
    return this._status;
  }

  async start(): Promise<void> {
    if (this._status === 'running' || this._status === 'starting') {
      return;
    }
    this.setStatus('starting');
    this.initializeBundle();
    this.scheduleTimeEvents();
    this.setStatus('running');
  }

  async stop(): Promise<void> {
    if (this._status === 'stopped' || this._status === 'idle') {
      return;
    }
    this.setStatus('stopping');
    this.clearAllTimers();
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
    const agentEvent = this.toAgentEvent(event.name, event.detail);
    this.emitAgentEvent(agentEvent);
    this.runTriggers(agentEvent);
  }

  private setStatus(status: DriverStatus): void {
    this._status = status;
    this.bus.emit('status-change', status);
  }

  private initializeBundle(): void {
    const bs = this.scenario.agent_bootstrap;
    const win = this.windowInfo();
    const cur = this.cursorInfo();
    this.bundle = {
      posture: {
        posture_class: bs.initial_posture.posture_class,
        action_family: bs.initial_posture.action_family,
        interrupt_mode: bs.initial_posture.interrupt_mode,
        transition_reason: bs.initial_posture.transition_reason,
        truth_basis_ids: [...bs.initial_posture.truth_basis_ids],
      },
      status_text: bs.initial_status_text,
      execution_state: bs.initial_execution_state,
      active_world_id: bs.active_world_id,
      active_user_id: bs.active_user_id,
      app: {
        namespace: 'avatar',
        surface_id: 'avatar-window',
        visible: true,
        focused: true,
        window: win,
        cursor_x: cur.x,
        cursor_y: cur.y,
      },
      runtime: {
        now: new Date(this.now()).toISOString(),
        session_id: this.sessionId,
        locale: bs.locale,
      },
    };
    this.bus.emit('bundle-change', this.bundle);
  }

  private scheduleTimeEvents(): void {
    for (const ev of this.scenario.events) {
      if (ev.kind === 'time') {
        this.scheduleEventAt(ev, ev.at_ms);
      } else {
        // 'after' events are chained; wait for the anchor event to emit, then schedule
        const anchor = ev.after_event_id;
        const unsub = this.bus.on('agent-event', (emitted) => {
          if (emitted.detail['scenario_event_id'] === anchor) {
            unsub();
            this.scheduleEventAt(ev, ev.delay_ms);
          }
        });
      }
    }

    if (this.scenario.loop && this.scenario.duration_ms !== null) {
      this.loopTimer = this.schedule(() => {
        this.clearAllTimers();
        this.emittedIds.clear();
        this.updateBundleTimestamp();
        this.scheduleTimeEvents();
      }, this.scenario.duration_ms);
      this.timers.add(this.loopTimer);
    }
  }

  private scheduleEventAt(ev: MockEvent, ms: number): void {
    const id = this.schedule(() => {
      this.timers.delete(id);
      const agentEvent = this.toAgentEvent(ev.type, ev.detail, ev.event_id);
      this.updateBundleForEvent(agentEvent);
      this.emitAgentEvent(agentEvent);
    }, ms);
    this.timers.add(id);
  }

  private runTriggers(agentEvent: AgentEvent): void {
    const triggers = this.scenario.triggers ?? [];
    for (const trigger of triggers) {
      if (trigger.on !== agentEvent.name) continue;
      if (!matchesFilter(agentEvent.detail, trigger.filter)) continue;
      const delay = trigger.emit.delay_ms ?? 0;
      const id = this.schedule(() => {
        this.timers.delete(id);
        const emitted = this.toAgentEvent(trigger.emit.type, trigger.emit.detail);
        this.updateBundleForEvent(emitted);
        this.emitAgentEvent(emitted);
      }, delay);
      this.timers.add(id);
    }
  }

  private toAgentEvent(
    name: string,
    detail: Record<string, unknown>,
    scenarioEventId?: string,
  ): AgentEvent {
    const event: AgentEvent = {
      event_id: ulid(this.now()),
      name,
      timestamp: new Date(this.now()).toISOString(),
      detail: scenarioEventId
        ? { ...detail, scenario_event_id: scenarioEventId }
        : { ...detail },
    };
    return event;
  }

  private emitAgentEvent(event: AgentEvent): void {
    this.emittedIds.set(event.event_id, event);
    this.bus.emit('agent-event', event);
  }

  private updateBundleForEvent(event: AgentEvent): void {
    if (event.name === 'runtime.agent.presentation.activity_requested') {
      const detail = event.detail;
      const activityName = typeof detail['activity_name'] === 'string' ? detail['activity_name'] : null;
      const category = typeof detail['category'] === 'string' ? detail['category'] : null;
      const intensityRaw = detail['intensity'];
      const intensity =
        intensityRaw === 'weak' || intensityRaw === 'moderate' || intensityRaw === 'strong'
          ? intensityRaw
          : null;
      if (activityName && (category === 'emotion' || category === 'interaction' || category === 'state')) {
        this.bundle = {
          ...this.bundle,
          activity: {
            name: activityName,
            category,
            intensity,
            source: 'mock',
          },
          runtime: { ...this.bundle.runtime, now: new Date(this.now()).toISOString() },
        };
        this.bus.emit('bundle-change', this.bundle);
      }
    }
  }

  private updateBundleTimestamp(): void {
    this.bundle = {
      ...this.bundle,
      runtime: { ...this.bundle.runtime, now: new Date(this.now()).toISOString() },
    };
    this.bus.emit('bundle-change', this.bundle);
  }

  private clearAllTimers(): void {
    for (const id of this.timers) {
      this.unschedule(id);
    }
    this.timers.clear();
    this.loopTimer = null;
  }
}

export function matchesFilter(
  detail: Record<string, unknown>,
  filter: Record<string, MockTriggerFilter> | undefined,
): boolean {
  if (!filter) return true;
  for (const [key, cond] of Object.entries(filter)) {
    const value = detail[key];
    if (cond === null || cond === undefined) {
      if (value !== cond) return false;
      continue;
    }
    if (typeof cond === 'object' && !Array.isArray(cond)) {
      const obj = cond as { eq?: unknown; in?: readonly unknown[] };
      if ('eq' in obj && value !== obj.eq) return false;
      if ('in' in obj && Array.isArray(obj.in) && !obj.in.includes(value)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}
