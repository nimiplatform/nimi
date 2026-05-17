// Wave 3 chunk 3-E of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Programmatically drives the 5 chunk 3-E mock scenarios through the VRM
// BackendBranch chain end-to-end (generated motion runtime + emote state +
// lipsync driver + audio pipeline + projection adapter). Each scenario's
// `.mock.json` fixture is the canonical input; the assertions here mirror
// each fixture's `expected` block.
//
// APML auto-adapter compliance: generated motion is the product path.
// Missing provider support fails closed and does not fall back to .vrma.
//
// Tick chain (per scenario where applicable):
//   1. lipsyncDriver.tick({vrm, deltaSec, lipsyncSnapshot})
//   2. emoteState.setLipsyncActive(active)
//   3. emoteState.tick({vrm, deltaSec})
//   4. generatedMotionRuntime.tick(deltaSec)
//
// useFrame is mocked no-op (vrm-lifecycle-e2e.test.tsx pattern); we drive
// the per-frame chain manually so the test stays deterministic in jsdom.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VRM } from '@pixiv/three-vrm';
import type { Profile } from 'wlipsync';

import listeningScenario from '../mock/scenarios/vrm-listening.mock.json';
import contextLostScenario from '../mock/scenarios/vrm-context-lost.mock.json';
import thinkingScenario from '../mock/scenarios/vrm-thinking.mock.json';
import speakingWithAudioScenario from '../mock/scenarios/vrm-speaking-with-audio.mock.json';
import speakingSilentAudioScenario from '../mock/scenarios/vrm-speaking-silent-audio.mock.json';
import emoteCycleScenario from '../mock/scenarios/vrm-emote-cycle.mock.json';

import {
  AudioPipelineController,
  SYNTHETIC_AUDIO_MIME_TYPE,
  type AudioPlaybackSnapshot,
} from '../audio/audio-pipeline.js';
import type {
  BackendAudioConsumer,
  WLipSyncSnapshot,
} from '../carrier/backend-branch.js';
import { createVrmAudioConsumer } from './vrm-audio-consumer.js';
import { createVrmEmoteState } from './vrm-emote-state.js';
import { createVrmLipsyncDriver } from './vrm-lipsync-driver.js';
import {
  createMissingVrmGeneratedMotionProvider,
  createVrmGeneratedMotionRuntime,
} from './vrm-generated-motion-runtime.js';
import { createVrmMotionPresetRegistry } from './vrm-motion-preset-registry.js';
import { createVrmProjectionAdapter } from './vrm-projection-adapter.js';
import type {
  VrmMotionPresetEntry,
  VrmMotionPresetTable,
} from './load-vrm-motion-preset-table.js';
import type { VrmEmoteTable } from './vrm-emote-state.js';
import type { ActivityMapping } from './vrm-projection-adapter.js';

// Mock `three` AnimationMixer / loop constants — same shape as
// vrm-motion-preset-registry.test.ts so motionRegistry.loadAll +
// play() remain deterministic without bundling the real three.js
// AnimationMixer.
const mocks = vi.hoisted(() => ({
  clipFromVRMAnimation: vi.fn((animation: unknown, _vrm: unknown) => ({
    __clipFor: animation,
  })),
  createAction: () => ({
    play: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    reset: vi.fn().mockReturnThis(),
    crossFadeTo: vi.fn().mockReturnThis(),
    timeScale: 1 as number,
    loop: 0 as number,
  }),
  loadAnimation: vi.fn(),
}));

vi.mock('three', () => ({
  LoopRepeat: 2201,
  LoopOnce: 2200,
  AnimationMixer: class FakeAnimationMixer {
    public _actions = new Map<unknown, ReturnType<typeof mocks.createAction>>();
    public _root: unknown;
    public update = vi.fn();
    public stopAllAction = vi.fn();
    public uncacheRoot = vi.fn();
    constructor(root: unknown) {
      this._root = root;
    }
    clipAction(clip: unknown): ReturnType<typeof mocks.createAction> {
      const cached = this._actions.get(clip);
      if (cached) return cached;
      const action = mocks.createAction();
      this._actions.set(clip, action);
      return action;
    }
  },
}));

