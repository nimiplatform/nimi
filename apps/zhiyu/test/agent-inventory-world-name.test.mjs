import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { transform } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');

test('Runtime inventory world-name hydration backfills old world-character agents from Realm world identity', async () => {
  const module = await importTypescriptModule('src/shell/agent/agent-inventory-world-name.ts');
  const calls = [];

  const hydrated = await module.hydrateZhiyuInventoryAgentWorldNames([
    {
      localAgentRef: 'local-agent:yan-zhenqing',
      sourceKind: 'worldCharacter',
      sourceWorldId: ' cbdb-tang-literati-world ',
      sourceWorldName: null,
    },
    {
      localAgentRef: 'local-agent:already-projected',
      sourceKind: 'worldCharacter',
      sourceWorldId: 'world-2',
      sourceWorldName: 'Existing World',
    },
    {
      localAgentRef: 'local-agent:persona',
      sourceKind: 'realmPersona',
      sourceWorldId: 'world-3',
      sourceWorldName: null,
    },
  ], async (worldId) => {
    calls.push(worldId);
    return worldId === 'cbdb-tang-literati-world' ? '唐代文人世界' : null;
  });

  assert.equal(hydrated[0].sourceWorldName, '唐代文人世界');
  assert.equal(hydrated[1].sourceWorldName, 'Existing World');
  assert.equal(hydrated[2].sourceWorldName, null);
  assert.deepEqual(calls, ['cbdb-tang-literati-world']);
});

test('Runtime inventory world-name hydration fails closed when Realm lookup is unavailable', async () => {
  const module = await importTypescriptModule('src/shell/agent/agent-inventory-world-name.ts');

  const hydrated = await module.hydrateZhiyuInventoryAgentWorldNames([
    {
      localAgentRef: 'local-agent:yan-zhenqing',
      sourceKind: 'worldCharacter',
      sourceWorldId: 'cbdb-tang-literati-world',
      sourceWorldName: null,
    },
  ], async () => {
    throw new Error('Realm unavailable');
  });

  assert.equal(hydrated[0].sourceWorldName, null);
});

async function importTypescriptModule(relativePath) {
  const source = await readFile(path.join(appRoot, relativePath), 'utf8');
  const result = await transform(source, {
    format: 'esm',
    loader: 'ts',
    sourcemap: false,
    target: 'es2022',
  });
  const encoded = Buffer.from(result.code, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}
