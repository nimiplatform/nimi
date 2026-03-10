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
});

describe('D-DSYNC-011: agent ownership flow source scanning', () => {
  test('D-DSYNC-011: loadMyAgents exists in source', () => {
    assert.ok(
      socialFlowSource.includes('export async function loadCreatorAgents'),
      'loadCreatorAgents (backing loadMyAgents) must be exported from social-flow',
    );
  });
});
