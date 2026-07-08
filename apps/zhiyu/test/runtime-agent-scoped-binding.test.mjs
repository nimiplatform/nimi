import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu Electron scoped binding bridge issues Runtime account binding after owner check', async () => {
  const { createZhiyuRuntimeAgentScopedBindingCommandHandler } = await importModule();
  const calls = [];
  const runtime = {
    account: {
      async getAccountSessionStatus(request, options) {
        calls.push({ method: 'status', request, options });
        return {
          state: 3,
          accountProjection: { accountId: 'acct_1' },
          reasonCode: 1,
          accountReasonCode: 1,
          productionInert: false,
        };
      },
      async issueScopedAppBinding(request, options) {
        calls.push({ method: 'issue', request, options });
        return {
          accepted: true,
          bindingId: 'binding-1',
          bindingCarrier: 'binding:binding-1',
          relation: {
            ...request.relation,
            bindingId: 'binding-1',
            issuedAt: { seconds: '100', nanos: 0 },
            expiresAt: { seconds: '200', nanos: 0 },
            state: 2,
            reasonCode: 1,
          },
          reasonCode: 1,
          accountReasonCode: 1,
          productionInert: false,
        };
      },
    },
  };
  const handler = createZhiyuRuntimeAgentScopedBindingCommandHandler({
    appId: 'nimi.zhiyu',
    runtimeEndpoint: '127.0.0.1:46371',
    runtime,
    accountCaller: {
      appId: 'nimi.zhiyu',
      appInstanceId: 'nimi.zhiyu.local-first-party',
      deviceId: 'nimi-zhiyu-local-first-party-device',
      mode: 1,
      scopes: [],
    },
  });

  const result = await handler({
    command: 'zhiyu.runtimeAgent.issueScopedBinding',
    appId: 'nimi.zhiyu',
    runtimeEndpoint: '127.0.0.1:46371',
    event: {},
    payload: {
      ownerUserId: 'acct_1',
      runtimeSourceRef: 'runtime-source:opaque',
      localAgentRef: 'local-agent:opaque',
      conversationAnchorId: 'agent_anchor_1',
      scopes: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
      issueRequestId: 'issue-request-1',
    },
  });

  assert.deepEqual(calls.map((call) => call.method), ['status', 'issue']);
  assert.match(
    calls[1].options.metadata.idempotencyKey,
    /:issue-request-1$/,
    'issue idempotency key must include the per-issuance request id so renewal does not replay the initial binding',
  );
  assert.equal(calls[1].request.relation.runtimeAppId, 'nimi.zhiyu');
  assert.equal(calls[1].request.relation.appInstanceId, 'nimi.zhiyu.local-first-party');
  assert.equal(calls[1].request.relation.agentId, 'local-agent:opaque');
  assert.equal(calls[1].request.relation.conversationAnchorId, 'agent_anchor_1');
  assert.equal(calls[1].request.relation.purpose, 2);
  assert.deepEqual(calls[1].request.relation.scopes, [
    'runtime.agent.turn.read',
    'runtime.agent.turn.write',
  ]);
  assert.equal(result.scopedBinding.bindingId, 'binding-1');
  assert.equal(result.scopedBinding.bindingSource, 'runtime-account-service');
  assert.equal(result.scopedBinding.agentId, 'local-agent:opaque');
  assert.equal(result.scopedBinding.conversationAnchorId, 'agent_anchor_1');
  assert.equal(result.scopedBinding.expiresAtMs, 200_000);
  assert.deepEqual(result.scopedBinding.scopes, [
    'runtime.agent.turn.read',
    'runtime.agent.turn.write',
  ]);
});

