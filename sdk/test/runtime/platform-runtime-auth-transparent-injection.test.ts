import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearPlatformClient,
  createPlatformClient,
  getPlatformClient,
} from '../../src/platform-client.js';
import {
  AuthorizeExternalPrincipalResponse,
} from '../../src/runtime/generated/runtime/v1/grant.js';
import {
  ExecuteScenarioRequest,
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
} from '../../src/runtime/generated/runtime/v1/ai.js';
import {
  OpenSessionResponse,
  RegisterAppResponse,
} from '../../src/runtime/generated/runtime/v1/auth.js';
import {
  ConversationAnchor,
  ConversationAnchorStatus,
  GetConversationAnchorSnapshotResponse,
} from '../../src/runtime/generated/runtime/v1/agent_service.js';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp.js';
import { RuntimeMethodIds } from '../../src/runtime/method-ids.js';
import {
  installTauriRuntime,
  unwrapTauriInvokePayload,
} from './runtime-client-fixtures.js';

const APP_ID = 'nimi.sdk.platform-auth.test';

type TauriInvokeCall = {
  command: string;
  payload: Record<string, unknown>;
};

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createJwtWithSub(sub: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({ sub }));
  return `${header}.${payload}.signature`;
}

function installPlatformRuntime(calls: TauriInvokeCall[]): () => void {
  return installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        const normalizedPayload = unwrapTauriInvokePayload(payload);
        calls.push({
          command,
          payload: normalizedPayload,
        });
        if (command !== 'runtime_bridge_unary') {
          return { responseBytesBase64: '' };
        }

        const methodId = String(normalizedPayload.methodId || '').trim();
        if (methodId === RuntimeMethodIds.auth.registerApp) {
          return {
            responseBytesBase64: Buffer.from(
              RegisterAppResponse.toBinary(RegisterAppResponse.create({
                appInstanceId: `${APP_ID}.runtime-session`,
                accepted: true,
                reasonCode: 1,
              })),
            ).toString('base64'),
          };
        }
        if (methodId === RuntimeMethodIds.auth.openSession) {
          return {
            responseBytesBase64: Buffer.from(
              OpenSessionResponse.toBinary(OpenSessionResponse.create({
                sessionId: 'runtime-session-id',
                sessionToken: 'runtime-session-token',
                issuedAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
                expiresAt: Timestamp.create({ seconds: '4700000000', nanos: 0 }),
                reasonCode: 1,
              })),
            ).toString('base64'),
          };
        }
        if (methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
          return {
            responseBytesBase64: Buffer.from(
              AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
                tokenId: 'runtime-agent-anchor-token',
                secret: 'runtime-agent-anchor-secret',
                appId: APP_ID,
                subjectUserId: 'subject-user',
                externalPrincipalId: APP_ID,
                effectiveScopes: ['runtime.agent.read'],
                policyVersion: '1.0.0',
                issuedScopeCatalogVersion: '1.0.0',
                canDelegate: false,
              })),
            ).toString('base64'),
          };
        }
        if (methodId === RuntimeMethodIds.agent.getConversationAnchorSnapshot) {
          return {
            responseBytesBase64: Buffer.from(
              GetConversationAnchorSnapshotResponse.toBinary(GetConversationAnchorSnapshotResponse.create({
                snapshot: {
                  anchor: ConversationAnchor.create({
                    conversationAnchorId: 'anchor-1',
                    agentId: 'agent-1',
                    subjectUserId: 'subject-user',
                    status: ConversationAnchorStatus.ACTIVE,
                  }),
                },
              })),
            ).toString('base64'),
          };
        }
        return { responseBytesBase64: '' };
      },
    },
    event: {
      listen: () => () => {},
    },
  });
}

async function createTransparentAuthPlatformClient(input: {
  accessTokenProvider?: () => string;
  subjectUserIdProvider?: () => string;
}): Promise<void> {
  await createPlatformClient({
    appId: APP_ID,
    authMode: 'external-principal',
    realmBaseUrl: 'http://localhost:3002',
    accessTokenProvider: input.accessTokenProvider,
    subjectUserIdProvider: input.subjectUserIdProvider,
  });
}

