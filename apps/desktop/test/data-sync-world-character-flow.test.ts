import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const worldFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/data/realm-world-data.ts'),
  'utf8',
);

describe('D-DSYNC-005: world flow source scanning', () => {
  test('D-DSYNC-005: loadWorldDetailById exists in source', () => {
    assert.ok(
      worldFlowSource.includes('export async function loadWorldDetailById'),
      'loadWorldDetailById must be exported from world-flow',
    );
  });

  test('D-DSYNC-005: loadWorldSemanticBundle exists in source', () => {
    assert.ok(
      worldFlowSource.includes('export async function loadWorldSemanticBundle'),
      'loadWorldSemanticBundle must be exported from world-flow',
    );
  });

  test('D-DSYNC-005: loadWorldCharacters exists in source', () => {
    assert.ok(
      worldFlowSource.includes('export async function loadWorldCharacters'),
      'loadWorldCharacters must be exported from world-flow',
    );
  });

  test('D-DSYNC-005: loadWorldHistory exists in source', () => {
    assert.ok(
      worldFlowSource.includes('export async function loadWorldHistory'),
      'loadWorldHistory must be exported from world-flow',
    );
  });

  test('D-DSYNC-005: public world asset loaders use the public WorldsService endpoints', () => {
    assert.ok(
      worldFlowSource.includes('export async function loadWorldLorebooks'),
      'loadWorldLorebooks must be exported from world-flow',
    );
    assert.ok(
      worldFlowSource.includes('export async function loadWorldBindings'),
      'loadWorldBindings must be exported from world-flow',
    );
  });

  test('D-DSYNC-005: public world data reads WorldCore and WorldCharacterCore surfaces', () => {
    assert.match(worldFlowSource, /worldCoreControllerGetWorldCore/);
    assert.match(worldFlowSource, /worldCoreControllerListWorldCharacters/);
    assert.match(worldFlowSource, /from '@nimiplatform\/sdk\/realm'/);
    assert.doesNotMatch(worldFlowSource, /@nimiplatform\/sdk\/world/);
    assert.doesNotMatch(worldFlowSource, /@nimiplatform\/sdk\/runtimeSource/);
  });
});

describe('D-DSYNC-011: old creator character flow is hard-cut', () => {
  test('D-DSYNC-011: runtime-source-create-data no longer exists', () => {
    assert.equal(
      existsSync(resolve(import.meta.dirname, '../src/shell/renderer/features/world/data/runtime-source-create-data.ts')),
      false,
    );
    assert.doesNotMatch(worldFlowSource, /createNimiRealmMasterCharacter|loadNimiRealmCreatorCharacters/);
  });
});
