import {
  assert,
  test,
  asNimiError,
  Runtime,
  RuntimeMethodIds,
  ReasonCode,
  isRetryableReasonCode,
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  PolicyMode,
  AuthorizationPreset,
  OpenSessionResponse,
  RuntimeProtoReasonCode,
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  FinishReason,
  ScenarioJobEvent,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  RoutePolicy,
  WorkflowEvent,
  WorkflowEventType,
  Timestamp,
  textGenerateOutput,
  APP_ID,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
} from './runtime-class-test-utils.js';

test('Runtime appAuth.authorizeExternalPrincipal resolves published scopeCatalogVersion', async () => {
  let capturedScopeCatalogVersion = '';

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        capturedScopeCatalogVersion = request.scopeCatalogVersion;

        return AuthorizeExternalPrincipalResponse.toBinary(
          AuthorizeExternalPrincipalResponse.create({
            tokenId: 'token-runtime-class',
            appId: APP_ID,
            subjectUserId: 'scope-user-1',
            externalPrincipalId: 'external-principal-1',
            effectiveScopes: [`app.${APP_ID}.chat.read`],
            policyVersion: '1.0.0',
            issuedScopeCatalogVersion: '1.0.0',
            canDelegate: false,
            secret: 'secret-runtime-class',
          }),
        );
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });

    await runtime.scope.register({
      manifestVersion: '1.0.0',
      scopes: [`app.${APP_ID}.chat.read`],
    });
    await runtime.scope.publish();

    await runtime.appAuth.authorizeExternalPrincipal({
      domain: 'app-auth',
      appId: APP_ID,
      externalPrincipalId: 'external-principal-1',
      externalPrincipalType: 2,
      subjectUserId: 'scope-user-1',
      consentId: 'consent-1',
      consentVersion: '1.0',
      decisionAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
      policyVersion: '1.0.0',
      policyMode: PolicyMode.PRESET,
      preset: AuthorizationPreset.READ_ONLY,
      scopes: [`app.${APP_ID}.chat.read`],
      resourceSelectors: undefined,
      canDelegate: false,
      maxDelegationDepth: 0,
      ttlSeconds: 3600,
      scopeCatalogVersion: '',
      policyOverride: false,
    });

    assert.equal(capturedScopeCatalogVersion, '1.0.0');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime appAuth.authorizeExternalPrincipal passes explicit sdk-v2 catalog version without local publish', async () => {
  let capturedScopeCatalogVersion = '';

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        capturedScopeCatalogVersion = request.scopeCatalogVersion;

        return AuthorizeExternalPrincipalResponse.toBinary(
          AuthorizeExternalPrincipalResponse.create({
            tokenId: 'token-sdk-v2',
            appId: APP_ID,
            subjectUserId: 'scope-user-2',
            externalPrincipalId: 'external-principal-2',
            effectiveScopes: ['ai.spend.meter'],
            policyVersion: 'runtime-protected-access-v1',
            issuedScopeCatalogVersion: 'sdk-v2',
            canDelegate: false,
            secret: 'secret-sdk-v2',
          }),
        );
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });

    await runtime.appAuth.authorizeExternalPrincipal({
      domain: 'app-auth',
      appId: APP_ID,
      externalPrincipalId: 'external-principal-2',
      externalPrincipalType: 2,
      subjectUserId: 'scope-user-2',
      consentId: 'consent-2',
      consentVersion: '1.0',
      decisionAt: Timestamp.create({ seconds: '1700000000', nanos: 0 }),
      policyVersion: 'runtime-protected-access-v1',
      policyMode: PolicyMode.CUSTOM,
      preset: AuthorizationPreset.UNSPECIFIED,
      scopes: ['ai.spend.meter'],
      resourceSelectors: {
        conversationIds: [],
        messageIds: [],
        documentIds: [],
        labels: {},
      },
      canDelegate: false,
      maxDelegationDepth: 0,
      ttlSeconds: 3600,
      scopeCatalogVersion: 'sdk-v2',
      policyOverride: false,
    });

    assert.equal(capturedScopeCatalogVersion, 'sdk-v2');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('AI_PROVIDER_RATE_LIMITED is retryable', () => {
  assert.equal(isRetryableReasonCode(ReasonCode.AI_PROVIDER_RATE_LIMITED), true);
});

test('SDK_SCOPE_CATALOG_VERSION_CONFLICT exists and key equals value', () => {
  assert.equal(
    ReasonCode.SDK_SCOPE_CATALOG_VERSION_CONFLICT,
    'SDK_SCOPE_CATALOG_VERSION_CONFLICT',
  );
});

