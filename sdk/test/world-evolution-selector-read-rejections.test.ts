import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorldEvolutionSelectorReadError,
  createWorldEvolutionSelectorReadFacade,
} from '../src/internal/world-evolution-selector-read.js';
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
