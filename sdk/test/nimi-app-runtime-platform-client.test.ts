import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  clearPlatformClient,
  createNimiAppRuntimePlatformClient,
} from '../src/index.js';
import { RuntimeMethodIds, setNodeGrpcBridge } from '../src/runtime/index.js';
import { ExecuteScenarioRequest, ExecuteScenarioResponse, FinishReason, RoutePolicy } from '../src/runtime/generated/runtime/v1/ai.js';
import { SendAppMessageResponse } from '../src/runtime/generated/runtime/v1/app.js';
import { RegisterAppRequest, RegisterAppResponse } from '../src/runtime/generated/runtime/v1/auth.js';
import { AuthorizeExternalPrincipalRequest, AuthorizeExternalPrincipalResponse } from '../src/runtime/generated/runtime/v1/grant.js';
import { ReasonCode } from '../src/types/index.js';
import { textGenerateOutput } from './helpers/runtime-ai-shapes.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const helperSourcePath = path.join(testDir, '..', 'src', 'nimi-app-runtime-platform-client.ts');

test('root SDK exports Nimi App Runtime platform helper', () => {
  assert.equal(typeof createNimiAppRuntimePlatformClient, 'function');
});

test('third-party Nimi App mode fails closed without self-declared first-party Runtime account path', async () => {
  clearPlatformClient();
  let runtimeCalls = 0;
  setNodeGrpcBridge({
    invokeUnary: async () => {
      runtimeCalls += 1;
      throw new Error('third-party helper must not call Runtime account token path');
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const projection = await createNimiAppRuntimePlatformClient({
      mode: 'third-party-nimi-app',
      appId: 'nimi.sdk.app.third-party',
      realmBaseUrl: 'https://realm.example',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });

    assert.equal(projection.status, 'unavailable');
    assert.equal(projection.reasonCode, ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE);
    assert.equal(runtimeCalls, 0);
  } finally {
    setNodeGrpcBridge(null);
  }
});

test('dev-standalone mode requires explicit Runtime developer session', async () => {
  clearPlatformClient();
  const projection = await createNimiAppRuntimePlatformClient({
    mode: 'dev-standalone',
    appId: 'nimi.sdk.app.dev.missing-session',
    realmBaseUrl: 'https://realm.example',
    runtimeTransport: null,
  });

  assert.equal(projection.status, 'action-required');
  assert.equal(projection.reasonCode, ReasonCode.PRINCIPAL_UNAUTHORIZED);
  assert.match(projection.actionHint, /developer_session/);
});

test('dev-standalone mode forwards explicit Runtime app session to Runtime calls', async () => {
  clearPlatformClient();
  let forwardedSession: { sessionId?: string; sessionToken?: string } | undefined;
  let forwardedAuthorization: string | undefined;
  setNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      forwardedSession = input.appSession;
      forwardedAuthorization = input.authorization;
      return SendAppMessageResponse.toBinary(SendAppMessageResponse.create({}));
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const projection = await createNimiAppRuntimePlatformClient({
      mode: 'dev-standalone',
      appId: 'nimi.sdk.app.dev.session',
      realmBaseUrl: 'https://realm.example',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      developerSession: {
        source: 'runtime-developer-session',
        sessionId: 'developer-session-id',
        sessionToken: 'developer-session-token',
      },
    });

    assert.equal(projection.status, 'ready');
    await projection.client.runtime.app.sendMessage({
      fromAppId: 'nimi.sdk.app.dev.session',
      toAppId: 'runtime.agent',
      subjectUserId: 'developer-user',
      messageType: 'runtime.agent.turn.request',
      requireAck: false,
    });
    assert.deepEqual(forwardedSession, {
      sessionId: 'developer-session-id',
      sessionToken: 'developer-session-token',
    });
    assert.equal(forwardedAuthorization, undefined);
  } finally {
    setNodeGrpcBridge(null);
  }
});

test('dev-standalone Runtime AI text.generate issues sdk-v2 protected spend token', async () => {
  clearPlatformClient();
  const calls: string[] = [];
  let registeredAppId = '';
  let authorizedScopeCatalogVersion = '';
  let authorizedScopes: string[] = [];
  let authorizedSubjectUserId = '';
  let executeProtectedToken: { tokenId?: string; secret?: string } | undefined;
  let executeAuthorization: string | undefined;
  let executeSubjectUserId = '';

  setNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      calls.push(input.methodId);
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        const request = RegisterAppRequest.fromBinary(input.request);
        registeredAppId = request.appId;
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          appInstanceId: request.appInstanceId,
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        authorizedScopeCatalogVersion = request.scopeCatalogVersion;
        authorizedScopes = request.scopes;
        authorizedSubjectUserId = request.subjectUserId;
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: 'protected-ai-token',
          appId: request.appId,
          subjectUserId: request.subjectUserId,
          externalPrincipalId: request.externalPrincipalId,
          effectiveScopes: request.scopes,
          policyVersion: request.policyVersion,
          issuedScopeCatalogVersion: request.scopeCatalogVersion,
          canDelegate: false,
          secret: 'protected-ai-secret',
        }));
      }
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        executeProtectedToken = input.protectedAccessToken;
        executeAuthorization = input.authorization;
        const request = ExecuteScenarioRequest.fromBinary(input.request);
        executeSubjectUserId = request.head?.subjectUserId || '';
        return ExecuteScenarioResponse.toBinary(ExecuteScenarioResponse.create({
          output: textGenerateOutput('nimi runtime llm ok'),
          finishReason: FinishReason.STOP,
          routeDecision: RoutePolicy.LOCAL,
          modelResolved: 'local.chat.gemma-4-e2b-it.q8-0',
          traceId: 'trace-dev-ai',
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const projection = await createNimiAppRuntimePlatformClient({
      mode: 'dev-standalone',
      appId: 'nimi.example-app',
      realmBaseUrl: 'https://realm.example',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      developerSession: {
        source: 'runtime-developer-session',
        sessionId: 'developer-session-id',
        sessionToken: 'developer-session-token',
      },
    });

    assert.equal(projection.status, 'ready');
    const output = await projection.client.runtime.ai.text.generate({
      route: 'local',
      connectorId: '01KS723RD9R2TBFQ2D1Q8W1Q4G',
      model: 'local.chat.gemma-4-e2b-it.q8-0',
      subjectUserId: 'developer-local',
      input: 'Reply with exactly: nimi runtime llm ok',
      metadata: {
        callerKind: 'third-party-app',
        callerId: 'nimi.example-app',
        surfaceId: 'nimi.example-app.ai.text.generate.smoke',
      },
    });

    assert.equal(output.text, 'nimi runtime llm ok');
    assert.equal(registeredAppId, 'nimi.example-app');
    assert.equal(authorizedScopeCatalogVersion, 'sdk-v2');
    assert.deepEqual(authorizedScopes, ['ai.spend.meter']);
    assert.equal(authorizedSubjectUserId, 'developer-local');
    assert.deepEqual(executeProtectedToken, {
      tokenId: 'protected-ai-token',
      secret: 'protected-ai-secret',
    });
    assert.equal(executeAuthorization, undefined);
    assert.equal(executeSubjectUserId, 'developer-local');
    assert.deepEqual(calls, [
      RuntimeMethodIds.auth.registerApp,
      RuntimeMethodIds.appAuth.authorizeExternalPrincipal,
      RuntimeMethodIds.ai.executeScenario,
    ]);
  } finally {
    setNodeGrpcBridge(null);
  }
});

test('helper input source does not expose app-owned auth custody seams', () => {
  const source = readFileSync(helperSourcePath, 'utf8');
  for (const forbidden of [
    'accessToken?:',
    'accessTokenProvider',
    'refreshTokenProvider',
    'subjectUserIdProvider',
    'sessionStore',
    'password',
    'decodeJwtSubject',
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must stay out of Nimi App helper input`);
  }

  const thirdPartyBranch = source.slice(
    source.indexOf("if (mode === 'third-party-nimi-app')"),
    source.indexOf('const developerSession = input.developerSession'),
  );
  assert.equal(thirdPartyBranch.includes('createLocalFirstPartyRuntimePlatformClient'), false);
  assert.equal(thirdPartyBranch.includes('GetAccessToken'), false);
});