vi.mock('./vrm-animation-loader.js', () => ({
  clipFromVRMAnimation: mocks.clipFromVRMAnimation,
  loadVrmAnimation: mocks.loadAnimation,
}));

beforeEach(() => {
  mocks.clipFromVRMAnimation.mockClear();
  mocks.loadAnimation.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────
// Shared test fixtures.
// ────────────────────────────────────────────────────────────────────

/** Wave 0 admitted preset table (mirrors vrm-motion-presets.yaml). */
function makeMotionTable(): VrmMotionPresetTable {
  return {
    builtinDir: 'apps/avatar/assets/vrm-motion-presets',
    presets: [
      { id: 'idle_subtle', file: 'idle_subtle.vrma', loop: true, license: 'MIT', source: 'internal' },
      { id: 'listen_lean', file: 'listen_lean.vrma', loop: true, license: 'internal', source: 'internal' },
      { id: 'nod_yes', file: 'nod_yes.vrma', loop: false, license: 'internal', source: 'internal' },
      { id: 'shake_no', file: 'shake_no.vrma', loop: false, license: 'internal', source: 'internal' },
    ],
  };
}

/** Subset of vrm-emote-states.yaml for the emote-cycle scenario. Cap
 *  invariant: each non-`neutral` primary expression weight ≤ 0.8. */
function makeEmoteTable(): VrmEmoteTable {
  return {
    emotes: {
      neutral: {
        blendDurationSec: 0.6,
        expressions: [{ name: 'neutral', weight: 1.0 }],
      },
      happy: {
        blendDurationSec: 0.4,
        expressions: [
          { name: 'happy', weight: 0.7 },
          { name: 'aa', weight: 0.2 },
        ],
      },
      sad: {
        blendDurationSec: 0.5,
        expressions: [
          { name: 'sad', weight: 0.7 },
          { name: 'oh', weight: 0.15 },
        ],
      },
      relaxed: {
        blendDurationSec: 0.5,
        expressions: [{ name: 'relaxed', weight: 0.6 }],
      },
    },
  };
}

/** D plan: only `idle_subtle.vrma` is admitted. The fetcher resolves
 *  idle_subtle and rejects everything else with `null` (animation_load_failed). */
function partialAssetFetcher(): (url: string) => Promise<unknown | null> {
  return async (url: string) => {
    if (url.includes('idle_subtle')) {
      return { __mockAnimation: 'idle_subtle' };
    }
    return null;
  };
}

/** Fake VRM stub — the registry only reads `vrm.scene` (mixer root) and
 *  the emote state reads `vrm.expressionManager.setValue`. */
function makeFakeVrm(setValueSpy?: ReturnType<typeof vi.fn>): VRM {
  return {
    scene: { traverse: () => {}, name: 'fake-vrm-scene' },
    expressionManager: {
      setValue: setValueSpy ?? vi.fn(),
    },
  } as unknown as VRM;
}

/** Activity-mapping that mirrors activity-mapping.yaml v2 routes for the
 *  scenarios under test. */
function makeActivityMapping(): ActivityMapping {
  return {
    resolveVrmRoute(name: string) {
      switch (name) {
        case 'listening':
          return { motion: 'listen_lean', fade: 0.3 };
        case 'thinking':
          return { motion: 'idle_subtle', fade: 0.4 };
        case 'idle':
          return { motion: 'idle_subtle', fade: 0.5 };
        default:
          return null;
      }
    },
  };
}

const TEST_PROFILE: Profile = { mfcc: [], visemes: [] } as unknown as Profile;

/** Fake AudioWorkletNode-like with mutable weights/volume. */
function fakeWLipSyncNode(): AudioWorkletNode & {
  weights: Record<string, number>;
  volume: number;
} {
  return {
    weights: { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 },
    volume: 0,
  } as unknown as AudioWorkletNode & {
    weights: Record<string, number>;
    volume: number;
  };
}

function fakeAudioSource(): AudioBufferSourceNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioBufferSourceNode;
}

function fakeAudioContext(decode?: () => Promise<AudioBuffer>): {
  context: AudioContext;
  source: { onended: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; buffer: AudioBuffer | null };
  decodeAudioData: ReturnType<typeof vi.fn>;
} {
  const source = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
  };
  const decodeAudioData = vi.fn(decode ?? (async () => ({ duration: 0.5 } as AudioBuffer)));
  const context = {
    destination: {} as AudioDestinationNode,
    decodeAudioData,
    createBufferSource: () => source as unknown as AudioBufferSourceNode,
  } as unknown as AudioContext;
  return { context, source, decodeAudioData };
}

