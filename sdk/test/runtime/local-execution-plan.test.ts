import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import {
  normalizeLocalRuntimeExecutionEntryKind,
  parseLocalRuntimeExecutionPlan,
} from '../../src/runtime/index.js';

test('parseLocalRuntimeExecutionPlan normalizes device profile and selections', () => {
  const parsed = parseLocalRuntimeExecutionPlan({
    planId: 'plan-1',
    targetId: 'test-ai',
    capability: 'chat',
    deviceProfile: {
      os: 'darwin',
      arch: 'arm64',
      gpu: { available: true, vendor: 'Apple' },
      python: { available: true, version: '3.12.1' },
      npu: { available: true, ready: false, detail: 'warming' },
      diskFreeBytes: 12345,
      ports: [{ port: 8080, available: true }, { port: -1, available: false }],
    },
    entries: [
      {
        entryId: 'dep-model',
        kind: 'LOCAL_EXECUTION_ENTRY_KIND_MODEL',
        capability: 'chat',
        required: true,
        selected: true,
        preferred: true,
        warnings: ['prefer-verified'],
      },
    ],
    selectionRationale: [
      {
        entryId: 'dep-model',
        selected: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        detail: 'verified model matched',
      },
    ],
    preflightDecisions: [
      {
        entryId: 'dep-model',
        target: 'python',
        check: 'python_available',
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        detail: 'python detected',
      },
    ],
    warnings: ['npu-unavailable'],
  });

  assert.equal(parsed.deviceProfile.arch, 'arm64');
  assert.deepEqual(parsed.deviceProfile.ports, [{ port: 8080, available: true }]);
  assert.equal(parsed.entries[0]?.kind, 'asset');
  assert.equal(parsed.selectionRationale[0]?.reasonCode, ReasonCode.ACTION_EXECUTED);
  assert.equal(parsed.preflightDecisions[0]?.check, 'python_available');
});

test('normalizeLocalRuntimeExecutionEntryKind projects Runtime wire enums', () => {
  assert.equal(normalizeLocalRuntimeExecutionEntryKind(2), 'service');
  assert.equal(normalizeLocalRuntimeExecutionEntryKind('3'), 'node');
  assert.equal(
    normalizeLocalRuntimeExecutionEntryKind('LOCAL_EXECUTION_ENTRY_KIND_MODEL'),
    'asset',
  );
});
