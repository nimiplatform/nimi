import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadInputModule() {
  const sourcePath = path.join(root, 'src/shell/agent/local-agent-discovery-input.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

test('normalizes hash-bearing sourceRef without caller-known runtimeSourceRef', async () => {
  const { normalizeZhiyuLocalAgentDiscoveryInput } = await loadInputModule();

  const normalized = normalizeZhiyuLocalAgentDiscoveryInput({
    ownerUserId: ' user-1 ',
    sourceRef: {
      kind: ' worldCharacter ',
      worldId: ' world-1 ',
      sourceId: ' source-1 ',
      sourceContentHash: ' hash-1 ',
    },
  });

  assert.equal(normalized?.runtimeSourceRef, undefined);
  assert.deepEqual(normalized, {
    ownerUserId: 'user-1',
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'source-1',
      sourceContentHash: 'hash-1',
    },
  });
});

test('preserves runtimeSourceRef only as an extra discovery filter', async () => {
  const { normalizeZhiyuLocalAgentDiscoveryInput } = await loadInputModule();

  const normalized = normalizeZhiyuLocalAgentDiscoveryInput({
    ownerUserId: 'user-1',
    runtimeSourceRef: ' opaque-runtime-source-ref ',
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'source-1',
      sourceContentHash: 'hash-1',
    },
  });

  assert.equal(normalized?.runtimeSourceRef, 'opaque-runtime-source-ref');
});

test('rejects discovery without owner or complete hash-bearing sourceRef', async () => {
  const { normalizeZhiyuLocalAgentDiscoveryInput } = await loadInputModule();

  assert.equal(normalizeZhiyuLocalAgentDiscoveryInput({
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'source-1',
      sourceContentHash: 'hash-1',
    },
  }), null);

  assert.equal(normalizeZhiyuLocalAgentDiscoveryInput({
    ownerUserId: 'user-1',
    runtimeSourceRef: 'opaque-runtime-source-ref',
  }), null);

  assert.equal(normalizeZhiyuLocalAgentDiscoveryInput({
    ownerUserId: 'user-1',
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'source-1',
      sourceContentHash: ' ',
    },
  }), null);
});
