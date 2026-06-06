import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorldEvolutionSelectorReadError,
  createWorldEvolutionSelectorReadFacade,
} from '../src/internal/world-evolution-selector-read.js';
import { createMissingWorldEvolutionSelectorReadProvider } from '../src/runtime/index.js';
import { ReasonCode } from '../src/types/index.js';

test('selector-read missing provider rejects with BOUNDARY_DENIED', async () => {
  const facade = createWorldEvolutionSelectorReadFacade(() => null);

  await assert.rejects(
    () => facade.executionEvents.read({ eventId: 'evt-missing-provider' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_PERMISSION_DENIED);
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'BOUNDARY_DENIED');
      assert.equal((error as { details?: { methodId?: string } }).details?.methodId, 'worldEvolution.executionEvents.read');
      return true;
    },
  );
});

test('provider MISSING_REQUIRED_EVIDENCE maps through the shared rejection carrier', async () => {
  const facade = createWorldEvolutionSelectorReadFacade(() => ({
    executionEvents: {
      read: async () => {
        throw createWorldEvolutionSelectorReadError(
          'MISSING_REQUIRED_EVIDENCE',
          'worldEvolution.executionEvents.read',
          'missing recorded execution evidence',
        );
      },
    },
    replays: { read: async () => [] },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: { read: async () => [] },
  }));

  await assert.rejects(
    () => facade.executionEvents.read({ eventId: 'evt-missing-evidence' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_NOT_FOUND);
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'MISSING_REQUIRED_EVIDENCE');
      return true;
    },
  );
});

test('provider unknown failures fail closed as boundary denial', async () => {
  const facade = createWorldEvolutionSelectorReadFacade(() => ({
    executionEvents: {
      read: async () => {
        throw new Error('bridge exploded');
      },
    },
    replays: { read: async () => [] },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: { read: async () => [] },
  }));

  await assert.rejects(
    () => facade.executionEvents.read({ eventId: 'evt-provider-error' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_PERMISSION_DENIED);
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'BOUNDARY_DENIED');
      return true;
    },
  );
});

test('SDK missing world-evolution selector provider returns empty optional reads and rejects required evidence', async () => {
  const provider = createMissingWorldEvolutionSelectorReadProvider({
    backingBoundary: 'tester-world-evolution-selector-read',
  });

  assert.deepEqual(await provider.executionEvents.read({ worldId: 'world-1' }), []);
  assert.deepEqual(await provider.replays.read({ worldId: 'world-1' }), []);
  assert.deepEqual(await provider.commitRequests.read({ worldId: 'world-1' }), []);
  await assert.rejects(
    () => provider.checkpoints.read({ worldId: 'world-1' }),
    (error: unknown) => {
      const details = (error as { details?: Record<string, unknown> }).details || {};
      assert.equal(details.rejectionCategory, 'MISSING_REQUIRED_EVIDENCE');
      assert.equal(details.methodId, 'worldEvolution.checkpoints.read');
      assert.equal(details.backingBoundary, 'tester-world-evolution-selector-read');
      return true;
    },
  );
});
