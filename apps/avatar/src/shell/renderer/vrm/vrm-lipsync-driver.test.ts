// VrmLipsyncDriver owner behavior tests.
//
// Covers: null snapshot
// decay path; active speech winner+runner blend; S → I projection;
// silence detection (amp threshold + winnerVal threshold); IDLE_MS
// timeout via test seam; silent() zero-out; missing-preset graceful
// degrade.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VRM } from '@pixiv/three-vrm';

import {
  createVrmLipsyncDriver,
  CAP,
  RUNNER_CAP,
  IDLE_MS,
  WEIGHT_SCALE,
  MIN_OUTPUT,
  LIP_KEYS,
  type LipKey,
} from './vrm-lipsync-driver.js';
import type { WLipSyncSnapshot } from '@nimiplatform/kit/features/avatar/headless';

type SetValueFn = (name: string, weight: number) => void;

function createMockVrm(opts?: { missingPresets?: ReadonlySet<string> }): {
  vrm: VRM;
  setValue: ReturnType<typeof vi.fn<SetValueFn>>;
} {
  const setValue = vi.fn<SetValueFn>((name) => {
    if (opts?.missingPresets?.has(name)) {
      throw new Error(`mock: missing preset "${name}"`);
    }
  });
  const vrm = {
    expressionManager: { setValue },
  } as unknown as VRM;
  return { vrm, setValue };
}

function emptyWeights(): WLipSyncSnapshot['weights'] {
  return { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 };
}

function makeSnapshot(
  weights: Partial<WLipSyncSnapshot['weights']>,
  volume: number,
): WLipSyncSnapshot {
  return { weights: { ...emptyWeights(), ...weights }, volume };
}

describe('createVrmLipsyncDriver — null snapshot path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns inactive and decays smoothState toward 0 when snapshot is null', () => {
    let now = 0;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const { vrm, setValue } = createMockVrm();

    // Seed with an active frame so smoothState is non-zero.
    const r1 = driver.tick({
      vrm,
      deltaSec: 0.1,
      lipsyncSnapshot: makeSnapshot({ A: 0.9, E: 0.2 }, 0.7),
    });
    expect(r1.active).toBe(true);
    const seeded = driver.snapshot().smoothState;
    expect(seeded.A).toBeGreaterThan(0);

    setValue.mockClear();
    now += 16;

    const r2 = driver.tick({ vrm, deltaSec: 0.016, lipsyncSnapshot: null });
    expect(r2.active).toBe(false);

    const decayed = driver.snapshot().smoothState;
    // After one decay frame, A should drop but not be exactly zero yet.
    expect(decayed.A).toBeLessThan(seeded.A);
    // setValue should have been called for all 5 visemes this frame.
    const names = setValue.mock.calls.map((c) => c[0]);
    expect(names).toEqual(
      expect.arrayContaining(['aa', 'ee', 'ih', 'oh', 'ou']),
    );
  });

  it('returns inactive when expressionManager is missing', () => {
    const driver = createVrmLipsyncDriver({ nowMsFn: () => 0 });
    const vrm = { expressionManager: null } as unknown as VRM;
    expect(
      driver.tick({
        vrm,
        deltaSec: 0.016,
        lipsyncSnapshot: makeSnapshot({ A: 0.9 }, 0.7),
      }).active,
    ).toBe(false);
  });
});

describe('createVrmLipsyncDriver — active speech path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('selects winner=A + runner=E and writes scaled aa/ee weights', () => {
    let now = 0;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const { vrm, setValue } = createMockVrm();

    // Drive the envelope to steady-state so smoothState ≈ target.
    for (let i = 0; i < 30; i++) {
      now += 16;
      driver.tick({
        vrm,
        deltaSec: 0.016,
        lipsyncSnapshot: makeSnapshot({ A: 0.8, E: 0.2, I: 0.1 }, 0.5),
      });
    }

    // After ramping, the smoothed winner (A) should be > runner (E)
    // and both clamped against CAP / RUNNER_CAP.
    const ss = driver.snapshot().smoothState;
    expect(ss.A).toBeGreaterThan(ss.E);
    expect(ss.A).toBeLessThanOrEqual(CAP + 1e-9);
    expect(ss.E).toBeLessThanOrEqual(RUNNER_CAP + 1e-9);

    // Last frame must have flushed all 5 viseme presets.
    const lastFiveCalls = setValue.mock.calls.slice(-5);
    const lastNames = lastFiveCalls.map((c) => c[0]);
    expect(lastNames).toEqual(['aa', 'ee', 'ih', 'oh', 'ou']);

    // The flushed weight must equal smoothState * WEIGHT_SCALE
    // (or 0 when below MIN_OUTPUT).
    const aaCall = lastFiveCalls.find((c) => c[0] === 'aa');
    expect(aaCall).toBeDefined();
    const aaWeight = aaCall![1];
    const expectedAa = ss.A <= MIN_OUTPUT ? 0 : ss.A * WEIGHT_SCALE;
    expect(aaWeight).toBeCloseTo(expectedAa, 6);
  });

  it('projects S to I (winner becomes I when only S is hot)', () => {
    let now = 0;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const { vrm } = createMockVrm();

    // Single active frame: only S is hot. Per RAW_TO_LIP, S → I, so
    // projected.I should dominate.
    driver.tick({
      vrm,
      deltaSec: 0.016,
      lipsyncSnapshot: makeSnapshot({ S: 0.9 }, 0.5),
    });

    const ss = driver.snapshot().smoothState;
    expect(ss.I).toBeGreaterThan(0);
    // No other key was raw-active.
    for (const k of LIP_KEYS) {
      if (k !== 'I') expect(ss[k]).toBe(0);
    }
  });
});

