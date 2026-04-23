import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAppendWorldHistoryInput,
  parseCommitWorldStateInput,
} from '../src/shell/renderer/infra/bootstrap/world-capabilities';

function buildCommitEnvelope() {
  return {
    worldId: 'world-1',
    appId: 'forge',
    sessionId: 'session-1',
    effectClass: 'STATE_AND_HISTORY' as const,
    scope: 'WORLD' as const,
    schemaId: 'forge.world.publish',
    schemaVersion: '1',
    actorRefs: [{ actorId: 'user-1', actorType: 'USER', role: 'creator' }],
    reason: 'publish',
  };
}

test('parseCommitWorldStateInput rejects invalid commit scope without fallback', () => {
  assert.throws(
    () => parseCommitWorldStateInput({
      commit: {
        ...buildCommitEnvelope(),
        scope: 'INVALID_SCOPE',
      },
      writes: [{
        scope: 'WORLD',
        scopeKey: 'world-1',
        payload: { name: 'Realm' },
      }],
      reason: 'sync',
    }, 'WORLD_STATE_COMMIT_INPUT_REQUIRED'),
    /WORLD_STATE_COMMIT_INPUT_REQUIRED/,
  );
});

test('parseCommitWorldStateInput rejects invalid write scope without defaulting to WORLD', () => {
  assert.throws(
    () => parseCommitWorldStateInput({
      commit: buildCommitEnvelope(),
      writes: [{
        scope: 'INVALID_SCOPE',
        scopeKey: 'world-1',
        payload: { name: 'Realm' },
      }],
      reason: 'sync',
    }, 'WORLD_STATE_COMMIT_INPUT_REQUIRED'),
    /WORLD_STATE_COMMIT_INPUT_REQUIRED/,
  );
});

test('parseCommitWorldStateInput rejects retired MEMORY_ONLY effectClass', () => {
  assert.throws(
    () => parseCommitWorldStateInput({
      commit: {
        ...buildCommitEnvelope(),
        effectClass: 'MEMORY_ONLY',
      },
      writes: [{
        scope: 'WORLD',
        scopeKey: 'world-1',
        payload: { name: 'Realm' },
      }],
      reason: 'sync',
    }, 'WORLD_STATE_COMMIT_INPUT_REQUIRED'),
    /WORLD_STATE_COMMIT_INPUT_REQUIRED/,
  );
});

test('parseAppendWorldHistoryInput rejects invalid visibility', () => {
  assert.throws(
    () => parseAppendWorldHistoryInput({
      commit: buildCommitEnvelope(),
      historyAppends: [{
        eventType: 'WORLD_EVENT',
        title: 'Launch',
        happenedAt: '2026-03-22T00:00:00.000Z',
        visibility: 'SECRET',
        relatedStateRefs: [{
          recordId: 'state-1',
          scope: 'WORLD',
          scopeKey: 'world-1',
        }],
      }],
      reason: 'append-history',
    }, 'WORLD_HISTORY_APPEND_INPUT_REQUIRED'),
    /WORLD_HISTORY_APPEND_INPUT_REQUIRED/,
  );
});

test('parseAppendWorldHistoryInput rejects missing relatedStateRefs', () => {
  assert.throws(
    () => parseAppendWorldHistoryInput({
      commit: buildCommitEnvelope(),
      historyAppends: [{
        eventType: 'WORLD_EVENT',
        title: 'Launch',
        happenedAt: '2026-03-22T00:00:00.000Z',
        visibility: 'WORLD',
      }],
      reason: 'append-history',
    }, 'WORLD_HISTORY_APPEND_INPUT_REQUIRED'),
    /WORLD_HISTORY_APPEND_INPUT_REQUIRED/,
  );
});

test('parseAppendWorldHistoryInput rejects invalid relatedStateRefs scope', () => {
  assert.throws(
    () => parseAppendWorldHistoryInput({
      commit: buildCommitEnvelope(),
      historyAppends: [{
        eventType: 'WORLD_EVENT',
        title: 'Launch',
        happenedAt: '2026-03-22T00:00:00.000Z',
        visibility: 'WORLD',
        relatedStateRefs: [{
          recordId: 'state-1',
          scope: 'INVALID_SCOPE',
          scopeKey: 'world-1',
        }],
      }],
      reason: 'append-history',
    }, 'WORLD_HISTORY_APPEND_INPUT_REQUIRED'),
    /WORLD_HISTORY_APPEND_INPUT_REQUIRED/,
  );
});
