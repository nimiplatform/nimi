import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const appRoot = path.resolve(import.meta.dirname, '..');

test('an unreachable Runtime reads as a missing Nimi connection that Zhiyu keeps retrying', async () => {
  const gate = await importGateModule();
  const projection = await projectionFor(gate, {
    reasonCode: 'RUNTIME_GRPC_UNAVAILABLE',
    details: { grpcCode: 14 },
  });

  assert.equal(gate.zhiyuRuntimeUnavailableKind(projection), 'connection');
  const html = gate.renderUnavailablePage({ projection, retrying: false });
  assert.match(html, /<h1>暂时连接不上 Nimi<\/h1>/);
  assert.match(html, /<p>请确认 Nimi 已打开，连接后会自动继续。<\/p>/);
  assert.match(html, /<button[^>]*>重新连接<\/button>/);
  assert.match(html, /data-zhiyu-runtime-unavailable-reason="electron-runtime-endpoint-unavailable"/);
  assert.match(html, /<details class="runtime-gate-details"><summary>技术详情/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /<dd>electron-runtime-endpoint-unavailable<\/dd>/);
});

test('a permission denial is never presented as Nimi not running', async () => {
  const gate = await importGateModule();
  const projection = await projectionFor(gate, { reasonCode: 'PERMISSION_DENIED' });

  assert.equal(gate.zhiyuRuntimeUnavailableKind(projection), 'session');
  const html = gate.renderUnavailablePage({ projection, retrying: false });
  assert.match(html, /<h1>织羽暂时无法打开<\/h1>/);
  assert.match(html, /<p>请从 Nimi 重新打开织羽。<\/p>/);
  assert.match(html, /<button[^>]*>重试<\/button>/);
  assert.doesNotMatch(html, /连接不上 Nimi/);
});

test('session and host admission failures point back to Nimi instead of auto-retrying', async () => {
  const gate = await importGateModule();
  for (const error of [
    { reasonCode: 'LOCAL_APP_SESSION_REVOKED', actionHint: 'reopen_local_app_session' },
    {
      reasonCode: 'electron-standard-capability-not-in-host-set',
      actionHint: 'use_command_admitted_by_electron_standard_shell_capability_set',
    },
  ]) {
    assert.equal(gate.zhiyuRuntimeUnavailableKind(await projectionFor(gate, error)), 'session');
  }
  assert.equal(
    gate.zhiyuRuntimeUnavailableKind(await projectionFor(gate, {
      reasonCode: 'LOCAL_APP_RUNTIME_UNAVAILABLE',
      actionHint: 'start_fixed_runtime_service',
    })),
    'connection',
  );
  assert.equal(gate.zhiyuRuntimeUnavailableKind(undefined), 'connection');
});

test('a manual retry shows progress in place and launch uses the same brand screen', async () => {
  const gate = await importGateModule();
  const projection = await projectionFor(gate, { reasonCode: 'electron-runtime-endpoint-unavailable' });

  const retrying = gate.renderUnavailablePage({ projection, retrying: true });
  assert.match(retrying, /<button[^>]*data-loading="true"[^>]*>正在连接…<\/button>/);
  assert.match(retrying, /class="runtime-gate-mark" data-state="connecting"/);
  assert.doesNotMatch(retrying, />重新连接</);

  const connecting = gate.renderConnectingScreen();
  assert.match(connecting, /正在连接 Nimi…/);
  assert.doesNotMatch(connecting, /<button|技术详情/);
});

async function projectionFor(gate, error) {
  globalThis.__zhiyuRuntimeGateTestError = error;
  return gate.getRuntimePlatformProjection();
}

async function importGateModule() {
  const output = (await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server.edge';
        import { RuntimeConnectingScreen, RuntimeUnavailablePage } from './src/shell/auth/runtime-unavailable-page.tsx';
        export { getRuntimePlatformProjection } from './src/shell/auth/runtime-platform.ts';
        export { zhiyuRuntimeUnavailableKind } from './src/shell/auth/runtime-unavailable-kind.ts';
        export function renderUnavailablePage(props) {
          return renderToStaticMarkup(createElement(RuntimeUnavailablePage, { onRetry() {}, ...props }));
        }
        export function renderConnectingScreen() {
          return renderToStaticMarkup(createElement(RuntimeConnectingScreen));
        }
      `,
      resolveDir: appRoot,
      sourcefile: 'runtime-unavailable-page-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    logLevel: 'silent',
    loader: { '.png': 'dataurl' },
    plugins: [runtimeGateStubPlugin()],
  })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Math.random()}`);
}

function runtimeGateStubPlugin() {
  const stubs = {
    '@nimiplatform/sdk': `
      export function createNimiClient() {
        return {
          auth: {
            async status() {
              throw globalThis.__zhiyuRuntimeGateTestError;
            },
          },
        };
      }
    `,
    '@nimiplatform/sdk/types': "export const ReasonCode = { RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE' };",
    '@nimiplatform/kit/shell/renderer/bridge': 'export function createNimiLocalAppStandardShellSurface() { return {}; }',
    '@nimiplatform/kit/ui': `
      import { createElement } from 'react';
      export function Button({ tone, size, loading, leadingIcon, children, ...props }) {
        return createElement('button', { ...props, 'data-loading': loading ? 'true' : undefined }, children);
      }
    `,
    'lucide-react': `
      import { createElement } from 'react';
      export function Check() { return createElement('svg'); }
      export function ChevronDown() { return createElement('svg'); }
      export function Copy() { return createElement('svg'); }
    `,
  };
  return {
    name: 'runtime-gate-stubs',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^(@nimiplatform\/sdk(\/types)?|@nimiplatform\/kit\/(ui|shell\/renderer\/bridge)|lucide-react)$/ }, (args) => ({
        path: args.path,
        namespace: 'runtime-gate-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'runtime-gate-stub' }, (args) => ({
        loader: 'jsx',
        contents: stubs[args.path],
        resolveDir: appRoot,
      }));
    },
  };
}
