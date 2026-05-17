import { describe, expect, it } from 'vitest';
import type { Live2DCompatibilityReport } from './compatibility.js';
import { createCommandBus, createLive2DBackendApi, type Live2DCommandEvent } from './plugin-api.js';
import { createLive2DProjectionAdapter } from './live2d-projection-adapter.js';

function createCompatibility(): Live2DCompatibilityReport {
  return {
    tier: 'semantic_basic',
    adapter: {
      manifest_kind: 'nimi.avatar.live2d.adapter',
      schema_version: 1,
      adapter_id: 'ren-semantic-basic',
      target_model: {
        model_id: 'ren',
        model3: 'ren.model3.json',
      },
      license: {
        redistribution: 'unknown',
        evidence: 'test',
        fixture_use: 'committable',
      },
      compatibility: {
        requested_tier: 'semantic_basic',
      },
      semantics: {
        motions: {
          idle: { group: 'Idle' },
          missing_activity: 'idle_degraded_with_diagnostic',
        },
        expressions: {
          map: { joy: 'exp_01' },
          disposition: { status: 'supported' },
        },
        poses: {
          disposition: { status: 'not_applicable' },
        },
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
    activityMotionGroups: new Map(),
    idleMotionGroup: 'Idle',
    mouthOpenParameterId: 'ParamMouthOpenY',
    missingActivity: 'idle_degraded_with_diagnostic',
  };
}

describe('Live2D semantic expression mapping', () => {
  it('maps cue-level expression ids through the adapter before writing Cubism commands', async () => {
    const commands: Live2DCommandEvent[] = [];
    const commandBus = createCommandBus();
    commandBus.on('command', (command) => commands.push(command));
    const api = createLive2DBackendApi({
      commandBus,
      compatibility: createCompatibility(),
      parameterState: new Map(),
      bounds: () => ({ x: 0, y: 0, width: 400, height: 600 }),
    });

    await api.setExpression('joy');

    expect(commands).toContainEqual({ kind: 'expression', id: 'exp_01' });
  });

  it('maps backend projection expression names through the adapter', () => {
    const commands: Live2DCommandEvent[] = [];
    const commandBus = createCommandBus();
    commandBus.on('command', (command) => commands.push(command));
    const projection = createLive2DProjectionAdapter({
      commandBus,
      compatibility: createCompatibility(),
    });

    projection.applyExpression({ name: 'joy' });

    expect(commands).toContainEqual({ kind: 'expression', id: 'exp_01' });
  });
});
