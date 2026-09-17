import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHORED_SCENE_CYCLE_MS,
  AUTHORED_SCENE_EPOCH_MS,
  deriveLunarSkyState,
  formatSceneTime,
  scenePhaseFromTime,
  sceneTimeFromDate,
  sceneTimeFromTimestamp,
  SCENE_PHASE_PRESET_TIME,
  SYNODIC_CYCLE_DAYS,
} from '../../src/shell/chrome/sky-math.ts';

const TAU = 2 * Math.PI;
const EPSILON = 1e-12;

function near(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function vectorNear(actual, expected, epsilon = EPSILON) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => near(value, expected[index], epsilon));
}

function angularDistance(left, right) {
  const delta = Math.abs(left - right) % TAU;
  return Math.min(delta, TAU - delta);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function vectorDistance(left, right) {
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

function phaseFractionFromDirections(sunDirection, earthDirection) {
  return (1 - dot(sunDirection, earthDirection)) / 2;
}

function lambertPhaseFromDirections(sunDirection, earthDirection) {
  const cosine = Math.min(Math.max(dot(sunDirection, earthDirection), -1), 1);
  const phaseAngle = Math.acos(-cosine);
  if (phaseAngle === 0) return 1;
  if (phaseAngle === Math.PI) return 0;
  return (
    Math.sin(phaseAngle)
      + (Math.PI - phaseAngle) * Math.cos(phaseAngle)
  ) / Math.PI;
}

test('authored scene time uses one fixed UTC epoch and an unwrapped 24-minute cycle', () => {
  assert.equal(AUTHORED_SCENE_CYCLE_MS, 24 * 60 * 1_000);
  assert.equal(SYNODIC_CYCLE_DAYS, 29.53059);
  assert.equal(sceneTimeFromTimestamp(AUTHORED_SCENE_EPOCH_MS), 0);
  assert.equal(
    sceneTimeFromTimestamp(AUTHORED_SCENE_EPOCH_MS + 6 * 60 * 1_000),
    0.25,
  );
  assert.equal(sceneTimeFromDate(new Date(AUTHORED_SCENE_EPOCH_MS)), 0);
  assert.equal(sceneTimeFromDate(AUTHORED_SCENE_EPOCH_MS + 6 * 60 * 1_000), 0.25);
  assert.equal(sceneTimeFromDate(AUTHORED_SCENE_EPOCH_MS + 24 * 60 * 1_000), 1);
  assert.equal(sceneTimeFromDate(AUTHORED_SCENE_EPOCH_MS + 30 * 60 * 1_000), 1.25);
  assert.equal(sceneTimeFromDate(AUTHORED_SCENE_EPOCH_MS - 6 * 60 * 1_000), -0.25);

  const utcInstant = new Date('2026-04-05T12:30:00.000Z');
  const offsetInstant = new Date('2026-04-05T20:30:00.000+08:00');
  assert.equal(sceneTimeFromDate(utcInstant), sceneTimeFromDate(offsetInstant));
});

test('canonical cycle quarters derive lunar light and Earth phase from one vector geometry', () => {
  const fullEarthNight = deriveLunarSkyState(0);
  assert.equal(fullEarthNight.cycle, 0);
  assert.equal(fullEarthNight.scenePhase, 'night');
  near(Math.hypot(...fullEarthNight.earthDirection), 1);
  assert.ok(fullEarthNight.earthDirection[0] > 0);
  assert.ok(fullEarthNight.earthDirection[1] > 0);
  assert.ok(fullEarthNight.earthDirection[2] > 0);
  vectorNear(
    fullEarthNight.sunDirection,
    fullEarthNight.earthDirection.map((component) => -component),
  );
  near(dot(fullEarthNight.sunDirection, fullEarthNight.earthDirection), -1);
  assert.ok(fullEarthNight.sunElevation < 0);
  assert.equal(fullEarthNight.lunarIllumination, 0);
  assert.equal(fullEarthNight.earthPhase, 1);
  assert.equal(fullEarthNight.earthshine, 1);

  const dawn = deriveLunarSkyState(0.25);
  assert.equal(dawn.scenePhase, 'dawn');
  near(dawn.sunDirection[2], 0);
  assert.equal(dawn.lunarIllumination, 0);
  near(
    dawn.earthPhase,
    phaseFractionFromDirections(dawn.sunDirection, dawn.earthDirection),
  );
  near(
    dawn.earthshine,
    lambertPhaseFromDirections(dawn.sunDirection, dawn.earthDirection),
  );
  assert.ok(Math.abs(dawn.earthPhase - 0.5) < 0.01);

  const newEarthDay = deriveLunarSkyState(0.5);
  assert.equal(newEarthDay.scenePhase, 'day');
  vectorNear(newEarthDay.sunDirection, newEarthDay.earthDirection);
  near(dot(newEarthDay.sunDirection, newEarthDay.earthDirection), 1);
  assert.ok(newEarthDay.sunElevation > 0);
  near(newEarthDay.lunarIllumination, newEarthDay.sunDirection[2]);
  assert.ok(newEarthDay.lunarIllumination > 0);
  assert.equal(newEarthDay.earthPhase, 0);
  assert.equal(newEarthDay.earthshine, 0);

  const dusk = deriveLunarSkyState(0.75);
  assert.equal(dusk.scenePhase, 'dusk');
  near(dusk.sunDirection[2], 0);
  assert.equal(dusk.lunarIllumination, 0);
  near(
    dusk.earthPhase,
    phaseFractionFromDirections(dusk.sunDirection, dusk.earthDirection),
  );
  near(
    dusk.earthshine,
    lambertPhaseFromDirections(dusk.sunDirection, dusk.earthDirection),
  );
  assert.ok(Math.abs(dusk.earthPhase - 0.5) < 0.01);
});

test('scene phase presets and labels use lunar horizon crossings, not local clock hours', () => {
  assert.deepEqual(SCENE_PHASE_PRESET_TIME, {
    dawn: 0.25,
    day: 0.5,
    dusk: 0.75,
    night: 0,
  });
  assert.equal(scenePhaseFromTime(0), 'night');
  assert.equal(scenePhaseFromTime(0.25), 'dawn');
  assert.equal(scenePhaseFromTime(0.5), 'day');
  assert.equal(scenePhaseFromTime(0.75), 'dusk');
  assert.equal(scenePhaseFromTime(1), 'night');

  assert.equal(formatSceneTime(0), '00:00');
  assert.equal(formatSceneTime(0.25), '06:00');
  assert.equal(formatSceneTime(0.5), '12:00');
  assert.equal(formatSceneTime(0.75), '18:00');
  assert.equal(formatSceneTime(1), '00:00');
  assert.equal(formatSceneTime(-0.25), '18:00');
});

test('all derived values remain normalized and keep one solar geometry invariant', () => {
  const longitudeLimit = 1.2 * Math.PI / 180;
  const latitudeLimit = 0.8 * Math.PI / 180;
  const apparentLibrationLimit = 1.5 * Math.PI / 180;
  const baseEarthDirection = deriveLunarSkyState(0).earthDirection;

  for (let step = -2_000; step <= 3_000; step += 1) {
    const state = deriveLunarSkyState(step / 1_000);
    const [x, y, z] = state.sunDirection;
    near(Math.hypot(x, y, z), 1);
    near(Math.hypot(...state.earthDirection), 1);
    near(state.lunarIllumination, Math.max(z, 0));
    near(
      state.earthPhase,
      phaseFractionFromDirections(state.sunDirection, state.earthDirection),
    );
    near(
      state.earthshine,
      lambertPhaseFromDirections(state.sunDirection, state.earthDirection),
    );
    assert.ok(state.cycle >= 0 && state.cycle < 1);
    assert.ok(state.lunarIllumination >= 0 && state.lunarIllumination <= 1);
    assert.ok(state.earthPhase >= 0 && state.earthPhase <= 1);
    assert.ok(state.earthshine >= 0 && state.earthshine <= 1);
    assert.ok(state.earthRotation >= 0 && state.earthRotation < TAU);
    assert.ok(state.cloudRotation >= 0 && state.cloudRotation < TAU);
    assert.ok(Math.abs(state.libration.longitude) <= longitudeLimit + EPSILON);
    assert.ok(Math.abs(state.libration.latitude) <= latitudeLimit + EPSILON);
    assert.ok(
      Math.acos(Math.min(Math.max(
        dot(baseEarthDirection, state.earthDirection),
        -1,
      ), 1)) <= apparentLibrationLimit + EPSILON,
    );
  }
});

test('authored rotations use one Earth turn and 1.18 cloud turns per scene cycle', () => {
  const quarter = deriveLunarSkyState(0.25);
  const half = deriveLunarSkyState(0.5);
  const threeQuarters = deriveLunarSkyState(0.75);
  const first = deriveLunarSkyState(0.137);
  const nextSolarCycle = deriveLunarSkyState(1.137);

  near(quarter.earthRotation, TAU * 0.25);
  near(half.earthRotation, TAU * 0.5);
  near(threeQuarters.earthRotation, TAU * 0.75);
  near(half.cloudRotation, TAU * 0.5 * 1.18);
  near(angularDistance(first.earthRotation, nextSolarCycle.earthRotation), 0);
  near(
    angularDistance(first.cloudRotation, nextSolarCycle.cloudRotation),
    TAU * 0.18,
  );
});

test('solar geometry and libration repeat while cloud drift stays continuous at cycle boundaries', () => {
  const before = deriveLunarSkyState(1 - 1e-8);
  const after = deriveLunarSkyState(1 + 1e-8);
  const first = deriveLunarSkyState(0.137);
  const nextSolarCycle = deriveLunarSkyState(1.137);

  assert.ok(Math.hypot(
    ...before.sunDirection.map((value, index) => value - after.sunDirection[index]),
  ) < 2e-7);
  assert.ok(Math.abs(before.lunarIllumination - after.lunarIllumination) < 2e-7);
  assert.ok(Math.abs(before.earthPhase - after.earthPhase) < 2e-7);
  assert.ok(Math.abs(before.earthshine - after.earthshine) < 2e-7);
  assert.ok(angularDistance(before.earthRotation, after.earthRotation) < 4e-6);
  assert.ok(angularDistance(before.cloudRotation, after.cloudRotation) < 4e-6);
  assert.ok(Math.abs(before.libration.longitude - after.libration.longitude) < 2e-7);
  assert.ok(Math.abs(before.libration.latitude - after.libration.latitude) < 2e-7);

  vectorNear(first.sunDirection, nextSolarCycle.sunDirection);
  vectorNear(first.earthDirection, nextSolarCycle.earthDirection);
  near(first.lunarIllumination, nextSolarCycle.lunarIllumination);
  near(first.earthPhase, nextSolarCycle.earthPhase);
  near(first.earthshine, nextSolarCycle.earthshine);
  near(angularDistance(first.earthRotation, nextSolarCycle.earthRotation), 0);
  assert.ok(angularDistance(first.cloudRotation, nextSolarCycle.cloudRotation) > 0.1);
});

test('invalid timestamps and scene times fail instead of producing NaN state', () => {
  assert.throws(() => sceneTimeFromTimestamp(Number.NaN), /timestampMs must be finite/u);
  assert.throws(() => sceneTimeFromDate(new Date(Number.NaN)), /timestampMs must be finite/u);
  assert.throws(() => sceneTimeFromDate(Number.POSITIVE_INFINITY), /timestampMs must be finite/u);
  assert.throws(() => deriveLunarSkyState(Number.NaN), /sceneTime must be finite/u);
  assert.throws(() => scenePhaseFromTime(Number.NEGATIVE_INFINITY), /sceneTime must be finite/u);
  assert.throws(() => formatSceneTime(Number.NaN), /sceneTime must be finite/u);
});
