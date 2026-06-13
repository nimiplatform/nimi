import { describe, expect, it } from 'vitest';
import type { Live2DCompatibilityReport } from '@nimiplatform/kit/features/avatar/headless';
import { createCommandBus, type Live2DCommandEvent } from './plugin-api.js';
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
    paramMouthFormSupported: false,
    missingActivity: 'idle_degraded_with_diagnostic',
  };
}

describe('Live2D semantic expression mapping', () => {
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
