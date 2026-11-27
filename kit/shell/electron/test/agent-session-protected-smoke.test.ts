import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'vitest';
import {
  BodyOutboxEnvelope,
  RegisterBodyCarrierRequest,
  RegisterBodyCarrierResponse,
} from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/agent_session.js';
import { createAppBusinessServices } from '../src/main/app-business-services.js';
import {
  createNimiElectronHarnessSecurityHost,
  type NimiElectronHarnessSecurityBinding,
} from '../src/main/harness-security-host.js';
import {
  createNimiElectronLocalAppHostForBinding,
  NimiElectronLocalAppHostError,
  type NimiElectronProtectedLocalBinding,
} from '../src/main/local-app-host.js';

function loadCompiledNativeAddon(): Record<string, unknown> {
  const artifact = process.platform === 'win32'
    ? 'nimi_shell_protected_local_node.dll'
    : 'libnimi_shell_protected_local_node.dylib';
  const addonPath = path.resolve(
    import.meta.dirname,
    '../../protected-local-node/target/debug',
    artifact,
  );
  assert.ok(fs.existsSync(addonPath), `compiled protected-local-node addon missing at ${addonPath}`);
  const nativeModule: { exports: Record<string, unknown> } = { exports: {} };
  process.dlopen(nativeModule, addonPath);
  return nativeModule.exports;
}

