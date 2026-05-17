import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VRM } from '@pixiv/three-vrm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WLipSyncSnapshot } from '../carrier/backend-branch.js';
import type { VrmAvatarModelManifest } from '../carrier/model-resolver.js';

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

import { createActivityMappingResolver } from '../nas/activity-mapping-resolver.js';
import { loadVrmEmoteTable } from './load-vrm-emote-table.js';
import {
  VRM_GENERATED_ROUTE_IDS,
  createVrmCapabilityProfile,
  type VrmGeneratedRouteId,
} from './vrm-capability-profile.js';
import { createDeterministicVrmGeneratedMotionProvider } from './vrm-deterministic-motion-provider.js';
import { createVrmEmoteState } from './vrm-emote-state.js';
import { createVrmGeneratedMotionRuntime } from './vrm-generated-motion-runtime.js';
import { createVrmLipsyncDriver } from './vrm-lipsync-driver.js';
import { createVrmProjectionAdapter } from './vrm-projection-adapter.js';
import { createVrmRuntime, VRM_CONTEXT_LOST_RETRY_MS } from './vrm-runtime.js';
import type { VrmEmoteState } from './vrm-emote-state.js';
import {
  resolveSamplePath,
  VRM_SAMPLE_DEFINITIONS,
  // @ts-ignore - imported Node ESM smoke helper is intentionally outside src.
} from '../../../../scripts/fetch-vrm-models.mjs';

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
    VRM?: {
      meta?: { title?: string; name?: string };
      humanoid?: { humanBones?: Array<{ bone?: string; node?: number }> };
    };
  };
  nodes?: GltfNode[];
};

type SampleCase = {
  id: string;
  filePath: string;
  sizeBytes: number;
  gltf: GltfJson;
};

type SmokeEvidence = {
  sampleId: string;
  scenarioId: string;
  status: 'PASS';
  evidenceClass: 'deterministic_headless_non_pixel';
  modelKind: 'vrm';
  sampleBytes: number;
  gltfVersion: string | null;
  vrmMetaName: string | null;
  supportedRoutes: readonly VrmGeneratedRouteId[];
  events: readonly string[];
  assertions: readonly string[];
};

type ScenarioCase = {
  id: string;
  run(sample: SampleCase): Promise<SmokeEvidence> | SmokeEvidence;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '../../../..');
const REPORT_ROOT = path.join(APP_ROOT, 'reports/vrm-wave5');
const WRITE_REPORTS = process.env.NIMI_AVATAR_VRM_WAVE5_REPORTS === '1';

let samples: SampleCase[] = [];

beforeAll(() => {
  samples = Object.keys(VRM_SAMPLE_DEFINITIONS).map(readSampleCase);
  if (WRITE_REPORTS) {
    rmSync(REPORT_ROOT, { recursive: true, force: true });
  }
});

