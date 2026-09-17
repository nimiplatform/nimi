/**
 * xoshiro256ss-v1 deterministic randomness with canonical JSON state.
 *
 * Authority: tables/simulator-state-engine-policy.yaml `random` surface and
 * P-SIM-012 (seeded randomness). Arithmetic uses JavaScript bigint masked to
 * uint64 with `(1n << 64n) - 1n`. Committed JSON never contains bigint.
 */

import type { JsonValue } from './json-value.ts';

const MASK64 = (1n << 64n) - 1n;
const SEED_PATTERN = /^[0-9a-f]{64}$/;
const STATE_WORD_PATTERN = /^[0-9a-f]{16}$/;

export interface SimulatorRandomSnapshotV1 {
  readonly generator: 'xoshiro256ss-v1';
  readonly state: readonly [string, string, string, string];
  readonly drawCount: number;
}

export interface SimulatorRandomState {
  s0: bigint;
  s1: bigint;
  s2: bigint;
  s3: bigint;
  drawCount: number;
}

export class SimulatorRandomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulatorRandomError';
  }
}

export function decodeSimulatorSeed(seed: string): SimulatorRandomState {
  if (typeof seed !== 'string' || !SEED_PATTERN.test(seed)) {
    throw new SimulatorRandomError('scenario seed must be exactly 64 lowercase hexadecimal characters');
  }
  if (seed === '0'.repeat(64)) {
    throw new SimulatorRandomError('scenario seed must not be the all-zero value');
  }
  const words: bigint[] = [];
  for (let index = 0; index < 4; index += 1) {
    words.push(BigInt(`0x${seed.slice(index * 16, (index + 1) * 16)}`));
  }
  return { s0: words[0], s1: words[1], s2: words[2], s3: words[3], drawCount: 0 };
}

function rotl(value: bigint, shift: bigint): bigint {
  return ((value << shift) | (value >> (64n - shift))) & MASK64;
}

/**
 * One v1 draw. Mutates `state` in place and returns
 * `Number(outputWord >> 11n) / 9007199254740992` in [0, 1).
 */
export function drawSimulatorRandom(state: SimulatorRandomState): number {
  if (!Number.isSafeInteger(state.drawCount) || state.drawCount < 0 || state.drawCount >= Number.MAX_SAFE_INTEGER) {
    throw new SimulatorRandomError('random draw count overflow');
  }
  const output = (rotl((state.s1 * 5n) & MASK64, 7n) * 9n) & MASK64;
  const t = (state.s1 << 17n) & MASK64;
  state.s2 = (state.s2 ^ state.s0) & MASK64;
  state.s3 = (state.s3 ^ state.s1) & MASK64;
  state.s1 = (state.s1 ^ state.s2) & MASK64;
  state.s0 = (state.s0 ^ state.s3) & MASK64;
  state.s2 = (state.s2 ^ t) & MASK64;
  state.s3 = rotl(state.s3, 45n);
  state.drawCount += 1;
  return Number(output >> 11n) / 9007199254740992;
}

function encodeWord(word: bigint): string {
  return word.toString(16).padStart(16, '0');
}

export function simulatorRandomToSnapshot(state: SimulatorRandomState): SimulatorRandomSnapshotV1 {
  if (!Number.isSafeInteger(state.drawCount) || state.drawCount < 0) {
    throw new SimulatorRandomError('random draw count is not a non-negative safe integer');
  }
  return {
    generator: 'xoshiro256ss-v1',
    state: [encodeWord(state.s0), encodeWord(state.s1), encodeWord(state.s2), encodeWord(state.s3)],
    drawCount: state.drawCount,
  };
}

export function simulatorRandomFromSnapshot(snapshot: SimulatorRandomSnapshotV1): SimulatorRandomState {
  if (!snapshot || snapshot.generator !== 'xoshiro256ss-v1') {
    throw new SimulatorRandomError('unknown random generator version');
  }
  if (!Array.isArray(snapshot.state) || snapshot.state.length !== 4) {
    throw new SimulatorRandomError('random snapshot must contain exactly four state words');
  }
  for (const word of snapshot.state) {
    if (typeof word !== 'string' || !STATE_WORD_PATTERN.test(word)) {
      throw new SimulatorRandomError('random state words must be exactly 16 lowercase hexadecimal characters');
    }
  }
  if (!Number.isSafeInteger(snapshot.drawCount) || snapshot.drawCount < 0) {
    throw new SimulatorRandomError('random draw count is not a non-negative safe integer');
  }
  const [s0, s1, s2, s3] = snapshot.state.map((word) => BigInt(`0x${word}`));
  if (s0 === 0n && s1 === 0n && s2 === 0n && s3 === 0n) {
    throw new SimulatorRandomError('random snapshot state must not be all zero');
  }
  return { s0, s1, s2, s3, drawCount: snapshot.drawCount };
}

export function simulatorRandomSnapshotAsJson(snapshot: SimulatorRandomSnapshotV1): JsonValue {
  return {
    generator: snapshot.generator,
    state: [...snapshot.state],
    drawCount: snapshot.drawCount,
  };
}
