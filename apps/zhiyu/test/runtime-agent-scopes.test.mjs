import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

test('Zhiyu Electron Runtime Agent scope runner delegates protected access to the host bridge', async () => {
  const { withZhiyuElectronRuntimeProtectedScopes } = await loadModule();
  const calls = [];

  const result = await withZhiyuElectronRuntimeProtectedScopes(
    [
      'runtime.agent.read',
      'runtime.agent.write',
      'runtime.agent.turn.write',
      'runtime.agent.delegation.read',
      'runtime.agent.delegation.write',
    ],
    async (options) => {
      calls.push(options);
      return 'ok';
    },
  );

  assert.equal(result, 'ok');
  assert.deepEqual(calls, [{}]);
});

test('Zhiyu Electron Runtime Agent scope runner rejects unregistered scopes', async () => {
  const { withZhiyuElectronRuntimeProtectedScopes } = await loadModule();

  await assert.rejects(
    () => withZhiyuElectronRuntimeProtectedScopes(
      ['runtime.memory.write'],
      async () => 'unused',
    ),
    (error) => error?.reasonCode === 'PRINCIPAL_UNAUTHORIZED'
      && error?.actionHint === 'register_zhiyu_runtime_protected_scope',
  );
});

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/agent/runtime-agent-scopes.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}
