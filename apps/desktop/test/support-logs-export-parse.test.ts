import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLogsExportResult } from '../src/shell/renderer/bridge/runtime-bridge/support-logs-export';

test('rule.nimi.desktop.product-surfaces.r027: log export parser accepts only concrete non-empty artifacts', () => {
  assert.deepEqual(
    parseLogsExportResult({
      artifactPath: '/tmp/nimi-logs.zip',
      fileCount: 2,
      byteSize: 128,
      exportedAt: '2026-06-12T00:00:00Z',
    }),
    {
      artifactPath: '/tmp/nimi-logs.zip',
      fileCount: 2,
      byteSize: 128,
      exportedAt: '2026-06-12T00:00:00Z',
    },
  );
});

test('rule.nimi.desktop.product-surfaces.r027: log export parser rejects empty or non-numeric success payloads', () => {
  for (const payload of [
    { artifactPath: '/tmp/nimi-logs.zip', fileCount: 0, byteSize: 128, exportedAt: '2026-06-12T00:00:00Z' },
    { artifactPath: '/tmp/nimi-logs.zip', fileCount: 2, byteSize: 0, exportedAt: '2026-06-12T00:00:00Z' },
    { artifactPath: '/tmp/nimi-logs.zip', fileCount: '2', byteSize: 128, exportedAt: '2026-06-12T00:00:00Z' },
    { artifactPath: '/tmp/nimi-logs.zip', fileCount: 2, byteSize: Number.NaN, exportedAt: '2026-06-12T00:00:00Z' },
    { artifactPath: '', fileCount: 2, byteSize: 128, exportedAt: '2026-06-12T00:00:00Z' },
    { artifactPath: '/tmp/nimi-logs.zip', fileCount: 2, byteSize: 128, exportedAt: '' },
    { artifactPath: '/tmp/nimi-logs.zip', fileCount: 1.5, byteSize: 128, exportedAt: '2026-06-12T00:00:00Z' },
    { artifactPath: '/tmp/nimi-logs.zip', fileCount: 2, byteSize: Number.POSITIVE_INFINITY, exportedAt: '2026-06-12T00:00:00Z' },
  ]) {
    assert.throws(() => parseLogsExportResult(payload), /desktop_logs_export returned (invalid|no)/);
  }
});