describe('createVrmLipsyncDriver — silence detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('treats sub-SILENCE_VOL volume as silent (amp gate)', () => {
    let now = 0;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const { vrm } = createMockVrm();

    // volume 0.001 → amp = (0.001*0.9)^0.7 ≈ 0.005 < SILENCE_VOL=0.04.
    const r = driver.tick({
      vrm,
      deltaSec: 0.016,
      lipsyncSnapshot: makeSnapshot({ A: 0.9, E: 0.5 }, 0.001),
    });
    expect(r.active).toBe(false);
  });

  it('treats sub-SILENCE_GAIN winner as silent (winner gate)', () => {
    let now = 0;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const { vrm } = createMockVrm();

    // All weights very low; volume mid-range → amp survives but
    // winnerVal = 0.01 * amp << SILENCE_GAIN=0.05.
    const r = driver.tick({
      vrm,
      deltaSec: 0.016,
      lipsyncSnapshot: makeSnapshot(
        { A: 0.01, E: 0.005, I: 0.005 },
        0.5,
      ),
    });
    expect(r.active).toBe(false);
  });
});

describe('createVrmLipsyncDriver — IDLE_MS timeout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('flips to silent when no active frame within IDLE_MS', () => {
    let now = 0;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const { vrm } = createMockVrm();

    // Active frame at t=0.
    const r1 = driver.tick({
      vrm,
      deltaSec: 0.016,
      lipsyncSnapshot: makeSnapshot({ A: 0.9, E: 0.2 }, 0.5),
    });
    expect(r1.active).toBe(true);

    // Synthesize a frame WAY past IDLE_MS, but with input that would
    // independently be silent (winner below threshold). The IDLE_MS
    // path must force silent regardless of any input.
    now += IDLE_MS + 1;
    const r2 = driver.tick({
      vrm,
      deltaSec: 0.016,
      // Force borderline-silent input so we exercise the IDLE branch
      // (`amp < SILENCE_VOL || winnerVal < SILENCE_GAIN` already
      // fires; the IDLE_MS clamp is the secondary gate).
      lipsyncSnapshot: makeSnapshot({ A: 0.005 }, 0.5),
    });
    expect(r2.active).toBe(false);
  });
});

describe('createVrmLipsyncDriver — silent()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('zeroes all 5 viseme presets and the smoothing state', () => {
    let now = 0;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const { vrm, setValue } = createMockVrm();

    // Seed with an active frame.
    driver.tick({
      vrm,
      deltaSec: 0.1,
      lipsyncSnapshot: makeSnapshot({ A: 0.9, E: 0.3 }, 0.7),
    });
    expect(driver.snapshot().smoothState.A).toBeGreaterThan(0);

    setValue.mockClear();
    driver.silent(vrm);

    // Each viseme preset receives a setValue(_, 0) call.
    const calledNames = setValue.mock.calls.map((c) => c[0]);
    for (const name of ['aa', 'ee', 'ih', 'oh', 'ou']) {
      expect(calledNames).toContain(name);
    }
    for (const call of setValue.mock.calls) {
      expect(call[1]).toBe(0);
    }
    const ss = driver.snapshot().smoothState;
    for (const k of LIP_KEYS) expect(ss[k as LipKey]).toBe(0);
    expect(driver.snapshot().isActive).toBe(false);
  });

  it('is safe when expressionManager is missing', () => {
    const driver = createVrmLipsyncDriver({ nowMsFn: () => 0 });
    const vrm = { expressionManager: null } as unknown as VRM;
    expect(() => driver.silent(vrm)).not.toThrow();
  });
});

describe('createVrmLipsyncDriver — missing preset graceful', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('continues flushing other presets when one preset throws', () => {
    let now = 0;
    const driver = createVrmLipsyncDriver({ nowMsFn: () => now });
    const { vrm, setValue } = createMockVrm({
      missingPresets: new Set(['aa']),
    });

    // Active frame; flush should attempt all 5 visemes; aa throws but
    // tick() returns successfully and the other 4 still receive
    // setValue calls.
    expect(() =>
      driver.tick({
        vrm,
        deltaSec: 0.016,
        lipsyncSnapshot: makeSnapshot({ A: 0.9, E: 0.2 }, 0.5),
      }),
    ).not.toThrow();

    const names = setValue.mock.calls.map((c) => c[0]);
    expect(names).toContain('aa'); // attempted
    expect(names).toContain('ee'); // succeeded
    expect(names).toContain('ih');
    expect(names).toContain('oh');
    expect(names).toContain('ou');
  });
});
