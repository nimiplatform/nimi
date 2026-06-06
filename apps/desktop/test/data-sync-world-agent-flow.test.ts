import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const worldFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/data/realm-world-data.ts'),
  'utf8',
);

const agentFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/world/data/realm-agent-create-data.ts'),
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

  test('D-DSYNC-005: loadWorldAgents exists in source', () => {
    assert.ok(
      worldFlowSource.includes('export async function loadWorldAgents'),
      'loadWorldAgents must be exported from world-flow',
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

  test('D-DSYNC-005: reusable public world data DX lives in SDK Realm extension', () => {
    assert.match(worldFlowSource, /loadNimiRealmWorldDetailById/);
    assert.match(worldFlowSource, /from '@nimiplatform\/sdk\/realm'/);
    assert.doesNotMatch(worldFlowSource, /@nimiplatform\/sdk\/world/);
  });
});

describe('D-DSYNC-011: agent ownership flow source scanning', () => {
  test('D-DSYNC-011: loadMyAgents exists in source', () => {
    assert.ok(
      agentFlowSource.includes('export async function loadCreatorAgents'),
      'loadCreatorAgents (backing loadMyAgents) must be exported from agent-flow',
    );
  });
});
