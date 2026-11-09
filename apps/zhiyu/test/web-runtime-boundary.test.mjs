import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';

// Transport-selection unit fixture only; authenticated Web acceptance uses the
// real official login, Home-approved source and PC Runtime.
test('Web entry never constructs or falls back to a native App client', async () => {
  const result = await build({ entryPoints: [path.resolve(import.meta.dirname, '../src/shell/auth/runtime-platform.ts')],
    bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'native-boundary-fixture', setup(api) {
      api.onResolve({ filter: /^@nimiplatform\// }, args => ({ path: args.path, namespace: 'boundary' }));
      api.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ loader: 'js', contents:
        args.path === '@nimiplatform/sdk'
          ? 'export function createNimiClient() { throw new Error("native client must not be constructed"); }'
          : args.path === '@nimiplatform/sdk/types'
            ? 'export const ReasonCode = { RUNTIME_UNAVAILABLE: "RUNTIME_UNAVAILABLE" };'
            : 'export function hasElectronRuntime() { return false; } export function createNimiLocalAppStandardShellSurface() { throw new Error("native bridge must not be constructed"); }',
      }));
    } }] });
  const api = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  api.setZhiyuRemoteRuntime(null);
  assert.equal(api.hasZhiyuRuntimeCarrier(), false);
  assert.equal(api.zhiyuRuntimeTransport(), 'webrtc');
  assert.throws(() => api.getZhiyuLocalAppClient(), /连接已断开/u);
  assert.throws(() => api.getZhiyuNativeAppClient(), /native/u);
  const peer = { role: 'app', closed: false };
  api.setZhiyuRemoteRuntime(peer);
  assert.equal(api.getZhiyuLocalAppClient(), peer);
  assert.equal(api.hasZhiyuRuntimeCarrier(), true);
  peer.closed = true;
  assert.throws(() => api.getZhiyuLocalAppClient(), /连接已断开/u);
});
