import type { AgentDataBundle, AgentEvent } from '../driver/types.js';
import { ulid } from '../infra/ids.js';

type RuntimeAgentExecutionStateValue =
  | 'idle'
  | 'chat_active'
  | 'life_pending'
  | 'life_running'
  | 'suspended';

export function mapExecutionState(value?: RuntimeAgentExecutionStateValue): AgentDataBundle['execution_state'] {
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

export function toRuntimeAgentEvent(
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

export function mergeCustomRecord(
  current: AgentDataBundle['custom'],
  next: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current || {}),
    ...next,
  };
}

export function clearTurnCueRecord(
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
