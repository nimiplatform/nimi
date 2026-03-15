import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const worldFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/runtime/data-sync/flows/world-flow.ts'),
  'utf8',
);

const socialFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/runtime/data-sync/flows/social-flow.ts'),
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

  test('D-DSYNC-005: loadWorldEvents exists in source', () => {
    assert.ok(
      worldFlowSource.includes('export async function loadWorldEvents'),
      'loadWorldEvents must be exported from world-flow',
    );
  });

  test('D-DSYNC-005: loadWorldEvents uses the public WorldsService endpoint', () => {
    assert.ok(
      worldFlowSource.includes('realm.services.WorldsService.worldControllerGetWorldEvents'),
      'loadWorldEvents must use the public WorldsService world events endpoint',
    );
    assert.ok(
      !worldFlowSource.includes('realm.services.WorldControlService.worldControlControllerListWorldEvents'),
      'loadWorldEvents must not depend on the maintainer-only WorldControlService endpoint',
    );
  });

  test('D-DSYNC-005: public world asset loaders use the public WorldsService endpoints', () => {
    assert.ok(
      worldFlowSource.includes('export async function loadWorldLorebooks'),
      'loadWorldLorebooks must be exported from world-flow',
    );
    assert.ok(
      worldFlowSource.includes('export async function loadWorldScenes'),
      'loadWorldScenes must be exported from world-flow',
    );
    assert.ok(
      worldFlowSource.includes('export async function loadWorldMediaBindings'),
      'loadWorldMediaBindings must be exported from world-flow',
    );
    assert.ok(
      worldFlowSource.includes('export async function loadWorldMutations'),
      'loadWorldMutations must be exported from world-flow',
    );
    assert.ok(
      worldFlowSource.includes('realm.services.WorldsService.worldControllerGetWorldLorebooks'),
      'loadWorldLorebooks must use the public WorldsService lorebooks endpoint',
    );
    assert.ok(
      worldFlowSource.includes('realm.services.WorldsService.worldControllerGetWorldScenes'),
      'loadWorldScenes must use the public WorldsService scenes endpoint',
    );
    assert.ok(
      worldFlowSource.includes('realm.services.WorldsService.worldControllerGetWorldMediaBindings'),
      'loadWorldMediaBindings must use the public WorldsService media bindings endpoint',
    );
    assert.ok(
      worldFlowSource.includes('realm.services.WorldsService.worldControllerGetWorldMutations'),
      'loadWorldMutations must use the public WorldsService mutations endpoint',
    );
  });
});

describe('D-DSYNC-011: agent ownership flow source scanning', () => {
  test('D-DSYNC-011: loadMyAgents exists in source', () => {
    assert.ok(
      socialFlowSource.includes('export async function loadCreatorAgents'),
      'loadCreatorAgents (backing loadMyAgents) must be exported from social-flow',
    );
  });
});