function createGenerateRequest(routePolicy: RoutePolicy, modelId: string): ExecuteScenarioRequest {
  return {
    head: {
      appId: getPlatformClient().runtime.appId,
      modelId,
      routePolicy,
      timeoutMs: 1000,
      connectorId: '',
    },
    scenarioType: ScenarioType.TEXT_GENERATE,
    executionMode: ExecutionMode.SYNC,
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'textGenerate',
        textGenerate: {
          input: [{
            role: 'user',
            content: 'hello',
            name: '',
            parts: [],
          }],
          systemPrompt: '',
          tools: [],
          temperature: 0,
          topP: 0,
          maxTokens: 32,
        },
      },
    },
  };
}

async function invokeGenerateWithoutSubject(): Promise<void> {
  await getPlatformClient().runtime.ai.executeScenario(createGenerateRequest(RoutePolicy.CLOUD, 'cloud/default'));
}

async function invokeLocalGenerateWithoutSubject(): Promise<void> {
  await getPlatformClient().runtime.ai.executeScenario(
    createGenerateRequest(RoutePolicy.LOCAL, 'llama/bartowski/Qwen_Qwen3.5-0.8B-GGUF'),
  );
}

function findUnaryCallByMethodId(
  calls: TauriInvokeCall[],
  methodId: string,
): TauriInvokeCall | undefined {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const item = calls[index];
    if (item?.command === 'runtime_bridge_unary' && item.payload.methodId === methodId) {
      return item;
    }
  }
  return undefined;
}

function decodeExecuteScenarioRequest(call: TauriInvokeCall): ExecuteScenarioRequest {
  const requestBytesBase64 = String(call.payload.requestBytesBase64 || '').trim();
  assert.ok(requestBytesBase64.length > 0);
  return ExecuteScenarioRequest.fromBinary(Buffer.from(requestBytesBase64, 'base64'));
}

