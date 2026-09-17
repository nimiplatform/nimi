import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeSimulatorSeed,
  drawSimulatorRandom,
  simulatorRandomFromSnapshot,
  simulatorRandomToSnapshot,
} from '../../src/state-engine/random.ts';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { canonicalizeJson } from '../../src/state-engine/json-value.ts';
import {
  FIXTURE_SEED,
  fixtureModule,
  fixtureScenario,
  registerFixtureModule,
  SHELL_ISSUER,
} from './fixtures.mjs';

// ---------------------------------------------------------------------------
// Independent two-limb (uint32 pair) xoshiro256** reference implementation.
// Cross-verifies the normative masked-bigint implementation.
// ---------------------------------------------------------------------------

function limbsFromHex(word) {
  return [Number(`0x${word.slice(0, 8)}`) >>> 0, Number(`0x${word.slice(8, 16)}`) >>> 0];
}

function rotlLimb([hi, lo], shift) {
  if (shift === 0) return [hi, lo];
  if (shift < 32) {
    return [((hi << shift) | (lo >>> (32 - shift))) >>> 0, ((lo << shift) | (hi >>> (32 - shift))) >>> 0];
  }
  const s = shift - 32;
  return [((lo << s) | (hi >>> (32 - s))) >>> 0, ((hi << s) | (lo >>> (32 - s))) >>> 0];
}

function xorLimb([ah, al], [bh, bl]) {
  return [(ah ^ bh) >>> 0, (al ^ bl) >>> 0];
}

function addLimb([ah, al], [bh, bl]) {
  const lo = (al + bl) >>> 0;
  const carry = lo < al ? 1 : 0;
  return [(ah + bh + carry) >>> 0, lo];
}

function shiftLeftLimb([hi, lo], shift) {
  if (shift === 0) return [hi, lo];
  if (shift < 32) return [((hi << shift) | (lo >>> (32 - shift))) >>> 0, (lo << shift) >>> 0];
  return [(lo << (shift - 32)) >>> 0, 0];
}

function multiplySmall(word, multiplier) {
  // multiplier is 5 or 9: x*5 = (x<<2)+x; x*9 = (x<<3)+x.
  const shift = multiplier === 5 ? 2 : 3;
  return addLimb(shiftLeftLimb(word, shift), word);
}

function twoLimbDraw(state) {
  const output = multiplySmall(rotlLimb(multiplySmall(state.s[1], 5), 7), 9);
  const t = shiftLeftLimb(state.s[1], 17);
  state.s[2] = xorLimb(state.s[2], state.s[0]);
  state.s[3] = xorLimb(state.s[3], state.s[1]);
  state.s[1] = xorLimb(state.s[1], state.s[2]);
  state.s[0] = xorLimb(state.s[0], state.s[3]);
  state.s[2] = xorLimb(state.s[2], t);
  state.s[3] = rotlLimb(state.s[3], 45);
  // value = Number(output >> 11) / 2^53; >> 11 keeps the top 53 bits.
  const top53 = (output[0] * 2 ** 21) + (output[1] >>> 11);
  return top53 / 9007199254740992;
}

function twoLimbFromSeed(seed) {
  return {
    s: [0, 1, 2, 3].map((index) => limbsFromHex(seed.slice(index * 16, (index + 1) * 16))),
  };
}

const SEEDS = [
  FIXTURE_SEED,
  '01'.repeat(32),
  'ff'.repeat(32),
  '0123456789abcdeffedcba9876543210aaaabbbbccccdddd1111222233334444',
];

test('normative bigint and two-limb implementations agree over long draw runs', () => {
  for (const seed of SEEDS) {
    const normative = decodeSimulatorSeed(seed);
    const reference = twoLimbFromSeed(seed);
    for (let draw = 0; draw < 1024; draw += 1) {
      const expected = twoLimbDraw(reference);
      const actual = drawSimulatorRandom(normative);
      assert.equal(actual, expected, `seed ${seed.slice(0, 8)} draw ${draw}`);
      assert.ok(actual >= 0 && actual < 1);
    }
  }
});

