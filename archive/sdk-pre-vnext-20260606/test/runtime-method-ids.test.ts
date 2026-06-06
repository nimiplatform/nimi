import assert from 'node:assert/strict';
import test from 'node:test';

import { RuntimeMethodIds } from '../src/runtime/method-ids.js';

// K5.1 — Wave-4 of topic 2026-05-10-runtime-knowledge-cognition-hard-cut.
// The SDK runtime.knowledge.* group is a product surface (per D6
// naming policy); its label intentionally stays "knowledge" to keep
// the developer-facing API stable. The wire-level transport target
// must be RuntimeCognitionService for every entry — there is no
// public RuntimeKnowledgeService and no future binding may
// reintroduce one.
test('runtime.knowledge.* method ids bind to RuntimeCognitionService', () => {
  const knowledgeIds = RuntimeMethodIds.knowledge;
  const entries = Object.entries(knowledgeIds);
  assert.ok(entries.length > 0, 'expected runtime.knowledge.* group to be populated');

  const expectedPrefix = '/nimi.runtime.v1.RuntimeCognitionService/';
  const forbiddenPrefix = '/nimi.runtime.v1.RuntimeKnowledgeService/';

  for (const [name, id] of entries) {
    assert.equal(
      typeof id,
      'string',
      `method id for runtime.knowledge.${name} must be a string`,
    );
    assert.ok(
      id.startsWith(expectedPrefix),
      `runtime.knowledge.${name} must bind under ${expectedPrefix}, got ${id}`,
    );
    assert.ok(
      !id.startsWith(forbiddenPrefix),
      `runtime.knowledge.${name} must not bind to retired RuntimeKnowledgeService, got ${id}`,
    );
  }
});

test('no runtime.knowledge.* method id contains the retired RuntimeKnowledgeService token', () => {
  for (const [name, id] of Object.entries(RuntimeMethodIds.knowledge)) {
    assert.ok(
      !id.includes('RuntimeKnowledgeService'),
      `runtime.knowledge.${name} must not include the retired RuntimeKnowledgeService identifier, got ${id}`,
    );
  }
});