// ────────────────────────────────────────────────────────────────────
// Scenario JSON schema sanity (catalog wiring).
// ────────────────────────────────────────────────────────────────────

describe('chunk 3-E scenario JSON files (fixture sanity)', () => {
  const scenarios = [
    { id: 'vrm-listening', json: listeningScenario },
    { id: 'vrm-context-lost', json: contextLostScenario },
    { id: 'vrm-thinking', json: thinkingScenario },
    { id: 'vrm-speaking-with-audio', json: speakingWithAudioScenario },
    { id: 'vrm-speaking-silent-audio', json: speakingSilentAudioScenario },
    { id: 'vrm-emote-cycle', json: emoteCycleScenario },
  ] as const;

  for (const { id, json } of scenarios) {
    it(`scenario ${id}: scenario_id + version + agent_bootstrap shape`, () => {
      const data = json as Record<string, unknown>;
      expect(data.scenario_id).toBe(id);
      expect(data.version).toBe('1');
      expect(typeof data.duration_ms === 'number' || data.duration_ms === null).toBe(true);
      expect(typeof data.loop).toBe('boolean');
      expect(Array.isArray(data.events)).toBe(true);
      const bootstrap = data.agent_bootstrap as Record<string, unknown>;
      expect(typeof bootstrap.active_world_id).toBe('string');
      expect(typeof bootstrap.active_user_id).toBe('string');
      const vrmBlock = data.vrm_mock_scenario as Record<string, unknown>;
      expect(vrmBlock).toBeDefined();
      expect(vrmBlock.category).toEqual(expect.any(String));
      expect((vrmBlock.model_manifest as { kind?: string }).kind).toBe('vrm');
      expect(Array.isArray(vrmBlock.expected)).toBe(true);
    });
  }
});

// ────────────────────────────────────────────────────────────────────
// Scenario 1: vrm-listening — generated provider missing fail-close.
// ────────────────────────────────────────────────────────────────────

describe('scenario vrm-listening (chunk 3-E)', () => {
  it('motionRegistry.loadAll yields loaded_ids=[idle_subtle], failed_ids contains listen_lean', async () => {
    mocks.loadAnimation.mockImplementation(partialAssetFetcher());
    const registry = createVrmMotionPresetRegistry({ table: makeMotionTable() });
    const result = await registry.loadAll({ vrm: makeFakeVrm() });
    expect(result.loadedIds).toEqual(['idle_subtle']);
    const failedById = new Map(result.failedIds.map((f) => [f.id, f.reason]));
    expect(failedById.get('listen_lean')).toBe('animation_load_failed');
    expect(failedById.get('nod_yes')).toBe('animation_load_failed');
    expect(failedById.get('shake_no')).toBe('animation_load_failed');
  });

  it('applyActivity("listening") routes to generatedMotionRuntime.play(listen_lean) and fails closed when provider is missing', async () => {
    const vrm = makeFakeVrm();
    const generatedMotionRuntime = createVrmGeneratedMotionRuntime(
      createMissingVrmGeneratedMotionProvider(),
    );
    generatedMotionRuntime.attach(vrm);
    const emoteState = createVrmEmoteState({ emoteTable: makeEmoteTable() });
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      generatedMotionRuntime,
      activityMapping: makeActivityMapping(),
    });

    const playSpy = vi.spyOn(generatedMotionRuntime, 'play');
    adapter.applyActivity({ name: 'listening', intensity: null });

    expect(playSpy).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: 'listen_lean', fade: 0.3 }),
    );
    const result = playSpy.mock.results[0]?.value as { played: boolean; reason?: string };
    expect(result.played).toBe(false);
    expect(result.reason).toBe('generated_motion_provider_missing');
    expect(generatedMotionRuntime.snapshot().activeRouteId).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario 2: vrm-thinking — generated provider missing fail-close.
