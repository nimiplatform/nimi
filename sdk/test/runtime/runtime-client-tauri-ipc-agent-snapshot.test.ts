import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GetPublicChatSessionSnapshotResponse,
} from '../../src/runtime/generated/runtime/v1/agent_service.js';
import { RegisterAppResponse } from '../../src/runtime/generated/runtime/v1/auth';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
} from '../../src/runtime/generated/runtime/v1/grant';
import { Runtime } from '../../src/runtime/runtime.js';
import { RuntimeMethodIds } from '../../src/runtime/method-ids';
import {
  APP_ID,
  installTauriRuntime,
  unwrapTauriInvokePayload,
} from './runtime-client-fixtures.js';

test('tauri-ipc Runtime agent session snapshot includes protected token and app session', async () => {
  const capturedPayloads: Record<string, unknown>[] = [];
  const authorizeRequests: AuthorizeExternalPrincipalRequest[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        const captured = unwrapTauriInvokePayload(payload);
        if (command !== 'runtime_bridge_unary') {
          throw new Error(`unexpected tauri command: ${command}`);
        }
        capturedPayloads.push(captured);
        if (captured.methodId === RuntimeMethodIds.auth.registerApp) {
          return {
            responseBytesBase64: Buffer.from(
              RegisterAppResponse.toBinary(RegisterAppResponse.create({ accepted: true })),
            ).toString('base64'),
          };
        }
        if (captured.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
          const request = AuthorizeExternalPrincipalRequest.fromBinary(
            Buffer.from(String(captured.requestBytesBase64 || ''), 'base64'),
          );
          authorizeRequests.push(request);
          return {
            responseBytesBase64: Buffer.from(AuthorizeExternalPrincipalResponse.toBinary(
              AuthorizeExternalPrincipalResponse.create({
                tokenId: 'runtime-agent-turn-read-token',
                secret: 'runtime-agent-turn-read-secret',
                appId: APP_ID,
                subjectUserId: 'user-1',
                externalPrincipalId: APP_ID,
                effectiveScopes: request.scopes,
                policyVersion: 'runtime-protected-access-v1',
                issuedScopeCatalogVersion: 'sdk-v2',
              }),
            )).toString('base64'),
          };
        }
        if (captured.methodId === RuntimeMethodIds.agent.getPublicChatSessionSnapshot) {
          return {
            responseBytesBase64: Buffer.from(
              GetPublicChatSessionSnapshotResponse.toBinary(GetPublicChatSessionSnapshotResponse.create({})),
            ).toString('base64'),
          };
        }
        throw new Error(`unexpected method: ${String(captured.methodId || '')}`);
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      auth: {
        appSession: () => ({
          sessionId: 'runtime-session-id',
          sessionToken: 'runtime-session-token',
        }),
      },
      subjectContext: {
        subjectUserId: 'user-1',
      },
    });

    await runtime.agent.turns.getSessionSnapshot({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
    });

    const snapshotPayload = capturedPayloads.find((captured) => captured.methodId === RuntimeMethodIds.agent.getPublicChatSessionSnapshot);
    assert.deepEqual(authorizeRequests.map((request) => request.scopes), [['runtime.agent.turn.read']]);
    assert.deepEqual(snapshotPayload?.protectedAccessToken, {
      tokenId: 'runtime-agent-turn-read-token',
      secret: 'runtime-agent-turn-read-secret',
    });
    assert.deepEqual(snapshotPayload?.appSession, {
      sessionId: 'runtime-session-id',
      sessionToken: 'runtime-session-token',
    });
  } finally {
    restoreTauri();
  }
});
