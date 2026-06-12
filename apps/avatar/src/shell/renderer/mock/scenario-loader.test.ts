import { describe, expect, it } from 'vitest';
import { loadScenarioFromJson, ScenarioValidationError } from './scenario-loader.js';

function validScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scenario_id: 'sample',
    version: '1',
    description: 'sample scenario',
    duration_ms: 1000,
    loop: false,
    agent_bootstrap: {
      active_world_id: 'world-1',
      active_user_id: 'user-1',
      locale: 'en-US',
      initial_posture: {
        posture_class: 'baseline_observer',
        action_family: 'observe',
        interrupt_mode: 'welcome',
        transition_reason: 'scenario_start',
        truth_basis_ids: [],
      },
      initial_status_text: 'idle',
      initial_execution_state: 'IDLE',
    },
    events: [
      {
        kind: 'time',
        at_ms: 0,
        type: 'avatar.fixture.presentation.activity_requested',
        detail: {
          activity_name: 'idle',
          category: 'state',
          intensity: null,
          source: 'mock',
        },
      },
    ],
    ...overrides,
  };
}

describe('loadScenarioFromJson', () => {
  it('rejects fixture files whose scenario_id does not match the filename', () => {
    expect(() =>
      loadScenarioFromJson(JSON.stringify(validScenario({ scenario_id: 'other' })), 'sample.mock.json'),
    ).toThrow(ScenarioValidationError);
  });

  it('rejects mock activity fixtures on the runtime presentation namespace', () => {
    expect(() =>
      loadScenarioFromJson(JSON.stringify(validScenario({
        events: [
          {
            kind: 'time',
            at_ms: 0,
            type: 'runtime.agent.presentation.activity_requested',
            detail: {
              activity_name: 'idle',
              category: 'state',
              intensity: null,
              source: 'mock',
            },
          },
        ],
      })), 'sample.mock.json'),
    ).toThrow(/must not emit runtime presentation/);
  });

  it('rejects malformed fixture activity detail', () => {
    expect(() =>
      loadScenarioFromJson(JSON.stringify(validScenario({
        events: [
          {
            kind: 'time',
            at_ms: 0,
            type: 'avatar.fixture.presentation.activity_requested',
            detail: {
              activity_name: '',
              category: 'renderer-local',
              intensity: 'huge',
              source: 'mock',
            },
          },
        ],
      })), 'sample.mock.json'),
    ).toThrow(/activity_name must be non-empty/);
  });
});
