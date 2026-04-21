import type { ActionFamily, ExecutionState, InterruptMode } from '../driver/types.js';

export type TimeBasedMockEvent = {
  kind: 'time';
  at_ms: number;
  event_id?: string;
  type: string;
  detail: Record<string, unknown>;
};

export type SequencedMockEvent = {
  kind: 'after';
  after_event_id: string;
  delay_ms: number;
  event_id?: string;
  type: string;
  detail: Record<string, unknown>;
};

export type MockEvent = TimeBasedMockEvent | SequencedMockEvent;

export type MockTriggerFilter =
  | string
  | number
  | boolean
  | null
  | { eq?: unknown; in?: readonly unknown[] };

export type MockTrigger = {
  trigger_id: string;
  on: string;
  filter?: Record<string, MockTriggerFilter>;
  emit: {
    type: string;
    detail: Record<string, unknown>;
    delay_ms?: number;
  };
};

export type AgentBootstrap = {
  active_world_id: string;
  active_user_id: string;
  locale: string;
  initial_posture: {
    posture_class: string;
    action_family: ActionFamily;
    interrupt_mode: InterruptMode;
    transition_reason: string;
    truth_basis_ids: readonly string[];
  };
  initial_status_text: string;
  initial_execution_state: ExecutionState;
};

export type MockScenario = {
  scenario_id: string;
  version: '1';
  description: string;
  duration_ms: number | null;
  loop: boolean;
  agent_bootstrap: AgentBootstrap;
  events: readonly MockEvent[];
  triggers?: readonly MockTrigger[];
};
