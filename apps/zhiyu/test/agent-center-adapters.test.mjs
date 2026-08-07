import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

test('production Agent Center remains absent while protected App Access is unavailable', async () => {
  const { createZhiyuProductionAgentCenterSession } = await loadFactoryModule();
  assert.equal(createZhiyuProductionAgentCenterSession(null), null);
  assert.equal(createZhiyuProductionAgentCenterSession('opaque-handle'), null);
});

test('production Agent Center has no access workflow or direct protected-operation adapter', async () => {
  const source = await readFile(path.join(root, 'src/production/agent-center-adapters.ts'), 'utf8');
  assert.doesNotMatch(source, /permission|grant|requestPermission|agentConfigure|getZhiyuLocalAppClient/u);
  await assert.rejects(
    readFile(path.join(root, 'src/production/agent-center-permissioned-binding.ts'), 'utf8'),
    (error) => error?.code === 'ENOENT',
  );
});

async function loadFactoryModule() {
  const output = (await build({
    entryPoints: [path.join(root, 'src/production/agent-center-adapters.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    logLevel: 'silent',
  })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Math.random()}`);
}
