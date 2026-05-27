import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  LOCAL_RUNTIME_ENGINE_IDS,
  isLocalRuntimeEngineId,
  normalizeLocalRuntimeEngineId,
  parseLocalRuntimeEngineId,
} from '../../src/runtime/index.js';

test('local runtime engine ids match Runtime local engine catalog order', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../../../.nimi/spec/runtime/kernel/tables/local-engine-catalog.yaml'),
    'utf8',
  );
  const engines = Array.from(new Set(
    [...source.matchAll(/^\s*-\s*engine:\s*([a-z0-9_-]+)/gmu)]
      .map((match) => String(match[1] || '').trim())
      .filter(Boolean),
  ));

  assert.deepEqual([...LOCAL_RUNTIME_ENGINE_IDS], engines);
});

test('local runtime engine parser accepts known runtime engines only', () => {
  assert.equal(parseLocalRuntimeEngineId('llama'), 'llama');
  assert.equal(parseLocalRuntimeEngineId('  SPEECH '), 'speech');
  assert.equal(parseLocalRuntimeEngineId('openai'), undefined);
  assert.equal(isLocalRuntimeEngineId('sidecar'), true);
  assert.equal(isLocalRuntimeEngineId('retired-engine'), false);
});

test('local runtime engine normalizer fails closed to runtime default', () => {
  assert.equal(normalizeLocalRuntimeEngineId('media'), 'media');
  assert.equal(normalizeLocalRuntimeEngineId('unknown'), 'llama');
  assert.equal(normalizeLocalRuntimeEngineId('unknown', 'speech'), 'speech');
});
