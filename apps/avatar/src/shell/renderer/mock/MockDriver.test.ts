import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { MockDriver, matchesFilter } from './MockDriver.js';
import type { MockScenario } from './scenario-types.js';

function makeScenario(overrides?: Partial<MockScenario>): MockScenario {
  return {
    scenario_id: 'test',
    version: '1',
    description: 'test',
    duration_ms: 10000,
    loop: false,
    agent_bootstrap: {
      active_world_id: 'w',
      active_user_id: 'u',
      locale: 'en',
      initial_posture: {
        posture_class: 'baseline',
        action_family: 'observe',
        interrupt_mode: 'welcome',
        transition_reason: 'test',
        truth_basis_ids: [],
      },
      initial_status_text: '',
      initial_execution_state: 'IDLE',
    },
    events: [],
    ...overrides,
  };
}

describe('MockDriver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits time-based events at the scheduled offset', async () => {
    const scenario = makeScenario({
      events: [
        { kind: 'time', at_ms: 1000, type: 'apml.state.activity', detail: { activity_name: 'happy', category: 'emotion', intensity: 'moderate', source: 'mock' } },
        { kind: 'time', at_ms: 2500, type: 'apml.state.activity', detail: { activity_name: 'sad', category: 'emotion', intensity: 'moderate', source: 'mock' } },
      ],
    });
    const driver = new MockDriver({ scenario });
    const names: string[] = [];
    driver.onEvent((ev) => names.push(ev.name + ':' + (ev.detail['activity_name'] ?? '')));
    await driver.start();
    vi.advanceTimersByTime(999);
    expect(names).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(names).toEqual(['apml.state.activity:happy']);
    vi.advanceTimersByTime(1500);
    expect(names).toEqual(['apml.state.activity:happy', 'apml.state.activity:sad']);
  });

  it('updates bundle activity when an apml.state.activity event fires', async () => {
    const scenario = makeScenario({
      events: [
        { kind: 'time', at_ms: 0, type: 'apml.state.activity', detail: { activity_name: 'neutral', category: 'emotion', intensity: null, source: 'mock' } },
      ],
    });
    const driver = new MockDriver({ scenario });
    await driver.start();
    vi.advanceTimersByTime(0);
    expect(driver.getBundle().activity?.name).toBe('neutral');
  });

  it('fires reactive trigger when matching upstream app event is emitted', async () => {
    const scenario = makeScenario({
      triggers: [
        {
          trigger_id: 't1',
          on: 'avatar.user.click',
          filter: { region: 'head' },
          emit: {
            type: 'apml.state.activity',
            detail: { activity_name: 'shy', category: 'emotion', intensity: 'strong', source: 'mock' },
          },
        },
      ],
    });
    const driver = new MockDriver({ scenario });
    const emissions: string[] = [];
    driver.onEvent((ev) => {
      if (ev.name === 'apml.state.activity') {
        emissions.push(String(ev.detail['activity_name']));
      }
    });
    await driver.start();
    driver.emit({ name: 'avatar.user.click', detail: { region: 'head', x: 10, y: 10, button: 'left' } });
    vi.advanceTimersByTime(0);
    expect(emissions).toContain('shy');
  });

  it('does not fire trigger if filter does not match', async () => {
    const scenario = makeScenario({
      triggers: [
        {
          trigger_id: 't1',
          on: 'avatar.user.click',
          filter: { region: 'head' },
          emit: { type: 'apml.state.activity', detail: { activity_name: 'shy', category: 'emotion', intensity: 'strong', source: 'mock' } },
        },
      ],
    });
    const driver = new MockDriver({ scenario });
    const emissions: string[] = [];
    driver.onEvent((ev) => {
      if (ev.name === 'apml.state.activity') emissions.push(String(ev.detail['activity_name']));
    });
    await driver.start();
    driver.emit({ name: 'avatar.user.click', detail: { region: 'body' } });
    vi.advanceTimersByTime(0);
    expect(emissions).not.toContain('shy');
  });

  it('loops when loop=true and duration_ms finite', async () => {
    const scenario = makeScenario({
      duration_ms: 2000,
      loop: true,
      events: [
        { kind: 'time', at_ms: 500, type: 'apml.state.activity', detail: { activity_name: 'a', category: 'state', intensity: null, source: 'mock' } },
      ],
    });
    const driver = new MockDriver({ scenario });
    const count = { n: 0 };
    driver.onEvent((ev) => {
      if (ev.name === 'apml.state.activity') count.n += 1;
    });
    await driver.start();
    vi.advanceTimersByTime(500);
    expect(count.n).toBe(1);
    vi.advanceTimersByTime(1500);
    vi.advanceTimersByTime(500);
    expect(count.n).toBe(2);
  });

  it('stops emitting after stop() is called', async () => {
    const scenario = makeScenario({
      events: [
        { kind: 'time', at_ms: 1000, type: 'apml.state.activity', detail: { activity_name: 'x', category: 'state', intensity: null, source: 'mock' } },
      ],
    });
    const driver = new MockDriver({ scenario });
    const count = { n: 0 };
    driver.onEvent(() => { count.n += 1; });
    await driver.start();
    await driver.stop();
    vi.advanceTimersByTime(5000);
    expect(count.n).toBe(0);
  });
});

describe('matchesFilter', () => {
  it('matches exact value', () => {
    expect(matchesFilter({ region: 'head' }, { region: 'head' })).toBe(true);
    expect(matchesFilter({ region: 'body' }, { region: 'head' })).toBe(false);
  });

  it('matches via eq object', () => {
    expect(matchesFilter({ x: 1 }, { x: { eq: 1 } })).toBe(true);
  });

  it('matches via in array', () => {
    expect(matchesFilter({ region: 'head' }, { region: { in: ['head', 'face'] } })).toBe(true);
    expect(matchesFilter({ region: 'body' }, { region: { in: ['head', 'face'] } })).toBe(false);
  });

  it('returns true when no filter', () => {
    expect(matchesFilter({ region: 'head' }, undefined)).toBe(true);
  });
});
