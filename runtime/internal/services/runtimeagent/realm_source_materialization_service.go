package runtimeagent

import (
	"context"
	"errors"
	"io"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// MaterializeRealmSource is the sole public Realm source ingress. Every Realm
// credential, challenge, Packet, proof, JWKS document and closure byte is
// acquired through the private issuer's authenticated first-party operation and
// never accepted from the caller. No app permission or grant participates.
func (s *Service) MaterializeRealmSource(ctx context.Context, req *runtimev1.MaterializeRealmSourceRequest) (*runtimev1.MaterializeRealmSourceResponse, error) {
	request, err := validateRealmSourceMaterializationRequestV3(ctx, req)
	if err != nil {
		return nil, err
	}
	if principal, protected, principalErr := protectedAccountProductPrincipal(ctx, "runtime.agent.write"); principalErr != nil {
		return nil, principalErr
	} else if protected && !principal.Owns(request.AccountID) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	if s == nil || s.isClosed() {
		return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailureIssuerUnavailableV3), nil
	}

	s.sourceMaterializationMu.RLock()
	repository := s.realmSourceMaterializationRepoV3
	issuer := s.realmSourceMaterializationIssuerV3
	runtimeInstanceID := s.sourceMaterializationRuntimeInstance
	requestLocks := s.realmSourceMaterializationRequestLocksV3
	staging := s.realmSourceMaterializationStagingV3
	s.sourceMaterializationMu.RUnlock()
	if repository == nil || issuer == nil || runtimeInstanceID == "" || requestLocks == nil || staging == nil {
		return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailureIssuerUnavailableV3), nil
	}

	release := requestLocks.acquire(request.AccountID, request.RequestID)
	defer release()
	now := s.sourceMaterializationClock()().UTC()
	intentDigest, err := realmSourceMaterializationIntentDigestV3(request)
	if err != nil {
		return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailureInvalidRequestV3), nil
	}
	sourceRefJSON, err := canonicalRealmSourceMaterializationRefV3(request.SourceRef)
	if err != nil {
		return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailureInvalidRequestV3), nil
	}
	challenge, err := newRealmSourceMaterializationChallengeV3(runtimeInstanceID, request, intentDigest, now)
	if err != nil {
		return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailureIssuerUnavailableV3), nil
	}
	attempt, disposition, err := repository.beginAttempt(ctx, realmSourceMaterializationAttemptV3{
		MaterializerAccountID: request.AccountID,
		RequestID:             request.RequestID,
		IntentDigest:          intentDigest,
		SourceRefJSON:         sourceRefJSON,
		RuntimeInstanceID:     runtimeInstanceID,
		Challenge:             challenge,
		CreatedAt:             now,
		UpdatedAt:             now,
	})
	if err != nil {
		return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailurePersistenceV3), nil
	}
	switch disposition {
	case realmSourceMaterializationBeginConflictV3:
		return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailureRequestConflictV3), nil
	case realmSourceMaterializationBeginCommittedReplayV3:
		status, statusErr := attempt.sourceContextStatus()
		if statusErr != nil {
			return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailurePersistenceV3), nil
		}
		return &runtimev1.MaterializeRealmSourceResponse{
			LocalAgentRef: attempt.LocalAgentRef, SourceContextStatus: status, IdempotentReplay: true,
			ReasonCode: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE,
		}, nil
	case realmSourceMaterializationBeginTerminalReplayV3:
		return realmSourceMaterializationFailureResponseV3(attempt.FailureCode), nil
	case realmSourceMaterializationBeginCreatedV3:
	default:
		return realmSourceMaterializationFailureResponseV3(sourceMaterializationFailurePersistenceV3), nil
	}

	fail := func(cause error) (*runtimev1.MaterializeRealmSourceResponse, error) {
		code := sourceMaterializationV3FailureCode(cause)
		if failureErr := repository.failAttempt(ctx, request.AccountID, request.RequestID, code, s.sourceMaterializationClock()().UTC()); failureErr != nil {
			code = sourceMaterializationFailurePersistenceV3
		}
		return realmSourceMaterializationFailureResponseV3(code), nil
	}
	if err := repository.transitionAttempt(ctx, request.AccountID, request.RequestID, realmSourceMaterializationAttemptRequestedV3, realmSourceMaterializationAttemptAcquiringV3, "", now); err != nil {
		return fail(err)
	}

	acquisition, err := issuer.AcquireRealmSourceMaterialization(ctx, RealmSourceMaterializationIssuanceRequest{
		AuthenticatedAccountID: request.AccountID,
		RequestID:              request.RequestID,
		SourceRef:              sourceMaterializationExternalRefV3(request.SourceRef),
		Challenge: RealmSourceMaterializationChallengeV3{
			ChallengeID: challenge.ChallengeID, ChallengeDigest: challenge.ChallengeDigest,
			IntendedRuntimeAudience: challenge.IntendedRuntimeAudience, IssuedAt: challenge.IssuedAt, ExpiresAt: challenge.ExpiresAt,
		},
		Limits: sourceMaterializationExternalLimitsV3(challenge.Limits),
	})
	if err != nil {
		code := sourceMaterializationFailureIssuerUnavailableV3
		switch {
		case errors.Is(err, ErrRealmSourceMaterializationAcquisitionInvalidRequest):
			code = sourceMaterializationFailureInvalidRequestV3
		case errors.Is(err, ErrRealmSourceMaterializationAcquisitionSourceBinding):
			code = sourceMaterializationFailureSourceBindingV3
		case errors.Is(err, ErrRealmSourceMaterializationAcquisitionDenied):
			code = sourceMaterializationFailureAcquisitionDeniedV3
		case errors.Is(err, ErrRealmSourceMaterializationAcquisitionCapacity):
			code = sourceMaterializationFailureCapacityV3
		case errors.Is(err, ErrRealmSourceMaterializationAcquisitionAccount):
			code = sourceMaterializationFailureAccountBindingV3
		}
		return fail(sourceMaterializationV3Error(code, "Realm acquisition failed: %v", err))
	}
	packetResponse := acquisition.PacketResponse
	if err := validateSourceMaterializationAcquisitionV3(acquisition, request.AccountID); err != nil {
		closeErr := closeRealmSourceMaterializationBodiesV3(packetResponse.Body)
		if closeErr != nil {
			return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "close rejected packet body: %v", closeErr))
		}
		return fail(err)
	}
	wireBudget, err := sourceMaterializationWireBudgetV3(challenge.Limits)
	if err != nil {
		_ = closeRealmSourceMaterializationBodiesV3(packetResponse.Body)
		return fail(err)
	}
	if err := validateSourceMaterializationHTTPResponseV3(packetResponse, 201, wireBudget); err != nil {
		closeErr := closeRealmSourceMaterializationBodiesV3(packetResponse.Body)
		if closeErr != nil {
			return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "close rejected packet body: %v", closeErr))
		}
		return fail(err)
	}
	stagedPacket, stageErr := staging.stagePacket(ctx, request.AccountID, request.RequestID, packetResponse.Body, wireBudget, packetResponse.ContentLength)
	packetBodyCloseErr := closeRealmSourceMaterializationBodiesV3(packetResponse.Body)
	if stageErr != nil {
		if packetBodyCloseErr != nil {
			return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "Packet staging and response cleanup failed: %v", errors.Join(stageErr, packetBodyCloseErr)))
		}
		return fail(stageErr)
	}
	if packetBodyCloseErr != nil {
		_ = stagedPacket.cleanup()
		return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "close staged Packet response: %v", packetBodyCloseErr))
	}
	if err := repository.transitionAttempt(ctx, request.AccountID, request.RequestID, realmSourceMaterializationAttemptAcquiringV3, realmSourceMaterializationAttemptVerifyingV3, "", s.sourceMaterializationClock()().UTC()); err != nil {
		if cleanupErr := stagedPacket.cleanup(); cleanupErr != nil {
			return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "attempt transition and Packet cleanup failed: %v", errors.Join(err, cleanupErr)))
		}
		return fail(err)
	}

	jwksResponse, err := issuer.FetchCurrentRealmSourceMaterializationJWKS(ctx, acquisition.AccountLease)
	if err != nil {
		closeErr := stagedPacket.cleanup()
		if closeErr != nil {
			return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "clean staged Packet after JWKS failure: %v", closeErr))
		}
		return fail(sourceMaterializationV3Error(sourceMaterializationFailureIssuerUnavailableV3, "current JWKS fetch failed: %v", err))
	}
	if err := validateSourceMaterializationHTTPResponseV3(jwksResponse, 200, sourceMaterializationJWKSMaxBytesV3); err != nil {
		closeErr := errors.Join(stagedPacket.cleanup(), closeRealmSourceMaterializationBodiesV3(jwksResponse.Body))
		if closeErr != nil {
			return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "close rejected verification bodies: %v", closeErr))
		}
		return fail(err)
	}
	verified, verificationErr := verifySourceMaterializationPacketV3(stagedPacket.reader(), jwksResponse.Body, sourceMaterializationVerificationExpectationV3{
		Challenge: challenge, ExpectedIssuer: acquisition.ExpectedIssuer,
		ExpectedAccessPolicyDigest: acquisition.ExpectedAccessPolicyVersionDigest,
		Now:                        s.sourceMaterializationClock()().UTC(),
	})
	cleanupErr := errors.Join(stagedPacket.cleanup(), closeRealmSourceMaterializationBodiesV3(jwksResponse.Body))
	if verificationErr != nil {
		if cleanupErr != nil {
			return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "verification and cleanup failed: %v", errors.Join(verificationErr, cleanupErr)))
		}
		return fail(verificationErr)
	}
	if cleanupErr != nil {
		return fail(sourceMaterializationV3Error(sourceMaterializationFailureCleanupV3, "verification body cleanup failed: %v", cleanupErr))
	}
	packetExpiresAt, err := parseSourceMaterializationInstantV3(verified.Packet.ExpiresAt, "packet.expiresAt")
	if err != nil {
		return fail(err)
	}
	var (
		localAgentRef string
		sourceStatus  *runtimev1.LocalAgentSourceContextStatus
		prepared      *preparedRealmSourceMaterializationProductV3
	)
	guardErr := issuer.WithCurrentRealmSourceMaterializationAccount(ctx, acquisition.AccountLease, func() error {
		if err := repository.transitionAttempt(ctx, request.AccountID, request.RequestID, realmSourceMaterializationAttemptVerifyingV3, realmSourceMaterializationAttemptCommittingV3, verified.Packet.PacketHash, s.sourceMaterializationClock()().UTC()); err != nil {
			return err
		}
		generatedRef, err := generateRuntimeLocalAgentRef()
		if err != nil {
			return sourceMaterializationV3Error(sourceMaterializationFailurePersistenceV3, "generate LocalAgent identity: %v", err)
		}
		localAgentRef = generatedRef
		preparedProduct, statusProjection, err := s.prepareRealmSourceMaterializationProductV3(ctx, request.AccountID, localAgentRef, verified)
		if err != nil {
			return sourceMaterializationV3Error(sourceMaterializationFailurePersistenceV3, "prepare LocalAgent product: %v", err)
		}
		prepared = preparedProduct
		sourceStatus = statusProjection
		commitErr := repository.finishCommit(ctx, attempt, realmSourceMaterializationReplayV3{
			RuntimeInstanceID: runtimeInstanceID, Issuer: verified.Packet.Issuer,
			ReplayBindingHash: verified.ReplayBindingHash, NonceDigest: verified.NonceReplayDigest,
			PacketHash:            verified.Packet.PacketHash,
			MaterializerAccountID: request.AccountID, RequestID: request.RequestID,
			FirstSeenAt: verified.VerifiedAt, ExpiresAt: packetExpiresAt,
		}, localAgentRef, sourceStatus, s.sourceMaterializationClock()().UTC(), prepared.commitTx)
		if commitErr != nil {
			prepared.rolledBack()
			prepared = nil
			var typed *sourceMaterializationErrorV3
			if !errors.As(commitErr, &typed) {
				commitErr = sourceMaterializationV3Error(sourceMaterializationFailurePersistenceV3, "atomic LocalAgent product commit failed: %v", commitErr)
			}
			return commitErr
		}
		return nil
	})
	if guardErr != nil {
		if prepared != nil {
			prepared.rolledBack()
		}
		var typed *sourceMaterializationErrorV3
		if errors.As(guardErr, &typed) {
			return fail(guardErr)
		}
		return fail(sourceMaterializationV3Error(sourceMaterializationFailureAccountBindingV3, "account commit guard failed: %v", guardErr))
	}
	prepared.committed()
	return &runtimev1.MaterializeRealmSourceResponse{
		LocalAgentRef: localAgentRef, SourceContextStatus: sourceStatus,
		ReasonCode: runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE,
	}, nil
}

func closeRealmSourceMaterializationBodiesV3(bodies ...io.Closer) error {
	var closeErrors []error
	for _, body := range bodies {
		if body != nil {
			closeErrors = append(closeErrors, body.Close())
		}
	}
	return errors.Join(closeErrors...)
}

func realmSourceMaterializationFailureResponseV3(code sourceMaterializationFailureCodeV3) *runtimev1.MaterializeRealmSourceResponse {
	return &runtimev1.MaterializeRealmSourceResponse{ReasonCode: realmSourceMaterializationReasonCodeV3(code)}
}
