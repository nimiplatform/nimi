import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorldEvolutionSelectorReadFacade, type WorldEvolutionSelectorReadProvider } from '../src/internal/world-evolution-selector-read.js';

test('executionEvents.read returns only selector, matchMode, and matches', async () => {
  const facade = createWorldEvolutionSelectorReadFacade(() => ({
    executionEvents: {
      read: async () => [{
        eventId: 'evt-result-1',
        worldId: 'world-result-1',
        appId: 'app-result-1',
        sessionId: 'session-result-1',
        traceId: 'trace-result-1',
        tick: 9,
        timestamp: '2026-04-08T00:00:00.000Z',
        eventKind: 'EXECUTION_EVENT',
        stage: 'COMMIT_REQUEST',
        actorRefs: [{ actorId: 'actor-1', actorType: 'AGENT' }],
        causation: null,
        correlation: null,
        effectClass: 'STATE_ONLY',
        reason: 'result-shape',
        evidenceRefs: [{ kind: 'event', refId: 'evt-result-1' }],
        detail: {
          kind: 'commit-request-candidate',
          checkpointRef: 'chk-1',
        },
      }],
    },
    replays: { read: async () => [] },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: { read: async () => [] },
  }));

  const result = await facade.executionEvents.read({ eventId: 'evt-result-1' });
  assert.deepEqual(Object.keys(result).sort(), ['matchMode', 'matches', 'selector']);
  assert.equal(result.matchMode, 'exact');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.detail?.kind, 'commit-request-candidate');
});

test('commitRequests.read returns adapter-bound commit request views only', async () => {
  const facade = createWorldEvolutionSelectorReadFacade(() => ({
    executionEvents: { read: async () => [] },
    replays: { read: async () => [] },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: {
      read: async () => [{
        worldId: 'world-commit-1',
        appId: 'app-commit-1',
        sessionId: 'session-commit-1',
        effectClass: 'STATE_AND_HISTORY',
        scope: 'WORLD',
        schemaId: 'schema-commit-1',
        schemaVersion: '1',
        actorRefs: [{ actorId: 'actor-commit-1', actorType: 'AGENT' }],
        reason: 'candidate',
        evidenceRefs: [{ kind: 'event', refId: 'evt-commit-1' }],
        sourceEventIds: ['evt-commit-1'],
        traceId: 'trace-commit-1',
        tick: 4,
      }],
    },
  }));

  const result = await facade.commitRequests.read({
    worldId: 'world-commit-1',
    appId: 'app-commit-1',
    sessionId: 'session-commit-1',
  });

  assert.equal(result.matchMode, 'filter');
  assert.equal(result.matches.length, 1);
  assert.deepEqual(Object.keys(result.matches[0] || {}).sort(), [
    'actorRefs',
    'appId',
    'effectClass',
    'evidenceRefs',
    'reason',
    'schemaId',
    'schemaVersion',
    'scope',
    'sessionId',
    'sourceEventIds',
    'tick',
    'traceId',
    'worldId',
  ]);
});

test('selector-read results reject unsupported projection widening', async () => {
  const provider: WorldEvolutionSelectorReadProvider = {
    executionEvents: {
      read: async () => [{
        eventId: 'evt-widening-1',
        worldId: 'world-widening-1',
        appId: 'app-widening-1',
        sessionId: 'session-widening-1',
        traceId: 'trace-widening-1',
        tick: 2,
        timestamp: '2026-04-08T00:00:00.000Z',
        eventKind: 'EXECUTION_EVENT',
        stage: 'EFFECT',
        actorRefs: [{ actorId: 'actor-1', actorType: 'AGENT' }],
        causation: null,
        correlation: null,
        effectClass: 'STATE_ONLY',
        reason: 'widening',
        evidenceRefs: [{ kind: 'event', refId: 'evt-widening-1' }],
        workflow: { leaked: true },
      }],
    },
    replays: { read: async () => [] },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: { read: async () => [] },
  };
  const facade = createWorldEvolutionSelectorReadFacade(() => provider);

  await assert.rejects(
    () => facade.executionEvents.read({ eventId: 'evt-widening-1' }),
    (error: unknown) => {
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'UNSUPPORTED_PROJECTION_SHAPE');
      return true;
    },
  );
});

test('selector-read results reject retired MEMORY_ONLY effectClass projections', async () => {
  const facade = createWorldEvolutionSelectorReadFacade(() => ({
    executionEvents: {
      read: async () => [{
        eventId: 'evt-memory-only-1',
        worldId: 'world-memory-only-1',
        appId: 'app-memory-only-1',
        sessionId: 'session-memory-only-1',
        traceId: 'trace-memory-only-1',
        tick: 1,
        timestamp: '2026-04-08T00:00:00.000Z',
        eventKind: 'EXECUTION_EVENT',
        stage: 'EFFECT',
        actorRefs: [{ actorId: 'actor-1', actorType: 'AGENT' }],
        causation: null,
        correlation: null,
        effectClass: 'MEMORY_ONLY',
        reason: 'memory-only-projection',
        evidenceRefs: [{ kind: 'event', refId: 'evt-memory-only-1' }],
      }],
    },
    replays: { read: async () => [] },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: { read: async () => [] },
  }));

  await assert.rejects(
    () => facade.executionEvents.read({ eventId: 'evt-memory-only-1' }),
    /unsupported effectClass/i,
  );
});
