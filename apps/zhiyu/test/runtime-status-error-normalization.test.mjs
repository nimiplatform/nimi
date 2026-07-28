import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

test('normalizes Electron SDK gRPC unavailable errors to the canonical no-daemon projection', async () => {
  const { normalizeZhiyuElectronRuntimeUnavailableError } = await loadModule();

  assert.deepEqual(
    normalizeZhiyuElectronRuntimeUnavailableError({
      reasonCode: 'RUNTIME_GRPC_UNAVAILABLE',
      actionHint: 'retry_or_check_runtime_daemon',
      source: 'runtime',
      details: { grpcCode: 14 },
    }),
    {
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      actionHint: 'start_external_runtime_daemon',
      source: 'electron',
    },
  );
});

test('leaves non-transport Runtime errors available to the caller', async () => {
  const { normalizeZhiyuElectronRuntimeUnavailableError } = await loadModule();

  assert.equal(
    normalizeZhiyuElectronRuntimeUnavailableError({
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'register_runtime_principal',
      source: 'runtime',
    }),
    null,
  );
});

test('does not normalize wrapped Runtime permission denied as a daemon outage', async () => {
  const { normalizeZhiyuElectronRuntimeUnavailableError } = await loadModule();

  assert.equal(
    normalizeZhiyuElectronRuntimeUnavailableError({
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      actionHint: 'start_external_runtime_daemon',
      source: 'electron',
      details: {
        command: 'nimi.shell.runtime.unary',
        runtimeEndpoint: '127.0.0.1:46371',
        cause: '7 PERMISSION_DENIED: {"actionHint":"authorize_missing_protected_scope","reasonCode":"APP_SCOPE_FORBIDDEN"}',
      },
    }),
    null,
  );
});

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/runtime/electron-runtime-unavailable.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}