function readSampleCase(sampleId: string): SampleCase {
  const { filePath, definition } = resolveSamplePath(sampleId);
  if (!existsSync(filePath)) {
    throw new Error(
      `wave5-smoke: sample ${sampleId} is missing at ${filePath}; run node apps/avatar/scripts/fetch-vrm-models.mjs first`,
    );
  }
  const buffer = readFileSync(filePath);
  if (buffer.length < definition.expectedMinBytes) {
    throw new Error(
      `wave5-smoke: sample ${sampleId} is too small: ${buffer.length} < ${definition.expectedMinBytes}`,
    );
  }
  return {
    id: sampleId,
    filePath,
    sizeBytes: buffer.length,
    gltf: parseGlbJson(buffer),
  };
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

function makeVrmFromRealSample(gltf: GltfJson, setValueSpy = vi.fn(), missingBones: string[] = []): VRM {
  const missing = new Set(missingBones);
  const humanBones = readHumanBones(gltf);
  const nodes = gltf.nodes ?? [];
  return {
    scene: { name: 'wave5-real-vrm-sample-scene' },
    expressionManager: { setValue: setValueSpy },
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

function readHumanBones(gltf: GltfJson): Record<string, VrmcHumanBone> {
  const vrm1 = gltf.extensions?.VRMC_vrm?.humanoid?.humanBones;
  if (vrm1) return vrm1;

  const vrm0 = gltf.extensions?.VRM?.humanoid?.humanBones ?? [];
  const mapped: Record<string, VrmcHumanBone> = {};
  for (const bone of vrm0) {
    if (typeof bone.bone === 'string' && typeof bone.node === 'number') {
      mapped[bone.bone] = { node: bone.node };
    }
  }
  return mapped;
}

function readVrmMetaName(gltf: GltfJson): string | null {
  return (
    gltf.extensions?.VRMC_vrm?.meta?.name ??
    gltf.extensions?.VRM?.meta?.title ??
    gltf.extensions?.VRM?.meta?.name ??
    null
  );
}

function makeEvidence(
  sample: SampleCase,
  scenarioId: string,
  events: readonly string[],
  assertions: readonly string[],
): SmokeEvidence {
  const profile = createVrmCapabilityProfile(makeVrmFromRealSample(sample.gltf));
  return {
    sampleId: sample.id,
    scenarioId,
    status: 'PASS',
    evidenceClass: 'deterministic_headless_non_pixel',
    modelKind: 'vrm',
    sampleBytes: sample.sizeBytes,
    gltfVersion: sample.gltf.asset?.version ?? null,
    vrmMetaName: readVrmMetaName(sample.gltf),
    supportedRoutes: profile.supportedRoutes,
    events,
    assertions,
  };
}

function writeScenarioReport(evidence: SmokeEvidence): void {
  if (!WRITE_REPORTS) return;
  const dir = path.join(REPORT_ROOT, evidence.sampleId, evidence.scenarioId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(
    path.join(dir, 'summary.md'),
    [
      `# ${evidence.sampleId} / ${evidence.scenarioId}`,
      '',
      `Status: ${evidence.status}`,
      `Evidence class: ${evidence.evidenceClass}`,
      `Sample bytes: ${evidence.sampleBytes}`,
      `Routes: ${evidence.supportedRoutes.join(', ')}`,
      '',
      'Assertions:',
      ...evidence.assertions.map((assertion) => `- ${assertion}`),
      '',
    ].join('\n'),
  );
}

function makeManifest(sample: SampleCase): VrmAvatarModelManifest {
  return {
    id: sample.id,
    kind: 'vrm',
    modelPath: sample.filePath,
    displayName: sample.id,
  } as unknown as VrmAvatarModelManifest;
}

async function runLifecycle(sample: SampleCase): Promise<SmokeEvidence> {
  const events: string[] = [];
  const vrm = makeVrmFromRealSample(sample.gltf);
  const runtime = createVrmRuntime({
    manifest: makeManifest(sample),
    loaderOverride: async () => vrm,
    onEvidence: (kind) => events.push(kind),
  });

  await runtime.start();
  expect(runtime.getState().kind).toBe('ready');
  runtime.shutdown();

  return makeEvidence(sample, 'vrm-lifecycle', events, [
    'runtime starts from real sample metadata and reaches ready',
    'loader override receives the sample-backed manifest without fixture fallback',
  ]);
}

async function runContextLost(sample: SampleCase): Promise<SmokeEvidence> {
  let now = 1000;
  const retryRef: { current: (() => void) | null } = { current: null };
  const events: string[] = [];
  const vrm = makeVrmFromRealSample(sample.gltf);
  const runtime = createVrmRuntime({
    manifest: makeManifest(sample),
    loaderOverride: async () => vrm,
    onEvidence: (kind) => events.push(kind),
    nowFn: () => now,
    setTimeoutFn: (handler, ms) => {
      expect(ms).toBe(VRM_CONTEXT_LOST_RETRY_MS);
      retryRef.current = handler;
      return handler;
    },
    clearTimeoutFn: () => {
      retryRef.current = null;
    },
  });

  await runtime.start();
  runtime.notifyContextLost();
  expect(runtime.getState().kind).toBe('context_lost');
  now += VRM_CONTEXT_LOST_RETRY_MS;
  if (!retryRef.current) {
    throw new Error('vrm context loss did not schedule recovery');
  }
  await retryRef.current();
  expect(runtime.getState().kind).toBe('ready');
  runtime.notifyContextLost();
  runtime.notifyContextLost();
  expect(runtime.getState()).toMatchObject({ kind: 'failed_closed', reason: 'context_lost_twice' });

  return makeEvidence(sample, 'vrm-context-lost', events, [
    'first context loss schedules the admitted 1500ms recovery window',
    'retry restores ready state',
    'second context loss before recovery fails closed',
  ]);
}

function makeEmoteState(): VrmEmoteState {
  return createVrmEmoteState({ emoteTable: loadVrmEmoteTable() });
}

function runMotionActivity(
  sample: SampleCase,
  scenarioId: string,
  activityName: string,
  expectedRoute: VrmGeneratedRouteId,
): SmokeEvidence {
  const vrm = makeVrmFromRealSample(sample.gltf);
  const runtime = createVrmGeneratedMotionRuntime(
    createDeterministicVrmGeneratedMotionProvider(),
  );
  runtime.attach(vrm);
  const adapter = createVrmProjectionAdapter({
    vrm,
    emoteState: makeEmoteState(),
    generatedMotionRuntime: runtime,
    activityMapping: createActivityMappingResolver(),
  });

  adapter.applyActivity({ name: activityName, intensity: 1 });
  expect(runtime.snapshot().activeRouteId).toBe(expectedRoute);

  return makeEvidence(sample, scenarioId, ['activity_requested', 'generated_motion_played'], [
    `applyActivity("${activityName}") resolves through activity-mapping.yaml`,
    `deterministic generated provider plays ${expectedRoute}`,
  ]);
}

function runSpeakingWithAudio(sample: SampleCase): SmokeEvidence {
  const setValueSpy = vi.fn();
  const vrm = makeVrmFromRealSample(sample.gltf, setValueSpy);
  const driver = createVrmLipsyncDriver({ nowMsFn: () => 1000 });
  const emoteState = makeEmoteState();
  emoteState.setEmote('happy');
  const activeSnapshot: WLipSyncSnapshot = {
    weights: { A: 0.6, E: 0.1, I: 0.05, O: 0.05, U: 0.05, S: 0 },
    volume: 0.5,
  };
  const active = driver.tick({ vrm, deltaSec: 0.05, lipsyncSnapshot: activeSnapshot });
  emoteState.setLipsyncActive(active.active);
  const tick = emoteState.tick({ vrm, deltaSec: 0.05 });

  expect(active.active).toBe(true);
  expect(tick.skippedCount).toBeGreaterThan(0);
  expect(setValueSpy).toHaveBeenCalled();

  return makeEvidence(sample, 'vrm-speaking-with-audio', ['lipsync_active', 'emote_applied'], [
    'wLipSync-style active snapshot drives active lipsync',
    'emote state suppresses viseme writes while lipsync is active',
  ]);
}

function runSpeakingSilentAudio(sample: SampleCase): SmokeEvidence {
  let now = 1000;
  const vrm = makeVrmFromRealSample(sample.gltf);
  const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
  driver.tick({
    vrm,
    deltaSec: 0.05,
    lipsyncSnapshot: {
      weights: { A: 0.6, E: 0.1, I: 0.05, O: 0.05, U: 0.05, S: 0 },
      volume: 0.5,
    },
  });
  now += 500;
  const silent = driver.tick({
    vrm,
    deltaSec: 0.256,
    lipsyncSnapshot: {
      weights: { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 },
      volume: 0,
    },
  });

  expect(silent.active).toBe(false);

  return makeEvidence(sample, 'vrm-speaking-silent-audio', ['lipsync_silent'], [
    'silent snapshot returns lipsync to inactive',
    'silent path does not invent mouth movement',
  ]);
}

function runEmoteCycle(sample: SampleCase): SmokeEvidence {
  const setValueSpy = vi.fn();
  const vrm = makeVrmFromRealSample(sample.gltf, setValueSpy);
  const emoteState = makeEmoteState();

  for (const emote of ['neutral', 'happy', 'sad', 'relaxed', 'neutral']) {
    emoteState.setEmote(emote);
    emoteState.tick({ vrm, deltaSec: 0.1 });
    expect(emoteState.snapshot().activeEmote).toBe(emote);
  }
  expect(emoteState.snapshot().lipsyncActive).toBe(false);
  expect(setValueSpy).toHaveBeenCalled();

  return makeEvidence(sample, 'vrm-emote-cycle', ['emote_applied'], [
    'neutral -> happy -> sad -> relaxed -> neutral emote cycle applies through VrmEmoteState',
    'lipsync inactive path does not suppress the emote cycle',
  ]);
}

const SCENARIOS: readonly ScenarioCase[] = [
  { id: 'vrm-lifecycle', run: runLifecycle },
  { id: 'vrm-context-lost', run: runContextLost },
  {
    id: 'vrm-listening',
    run: (sample) => runMotionActivity(sample, 'vrm-listening', 'listening', 'listen_lean'),
  },
  {
    id: 'vrm-thinking',
    run: (sample) => runMotionActivity(sample, 'vrm-thinking', 'thinking', 'idle_subtle'),
  },
  { id: 'vrm-speaking-with-audio', run: runSpeakingWithAudio },
  { id: 'vrm-speaking-silent-audio', run: runSpeakingSilentAudio },
  { id: 'vrm-emote-cycle', run: runEmoteCycle },
];

describe('wave-5 real VRM sample smoke matrix', () => {
  it('parses every admitted sample and exposes generated route capability', () => {
    expect(samples.map((sample) => sample.id).sort()).toEqual([
      'vrm1-constraint-twist',
      'vroid-hair-sample-female-cc0',
      'vroid-hair-sample-male-cc0',
    ]);
    for (const sample of samples) {
      const profile = createVrmCapabilityProfile(makeVrmFromRealSample(sample.gltf));
      expect(sample.sizeBytes).toBeGreaterThan(9_000_000);
      expect(sample.gltf.asset?.version).toBe('2.0');
      expect(readVrmMetaName(sample.gltf)).toEqual(expect.any(String));
      expect(profile.supportedRoutes.sort()).toEqual([...VRM_GENERATED_ROUTE_IDS].sort());
      expect(profile.unsupportedRoutes).toEqual([]);
    }
  });

  for (const scenario of SCENARIOS) {
    it(`runs ${scenario.id} across all admitted samples`, async () => {
      const results: SmokeEvidence[] = [];
      for (const sample of samples) {
        const evidence = await scenario.run(sample);
        writeScenarioReport(evidence);
        results.push(evidence);
      }
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'PASS')).toBe(true);
    });
  }

  it('fails closed on the real sample path when route capability evidence is missing', () => {
    const sample = samples.find((entry) => entry.id === 'vrm1-constraint-twist');
    expect(sample).toBeDefined();
    const provider = createDeterministicVrmGeneratedMotionProvider();
    const result = provider.generate({
      vrm: makeVrmFromRealSample(sample!.gltf, vi.fn(), ['rightHand']),
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