describe('Stage 1 Electron protected AgentSession + Rust HarnessSecurity smoke', () => {
  it('routes agentSession unary & stream calls through Electron LocalAppHost and AppBusinessServices', async () => {
    let outboxNextCount = 0;
    let closedStreamId = '';
    const binding = new Proxy<Record<string, unknown>>(
      {
        localAppObserveSessionEnd: () => ({ wait: () => new Promise(() => undefined), close: () => undefined }),
        localAppSessionStatus: async () => ({
          status: 'ok',
          value: {
            state: 'ready',
            reasonCode: 'action-executed',
            retryable: false,
            currentUser: { state: 'unavailable', value: null, reasonCode: 'current-user-display-unavailable', retryable: false },
          },
        }),
        localAppSessionRenew: async () => ({ status: 'ok', value: {} }),
        localAppSessionRebind: async () => ({ status: 'ok', value: {} }),
        localAppAgentSessionUnary: async (input: { methodId: string; requestBytes: Buffer }) => {
          if (input.methodId === '/nimi.runtime.v1.AgentSessionService/RegisterBodyCarrier') {
            const decoded = RegisterBodyCarrierRequest.fromBinary(input.requestBytes);
            if (decoded.capabilityNamespace === 'os.pc.forbidden') {
              return { status: 'error', reasonCode: 'local-app-access-denied', retryable: false };
            }
            const respBytes = RegisterBodyCarrierResponse.toBinary({
              leaseEpoch: '7',
              capabilityNamespace: decoded.capabilityNamespace,
              pendingTombstones: [],
              pendingIntents: [],
              heartbeatIntervalMs: 10000,
            });
            return { status: 'ok', value: Buffer.from(respBytes) };
          }
          return { status: 'error', reasonCode: 'local-app-operation-unsupported', retryable: false };
        },
        localAppAgentSessionStreamOpen: async (input: { methodId: string; requestBytes: Buffer }) => {
          assert.equal(input.methodId, '/nimi.runtime.v1.AgentSessionService/SubscribeBodyOutbox');
          return { status: 'ok', value: { streamId: 'agent-session-smoke-1' } };
        },
        localAppAgentSessionStreamNext: async ({ streamId }: { streamId: string }) => {
          assert.equal(streamId, 'agent-session-smoke-1');
          outboxNextCount += 1;
          if (outboxNextCount === 1) {
            const envBytes = BodyOutboxEnvelope.toBinary({
              outboxId: 'outbox-1',
              deviceId: 'dev-1',
              capabilityNamespace: 'os.pc.workspace',
              workSessionRef: 'ws-1',
              commandKind: 1,
              payloadJson: '{"text":"ping"}',
              createdAt: '2026-11-24T00:00:00Z',
              agentBinding: 'agent-1',
            });
            return { status: 'ok', completed: false, value: Buffer.from(envBytes) };
          }
          return { status: 'ok', completed: true, value: null };
        },
        localAppAgentSessionStreamClose: async ({ streamId }: { streamId: string }) => {
          closedStreamId = streamId;
          return { status: 'ok', value: { closed: true } };
        },
      },
      {
        get(target, prop) {
          if (typeof prop === 'string' && !(prop in target)) {
            return async () => ({ status: 'ok', value: {} });
          }
          return Reflect.get(target, prop);
        },
      },
    ) as unknown as NimiElectronProtectedLocalBinding;

    const host = createNimiElectronLocalAppHostForBinding(binding);
    const { services, close } = createAppBusinessServices(host);
    try {
      const registered = await services.agentSession.registerBodyCarrier({
        deviceId: 'dev-1',
        capabilityNamespace: 'os.pc.workspace',
        instanceId: 'harness-1',
        capabilitiesJson: '{}',
      });
      assert.equal(String(registered.leaseEpoch), '7');
      assert.equal(registered.capabilityNamespace, 'os.pc.workspace');

      await assert.rejects(
        () => services.agentSession.registerBodyCarrier({
          deviceId: 'dev-1',
          capabilityNamespace: 'os.pc.forbidden',
          instanceId: 'ordinary-1',
          capabilitiesJson: '{}',
        }),
        (err: unknown) => err instanceof NimiElectronLocalAppHostError && err.reasonCode === 'local-app-access-denied',
      );

      const received: string[] = [];
      for await (const env of services.agentSession.subscribeBodyOutbox({
        deviceId: 'dev-1',
        capabilityNamespace: 'os.pc.workspace',
        leaseEpoch: '7',
      })) {
        received.push(env.outboxId);
      }
      assert.deepEqual(received, ['outbox-1']);
      assert.equal(closedStreamId, '');
    } finally {
      close();
    }
  });

  // The addon includes the protected Desktop carrier, which builds only on macOS and Windows.
  it.runIf(process.platform === 'win32' || process.platform === 'darwin')('exercises native workspace guards and Windows Job Objects through the compiled N-API addon', async () => {
    const addon = loadCompiledNativeAddon() as unknown as NimiElectronHarnessSecurityBinding;
    const security = createNimiElectronHarnessSecurityHost(addon);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-electron-harness-sec-'));
    const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-electron-harness-snap-'));
    try {
      const snapFile = path.join(snapDir, 'before.bak');
      const created = await security.secureWriteFile({
        workspaceRoot: workspace,
        relativePath: 'notes/demo.txt',
        content: Buffer.from('v1', 'utf8'),
        allowCreate: true,
      });
      assert.equal(created.created, true);

      const updated = await security.secureWriteFile({
        workspaceRoot: workspace,
        relativePath: 'notes/demo.txt',
        content: Buffer.from('v2', 'utf8'),
        preconditionSha256: created.sha256,
        snapshotRoot: snapDir,
        snapshotPath: snapFile,
      });
      assert.equal(updated.snapshotWritten, true);
      assert.equal(fs.readFileSync(snapFile, 'utf8'), 'v1');

      const read = await security.secureReadFile({
        workspaceRoot: workspace,
        relativePath: 'notes/demo.txt',
      });
      assert.equal(Buffer.from(read.contentBase64, 'base64').toString('utf8'), 'v2');
      assert.equal(read.nNumberOfLinks, 1);

      await assert.rejects(
        () => security.verifyWorkspacePath({ workspaceRoot: workspace, relativePath: '@notes/demo.txt' }),
        (err: unknown) => err instanceof NimiElectronLocalAppHostError && err.reasonCode === 'invalid-path',
      );

      if (process.platform === 'win32') {
        const sysRoot = process.env.SystemRoot || 'C:\\Windows';
        const jobRes = await security.runJobProcess({
          executable: path.join(sysRoot, 'System32', 'cmd.exe'),
          args: ['/C', 'echo', 'hello-job'],
          workingDirectory: workspace,
          env: { SystemRoot: sysRoot },
          timeoutMs: 10_000,
        });
        assert.equal(jobRes.exitCode, 0);
        assert.equal(jobRes.activeProcessesRemaining, 0);
        assert.match(jobRes.stdoutUtf8, /hello-job/u);
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(snapDir, { recursive: true, force: true });
    }
  });
});
