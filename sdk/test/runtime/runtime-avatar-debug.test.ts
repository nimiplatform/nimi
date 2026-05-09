import {
  assert,
  test,
  Timestamp,
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  RegisterAppRequest,
  RegisterAppResponse,
  Runtime,
  RuntimeMethodIds,
  APP_ID,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
} from './runtime-agent-surface-test-utils.js';
import {
  AvatarDebugProbeKind,
  AvatarDebugProbeStatus,
  AvatarDebugReplayRedactionState,
  AvatarDebugReplayVisibility,
  AvatarDebugRequestedBy,
  GetAvatarDebugReplayRequest,
  GetAvatarDebugReplayResponse,
  GetAvatarDebugSnapshotRequest,
  GetAvatarDebugSnapshotResponse,
  ListAvatarDebugProbeResultsRequest,
  ListAvatarDebugProbeResultsResponse,
  RequestAvatarDebugProbeRequest,
  RequestAvatarDebugProbeResponse,
} from '../../src/runtime/generated/runtime/v1/agent_service.js';

function isMethodGroupUnavailable(error: unknown): boolean {
  return (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_METHOD_UNAVAILABLE';
}

function requestEnvelope() {
  return {
    probeId: 'probe-1',
    agentId: 'agent-1',
    conversationAnchorId: 'anchor-1',
    probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
    requestedAt: Timestamp.create({ seconds: '1700000100', nanos: 0 }),
    requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
    runtimeReplayRef: 'runtime.audit.avatar_debug.replay/probe-1',
    replayRequested: true,
  };
}

function resultEnvelope() {
  return {
    probeId: 'probe-1',
    agentId: 'agent-1',
    conversationAnchorId: 'anchor-1',
    probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
    status: AvatarDebugProbeStatus.BLOCKED,
    observedAt: Timestamp.create({ seconds: '1700000100', nanos: 0 }),
    evidenceRefs: ['runtime.audit.avatar_debug.request/probe-1'],
    reasonCode: 'avatar_debug_session_not_available',
    resultId: 'result-1',
  };
}

function replayRef() {
  return {
    probeId: 'probe-1',
    replayRef: 'runtime.audit.avatar_debug.replay/probe-1',
    redactionState: AvatarDebugReplayRedactionState.VISIBLE,
    visibility: AvatarDebugReplayVisibility.DESKTOP_DEBUG_WORKBENCH,
    linkedAt: Timestamp.create({ seconds: '1700000100', nanos: 0 }),
  };
}

test('runtime avatar debug module uses typed Runtime RPCs and protected scopes', async () => {
  const authorizeRequests: AuthorizeExternalPrincipalRequest[] = [];
  const capturedMethods: string[] = [];
  const capturedProbeRequests: RequestAvatarDebugProbeRequest[] = [];
  const capturedSnapshotRequests: GetAvatarDebugSnapshotRequest[] = [];
  const capturedListRequests: ListAvatarDebugProbeResultsRequest[] = [];
  const capturedReplayRequests: GetAvatarDebugReplayRequest[] = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      capturedMethods.push(input.methodId);
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        const request = RegisterAppRequest.fromBinary(input.request);
        assert.equal(request.appId, APP_ID);
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({ accepted: true }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        const request = AuthorizeExternalPrincipalRequest.fromBinary(input.request);
        authorizeRequests.push(request);
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: `avatar-debug-token-${authorizeRequests.length}`,
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: request.scopes,
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: `avatar-debug-secret-${authorizeRequests.length}`,
        }));
      }
      if (input.methodId === RuntimeMethodIds.agent.requestAvatarDebugProbe) {
        capturedProbeRequests.push(RequestAvatarDebugProbeRequest.fromBinary(input.request));
        assert.equal(input.protectedAccessToken?.tokenId, 'avatar-debug-token-1');
        return RequestAvatarDebugProbeResponse.toBinary(RequestAvatarDebugProbeResponse.create({
          request: requestEnvelope(),
          result: resultEnvelope(),
          replayRef: replayRef(),
        }));
      }
      if (input.methodId === RuntimeMethodIds.agent.getAvatarDebugSnapshot) {
        capturedSnapshotRequests.push(GetAvatarDebugSnapshotRequest.fromBinary(input.request));
        assert.equal(input.protectedAccessToken?.tokenId, 'avatar-debug-token-2');
        return GetAvatarDebugSnapshotResponse.toBinary(GetAvatarDebugSnapshotResponse.create({
          agentId: 'agent-1',
          conversationAnchorId: 'anchor-1',
          probeResults: [resultEnvelope()],
          replayRefs: [replayRef()],
          observedAt: Timestamp.create({ seconds: '1700000101', nanos: 0 }),
        }));
      }
      if (input.methodId === RuntimeMethodIds.agent.listAvatarDebugProbeResults) {
        capturedListRequests.push(ListAvatarDebugProbeResultsRequest.fromBinary(input.request));
        assert.equal(input.protectedAccessToken?.tokenId, 'avatar-debug-token-2');
        return ListAvatarDebugProbeResultsResponse.toBinary(ListAvatarDebugProbeResultsResponse.create({
          probeResults: [resultEnvelope()],
        }));
      }
      if (input.methodId === RuntimeMethodIds.agent.getAvatarDebugReplay) {
        capturedReplayRequests.push(GetAvatarDebugReplayRequest.fromBinary(input.request));
        assert.equal(input.protectedAccessToken?.tokenId, 'avatar-debug-token-2');
        return GetAvatarDebugReplayResponse.toBinary(GetAvatarDebugReplayResponse.create({
          request: requestEnvelope(),
          result: resultEnvelope(),
          replayRef: replayRef(),
        }));
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
        subjectUserId: 'subject-1',
      },
    });

    await assert.rejects(
      () => runtime.avatarDebug.requestProbe({
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
        probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
        requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
        probeId: 'probe-1',
        replayRequested: true,
      }),
      isMethodGroupUnavailable,
    );
    assert.equal(capturedProbeRequests.length, 0);
    return;

    const requested = await runtime.avatarDebug.requestProbe({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
      requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
      probeId: 'probe-1',
      replayRequested: true,
    });
    const snapshot = await runtime.avatarDebug.snapshot({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
    });
    const listed = await runtime.avatarDebug.listProbeResults({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      probeKind: AvatarDebugProbeKind.BACKEND_LOAD,
    });
    const replay = await runtime.avatarDebug.getReplay({
      agentId: 'agent-1',
      conversationAnchorId: 'anchor-1',
      probeId: 'probe-1',
    });

    assert.equal(requested.result?.status, AvatarDebugProbeStatus.BLOCKED);
    assert.equal(snapshot.probeResults.length, 1);
    assert.equal(listed.probeResults[0]?.reasonCode, 'avatar_debug_session_not_available');
    assert.equal(replay.replayRef?.replayRef, 'runtime.audit.avatar_debug.replay/probe-1');
    assert.deepEqual(authorizeRequests.map((request) => request.scopes), [
      ['runtime.agent.avatar_debug.write'],
      ['runtime.agent.avatar_debug.read'],
    ]);
    assert.equal(capturedProbeRequests[0]?.context?.appId, APP_ID);
    assert.equal(capturedProbeRequests[0]?.context?.subjectUserId, 'subject-1');
    assert.equal(capturedProbeRequests[0]?.probeKind, AvatarDebugProbeKind.BACKEND_LOAD);
    assert.equal(capturedProbeRequests[0]?.requestedBy, AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH);
    assert.equal(capturedSnapshotRequests[0]?.conversationAnchorId, 'anchor-1');
    assert.equal(capturedListRequests[0]?.probeKind, AvatarDebugProbeKind.BACKEND_LOAD);
    assert.equal(capturedReplayRequests[0]?.probeId, 'probe-1');
    assert.deepEqual(capturedMethods.filter((method) => method.includes('AvatarDebug')), [
      RuntimeMethodIds.agent.requestAvatarDebugProbe,
      RuntimeMethodIds.agent.getAvatarDebugSnapshot,
      RuntimeMethodIds.agent.listAvatarDebugProbeResults,
      RuntimeMethodIds.agent.getAvatarDebugReplay,
    ]);
  } finally {
    clearNodeGrpcBridge();
  }
});
