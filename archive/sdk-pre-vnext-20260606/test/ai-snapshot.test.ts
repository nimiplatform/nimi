import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAISnapshotRecord,
  type AIConfig,
} from '../src/ai/index.js';

const SCOPE = { kind: 'app', ownerId: 'dev.nimi.tester', surfaceId: 'app-lab' } as const;

const CONFIG: AIConfig = {
  scopeRef: SCOPE,
  capabilities: {
    targetRefs: {
      'text.generate': {
        kind: 'local_runtime_target_ref',
        targetId: 'target-chat',
        profileId: 'profile-chat',
      },
    },
    selectedParams: {},
  },
  profileOrigin: null,
};

test('AISnapshot record uses the AIConfig scope as the evidence envelope scope', () => {
  const snapshot = createAISnapshotRecord({
    config: CONFIG,
    capability: 'text.generate',
    selectedTargetRef: CONFIG.capabilities.targetRefs['text.generate'] ?? null,
    executionId: 'exec-1',
    createdAt: '2026-06-02T00:00:00.000Z',
  });

  assert.deepEqual(snapshot.scopeRef, SCOPE);
  assert.deepEqual(snapshot.configEvidence.configSnapshot.scopeRef, SCOPE);
});

test('AISnapshot record rejects a scopeRef that does not match the AIConfig scope', () => {
  assert.throws(
    () => createAISnapshotRecord({
      scopeRef: { kind: 'app', ownerId: 'other.app' },
      config: CONFIG,
      capability: 'text.generate',
      selectedTargetRef: CONFIG.capabilities.targetRefs['text.generate'] ?? null,
    }),
    /AISnapshot scopeRef must match the embedded AIConfig scopeRef/,
  );
});
