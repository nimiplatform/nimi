import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

test('surfaces the Electron host action hint for a capability-set rejection', async () => {
  const runtimePlatform = await loadRuntimePlatform({
    reasonCode: 'electron-standard-capability-not-in-host-set',
    actionHint: 'use_command_admitted_by_electron_standard_shell_capability_set',
  });

  const projection = await runtimePlatform.getRuntimePlatformProjection();

  assert.equal(projection.status, 'action-required');
  assert.equal(projection.reasonCode, 'electron-standard-capability-not-in-host-set');
  assert.equal(
    projection.actionHint,
    'use_command_admitted_by_electron_standard_shell_capability_set',
  );
});

test('never suggests starting a daemon when a capability-set rejection omits its action hint', async () => {
  const runtimePlatform = await loadRuntimePlatform({
    reasonCode: 'electron-standard-capability-not-in-host-set',
  });

  const projection = await runtimePlatform.getRuntimePlatformProjection();

  assert.equal(
    projection.actionHint,
    'use_command_admitted_by_electron_standard_shell_capability_set',
  );
});

async function loadRuntimePlatform(error) {
  const buildDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-zhiyu-runtime-platform-'));
  const outfile = path.join(buildDir, 'runtime-platform.mjs');
  globalThis.__nimiZhiyuRuntimeReadyError = error;

  await build({
    entryPoints: [path.join(root, 'src/shell/auth/runtime-platform.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    logLevel: 'silent',
    plugins: [sdkStubPlugin()],
  });

  try {
    return await import(`${pathToFileURL(outfile).href}?test=${Date.now()}-${Math.random()}`);
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

function sdkStubPlugin() {
  return {
    name: 'zhiyu-runtime-platform-sdk-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk$/ }, () => ({
        path: 'sdk-stub',
        namespace: 'sdk-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'sdk-stub' }, () => ({
        loader: 'js',
        contents: `
          export function createNimiClient() {
            return {
              runtime: {
                async ready() {
                  throw globalThis.__nimiZhiyuRuntimeReadyError;
                },
              },
            };
          }
        `,
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/runtime$/ }, () => ({
        path: 'sdk-runtime-stub',
        namespace: 'sdk-runtime-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'sdk-runtime-stub' }, () => ({
        loader: 'js',
        contents: 'export function createNimiLocalFirstPartyRuntimeAccountCaller() { return {}; }',
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/types$/ }, () => ({
        path: 'sdk-types-stub',
        namespace: 'sdk-types-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'sdk-types-stub' }, () => ({
        loader: 'js',
        contents: "export const ReasonCode = { RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE' };",
      }));
    },
  };
}