// ────────────────────────────────────────────────────────────────────

describe('scenario vrm-thinking (chunk 3-E)', () => {
  it('applyActivity("thinking") routes to generatedMotionRuntime.play(idle_subtle) and fails closed when provider is missing', async () => {
    const vrm = makeFakeVrm();
    const generatedMotionRuntime = createVrmGeneratedMotionRuntime(
      createMissingVrmGeneratedMotionProvider(),
    );
    generatedMotionRuntime.attach(vrm);
    const emoteState = createVrmEmoteState({ emoteTable: makeEmoteTable() });
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      generatedMotionRuntime,
      activityMapping: makeActivityMapping(),
    });

    const playSpy = vi.spyOn(generatedMotionRuntime, 'play');
    adapter.applyActivity({ name: 'thinking', intensity: null });

    expect(playSpy).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: 'idle_subtle', fade: 0.4 }),
    );
    const result = playSpy.mock.results[0]?.value as { played: boolean; reason?: string };
    expect(result.played).toBe(false);
    expect(result.reason).toBe('generated_motion_provider_missing');
    expect(generatedMotionRuntime.snapshot().activeRouteId).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario 3: vrm-speaking-with-audio — non-synthetic mime, lipsync coordination.
// ────────────────────────────────────────────────────────────────────

