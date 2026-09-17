/** Deterministic celestial state for the authored lunar-surface scene. */

export type ScenePhase = 'day' | 'dusk' | 'night' | 'dawn';
export type SceneVector3 = readonly [x: number, y: number, z: number];

export interface LunarSkyState {
  /** Unbounded authored synodic cycles elapsed since AUTHORED_SCENE_EPOCH_MS. */
  readonly sceneTime: number;
  /** Current authored synodic cycle position in [0, 1). */
  readonly cycle: number;
  readonly scenePhase: ScenePhase;
  /**
   * Moon-to-Earth direction in the same lunar-local basis as sunDirection.
   * It includes the authored low-amplitude libration displacement.
   */
  readonly earthDirection: SceneVector3;
  /**
   * Lunar-local light direction.
   *
   * +X is the authored screen-left tangent, +Y is screen-up/depth tangent,
   * and +Z is the lunar outward surface normal. At cycle 0 the Sun is below
   * the surface opposite Earth (full Earth); at cycle 0.5 it is toward Earth
   * (new Earth).
   */
  readonly sunDirection: SceneVector3;
  /** Solar elevation above the lunar horizon, in radians. */
  readonly sunElevation: number;
  /** Solar azimuth in radians: 0 at +Y, positive toward +X. */
  readonly sunAzimuth: number;
  /** Direct irradiance multiplier for a flat lunar surface, in [0, 1]. */
  readonly lunarIllumination: number;
  /** Illuminated fraction of the Earth disc seen from the Moon, in [0, 1]. */
  readonly earthPhase: number;
  /** Lambert-sphere Earthshine multiplier, in [0, 1]. */
  readonly earthshine: number;
  /** Periodic Earth texture rotation in radians, in [0, 2π). */
  readonly earthRotation: number;
  /** Periodic cloud texture rotation in radians, in [0, 2π). */
  readonly cloudRotation: number;
  /** Apparent Earth displacement caused by lunar libration, in radians. */
  readonly libration: {
    readonly longitude: number;
    readonly latitude: number;
  };
}

export const AUTHORED_SCENE_CYCLE_MS = 24 * 60 * 1_000;
export const AUTHORED_SCENE_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
/** Astronomical reference only; authored motion rates do not use this duration. */
export const SYNODIC_CYCLE_DAYS = 29.53059;

const TAU = 2 * Math.PI;
const EARTH_TURNS_PER_AUTHORED_CYCLE = 1;
const CLOUD_TURNS_PER_AUTHORED_CYCLE = 1.18;
const LIBRATION_LONGITUDE_AMPLITUDE = 1.2 * Math.PI / 180;
const LIBRATION_LATITUDE_AMPLITUDE = 0.8 * Math.PI / 180;
const LIBRATION_LONGITUDE_TURNS_PER_CYCLE = 1;
const LIBRATION_LATITUDE_TURNS_PER_CYCLE = 2;
const HORIZON_PHASE_BAND = Math.sin(6 * Math.PI / 180);
const UNIT_EPSILON = 1e-15;
const BASE_EARTH_DIRECTION = normalizeVector([0.32, 0.42, 0.85]);
const SOLAR_ORBIT_TANGENT = normalizeVector([
  BASE_EARTH_DIRECTION[1],
  -BASE_EARTH_DIRECTION[0],
  0,
]);

export const SCENE_PHASE_PRESET_TIME: Readonly<Record<ScenePhase, number>> = {
  dawn: 0.25,
  day: 0.5,
  dusk: 0.75,
  night: 0,
};

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function cycleFromSceneTime(sceneTime: number): number {
  assertFinite(sceneTime, 'sceneTime');
  return positiveModulo(sceneTime, 1);
}

function cleanUnitComponent(value: number): number {
  return Math.abs(value) < UNIT_EPSILON ? 0 : value;
}

function normalizeVector(vector: SceneVector3): SceneVector3 {
  const length = Math.hypot(...vector);
  if (length <= UNIT_EPSILON) {
    throw new RangeError('scene vector must have non-zero length');
  }
  return [
    cleanUnitComponent(vector[0] / length),
    cleanUnitComponent(vector[1] / length),
    cleanUnitComponent(vector[2] / length),
  ];
}

function sunDirectionFromCycle(cycle: number): SceneVector3 {
  const angle = TAU * cycle;
  const earthAxisWeight = -Math.cos(angle);
  const tangentWeight = Math.sin(angle);
  return normalizeVector([
    BASE_EARTH_DIRECTION[0] * earthAxisWeight + SOLAR_ORBIT_TANGENT[0] * tangentWeight,
    BASE_EARTH_DIRECTION[1] * earthAxisWeight + SOLAR_ORBIT_TANGENT[1] * tangentWeight,
    BASE_EARTH_DIRECTION[2] * earthAxisWeight + SOLAR_ORBIT_TANGENT[2] * tangentWeight,
  ]);
}

function rotateAroundY(vector: SceneVector3, angle: number): SceneVector3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    vector[0] * cosine + vector[2] * sine,
    vector[1],
    -vector[0] * sine + vector[2] * cosine,
  ];
}

