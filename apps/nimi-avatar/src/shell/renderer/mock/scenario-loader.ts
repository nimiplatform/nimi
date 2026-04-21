import type { MockEvent, MockScenario, MockTrigger } from './scenario-types.js';

const ACTION_FAMILIES = ['observe', 'engage', 'support', 'assist', 'reflect', 'rest'] as const;
const INTERRUPT_MODES = ['welcome', 'cautious', 'focused'] as const;
const EXECUTION_STATES = ['IDLE', 'CHAT_ACTIVE', 'LIFE_PENDING', 'LIFE_RUNNING', 'SUSPENDED'] as const;

export class ScenarioValidationError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`[scenario:${path}] ${message}`);
    this.name = 'ScenarioValidationError';
    this.path = path;
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new ScenarioValidationError(`expected string, got ${typeof value}`, path);
  }
}

function assertNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ScenarioValidationError(`expected finite number, got ${String(value)}`, path);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new ScenarioValidationError(`expected boolean, got ${typeof value}`, path);
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ScenarioValidationError('expected object', path);
  }
}

function assertArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new ScenarioValidationError('expected array', path);
  }
}

function assertIn<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): asserts value is T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ScenarioValidationError(`expected one of ${allowed.join('|')}, got ${String(value)}`, path);
  }
}

function parseEvent(raw: unknown, path: string): MockEvent {
  assertObject(raw, path);
  const kind = raw['kind'];
  assertString(kind, `${path}.kind`);

  const type = raw['type'];
  assertString(type, `${path}.type`);

  const detail = raw['detail'];
  assertObject(detail, `${path}.detail`);

  if (kind === 'time') {
    const atMs = raw['at_ms'];
    assertNumber(atMs, `${path}.at_ms`);
    if (atMs < 0) {
      throw new ScenarioValidationError('at_ms must be >= 0', `${path}.at_ms`);
    }
    const eventId = raw['event_id'];
    if (eventId !== undefined) {
      assertString(eventId, `${path}.event_id`);
    }
    return {
      kind: 'time',
      at_ms: atMs,
      ...(typeof eventId === 'string' ? { event_id: eventId } : {}),
      type,
      detail: detail as Record<string, unknown>,
    };
  }

  if (kind === 'after') {
    const after = raw['after_event_id'];
    assertString(after, `${path}.after_event_id`);
    const delay = raw['delay_ms'];
    assertNumber(delay, `${path}.delay_ms`);
    if (delay < 0) {
      throw new ScenarioValidationError('delay_ms must be >= 0', `${path}.delay_ms`);
    }
    const eventId = raw['event_id'];
    if (eventId !== undefined) {
      assertString(eventId, `${path}.event_id`);
    }
    return {
      kind: 'after',
      after_event_id: after,
      delay_ms: delay,
      ...(typeof eventId === 'string' ? { event_id: eventId } : {}),
      type,
      detail: detail as Record<string, unknown>,
    };
  }

  throw new ScenarioValidationError(`unknown event kind: ${kind}`, `${path}.kind`);
}

function parseTrigger(raw: unknown, path: string): MockTrigger {
  assertObject(raw, path);
  const triggerId = raw['trigger_id'];
  assertString(triggerId, `${path}.trigger_id`);
  const on = raw['on'];
  assertString(on, `${path}.on`);
  const emit = raw['emit'];
  assertObject(emit, `${path}.emit`);
  const emitType = emit['type'];
  assertString(emitType, `${path}.emit.type`);
  const emitDetail = emit['detail'];
  assertObject(emitDetail, `${path}.emit.detail`);
  const emitDelay = emit['delay_ms'];
  if (emitDelay !== undefined) {
    assertNumber(emitDelay, `${path}.emit.delay_ms`);
  }
  const filter = raw['filter'];
  if (filter !== undefined) {
    assertObject(filter, `${path}.filter`);
  }
  return {
    trigger_id: triggerId,
    on,
    ...(filter ? { filter: filter as MockTrigger['filter'] } : {}),
    emit: {
      type: emitType,
      detail: emitDetail as Record<string, unknown>,
      ...(typeof emitDelay === 'number' ? { delay_ms: emitDelay } : {}),
    },
  };
}

