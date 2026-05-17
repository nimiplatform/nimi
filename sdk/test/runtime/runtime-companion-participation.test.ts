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
  LOCAL_AGENT_REF,
  LOCAL_AGENT_IDENTITY,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
} from './runtime-agent-surface-test-utils.js';
import {
  CancelCompanionParticipationRequest,
  CancelCompanionParticipationResponse,
  CompanionParticipationProjection,
  CompanionParticipationStatus,
  CompanionParticipationSurfaceKind,
  CompanionParticipationTriggerSource,
  GetCompanionParticipationProjectionRequest,
  GetCompanionParticipationProjectionResponse,
  OpenCompanionParticipationReplayRequest,
  OpenCompanionParticipationReplayResponse,
  RequestCompanionParticipationRequest,
  RequestCompanionParticipationResponse,
} from '../../src/runtime/generated/runtime/v1/agent_service.js';
import {
  decodeCompanionParticipationProjection,
} from '../../src/runtime/runtime-companion-participation.js';

function projection(status = CompanionParticipationStatus.RUNNING) {
  return CompanionParticipationProjection.create({
    projectionId: 'companion_participation_projection/anchor-1/avatar_companion/turn-1',
    agentId: LOCAL_AGENT_REF,
    surfaceKind: CompanionParticipationSurfaceKind.AVATAR_COMPANION,
    profileRef: 'avatar.profile/default',
    roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
    triggerSource: CompanionParticipationTriggerSource.USER_EXPLICIT,
    status,
    candidateRef: status === CompanionParticipationStatus.COMMITTED_BY_OWNER ? 'runtime.agent.public_chat.turn/turn-1/candidate' : '',
    commitRef: status === CompanionParticipationStatus.COMMITTED_BY_OWNER ? 'runtime.agent.public_chat.message/message-1' : '',
    refusalReason: '',
    presentationRef: 'runtime.presentation/avatar_companion',
    auditRef: 'runtime.audit.companion_participation/companion_participation_projection/anchor-1/avatar_companion/turn-1',
    observedAt: Timestamp.create({ seconds: '1700000100', nanos: 0 }),
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
  });
}

