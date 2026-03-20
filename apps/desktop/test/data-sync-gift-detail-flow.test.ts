import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGiftTransaction } from '../src/runtime/data-sync/flows/economy-notification-flow.js';

type DataSyncError = {
  action: string;
  error: unknown;
  details?: Record<string, unknown>;
};

function createEmitter(errors: DataSyncError[]) {
  return (action: string, error: unknown, details?: Record<string, unknown>) => {
    errors.push({ action, error, details });
  };
}

test('loadGiftTransaction uses the typed single-detail API', async () => {
  let receivedListCalls = 0;
  let sentListCalls = 0;
  let detailCalls = 0;

  const result = await loadGiftTransaction(
    async (task) => task({
      services: {
        EconomyCurrencyGiftsService: {
          economyControllerGetGiftTransaction: async (giftTransactionId: string) => {
            detailCalls += 1;
            return {
              id: giftTransactionId,
              status: 'PENDING',
            };
          },
          economyControllerGetReceivedGifts: async () => {
            receivedListCalls += 1;
            return { items: [] };
          },
          economyControllerGetSentGifts: async () => {
            sentListCalls += 1;
            return { items: [] };
          },
        },
      },
    } as never),
    () => undefined,
    'gift-1',
  );

  assert.equal(result.id, 'gift-1');
  assert.equal(detailCalls, 1);
  assert.equal(receivedListCalls, 0);
  assert.equal(sentListCalls, 0);
});

test('loadGiftTransaction fails close on invalid detail payloads', async () => {
  const errors: DataSyncError[] = [];

  await assert.rejects(
    () => loadGiftTransaction(
      async () => 'invalid-detail' as never,
      createEmitter(errors),
      'gift-1',
    ),
    /GIFT_TRANSACTION_CONTRACT_INVALID/,
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-gift-transaction');
});

test('loadGiftTransaction surfaces not-found errors from the detail API', async () => {
  const errors: DataSyncError[] = [];

  await assert.rejects(
    () => loadGiftTransaction(
      async () => {
        throw new Error('GIFT_TRANSACTION_NOT_FOUND');
      },
      createEmitter(errors),
      'gift-missing',
    ),
    /GIFT_TRANSACTION_NOT_FOUND/,
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-gift-transaction');
  assert.deepEqual(errors[0]!.details, { id: 'gift-missing' });
});
