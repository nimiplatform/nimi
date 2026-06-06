import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeRequestMetadata,
  buildRuntimeTargetCallOptions,
  createRuntimeTraceId,
} from '../../src/runtime/runtime-call-options.js';

test('runtime call options build app-facing metadata without owning route truth', () => {
  let index = 0;
  const createTraceId = (prefix = 'runtime-call') => `${prefix}-${++index}`;

  const metadata = buildRuntimeRequestMetadata({
    connectorId: 'connector-1',
    createTraceId,
  });
  assert.deepEqual(metadata, {
    traceId: 'runtime-call-1',
    'x-nimi-trace-id': 'runtime-call-1',
    keySource: 'managed',
  });

  const options = buildRuntimeTargetCallOptions({
    targetId: 'settings.preview',
    timeoutMs: 5000,
    callerKind: 'third-party-app',
    surfaceId: 'tester.settings',
    connectorId: 'connector-1',
    createTraceId,
  });

  assert.equal(options.timeoutMs, 5000);
  assert.equal(options.idempotencyKey, 'runtime-idem-3');
  assert.deepEqual(options.metadata, {
    traceId: 'runtime-call-2',
    callerKind: 'third-party-app',
    callerId: 'target:settings.preview',
    surfaceId: 'tester.settings',
    keySource: 'managed',
  });
});

test('runtime call options support explicit trace and idempotency keys', () => {
  const options = buildRuntimeTargetCallOptions({
    targetId: '',
    timeoutMs: 1000,
    callerKind: 'desktop-core',
    surfaceId: 'desktop.renderer',
    traceId: 'trace-explicit',
    idempotencyKey: 'idem-explicit',
  });

  assert.equal(options.idempotencyKey, 'idem-explicit');
  assert.equal(options.metadata.traceId, 'trace-explicit');
  assert.equal(options.metadata.callerId, 'target:unknown');
  assert.equal(options.metadata.keySource, undefined);
});

test('createRuntimeTraceId uses SDK client IDs', () => {
  assert.match(createRuntimeTraceId('runtime-call'), /^runtime-call-[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.match(createRuntimeTraceId('runtime-idem'), /^runtime-idem-[0-9A-HJKMNP-TV-Z]{26}$/);
});