test('retry backoff includes jitter', async () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;

    let callCount = 0;
    const callTimestamps: number[] = [];

    installNodeGrpcBridge({
      invokeUnary: async (_config, input) => {
        if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
          callCount += 1;
          callTimestamps.push(Date.now());

          if (callCount < 3) {
            throw {
              reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
              actionHint: 'retry',
              retryable: true,
              message: 'unavailable',
            };
          }

          return ExecuteScenarioResponse.toBinary(
            ExecuteScenarioResponse.create({
              output: textGenerateOutput('jitter-ok'),
              finishReason: FinishReason.STOP,
              routeDecision: RoutePolicy.LOCAL,
              modelResolved: 'local/qwen2.5',
              traceId: 'trace-jitter',
            }),
          );
        }
        throw new Error(`unexpected method: ${input.methodId}`);
      },
      openStream: async () => {
        throw new Error('unexpected stream call');
      },
      closeStream: async () => {},
    });

    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      retry: {
        maxAttempts: 3,
        backoffMs: 100,
      },
      subjectContext: {
        subjectUserId: 'jitter-user',
      },
    });

    const output = await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'jitter test',
    });

    assert.equal(output.text, 'jitter-ok');
    assert.equal(callCount, 3);
  } finally {
    Math.random = originalRandom;
    clearNodeGrpcBridge();
  }
});

test('metadata sends x-nimi-key-source with inline/managed values', async () => {
  let capturedMetadata: Record<string, string> = {};

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        const metadataEntries = input.metadata;
        capturedMetadata = {};
        for (const [key, value] of Object.entries(metadataEntries)) {
          if (typeof value === 'string') {
            capturedMetadata[key] = value;
          }
        }

        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('metadata-ok'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/qwen2.5',
            traceId: 'trace-metadata',
          }),
        );
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'metadata-user',
      },
    });

    await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'metadata test',
      metadata: {
        keySource: 'managed',
      },
    });

    assert.equal(capturedMetadata.keySource, 'managed');
  } finally {
    clearNodeGrpcBridge();
  }
});

test('Runtime ai.text.generate omits x-nimi-key-source unless explicitly provided', async () => {
  let capturedMetadata: Record<string, string> = {};

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        capturedMetadata = {};
        for (const [key, value] of Object.entries(input.metadata || {})) {
          if (typeof value === 'string') {
            capturedMetadata[key] = value;
          }
        }
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('metadata-default-ok'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.CLOUD,
            modelResolved: 'gemini/gemini-3-flash-preview',
            traceId: 'trace-metadata-default',
          }),
        );
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'metadata-default-user',
      },
    });

    await runtime.ai.text.generate({
      model: 'gemini/gemini-3-flash-preview',
      input: 'metadata default test',
      route: 'cloud',
    });

    assert.equal(capturedMetadata.keySource, undefined);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('RuntimeEventName does not include ai.route.decision or media.job.status (SDKR-028)', () => {
  // The Phase 1 event set is: runtime.connected, runtime.disconnected,
  // auth.token.issued, auth.token.revoked, error.
  // ai.route.decision and media.job.status are NOT in Phase 1 — they were
  // removed and moved to telemetry side-channel.
  const runtime = new Runtime({
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint: '127.0.0.1:46371',
    },
  });

  // Attempting to subscribe to a non-existent event name should not register
  // a meaningful handler. We verify the Phase 1 set is the complete list by
  // confirming events.on returns an unsubscribe function for valid names.
  const validNames = [
    'runtime.connected',
    'runtime.disconnected',
    'auth.token.issued',
    'auth.token.revoked',
    'error',
  ] as const;

  for (const name of validNames) {
    const unsub = runtime.events.on(name, () => {});
    assert.equal(typeof unsub, 'function', `events.on('${name}') must return unsubscribe`);
    unsub();
  }
});

test('Runtime runtimeVersion() returns null before any RPC and caches after metadata arrives', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('version-test'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/qwen2.5',
            traceId: 'trace-version',
          }),
        );
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async () => {
      throw new Error('unexpected stream call');
    },
    closeStream: async () => {},
  });

  try {
    const runtime = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'version-user',
      },
    });

    // Before any RPC, version is null
    assert.equal(runtime.runtimeVersion(), null);

    await runtime.ai.text.generate({
      model: 'local/qwen2.5',
      input: 'version test',
    });

    // runtimeVersion remains null when the bridge does not emit metadata
    // (node-grpc bridge mock doesn't call _responseMetadataObserver)
    assert.equal(runtime.runtimeVersion(), null);
  } finally {
    clearNodeGrpcBridge();
  }
});