function rotateAroundX(vector: SceneVector3, angle: number): SceneVector3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    vector[0],
    vector[1] * cosine - vector[2] * sine,
    vector[1] * sine + vector[2] * cosine,
  ];
}

function earthDirectionFromLibration(longitude: number, latitude: number): SceneVector3 {
  return normalizeVector(rotateAroundX(
    rotateAroundY(BASE_EARTH_DIRECTION, longitude),
    -latitude,
  ));
}

function scenePhaseFromDirection(sunDirection: SceneVector3): ScenePhase {
  const elevationSine = sunDirection[2];
  if (Math.abs(elevationSine) <= HORIZON_PHASE_BAND) {
    return sunDirection[0] >= 0 ? 'dawn' : 'dusk';
  }
  return elevationSine > 0 ? 'day' : 'night';
}

function lambertSpherePhase(phaseAngle: number): number {
  if (phaseAngle <= UNIT_EPSILON) return 1;
  if (phaseAngle >= Math.PI - UNIT_EPSILON) return 0;
  return clamp01((
    Math.sin(phaseAngle)
    + (Math.PI - phaseAngle) * Math.cos(phaseAngle)
  ) / Math.PI);
}

function wrappedRadians(turns: number): number {
  return positiveModulo(turns, 1) * TAU;
}

/**
 * Maps a UTC instant to unbounded authored scene time.
 *
 * One unit is one 24-minute authored synodic cycle. The result deliberately
 * does not wrap, so Earth rotation, cloud drift, and libration remain
 * continuous across authored cycle boundaries.
 */
export function sceneTimeFromTimestamp(timestampMs: number): number {
  assertFinite(timestampMs, 'timestampMs');
  return (timestampMs - AUTHORED_SCENE_EPOCH_MS) / AUTHORED_SCENE_CYCLE_MS;
}

/** Date-compatible wrapper around sceneTimeFromTimestamp. */
export function sceneTimeFromDate(now: Date | number = Date.now()): number {
  return sceneTimeFromTimestamp(typeof now === 'number' ? now : now.getTime());
}

/** Presentation label derived from physical solar elevation and travel direction. */
export function scenePhaseFromTime(sceneTime: number): ScenePhase {
  const cycle = cycleFromSceneTime(sceneTime);
  return scenePhaseFromDirection(sunDirectionFromCycle(cycle));
}

/**
 * Formats elapsed position inside the 24-minute authored cycle as MM:SS.
 * This is a scene-cycle coordinate, not terrestrial local time.
 */
export function formatSceneTime(sceneTime: number): string {
  const cycle = cycleFromSceneTime(sceneTime);
  const elapsedSeconds = Math.floor(cycle * AUTHORED_SCENE_CYCLE_MS / 1_000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Derives every time-varying celestial value from one authored scene time.
 *
 * Canonical states:
 * - 0.00: lunar night, full Earth
 * - 0.25: lunar dawn, approximately half Earth
 * - 0.50: lunar daylight maximum, new Earth
 * - 0.75: lunar dusk, approximately half Earth
 *
 * Libration gives the quarter-cycle Earth phases their small physical offset
 * from exactly one half.
 */
export function deriveLunarSkyState(sceneTime: number): LunarSkyState {
  const cycle = cycleFromSceneTime(sceneTime);
  const sunDirection = sunDirectionFromCycle(cycle);
  const librationLongitude = LIBRATION_LONGITUDE_AMPLITUDE
    * Math.sin(TAU * sceneTime * LIBRATION_LONGITUDE_TURNS_PER_CYCLE);
  const librationLatitude = LIBRATION_LATITUDE_AMPLITUDE
    * Math.sin(TAU * sceneTime * LIBRATION_LATITUDE_TURNS_PER_CYCLE);
  const earthDirection = earthDirectionFromLibration(
    librationLongitude,
    librationLatitude,
  );
  const sunElevation = Math.asin(sunDirection[2]);
  const horizontalLength = Math.hypot(sunDirection[0], sunDirection[1]);
  const sunAzimuth = horizontalLength <= UNIT_EPSILON
    ? 0
    : Math.atan2(sunDirection[0], sunDirection[1]);
  const lunarIllumination = Math.max(sunDirection[2], 0);

  const sunEarthDot = Math.min(Math.max(
    sunDirection[0] * earthDirection[0]
      + sunDirection[1] * earthDirection[1]
      + sunDirection[2] * earthDirection[2],
    -1,
  ), 1);
  const earthPhase = clamp01((1 - sunEarthDot) / 2);
  const earthPhaseAngle = Math.acos(-sunEarthDot);
  const earthshine = lambertSpherePhase(earthPhaseAngle);

  const earthRotation = wrappedRadians(sceneTime * EARTH_TURNS_PER_AUTHORED_CYCLE);
  const cloudRotation = wrappedRadians(sceneTime * CLOUD_TURNS_PER_AUTHORED_CYCLE);

  return {
    sceneTime,
    cycle,
    scenePhase: scenePhaseFromDirection(sunDirection),
    earthDirection,
    sunDirection,
    sunElevation,
    sunAzimuth,
    lunarIllumination,
    earthPhase,
    earthshine,
    earthRotation,
    cloudRotation,
    libration: {
      longitude: librationLongitude,
      latitude: librationLatitude,
    },
  };
}
