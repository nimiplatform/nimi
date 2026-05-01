import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VRM } from '@pixiv/three-vrm';
import { describe, expect, it, vi } from 'vitest';

const threeMocks = vi.hoisted(() => ({
  createAction: () => ({
    play: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    reset: vi.fn().mockReturnThis(),
    crossFadeTo: vi.fn().mockReturnThis(),
    timeScale: 1 as number,
    loop: 0 as number,
  }),
}));

vi.mock('three', () => ({
  LoopRepeat: 2201,
  LoopOnce: 2200,
  NumberKeyframeTrack: class FakeNumberKeyframeTrack {
    constructor(
      public name: string,
      public times: number[],
      public values: number[],
    ) {}
  },
  AnimationClip: class FakeAnimationClip {
    constructor(
      public name: string,
      public duration: number,
      public tracks: unknown[],
    ) {}
  },
  AnimationMixer: class FakeAnimationMixer {
    public actions = new Map<unknown, ReturnType<typeof threeMocks.createAction>>();
    public update = vi.fn();
    public stopAllAction = vi.fn();
    public uncacheRoot = vi.fn();
    constructor(public root: unknown) {}
    clipAction(clip: unknown): ReturnType<typeof threeMocks.createAction> {
      const cached = this.actions.get(clip);
      if (cached) return cached;
      const action = threeMocks.createAction();
      this.actions.set(clip, action);
      return action;
    }
  },
}));

import {
  VRM_GENERATED_ROUTE_IDS,
  createVrmCapabilityProfile,
} from './vrm-capability-profile.js';
import { createDeterministicVrmGeneratedMotionProvider } from './vrm-deterministic-motion-provider.js';
import { createVrmGeneratedMotionRuntime } from './vrm-generated-motion-runtime.js';
import { createVrmProjectionAdapter } from './vrm-projection-adapter.js';
import type { VrmEmoteState } from './vrm-emote-state.js';

type GltfNode = {
  name?: string;
};

type VrmcHumanBone = {
  node?: number;
};

type GltfJson = {
  asset?: { version?: string };
  extensions?: {
    VRMC_vrm?: {
      meta?: { name?: string };
      humanoid?: { humanBones?: Record<string, VrmcHumanBone> };
    };
  };
  nodes?: GltfNode[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE_PATH = path.resolve(
  __dirname,
  '../../../..',
  '.cache/assets/vrm-models/VRM1_Constraint_Twist_Sample.vrm',
);

function readSample(): { buffer: Buffer; gltf: GltfJson } {
  const buffer = readFileSync(SAMPLE_PATH);
  return { buffer, gltf: parseGlbJson(buffer) };
}

function parseGlbJson(buffer: Buffer): GltfJson {
  if (buffer.subarray(0, 4).toString('utf8') !== 'glTF') {
    throw new Error('wave5-smoke: sample is not binary glTF');
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`wave5-smoke: unsupported glTF version ${version}`);
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(buffer.subarray(chunkStart, chunkEnd).toString('utf8')) as GltfJson;
    }
    offset = chunkEnd;
  }
  throw new Error('wave5-smoke: binary glTF JSON chunk not found');
}

function makeVrmFromRealSample(gltf: GltfJson, missingBones: string[] = []): VRM {
  const missing = new Set(missingBones);
  const humanBones = gltf.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {};
  const nodes = gltf.nodes ?? [];
  return {
    scene: { name: 'wave5-real-vrm-sample-scene' },
    expressionManager: { setValue: vi.fn() },
    humanoid: {
      getNormalizedBoneNode(name: string) {
        if (missing.has(name)) return null;
        const bone = humanBones[name];
        if (!bone || typeof bone.node !== 'number') return null;
        const node = nodes[bone.node];
        return { name: node?.name ?? name };
      },
    },
  } as unknown as VRM;
}

function fakeEmoteState(): VrmEmoteState {
  return {
    setEmote: vi.fn(),
    applyTransientExpression: vi.fn(),
    setLipsyncActive: vi.fn(),
    tick: vi.fn(),
    reset: vi.fn(),
    snapshot: vi.fn(() => ({
      activeEmote: 'neutral',
      transientExpression: null,
      lipsyncActive: false,
    })),
  } as unknown as VrmEmoteState;
}

describe('wave-5 real VRM generated motion smoke', () => {
  it('parses representative VRM metadata and humanoid bones from the real sample', () => {
    const { buffer, gltf } = readSample();
    const profile = createVrmCapabilityProfile(makeVrmFromRealSample(gltf));

    expect(buffer.length).toBeGreaterThan(9_000_000);
    expect(gltf.asset?.version).toBe('2.0');
    expect(gltf.extensions?.VRMC_vrm?.meta?.name).toEqual(expect.any(String));
    expect(profile.supportedRoutes.sort()).toEqual([...VRM_GENERATED_ROUTE_IDS].sort());
    expect(profile.unsupportedRoutes).toEqual([]);
  });

  it('routes typed activity projection through Avatar route to generated clip execution', () => {
    const { gltf } = readSample();
    const vrm = makeVrmFromRealSample(gltf);
    const runtime = createVrmGeneratedMotionRuntime(
      createDeterministicVrmGeneratedMotionProvider(),
    );
    runtime.attach(vrm);

    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState: fakeEmoteState(),
      generatedMotionRuntime: runtime,
      activityMapping: {
        resolveVrmRoute(activityName) {
          if (activityName === 'greet') return { motion: 'greet_wave', fade: 0.2 };
          return null;
        },
      },
    });

    adapter.applyActivity({ name: 'greet', intensity: 1 });

    expect(runtime.snapshot().activeRouteId).toBe('greet_wave');
  });

  it('fails closed on the real sample path when route capability evidence is missing', () => {
    const { gltf } = readSample();
    const provider = createDeterministicVrmGeneratedMotionProvider();
    const result = provider.generate({
      vrm: makeVrmFromRealSample(gltf, ['rightHand']),
      routeId: 'greet_wave',
      intensity: 1,
      loop: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_bones:rightHand');
    }
  });
});