describe('scenario vrm-speaking-with-audio (chunk 3-E)', () => {
  it('AudioPipelineController progresses idle → requested → started → completed; sink attach + detach', async () => {
    const fake = fakeAudioContext();
    const node = fakeWLipSyncNode();
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => node),
    });
    const attachSpy = vi.spyOn(consumer, 'attachAudioSource');
    const detachSpy = vi.spyOn(consumer, 'detachAudioSource');

    const runtime = {
      artifacts: {
        readBytes: vi.fn(async () => ({
          bytes: new ArrayBuffer(1024),
          mimeType: 'audio/wav',
          sizeBytes: 1024,
        })),
      },
    };
    const pipeline = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    pipeline.setRuntime(runtime as never);
    pipeline.registerLipsyncSink(consumer);

    const states: AudioPlaybackSnapshot[] = [];
    pipeline.subscribe((s) => states.push(s));

    await pipeline.play({
      audioArtifactId: 'mock-artifact-001',
      audioMimeType: 'audio/wav',
    });

    expect(states.map((s) => s.state)).toEqual(['idle', 'requested', 'started']);
    expect(fake.source.start).toHaveBeenCalledTimes(1);
    // Microtask boundary so post-start sink attach runs.
    await Promise.resolve();
    expect(attachSpy).toHaveBeenCalledTimes(1);

    fake.source.onended?.();
    expect(states.map((s) => s.state)).toEqual([
      'idle',
      'requested',
      'started',
      'completed',
    ]);
    expect(detachSpy).toHaveBeenCalled();
  });

  it('lipsyncDriver tick over active phase reports {active: true}; emote suppresses visemes', () => {
    const driver = createVrmLipsyncDriver({ nowMsFn: () => 1000 });
    const emoteState = createVrmEmoteState({ emoteTable: makeEmoteTable() });
    const setValueSpy = vi.fn();
    const vrm = makeFakeVrm(setValueSpy);

    // Establish a happy emote so emoteState has viseme garnish entries (aa).
    emoteState.setEmote('happy');

    // Active phase snapshot from the fixture: A=0.6 dominant, volume=0.5.
    const activeSnapshot: WLipSyncSnapshot = {
      weights: { A: 0.6, E: 0.1, I: 0.05, O: 0.05, U: 0.05, S: 0.0 },
      volume: 0.5,
    };
    const activeResult = driver.tick({ vrm, deltaSec: 0.05, lipsyncSnapshot: activeSnapshot });
    expect(activeResult.active).toBe(true);

    emoteState.setLipsyncActive(activeResult.active);
    const tickResult = emoteState.tick({ vrm, deltaSec: 0.05 });
    // Bundle "happy" includes viseme `aa` — when lipsyncActive=true we
    // expect at least one viseme write to be suppressed.
    expect(tickResult.skippedCount).toBeGreaterThan(0);
  });

  it('lipsyncDriver tick over silent phase reports {active: false}', () => {
    let now = 1000;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const vrm = makeFakeVrm();

    // Drive an active frame first so lastActiveAtMs anchors.
    driver.tick({
      vrm,
      deltaSec: 0.05,
      lipsyncSnapshot: {
        weights: { A: 0.6, E: 0.1, I: 0.05, O: 0.05, U: 0.05, S: 0.0 },
        volume: 0.5,
      },
    });
    // Advance past the IDLE_MS threshold so silent path forces inactive.
    now += 500;
    const silentSnapshot: WLipSyncSnapshot = {
      weights: { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 },
      volume: 0,
    };
    const result = driver.tick({ vrm, deltaSec: 0.256, lipsyncSnapshot: silentSnapshot });
    expect(result.active).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario 4: vrm-speaking-silent-audio — synthetic mime fast-path.
// ────────────────────────────────────────────────────────────────────

describe('scenario vrm-speaking-silent-audio (chunk 3-E)', () => {
  it('synthetic mime: no decodeAudioData, sink.silent invoked, state ends completed', async () => {
    const fake = fakeAudioContext();
    const node = fakeWLipSyncNode();
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => node),
    });
    const silentSpy = vi.spyOn(consumer, 'silent');
    const attachSpy = vi.spyOn(consumer, 'attachAudioSource');

    const audioContextFactory = vi.fn(() => fake.context);
    const pipeline = new AudioPipelineController({
      audioContextFactory,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    pipeline.registerLipsyncSink(consumer);

    const states: AudioPlaybackSnapshot[] = [];
    pipeline.subscribe((s) => states.push(s));

    await pipeline.play({
      audioArtifactId: 'synthetic://lipsync/turn-mock-001',
      audioMimeType: SYNTHETIC_AUDIO_MIME_TYPE,
    });

    // Synthetic path skips AudioContext construction entirely.
    expect(audioContextFactory).not.toHaveBeenCalled();
    expect(fake.decodeAudioData).not.toHaveBeenCalled();
    expect(attachSpy).not.toHaveBeenCalled();
    expect(silentSpy).toHaveBeenCalledTimes(1);
    expect(states.map((s) => s.state)).toEqual(['idle', 'requested', 'completed']);
    expect(states[states.length - 1]?.reason).toBe('synthetic_audio_no_playback');
  });

  it('lipsyncDriver remains {active: false} when audioConsumer.snapshot() is null', () => {
    const driver = createVrmLipsyncDriver({ nowMsFn: () => 0 });
    const vrm = makeFakeVrm();
    // null snapshot represents "no source attached / synthetic path".
    const result = driver.tick({ vrm, deltaSec: 0.05, lipsyncSnapshot: null });
    expect(result.active).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Scenario 5: vrm-emote-cycle — crossfade + cap + skipped_count invariants.
// ────────────────────────────────────────────────────────────────────

describe('scenario vrm-emote-cycle (chunk 3-E)', () => {
  it('sequential applyEmotion updates emoteState.snapshot().activeEmote in order', async () => {
    mocks.loadAnimation.mockImplementation(partialAssetFetcher());
    const vrm = makeFakeVrm();
    const generatedMotionRuntime = createVrmGeneratedMotionRuntime(
      createMissingVrmGeneratedMotionProvider(),
    );
    generatedMotionRuntime.attach(vrm);
    const emoteState = createVrmEmoteState({ emoteTable: makeEmoteTable() });
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      generatedMotionRuntime,
      activityMapping: makeActivityMapping(),
    });

    const sequence: Array<string | null> = [];
    const apply = (current: string, previous: string | null): void => {
      adapter.applyEmotion({ current, previous });
      sequence.push(emoteState.snapshot().activeEmote);
    };

    apply('neutral', null);
    apply('happy', 'neutral');
    apply('sad', 'happy');
    apply('relaxed', 'sad');
    apply('neutral', 'relaxed');

    expect(sequence).toEqual(['neutral', 'happy', 'sad', 'relaxed', 'neutral']);
  });

  it('primary expressive weight stays ≤ 0.8 across the crossfade cycle (neutral preset exempt)', () => {
    const emoteState = createVrmEmoteState({ emoteTable: makeEmoteTable() });
    const setValueSpy = vi.fn();
    const vrm = makeFakeVrm(setValueSpy);

    const expressiveCaps: number[] = [];
    const sequence = ['neutral', 'happy', 'sad', 'relaxed', 'neutral'];
    for (const emote of sequence) {
      emoteState.setEmote(emote);
      // Tick repeatedly to converge toward target weights.
      for (let i = 0; i < 10; i++) {
        emoteState.tick({ vrm, deltaSec: 0.1 });
      }
      const snap = emoteState.snapshot();
      let primaryExpressive = 0;
      for (const [name, w] of Object.entries(snap.currentWeights)) {
        if (name === 'neutral') continue;
        if (w > primaryExpressive) primaryExpressive = w;
      }
      expressiveCaps.push(primaryExpressive);
    }

    for (const cap of expressiveCaps) {
      expect(cap).toBeLessThanOrEqual(0.8 + 1e-6);
    }
  });

  it('skippedCount = 0 when lipsyncActive=false; expressionManager.setValue called for emote presets', () => {
    const emoteState = createVrmEmoteState({ emoteTable: makeEmoteTable() });
    const setValueSpy = vi.fn();
    const vrm = makeFakeVrm(setValueSpy);

    emoteState.setLipsyncActive(false);
    emoteState.setEmote('happy');
    const result = emoteState.tick({ vrm, deltaSec: 0.1 });
    expect(result.skippedCount).toBe(0);
    expect(emoteState.snapshot().lipsyncActive).toBe(false);

    // happy bundle has `happy` + `aa`; both should be flushed when lipsyncActive=false.
    const calledNames = setValueSpy.mock.calls.map((c) => c[0]);
    expect(calledNames).toContain('happy');
    expect(calledNames).toContain('aa');
  });

  it('crossfade is smooth: intermediate weights are between 0 and target, not abrupt jumps', () => {
    const emoteState = createVrmEmoteState({ emoteTable: makeEmoteTable() });
    const vrm = makeFakeVrm();

    emoteState.setEmote('happy');
    // After a single small tick, currentWeights should be partial — not yet
    // at the target — proving the bundle ramps rather than snapping.
    emoteState.tick({ vrm, deltaSec: 0.05 });
    const snap = emoteState.snapshot();
    const happyWeight = snap.currentWeights['happy'] ?? 0;
    expect(happyWeight).toBeGreaterThan(0);
    expect(happyWeight).toBeLessThan(0.7);
  });
});