test('Zhiyu Electron scoped binding bridge honors admitted requested Runtime Agent scopes', async () => {
  const { createZhiyuRuntimeAgentScopedBindingCommandHandler } = await importModule();
  const calls = [];
  const runtime = {
    account: {
      async getAccountSessionStatus() {
        return {
          state: 3,
          accountProjection: { accountId: 'acct_1' },
          reasonCode: 1,
          accountReasonCode: 1,
          productionInert: false,
        };
      },
      async issueScopedAppBinding(request) {
        calls.push(request);
        return {
          accepted: true,
          bindingId: 'binding-turn',
          bindingCarrier: 'binding:binding-turn',
          relation: {
            ...request.relation,
            bindingId: 'binding-turn',
            issuedAt: { seconds: '100', nanos: 0 },
            expiresAt: { seconds: '200', nanos: 0 },
            state: 2,
            reasonCode: 1,
          },
          reasonCode: 1,
          accountReasonCode: 1,
          productionInert: false,
        };
      },
    },
  };
  const handler = createZhiyuRuntimeAgentScopedBindingCommandHandler({
    appId: 'nimi.zhiyu',
    runtimeEndpoint: '127.0.0.1:46371',
    runtime,
    accountCaller: {
      appId: 'nimi.zhiyu',
      appInstanceId: 'nimi.zhiyu.local-first-party',
      deviceId: 'nimi-zhiyu-local-first-party-device',
      mode: 1,
      scopes: [],
    },
  });

  const result = await handler({
    command: 'zhiyu.runtimeAgent.issueScopedBinding',
    appId: 'nimi.zhiyu',
    runtimeEndpoint: '127.0.0.1:46371',
    event: {},
    payload: {
      ownerUserId: 'acct_1',
      runtimeSourceRef: 'runtime-source:opaque',
      localAgentRef: 'local-agent:opaque',
      conversationAnchorId: 'agent_anchor_1',
      scopes: [
        'runtime.agent.autonomy.write',
        'runtime.agent.turn.write',
        'runtime.agent.read',
        'runtime.agent.turn.read',
      ],
    },
  });

  assert.deepEqual(calls[0].relation.scopes, [
    'runtime.agent.autonomy.write',
    'runtime.agent.read',
    'runtime.agent.turn.read',
    'runtime.agent.turn.write',
  ]);
  assert.deepEqual(result.scopedBinding.scopes, [
    'runtime.agent.autonomy.write',
    'runtime.agent.read',
    'runtime.agent.turn.read',
    'runtime.agent.turn.write',
  ]);
});

test('Zhiyu Electron scoped binding bridge rejects owner mismatch before issue', async () => {
  const { createZhiyuRuntimeAgentScopedBindingCommandHandler } = await importModule();
  let issueCalled = false;
  const handler = createZhiyuRuntimeAgentScopedBindingCommandHandler({
    appId: 'nimi.zhiyu',
    runtimeEndpoint: '127.0.0.1:46371',
    runtime: {
      account: {
        async getAccountSessionStatus() {
          return {
            state: 3,
            accountProjection: { accountId: 'acct_other' },
            reasonCode: 1,
            accountReasonCode: 1,
            productionInert: false,
          };
        },
        async issueScopedAppBinding() {
          issueCalled = true;
          throw new Error('not expected');
        },
      },
    },
    accountCaller: {
      appId: 'nimi.zhiyu',
      appInstanceId: 'nimi.zhiyu.local-first-party',
      deviceId: 'nimi-zhiyu-local-first-party-device',
      mode: 1,
      scopes: [],
    },
  });

  await assert.rejects(
    () => handler({
      command: 'zhiyu.runtimeAgent.issueScopedBinding',
      appId: 'nimi.zhiyu',
      runtimeEndpoint: '127.0.0.1:46371',
      event: {},
      payload: {
        ownerUserId: 'acct_1',
        runtimeSourceRef: 'runtime-source:opaque',
        localAgentRef: 'local-agent:opaque',
        conversationAnchorId: 'agent_anchor_1',
      },
    }),
    (error) => error?.reasonCode === 'zhiyu-runtime-agent-scoped-binding-account-mismatch',
  );
  assert.equal(issueCalled, false);
});

async function importModule() {
  const outputPath = path.join(await buildModule(), 'runtime-agent-scoped-binding.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-runtime-agent-scoped-binding-'));
  await build({
    entryPoints: [path.join(root, 'src-electron/runtime-agent-scoped-binding.ts')],
    outfile: path.join(buildDir, 'runtime-agent-scoped-binding.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    plugins: [workspaceSourcePlugin()],
  });
  return buildDir;
}

function workspaceSourcePlugin() {
  const repoRoot = path.resolve(root, '..', '..');
  return {
    name: 'workspace-source',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/runtime$/ }, () => ({
        path: path.join(repoRoot, 'sdks/typescript/runtime/index.ts'),
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/runtime\/generated$/ }, () => ({
        path: path.join(repoRoot, 'sdks/typescript/core-generated/runtime-typed-client.ts'),
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/shell\/electron\/main$/ }, () => ({
        path: 'workspace-kit-electron-main-stub',
        namespace: 'workspace-kit-electron-main-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-kit-electron-main-stub' }, () => ({
        loader: 'js',
        contents: `
          export class NimiElectronShellHostError extends Error {
            constructor(input) {
              super(input.message);
              this.name = 'NimiElectronShellHostError';
              this.code = input.code;
              this.reasonCode = input.reasonCode;
              this.actionHint = input.actionHint;
              this.source = input.source || 'electron';
              this.details = input.details;
              this.envelope = {
                code: input.code,
                reasonCode: input.reasonCode,
                actionHint: input.actionHint,
                source: this.source,
                details: input.details,
              };
            }
          }
        `,
      }));
    },
  };
}