test('platform runtime call injects bearer token from accessTokenProvider', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => 'token-provider-value',
    });

    await getPlatformClient().runtime.connector.listConnectors({} as never);

    const unaryCall = calls.find((item) => item.command === 'runtime_bridge_unary');
    assert.ok(unaryCall);
    assert.equal(unaryCall.payload.authorization, 'Bearer token-provider-value');
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform runtime call resolves fresh token on each invocation', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  let currentToken = 'token-initial';
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => currentToken,
    });

    await getPlatformClient().runtime.connector.listConnectors({} as never);
    currentToken = 'token-refreshed';
    await getPlatformClient().runtime.connector.listConnectors({} as never);

    const unaryCalls = calls.filter((item) => item.command === 'runtime_bridge_unary');
    assert.ok(unaryCalls.length >= 2);
    assert.equal(unaryCalls[0]?.payload.authorization, 'Bearer token-initial');
    assert.equal(unaryCalls[1]?.payload.authorization, 'Bearer token-refreshed');
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform runtime call injects subjectUserId from subjectUserIdProvider', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => createJwtWithSub('jwt-subject-user'),
      subjectUserIdProvider: () => 'subject-from-provider',
    });

    await invokeGenerateWithoutSubject();
    const unaryCall = findUnaryCallByMethodId(calls, RuntimeMethodIds.ai.executeScenario);
    assert.ok(unaryCall);
    assert.equal(decodeExecuteScenarioRequest(unaryCall).head?.subjectUserId, 'subject-from-provider');
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform runtime call falls back to jwt sub when subjectUserIdProvider is empty', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => createJwtWithSub('jwt-subject-fallback'),
      subjectUserIdProvider: () => '',
    });

    await invokeGenerateWithoutSubject();
    const unaryCall = findUnaryCallByMethodId(calls, RuntimeMethodIds.ai.executeScenario);
    assert.ok(unaryCall);
    assert.equal(decodeExecuteScenarioRequest(unaryCall).head?.subjectUserId, 'jwt-subject-fallback');
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform runtime call omits authorization when token provider returns empty', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => '',
    });

    await getPlatformClient().runtime.connector.listConnectors({} as never);

    const unaryCall = calls.find((item) => item.command === 'runtime_bridge_unary');
    assert.ok(unaryCall);
    assert.equal(unaryCall.payload.authorization, undefined);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform local ai call omits authorization even when token provider returns a token', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => 'stale-realm-token',
    });

    await invokeLocalGenerateWithoutSubject();

    const unaryCall = findUnaryCallByMethodId(calls, RuntimeMethodIds.ai.executeScenario);
    assert.ok(unaryCall);
    assert.equal(unaryCall.payload.authorization, undefined);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform local read-only calls omit authorization even when token provider returns a token', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => 'stale-realm-token',
    });

    await getPlatformClient().runtime.local.listLocalAssets({} as never);
    await getPlatformClient().runtime.local.warmLocalAsset({
      localAssetId: 'local-model-1',
      timeoutMs: 60_000,
    });

    const listCall = findUnaryCallByMethodId(calls, RuntimeMethodIds.local.listLocalAssets);
    assert.ok(listCall);
    assert.equal(listCall.payload.authorization, undefined);

    const warmCall = findUnaryCallByMethodId(calls, RuntimeMethodIds.local.warmLocalAsset);
    assert.ok(warmCall);
    assert.equal(warmCall.payload.authorization, undefined);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform cloud ai call still injects authorization', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => 'fresh-realm-token',
      subjectUserIdProvider: () => 'subject-user',
    });

    await invokeGenerateWithoutSubject();

    const unaryCall = findUnaryCallByMethodId(calls, RuntimeMethodIds.ai.executeScenario);
    assert.ok(unaryCall);
    assert.equal(unaryCall.payload.authorization, 'Bearer fresh-realm-token');
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform runtime app call injects runtime app session transparently', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => createJwtWithSub('jwt-subject-user'),
      subjectUserIdProvider: () => 'subject-user',
    });

    await getPlatformClient().runtime.app.sendMessage({
      fromAppId: getPlatformClient().runtime.appId,
      toAppId: 'runtime.agent',
      subjectUserId: 'subject-user',
      messageType: 'runtime.agent.turn.request',
      payload: undefined,
      requireAck: false,
    });

    assert.ok(findUnaryCallByMethodId(calls, RuntimeMethodIds.auth.registerApp));
    assert.ok(findUnaryCallByMethodId(calls, RuntimeMethodIds.auth.openSession));

    const sendCall = findUnaryCallByMethodId(calls, RuntimeMethodIds.app.sendAppMessage);
    assert.ok(sendCall);
    assert.deepEqual(sendCall.payload.appSession, {
      sessionId: 'runtime-session-id',
      sessionToken: 'runtime-session-token',
    });
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('platform runtime agent anchor call uses admitted SDK runtime method with protected token', async () => {
  clearPlatformClient();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installPlatformRuntime(calls);
  try {
    await createTransparentAuthPlatformClient({
      accessTokenProvider: () => createJwtWithSub('jwt-subject-user'),
      subjectUserIdProvider: () => 'subject-user',
    });

    await getPlatformClient().runtime.agent.anchors.getSnapshot({
      ownerUserId: 'user-1',
      realmAgentId: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      conversationAnchorId: 'anchor-1',
    });

    const snapshotCall = findUnaryCallByMethodId(
      calls,
      RuntimeMethodIds.agent.getConversationAnchorSnapshot,
    );
    assert.ok(snapshotCall);
    assert.deepEqual(snapshotCall.payload.appSession, {
      sessionId: 'runtime-session-id',
      sessionToken: 'runtime-session-token',
    });
    assert.deepEqual(snapshotCall.payload.protectedAccessToken, {
      tokenId: 'runtime-agent-anchor-token',
      secret: 'runtime-agent-anchor-secret',
    });
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});
