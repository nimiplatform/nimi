import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseGitBatchResponse,
  partitionGitBatchRows,
} from '../build/materialize.mjs';

test('Git blob batches are bounded by object count instead of spawning once per file', () => {
  const rows = Array.from({ length: 1_025 }, (_, index) => ({
    path: `file-${index}.ts`,
    mode: '100644',
    objectId: index.toString(16).padStart(40, '0'),
    size: 1,
  }));
  const batches = partitionGitBatchRows(rows);
  assert.deepEqual(batches.map((batch) => batch.length), [512, 512, 1]);
});

test('Git batch response parser preserves binary bytes and rejects protocol drift', () => {
  const objectId = 'a'.repeat(40);
  const bytes = Buffer.from([0x00, 0x0a, 0xff]);
  const row = { path: 'binary.bin', mode: '100755', objectId, size: bytes.length };
  const response = Buffer.concat([Buffer.from(`${objectId} blob ${bytes.length}\n`), bytes, Buffer.from('\n')]);
  assert.deepEqual(parseGitBatchResponse([row], response), [{
    path: row.path,
    mode: row.mode,
    objectId,
    bytes,
  }]);
  assert.throws(
    () => parseGitBatchResponse([row], Buffer.from(`${'b'.repeat(40)} blob 3\nabc\n`)),
    (error) => error?.code === 'SIM_SOURCE_BATCH_HEADER',
  );
  assert.throws(
    () => parseGitBatchResponse([row], Buffer.from(`${objectId} blob 4\nabc\n`)),
    (error) => error?.code === 'SIM_SOURCE_BATCH_SIZE',
  );
  assert.throws(
    () => parseGitBatchResponse([row], Buffer.from(`${objectId} blob 3\nabc`)),
    (error) => error?.code === 'SIM_SOURCE_BATCH_TRUNCATED',
  );
  assert.throws(
    () => parseGitBatchResponse([row], Buffer.concat([response, Buffer.from('extra')])),
    (error) => error?.code === 'SIM_SOURCE_BATCH_TRAILING',
  );
});
