import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectRuntimeConfigProfileExportLoadout,
  summarizeRuntimeConfigProfileDownloads,
} from '../src/shell/renderer/features/runtime-config/runtime-config-profile-presentation.js';

test('AI setup export keeps only one model setup for the same use', () => {
  const selected = selectRuntimeConfigProfileExportLoadout({
    currentIds: ['text-old', 'image-current'],
    loadoutId: 'text-new',
    sameUseIds: new Set(['text-old', 'text-new']),
    checked: true,
  });
  assert.deepEqual(selected, ['image-current', 'text-new']);
});

test('AI setup download summary distinguishes zero, known, and unknown downloads', () => {
  assert.deepEqual(summarizeRuntimeConfigProfileDownloads({ downloads: [], totalDownloadBytes: 0 }), {
    kind: 'none',
    count: 0,
    totalBytes: 0,
  });
  assert.deepEqual(summarizeRuntimeConfigProfileDownloads({ downloads: [{} as never], totalDownloadBytes: 1024 }), {
    kind: 'known',
    count: 1,
    totalBytes: 1024,
  });
  assert.deepEqual(summarizeRuntimeConfigProfileDownloads({ downloads: [{} as never], totalDownloadBytes: null }), {
    kind: 'unknown',
    count: 1,
    totalBytes: null,
  });
});
