import { describe, expect, it } from 'vitest';
import type { Live2DBackendResources } from './backend-session.js';
import type { Model3Settings, ModelManifest } from './model-loader.js';
import {
  parseLive2DAdapterManifest,
  validateLive2DCompatibility,
  assertLive2DCompatibilitySupported,
  type Live2DAdapterManifestV1,
} from './compatibility.js';

const model: ModelManifest = {
  runtimeDir: '/models/ren/runtime',
  modelId: 'ren',
  model3JsonPath: '/models/ren/runtime/ren.model3.json',
  nimiDir: '/models/ren/runtime/nimi',
  adapterManifestPath: '/models/ren/runtime/nimi/live2d-adapter.json',
};

const settings: Model3Settings = {
  Version: 3,
  FileReferences: {
    Moc: 'ren.moc3',
    Textures: ['ren.4096/texture_00.png'],
    Motions: {},
    Expressions: [
      { Name: 'smile', File: 'expressions/smile.exp3.json' },
    ],
    Physics: 'ren.physics3.json',
    Pose: 'ren.pose3.json',
  },
  HitAreas: [
    { Id: 'HitAreaHead', Name: 'head' },
    { Id: 'HitAreaBody', Name: 'body' },
  ],
  Groups: [
    { Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] },
  ],
};

const resources: Live2DBackendResources = {
  mocPath: '/models/ren/runtime/ren.moc3',
  texturePaths: ['/models/ren/runtime/ren.4096/texture_00.png'],
  motionGroups: new Map([
    ['Idle', ['/models/ren/runtime/motions/idle.motion3.json']],
    ['RenNeutral', ['/models/ren/runtime/motions/neutral.motion3.json']],
    ['RenGreet', ['/models/ren/runtime/motions/greet.motion3.json']],
    ['RenListening', ['/models/ren/runtime/motions/listening.motion3.json']],
    ['RenThinking', ['/models/ren/runtime/motions/thinking.motion3.json']],
  ]),
  expressions: new Map([
    ['smile', '/models/ren/runtime/expressions/smile.exp3.json'],
  ]),
  physicsPath: '/models/ren/runtime/ren.physics3.json',
  posePath: '/models/ren/runtime/ren.pose3.json',
  displayInfoPath: null,
};

function createBasicManifest(overrides: Partial<Live2DAdapterManifestV1> = {}): Live2DAdapterManifestV1 {
  const base: Live2DAdapterManifestV1 = {
    manifest_kind: 'nimi.avatar.live2d.adapter',
    schema_version: 1,
    adapter_id: 'ren-basic',
    target_model: {
      model_id: 'ren',
      model3: 'ren.model3.json',
    },
    license: {
      redistribution: 'allowed',
      evidence: 'Synthetic test manifest; no third-party asset bytes are included.',
      fixture_use: 'committable',
    },
    compatibility: {
      requested_tier: 'semantic_basic',
    },
    semantics: {
      motions: {
        idle: { group: 'Idle' },
        activities: {
          neutral: { group: 'RenNeutral' },
          greet: { group: 'RenGreet' },
          listening: { group: 'RenListening' },
          thinking: { group: 'RenThinking' },
        },
        missing_activity: 'diagnostic_no_success',
      },
      expressions: {
        map: { happy: 'smile' },
        disposition: { status: 'supported' },
      },
      poses: {
        map: { focused: 'standing' },
        disposition: { status: 'supported' },
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
        map: {
          head: ['head'],
          body: ['body'],
        },
        fallback: 'alpha_mask_only',
        disposition: { status: 'supported' },
      },
      nas_fallback: {
        default_idle_motion: 'Idle',
        missing_handler: 'backend_default_with_diagnostic',
      },
    },
  };
  return { ...base, ...overrides };
}

describe('Live2D compatibility validation', () => {
  it('defaults official Cubism packages without an adapter to render_only', () => {
    const report = validateLive2DCompatibility({ model, settings, resources });

    expect(report.tier).toBe('render_only');
    expect(report.adapter).toBeNull();
    expect(report.diagnostics).toEqual([]);
    expect(report.mouthOpenParameterId).toBe('ParamMouthOpenY');
  });

  it('admits a semantic_basic adapter with explicit mappings and legal fixture posture', () => {
    const report = validateLive2DCompatibility({
      model,
      settings,
      resources,
      adapter: createBasicManifest(),
    });

    expect(report.tier).toBe('semantic_basic');
    expect(report.diagnostics).toEqual([]);
    expect(report.activityMotionGroups.get('greet')?.group).toBe('RenGreet');
    expect(report.missingActivity).toBe('diagnostic_no_success');
  });

  it('fails closed when a manifest claims missing mapped features', () => {
    const report = validateLive2DCompatibility({
      model,
      settings,
      resources,
      adapter: createBasicManifest({
        semantics: {
          ...createBasicManifest().semantics,
          motions: {
            ...createBasicManifest().semantics.motions,
            activities: {
              ...createBasicManifest().semantics.motions.activities,
              greet: { group: 'MissingGreet' },
            },
          },
          lipsync: {
            mouth_open_y_parameter: 'ParamMissingMouth',
            disposition: { status: 'supported' },
          },
        },
      }),
    });

    expect(report.tier).toBe('unsupported');
    expect(report.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'AVATAR_LIVE2D_COMPAT_MOTION_MISSING',
      'AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING',
    ]));
    expect(() => assertLive2DCompatibilitySupported(report)).toThrow('AVATAR_LIVE2D_COMPAT_MOTION_MISSING');
  });

  it('rejects malformed adapter manifests before loader success', () => {
    expect(() => parseLive2DAdapterManifest('{"manifest_kind":"wrong"}'))
      .toThrow('AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID');
  });
});
