import { describe, expect, it } from 'vitest';

import { activityIdToMotionGroup } from '../src/avatar-activity-naming.js';
import {
  createLive2DProjectionAdapter,
  type Live2DProjectionCommandEvent,
} from '../src/live2d-projection-adapter.js';
import type { Live2DCompatibilityReport } from '../src/live2d-compatibility.js';

function createCompatibility(): Live2DCompatibilityReport {
  return {
    tier: 'semantic_basic',
    adapter: {
      manifest_kind: 'nimi.avatar.live2d.adapter',
      schema_version: 1,
      adapter_id: 'adapter-1',
      target_model: { model_id: 'ren', model3: 'ren.model3.json' },
      license: {
        redistribution: 'allowed',
        evidence: 'test',
        fixture_use: 'committable',
      },
      compatibility: { requested_tier: 'semantic_basic' },
      semantics: {
        motions: {
          idle: { group: 'Idle' },
          missing_activity: 'idle_degraded_with_diagnostic',
        },
        expressions: {
          map: { joy: 'exp_joy' },
          disposition: { status: 'supported' },
        },
        poses: { disposition: { status: 'not_applicable' } },
        lipsync: {
          mouth_open_y_parameter: 'ParamMouthOpenY',
          disposition: { status: 'supported' },
        },
        physics: {
          mode: 'model_physics',
          disposition: { status: 'supported' },
        },
        hit_regions: {
          fallback: 'alpha_mask_only',
          disposition: { status: 'supported' },
        },
        nas_fallback: {
          default_idle_motion: 'Idle',
          missing_handler: 'backend_default_with_diagnostic',
        },
      },
    },
    diagnostics: [],
    activityMotionGroups: new Map([
      ['greet', { group: 'Greeting', weak_group: 'GreetingWeak', strong_group: 'GreetingStrong' }],
    ]),
    idleMotionGroup: 'Idle',
    mouthOpenParameterId: 'ParamMouthOpenY',
    paramMouthFormSupported: false,
    missingActivity: 'idle_degraded_with_diagnostic',
  };
}

function captureBus(): {
  commands: Live2DProjectionCommandEvent[];
  bus: { emit(eventName: 'command', event: Live2DProjectionCommandEvent): void };
} {
  const commands: Live2DProjectionCommandEvent[] = [];
  return {
    commands,
    bus: {
      emit(eventName, event) {
        if (eventName === 'command') commands.push(event);
      },
    },
  };
}

describe('avatar activity naming', () => {
  it('maps canonical and extension activity ids to Live2D motion groups', () => {
    expect(activityIdToMotionGroup('thinking')).toBe('Activity_Thinking');
    expect(activityIdToMotionGroup('ext:playing')).toBe('Activity_ExtPlaying');
    expect(activityIdToMotionGroup('look-left')).toBe('Activity_LookLeft');
  });
});

describe('Live2D projection adapter', () => {
  it('uses adapter activity motion groups with intensity variants', () => {
    const { bus, commands } = captureBus();
    const adapter = createLive2DProjectionAdapter({
      commandBus: bus,
      compatibility: createCompatibility(),
    });

    adapter.applyActivity({ name: 'greet', intensity: 0.8 });

    expect(commands).toEqual([
      { kind: 'motion', group: 'GreetingStrong', options: { priority: 'normal' } },
    ]);
  });

  it('falls back to canonical activity motion group naming', () => {
    const { bus, commands } = captureBus();
    const adapter = createLive2DProjectionAdapter({
      commandBus: bus,
      compatibility: null,
    });

    adapter.applyActivity({ name: 'focused-mode', intensity: null });

    expect(commands).toEqual([
      { kind: 'motion', group: 'Activity_FocusedMode', options: { priority: 'normal' } },
    ]);
  });

  it('maps expressions through adapter semantics and reset returns to idle', () => {
    const { bus, commands } = captureBus();
    const adapter = createLive2DProjectionAdapter({
      commandBus: bus,
      compatibility: createCompatibility(),
    });

    adapter.applyExpression({ name: 'joy' });
    adapter.reset();

    expect(commands).toEqual([
      { kind: 'expression', id: 'exp_joy' },
      { kind: 'expression-clear' },
      { kind: 'pose-clear' },
      { kind: 'motion-stop' },
      { kind: 'motion', group: 'Idle', options: { priority: 'low' } },
    ]);
  });
});
