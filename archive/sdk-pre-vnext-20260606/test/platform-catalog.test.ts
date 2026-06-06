import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  isAdmittedFirstRunLocalBaseline,
  loadPlatformAIProfileFactoryCatalog,
  loadPlatformAIProfileFactoryRows,
  selectFactoryAIProfileForFirstRun,
} from '../src/platform-catalog/index.js';

const FORBIDDEN_FACTORY_ROW_KEYS = /provider|connector|engine|model/i;

test('platform AIProfile factory rows are SDK projections without provider/model truth', () => {
  const rows = loadPlatformAIProfileFactoryRows();
  assert.deepEqual(rows, PLATFORM_AI_PROFILE_FACTORY_ROWS);
  assert.ok(rows.length > 0, 'expected generated Platform factory AIProfile rows');

  const aliases = rows.map((row) => row.alias).sort();
  assert.deepEqual(aliases, [
    'cloud-first',
    'hybrid-recommended',
    'local-gpu',
    'local-speech-ready',
    'local-standard',
  ]);

  for (const row of rows) {
    assert.equal(row.sourceRule, 'P-AIPS-002', `${row.alias} must preserve its source rule`);
    assert.equal(
      Object.keys(row).some((key) => FORBIDDEN_FACTORY_ROW_KEYS.test(key)),
      false,
      `${row.alias} must not expose provider/model authority fields`,
    );
  }
});

test('factory AIProfile catalog mirrors row capabilities without executable bindings', () => {
  const rows = loadPlatformAIProfileFactoryRows();
  const profiles = loadPlatformAIProfileFactoryCatalog();
  assert.equal(profiles.length, rows.length);

  for (const row of rows) {
    const profile = profiles.find((candidate) => candidate.profileId === row.alias);
    assert.ok(profile, `missing factory profile for ${row.alias}`);
    assert.deepEqual(Object.keys(profile.capabilities).sort(), [...row.capabilitySet].sort());
    for (const capability of Object.values(profile.capabilities)) {
      assert.equal(capability.targetRef, undefined);
    }
  }
});

test('first-run factory selection admits only local baseline rows by install level', () => {
  assert.equal(
    selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'minimal')?.alias,
    'local-speech-ready',
  );
  assert.equal(
    selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'recommended')?.alias,
    'local-gpu',
  );

  const firstRunRows = PLATFORM_AI_PROFILE_FACTORY_ROWS
    .filter((row) => row.applicableScopes.includes('first-run'));
  assert.ok(firstRunRows.length > 0, 'expected local first-run rows');

  for (const row of firstRunRows) {
    assert.ok(
      row.firstRunInstallLevels.includes('minimal') || row.firstRunInstallLevels.includes('recommended'),
      `${row.alias} must map to Minimal or Recommended`,
    );
    assert.notEqual(row.computePosture, 'cloud-only', `${row.alias} must not be cloud-only first-run`);
    assert.notEqual(row.routingPolicy, 'cloud-first', `${row.alias} must not be cloud-first first-run`);
    assert.notEqual(row.routingPolicy, 'hybrid-explicit', `${row.alias} must not be hybrid first-run`);
    assert.equal(row.capabilitySet.includes('video.generate'), false, `${row.alias} must not be video first-run`);
    assert.equal(isAdmittedFirstRunLocalBaseline(row), true);
  }

  for (const alias of ['cloud-first', 'hybrid-recommended', 'local-standard']) {
    const row = PLATFORM_AI_PROFILE_FACTORY_ROWS.find((candidate) => candidate.alias === alias);
    assert.ok(row, `missing ${alias}`);
    assert.equal(isAdmittedFirstRunLocalBaseline(row), false);
  }
});
