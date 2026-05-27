import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  LOCAL_RUNTIME_ENGINE_IDS,
  LOCAL_RUNTIME_ENGINE_RUNTIME_MODE_IDS,
  isLocalRuntimeEngineId,
  normalizeLocalRuntimeEngineRuntimeModeId,
  normalizeLocalRuntimeEngineId,
  parseLocalRuntimeEngineRuntimeModeId,
  parseLocalRuntimeEngineId,
  toLocalRuntimeEngineRuntimeModeRequestValue,
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

test('local runtime engine mode parser accepts Runtime enum projections', () => {
  assert.deepEqual([...LOCAL_RUNTIME_ENGINE_RUNTIME_MODE_IDS], ['supervised', 'attached-endpoint']);
  assert.equal(parseLocalRuntimeEngineRuntimeModeId(1), 'supervised');
  assert.equal(parseLocalRuntimeEngineRuntimeModeId('1'), 'supervised');
  assert.equal(
    parseLocalRuntimeEngineRuntimeModeId('LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED'),
    'supervised',
  );
  assert.equal(
    parseLocalRuntimeEngineRuntimeModeId('LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT'),
    'attached-endpoint',
  );
  assert.equal(normalizeLocalRuntimeEngineRuntimeModeId('unknown'), 'attached-endpoint');
  assert.equal(toLocalRuntimeEngineRuntimeModeRequestValue('supervised'), 1);
  assert.equal(toLocalRuntimeEngineRuntimeModeRequestValue('attached-endpoint'), 2);
  assert.equal(toLocalRuntimeEngineRuntimeModeRequestValue('unknown'), 0);
});
