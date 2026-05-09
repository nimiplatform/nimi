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

test('S-ERROR-011: AUTH_TOKEN_EXPIRED, AUTH_UNSUPPORTED_PROOF_TYPE, AUTH_TOKEN_INVALID are not retryable; SESSION_EXPIRED is retryable', () => {
  // ExternalPrincipal auth failure codes must never be retried
  assert.equal(isRetryableReasonCode(ReasonCode.AUTH_TOKEN_EXPIRED), false,
    'AUTH_TOKEN_EXPIRED must not be retryable');
  assert.equal(isRetryableReasonCode(ReasonCode.AUTH_UNSUPPORTED_PROOF_TYPE), false,
    'AUTH_UNSUPPORTED_PROOF_TYPE must not be retryable');
  assert.equal(isRetryableReasonCode(ReasonCode.AUTH_TOKEN_INVALID), false,
    'AUTH_TOKEN_INVALID must not be retryable');

  // SESSION_EXPIRED is a transient condition and IS retryable (contrast)
  assert.equal(isRetryableReasonCode(ReasonCode.SESSION_EXPIRED), true,
    'SESSION_EXPIRED must be retryable');
});

// --- S-RUNTIME-066: pagination defaults are not overridden by SDK ---

test('S-RUNTIME-066: SDK pagination passthrough does not override runtime defaults', async () => {
  const capturedRequests: { methodId: string; request: Uint8Array }[] = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.connector.listConnectors) {
        capturedRequests.push({
          methodId: input.methodId,
          request: new Uint8Array(input.request),
        });
        // Return an empty protobuf response (default ListConnectorsResponse)
        return new Uint8Array(0);
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
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
    });

    await runtime.connect();

    // Call with explicit pagination params
    await runtime.connector.listConnectors({
      pageSize: 100,
      pageToken: 'abc',
      kindFilter: 0,
      statusFilter: 0,
      providerFilter: '',
    });

    // Call with no pagination params (all defaults)
    await runtime.connector.listConnectors({
      pageSize: 0,
      pageToken: '',
      kindFilter: 0,
      statusFilter: 0,
      providerFilter: '',
    });

    assert.equal(capturedRequests.length, 2, 'expected two listConnectors calls');

    // First call: SDK must encode pageSize=100 and pageToken='abc' as provided
    // Protobuf encodes non-default values, so the binary must be non-empty
    assert.ok(capturedRequests[0].request.length > 0,
      'request with explicit pagination must encode non-default fields');

    // Second call: SDK must NOT inject default pageSize or pageToken
    // Proto3 omits default values (pageSize=0, pageToken=''), so binary is empty
    assert.equal(capturedRequests[1].request.length, 0,
      'SDK must not inject default pageSize or pageToken when caller provides none');
  } finally {
    clearNodeGrpcBridge();
  }
});

// --- S-RUNTIME-050: blocked vs deferred distinction ---

test('S-RUNTIME-050: Phase 2 deferred method propagates SDK_RUNTIME_METHOD_UNAVAILABLE', async () => {
  installNodeGrpcBridge({
    invokeUnary: async (config, input) => {
      // Emit runtime version 0.4.0 to trigger version detection
      if (config._responseMetadataObserver) {
        config._responseMetadataObserver({ 'x-nimi-runtime-version': '0.4.0' });
      }

      if (input.methodId === RuntimeMethodIds.ai.executeScenario) {
        return ExecuteScenarioResponse.toBinary(
          ExecuteScenarioResponse.create({
            output: textGenerateOutput('version-seed'),
            finishReason: FinishReason.STOP,
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/test',
            traceId: 'trace-phase2',
          }),
        );
      }

      // Phase 2 workflow method: runtime rejects with unavailable
      if (input.methodId === RuntimeMethodIds.workflow.submit) {
        throw {
          reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
          message: 'workflow.submit is unavailable: runtime version 0.4.0 does not support this Phase 2 deferred method',
          actionHint: 'upgrade_runtime_to_support_phase2_method',
          retryable: false,
        };
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
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      subjectContext: { subjectUserId: 'phase2-user' },
    });

    // Trigger version detection via an AI call
    await runtime.ai.text.generate({ model: 'local/test', input: 'seed' });
    assert.equal(runtime.runtimeVersion(), '0.4.0');

    // Call a Phase 2 deferred method (workflow.submit)
    let thrown: unknown = null;
    try {
      await runtime.workflow.submit({
        appId: APP_ID,
        subjectUserId: 'phase2-user',
        timeoutMs: 5000,
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'Phase 2 deferred method must throw when unavailable');
    const nimiError = asNimiError(thrown, { source: 'sdk' });
    assert.equal(nimiError.reasonCode, ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
      'reasonCode must be SDK_RUNTIME_METHOD_UNAVAILABLE, not a generic blocked error');
    assert.ok(
      nimiError.actionHint.includes('admission') || nimiError.message.includes('runtime-method-groups'),
      'error must reference method-group admission context in actionHint or message',
    );
  } finally {
    clearNodeGrpcBridge();
  }
});
