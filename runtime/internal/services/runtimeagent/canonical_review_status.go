package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) GetAgentCanonicalMemoryReviewStatus(ctx context.Context, req *runtimev1.GetAgentCanonicalMemoryReviewStatusRequest) (*runtimev1.GetAgentCanonicalMemoryReviewStatusResponse, error) {
	reviewStatus, err := s.reviewRuntime().status(ctx, req)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAgentCanonicalMemoryReviewStatusResponse{Status: reviewStatus}, nil
}

func (r reviewRuntime) status(ctx context.Context, req *runtimev1.GetAgentCanonicalMemoryReviewStatusRequest) (*runtimev1.AgentCanonicalMemoryReviewStatus, error) {
	identity, _, err := r.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	if trimmed := strings.TrimSpace(req.GetAgentId()); trimmed == "" || trimmed != identity.LocalAgentRef {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	locator := cloneLocator(req.GetBank())
	if locator == nil {
		locator = &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: identity.LocalAgentRef},
			},
		}
	}
	if _, resolved, err := r.resolveTarget(CanonicalReviewRequest{
		AgentID: identity.LocalAgentRef,
		Bank:    locator,
	}); err != nil {
		return nil, err
	} else {
		locator = resolved
	}

	reviewStatus := &runtimev1.AgentCanonicalMemoryReviewStatus{
		Bank:                    cloneLocator(locator),
		ReviewExecutorAvailable: r.hasExecutor(),
	}
	if _, err := r.svc.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: cloneLocator(locator)}); err != nil {
		if status.Code(err) != codes.NotFound {
			return nil, err
		}
		reviewStatus.Readiness = runtimev1.AgentCanonicalMemoryReviewReadiness_AGENT_CANONICAL_MEMORY_REVIEW_READINESS_BANK_UNAVAILABLE
		return reviewStatus, nil
	}

	followUp, err := r.getReviewFollowUp(ctx, locator)
	if err != nil {
		return nil, err
	}
	if followUp != nil {
		completedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(followUp.CompletedAt))
		if err != nil {
			return nil, err
		}
		completedAt = completedAt.UTC()
		reviewStatus.LastReviewRunId = strings.TrimSpace(followUp.ReviewRunID)
		reviewStatus.CheckpointBasis = strings.TrimSpace(followUp.CheckpointBasis)
		reviewStatus.LastCompletedAt = timestamppb.New(completedAt)
		reviewStatus.NextEligibleAt = timestamppb.New(completedAt.Add(canonicalReviewEligibilityWindow))
	}

	recoverableRunID, err := r.recoverableReviewRunID(ctx, locator)
	if err != nil {
		return nil, err
	}
	reviewStatus.RecoverableReviewRunId = recoverableRunID
	reviewStatus.Readiness, reviewStatus.EligibleNow = canonicalReviewReadiness(reviewStatus, time.Now().UTC())
	return reviewStatus, nil
}

func (r reviewRuntime) recoverableReviewRunID(ctx context.Context, locator *runtimev1.MemoryBankLocator) (string, error) {
	if r.svc.reviews == nil {
		return "", nil
	}
	locatorKey := memoryservice.LocatorKey(locator)
	runs, err := r.svc.reviews.ListRecoverableReviewRuns(ctx)
	if err != nil {
		return "", err
	}
	for _, run := range runs {
		if strings.TrimSpace(run.BankLocatorKey) == locatorKey {
			return strings.TrimSpace(run.ReviewRunID), nil
		}
	}
	return "", nil
}

func canonicalReviewReadiness(reviewStatus *runtimev1.AgentCanonicalMemoryReviewStatus, now time.Time) (runtimev1.AgentCanonicalMemoryReviewReadiness, bool) {
	if strings.TrimSpace(reviewStatus.GetRecoverableReviewRunId()) != "" {
		return runtimev1.AgentCanonicalMemoryReviewReadiness_AGENT_CANONICAL_MEMORY_REVIEW_READINESS_RECOVERABLE_RUN_BLOCKING, false
	}
	if !reviewStatus.GetReviewExecutorAvailable() {
		return runtimev1.AgentCanonicalMemoryReviewReadiness_AGENT_CANONICAL_MEMORY_REVIEW_READINESS_EXECUTOR_UNAVAILABLE, false
	}
	nextEligibleAt := reviewStatus.GetNextEligibleAt()
	if nextEligibleAt == nil {
		return runtimev1.AgentCanonicalMemoryReviewReadiness_AGENT_CANONICAL_MEMORY_REVIEW_READINESS_ELIGIBLE, true
	}
	if now.Before(nextEligibleAt.AsTime()) {
		return runtimev1.AgentCanonicalMemoryReviewReadiness_AGENT_CANONICAL_MEMORY_REVIEW_READINESS_WAITING_FOR_WINDOW, false
	}
	return runtimev1.AgentCanonicalMemoryReviewReadiness_AGENT_CANONICAL_MEMORY_REVIEW_READINESS_ELIGIBLE, true
}
