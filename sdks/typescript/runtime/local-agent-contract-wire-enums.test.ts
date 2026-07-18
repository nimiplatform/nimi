import assert from 'node:assert/strict';
import test from 'node:test';

import * as runtimeWireTypes from './wire-types';

const LOCAL_AGENT_CONTRACT_ENUM_NAMES = [
  'AgentContextProjectionReasonCode',
  'AgentLocalSourceContextSchemaVersion',
  'AgentLocalSourceContextState',
  'AgentLocalSourceCoverageSection',
  'AgentLocalSourceCoverageState',
  'AgentLocalSourceSnapshotSchemaVersion',
  'AgentTurnContextCompilerSchemaVersion',
  'AgentTurnContextLaneId',
  'AgentTurnContextLaneState',
  'AgentTurnContextManifestSchemaVersion',
  'AgentTurnContextState',
  'AgentTurnContextSummarySchemaVersion',
  'AgentTurnContextTruncationReason',
] as const;

type KnownEnumPredicate = (value: unknown) => boolean;
type KnownEnumAssertion = (value: unknown) => number;

test('local-agent contract wire enums fail closed as an exact generated matrix', () => {
  const exports = runtimeWireTypes as unknown as Readonly<Record<string, unknown>>;
  const expectedPredicates = LOCAL_AGENT_CONTRACT_ENUM_NAMES.map((name) => `isKnown${name}`).sort();
  const expectedAssertions = LOCAL_AGENT_CONTRACT_ENUM_NAMES.map((name) => `assertKnown${name}`).sort();

  assert.deepEqual(
    Object.keys(exports).filter((name) => name.startsWith('isKnown')).sort(),
    expectedPredicates,
  );
  assert.deepEqual(
    Object.keys(exports).filter((name) => name.startsWith('assertKnown')).sort(),
    expectedAssertions,
  );

  for (const enumName of LOCAL_AGENT_CONTRACT_ENUM_NAMES) {
    const isKnown = exports[`isKnown${enumName}`] as KnownEnumPredicate;
    const assertKnown = exports[`assertKnown${enumName}`] as KnownEnumAssertion;
    assert.equal(typeof isKnown, 'function', enumName);
    assert.equal(typeof assertKnown, 'function', enumName);
    assert.equal(isKnown(0), true, enumName);
    assert.equal(assertKnown(0), 0, enumName);
    assert.equal(isKnown(2_147_483_647), false, enumName);
    assert.equal(isKnown(1.5), false, enumName);
    assert.equal(isKnown('0'), false, enumName);
    assert.throws(
      () => assertKnown(2_147_483_647),
      new RegExp(`Unknown ${enumName} numeric value: 2147483647`, 'u'),
    );
  }
});