test('runtime companion participation module uses typed Runtime RPCs and protected scopes', async () => {
  const authorizeRequests: AuthorizeExternalPrincipalRequest[] = [];
  const capturedMethods: string[] = [];
  const capturedGetRequests: GetCompanionParticipationProjectionRequest[] = [];
  const capturedRequestRequests: RequestCompanionParticipationRequest[] = [];
  const capturedCancelRequests: CancelCompanionParticipationRequest[] = [];
  const capturedReplayRequests: OpenCompanionParticipationReplayRequest[] = [];

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
          tokenId: `companion-participation-token-${authorizeRequests.length}`,
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: request.scopes,
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: `companion-participation-secret-${authorizeRequests.length}`,
        }));
      }
      if (input.methodId === RuntimeMethodIds.agent.requestCompanionParticipation) {
        capturedRequestRequests.push(RequestCompanionParticipationRequest.fromBinary(input.request));
        assert.equal(input.protectedAccessToken?.tokenId, 'companion-participation-token-1');
        return RequestCompanionParticipationResponse.toBinary(RequestCompanionParticipationResponse.create({
          projection: projection(CompanionParticipationStatus.RUNNING),
        }));
      }
      if (input.methodId === RuntimeMethodIds.agent.getCompanionParticipationProjection) {
        capturedGetRequests.push(GetCompanionParticipationProjectionRequest.fromBinary(input.request));
        assert.equal(input.protectedAccessToken?.tokenId, 'companion-participation-token-2');
        return GetCompanionParticipationProjectionResponse.toBinary(GetCompanionParticipationProjectionResponse.create({
          projection: projection(CompanionParticipationStatus.COMMITTED_BY_OWNER),
        }));
      }
      if (input.methodId === RuntimeMethodIds.agent.cancelCompanionParticipation) {
        capturedCancelRequests.push(CancelCompanionParticipationRequest.fromBinary(input.request));
        assert.equal(input.protectedAccessToken?.tokenId, 'companion-participation-token-1');
        return CancelCompanionParticipationResponse.toBinary(CancelCompanionParticipationResponse.create({
          projection: projection(CompanionParticipationStatus.CANCELED),
        }));
      }
      if (input.methodId === RuntimeMethodIds.agent.openCompanionParticipationReplay) {
        capturedReplayRequests.push(OpenCompanionParticipationReplayRequest.fromBinary(input.request));
        assert.equal(input.protectedAccessToken?.tokenId, 'companion-participation-token-2');
        return OpenCompanionParticipationReplayResponse.toBinary(OpenCompanionParticipationReplayResponse.create({
          replayRef: 'runtime.replay.companion_participation/companion_participation_projection/anchor-1/avatar_companion/turn-1',
          projection: projection(CompanionParticipationStatus.COMMITTED_BY_OWNER),
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

    const baseRequest = {
      ...LOCAL_AGENT_IDENTITY,
      conversationAnchorId: 'anchor-1',
      surfaceKind: 'avatar_companion' as const,
      triggerSource: 'user_explicit' as const,
      profileRef: 'avatar.profile/default',
    };
    const requested = await runtime.companionParticipation.request({
      ...baseRequest,
      text: 'hello avatar',
      requestId: 'request-1',
    });
    const current = await runtime.companionParticipation.getProjection(baseRequest);
    const canceled = await runtime.companionParticipation.cancel({
      ...baseRequest,
      projectionId: requested.projectionId,
      turnId: requested.turnId,
      reason: 'user_cancel',
    });
    const replay = await runtime.companionParticipation.openReplay({
      ...baseRequest,
      projectionId: current.projectionId,
    });

    assert.equal(requested.status, 'running');
    assert.equal(current.status, 'committed_by_owner');
    assert.equal(current.commitRef, 'runtime.agent.public_chat.message/message-1');
    assert.equal(canceled.status, 'canceled');
    assert.equal(replay.projection.status, 'committed_by_owner');
    assert.deepEqual(authorizeRequests.map((request) => request.scopes), [
      ['runtime.agent.companion_participation.write'],
      ['runtime.agent.companion_participation.read'],
    ]);
    assert.equal(capturedRequestRequests[0]?.context?.appId, APP_ID);
    assert.equal(capturedRequestRequests[0]?.context?.subjectUserId, 'subject-1');
    assert.equal(capturedRequestRequests[0]?.text, 'hello avatar');
    assert.equal(capturedGetRequests[0]?.surfaceKind, CompanionParticipationSurfaceKind.AVATAR_COMPANION);
    assert.equal(capturedCancelRequests[0]?.reason, 'user_cancel');
    assert.equal(capturedReplayRequests[0]?.projectionId, current.projectionId);
    assert.deepEqual(capturedMethods.filter((method) => method.includes('CompanionParticipation')), [
      RuntimeMethodIds.agent.requestCompanionParticipation,
      RuntimeMethodIds.agent.getCompanionParticipationProjection,
      RuntimeMethodIds.agent.cancelCompanionParticipation,
      RuntimeMethodIds.agent.openCompanionParticipationReplay,
    ]);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('decodeCompanionParticipationProjection fails closed on unknown or incomplete projection', () => {
  assert.throws(
    () => decodeCompanionParticipationProjection({
      ...projection(),
      status: 999 as CompanionParticipationStatus,
    }),
    /unknown companion participation projection status/,
  );
  assert.throws(
    () => decodeCompanionParticipationProjection({
      ...projection(CompanionParticipationStatus.CANDIDATE_READY),
      candidateRef: '',
    }),
    /candidate_ready projection missing candidate_ref/,
  );
  assert.throws(
    () => decodeCompanionParticipationProjection({
      ...projection(CompanionParticipationStatus.COMMITTED_BY_OWNER),
      commitRef: '',
    }),
    /committed_by_owner projection missing commit_ref/,
  );
});