export function parseScenario(raw: unknown, source: string): MockScenario {
  assertObject(raw, source);

  const scenarioId = raw['scenario_id'];
  assertString(scenarioId, `${source}.scenario_id`);

  const version = raw['version'];
  if (version !== '1') {
    throw new ScenarioValidationError(`unsupported scenario version: ${String(version)}`, `${source}.version`);
  }

  const description = raw['description'];
  assertString(description, `${source}.description`);

  const duration = raw['duration_ms'];
  if (duration !== null && duration !== undefined) {
    assertNumber(duration, `${source}.duration_ms`);
    if (duration <= 0) {
      throw new ScenarioValidationError('duration_ms must be > 0 when set', `${source}.duration_ms`);
    }
  }

  const loop = raw['loop'];
  assertBoolean(loop, `${source}.loop`);

  if (loop && (duration === null || duration === undefined)) {
    throw new ScenarioValidationError('loop: true requires finite duration_ms', `${source}.loop`);
  }

  const bootstrap = raw['agent_bootstrap'];
  assertObject(bootstrap, `${source}.agent_bootstrap`);
  assertString(bootstrap['active_world_id'], `${source}.agent_bootstrap.active_world_id`);
  assertString(bootstrap['active_user_id'], `${source}.agent_bootstrap.active_user_id`);
  assertString(bootstrap['locale'], `${source}.agent_bootstrap.locale`);
  assertString(bootstrap['initial_status_text'], `${source}.agent_bootstrap.initial_status_text`);
  assertIn(bootstrap['initial_execution_state'], EXECUTION_STATES, `${source}.agent_bootstrap.initial_execution_state`);

  const posture = bootstrap['initial_posture'];
  assertObject(posture, `${source}.agent_bootstrap.initial_posture`);
  assertString(posture['posture_class'], `${source}.agent_bootstrap.initial_posture.posture_class`);
  assertIn(posture['action_family'], ACTION_FAMILIES, `${source}.agent_bootstrap.initial_posture.action_family`);
  assertIn(posture['interrupt_mode'], INTERRUPT_MODES, `${source}.agent_bootstrap.initial_posture.interrupt_mode`);
  assertString(posture['transition_reason'], `${source}.agent_bootstrap.initial_posture.transition_reason`);
  assertArray(posture['truth_basis_ids'], `${source}.agent_bootstrap.initial_posture.truth_basis_ids`);
  for (const [idx, id] of (posture['truth_basis_ids'] as unknown[]).entries()) {
    assertString(id, `${source}.agent_bootstrap.initial_posture.truth_basis_ids[${idx}]`);
  }

  const rawEvents = raw['events'];
  assertArray(rawEvents, `${source}.events`);
  const events = rawEvents.map((ev, i) => parseEvent(ev, `${source}.events[${i}]`));

  const afterEventIds = new Set<string>();
  for (const ev of events) {
    if (ev.event_id) afterEventIds.add(ev.event_id);
  }
  for (const [i, ev] of events.entries()) {
    if (ev.kind === 'after' && !afterEventIds.has(ev.after_event_id)) {
      throw new ScenarioValidationError(
        `after_event_id '${ev.after_event_id}' references non-existent event`,
        `${source}.events[${i}].after_event_id`,
      );
    }
  }

  const rawTriggers = raw['triggers'];
  let triggers: MockTrigger[] | undefined;
  if (rawTriggers !== undefined) {
    assertArray(rawTriggers, `${source}.triggers`);
    triggers = rawTriggers.map((t, i) => parseTrigger(t, `${source}.triggers[${i}]`));
  }

  return {
    scenario_id: scenarioId,
    version: '1',
    description,
    duration_ms: duration ?? null,
    loop,
    agent_bootstrap: {
      active_world_id: bootstrap['active_world_id'] as string,
      active_user_id: bootstrap['active_user_id'] as string,
      locale: bootstrap['locale'] as string,
      initial_posture: {
        posture_class: posture['posture_class'] as string,
        action_family: posture['action_family'] as MockScenario['agent_bootstrap']['initial_posture']['action_family'],
        interrupt_mode: posture['interrupt_mode'] as MockScenario['agent_bootstrap']['initial_posture']['interrupt_mode'],
        transition_reason: posture['transition_reason'] as string,
        truth_basis_ids: posture['truth_basis_ids'] as readonly string[],
      },
      initial_status_text: bootstrap['initial_status_text'] as string,
      initial_execution_state: bootstrap['initial_execution_state'] as MockScenario['agent_bootstrap']['initial_execution_state'],
    },
    events,
    ...(triggers ? { triggers } : {}),
  };
}

export function loadScenarioFromJson(json: string, source = 'inline'): MockScenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ScenarioValidationError(
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      source,
    );
  }
  return parseScenario(parsed, source);
}