test('locked known-answer vectors for xoshiro256ss-v1', () => {
  const vectors = new Map();
  for (const seed of SEEDS) {
    const state = decodeSimulatorSeed(seed);
    const draws = [];
    for (let index = 0; index < 8; index += 1) draws.push(drawSimulatorRandom(state));
    vectors.set(seed.slice(0, 16), draws.map((value) => value.toPrecision(17)));
  }
  // Generated from the normative implementation, cross-verified against the
  // two-limb implementation above and an independent arbitrary-precision
  // implementation. Any arithmetic drift fails this test.
  assert.deepEqual(vectors.get('0123456789abcdef'), [
    '0.40000000000000002',
    '0.99414053559166848',
    '0.72382212132661128',
    '0.13032258990175738',
    '0.59844466812777874',
    '0.99229309642112817',
    '0.13142719317942608',
    '0.64159619445622196',
  ]);
  assert.deepEqual(vectors.get('a1b2c3d4e5f60718'), [
    '0.62352941176470533',
    '0.62352941176470533',
    '0.24706016982508983',
    '0.38754561789812525',
    '0.17917057052996210',
    '0.18400818659970208',
    '0.96583832740749775',
    '0.11642281191174320',
  ]);
});

test('identical seeds and commands produce identical draws; different seeds differ', async () => {
  async function runDraws(seed) {
    const engine = createSimulatorStateEngine({
      scenario: fixtureScenario({ seed }),
    });
    registerFixtureModule(engine, fixtureModule());
    await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
    for (let index = 0; index < 4; index += 1) {
      await engine.acceptCommand('increment-with-random', { scale: 1000 }, SHELL_ISSUER);
    }
    const committed = await engine.acceptQuery('read-counter', {}, SHELL_ISSUER);
    return { counter: committed.value.counter, random: engine.getCommitted().random };
  }
  const first = await runDraws(FIXTURE_SEED);
  const second = await runDraws(FIXTURE_SEED);
  assert.equal(first.counter, second.counter);
  assert.deepEqual(first.random, second.random);
  const different = await runDraws('02'.repeat(32));
  assert.notEqual(different.counter, first.counter);
});

test('canonical random JSON never contains bigint and round-trips exactly', () => {
  const state = decodeSimulatorSeed(FIXTURE_SEED);
  for (let index = 0; index < 17; index += 1) drawSimulatorRandom(state);
  const snapshot = simulatorRandomToSnapshot(state);
  const canonical = canonicalizeJson(snapshot);
  assert.equal(typeof snapshot.drawCount, 'number');
  assert.doesNotMatch(canonical, /[0-9]n[,\]}]/);
  assert.match(canonical, /^\{"drawCount":[0-9]+,"generator":"xoshiro256ss-v1","state":\["[0-9a-f]{16}","[0-9a-f]{16}","[0-9a-f]{16}","[0-9a-f]{16}"\]}$/);
  const restored = simulatorRandomFromSnapshot(JSON.parse(canonical));
  assert.deepEqual(simulatorRandomToSnapshot(restored), snapshot);
});

test('snapshot validation fails closed', () => {
  assert.throws(() => simulatorRandomFromSnapshot({ generator: 'xoshiro256ss-v2', state: ['00'.repeat(8), '00'.repeat(8), '00'.repeat(8), '01'.repeat(8)], drawCount: 0 }), /generator/);
  assert.throws(() => simulatorRandomFromSnapshot({ generator: 'xoshiro256ss-v1', state: ['00'.repeat(8), '00'.repeat(8), '00'.repeat(8), '00'.repeat(8)], drawCount: 0 }), /all zero/);
  assert.throws(() => simulatorRandomFromSnapshot({ generator: 'xoshiro256ss-v1', state: ['AA'.repeat(8), '00'.repeat(8), '00'.repeat(8), '01'.repeat(8)], drawCount: 0 }), /16 lowercase/);
  assert.throws(() => simulatorRandomFromSnapshot({ generator: 'xoshiro256ss-v1', state: ['00'.repeat(8), '00'.repeat(8), '00'.repeat(8), '01'.repeat(8)], drawCount: -1 }), /non-negative/);
});

test('draw count is committed with the transaction and rolls back on failure', async () => {
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario() });
  registerFixtureModule(engine, fixtureModule());
  await engine.acceptCommand('simulator.behavior.activate', { moduleId: 'fixture-module' }, SHELL_ISSUER);
  assert.equal(engine.getCommitted().random.drawCount, 0);
  await engine.acceptCommand('increment-with-random', { scale: 10 }, SHELL_ISSUER);
  assert.equal(engine.getCommitted().random.drawCount, 1);
  // A failed payload validation draws nothing and commits nothing.
  await engine.acceptCommand('increment-with-random', { scale: 0 }, SHELL_ISSUER);
  assert.equal(engine.getCommitted().random.drawCount, 1);
});
