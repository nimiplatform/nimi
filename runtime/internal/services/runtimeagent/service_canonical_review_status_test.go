package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func TestRuntimeAgentCanonicalReviewStatusProjectsFollowUp(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	agentID := "agent-review-status-followup"
	localAgentRef := testRuntimeAgentLocalRef(agentID)
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, agentID)
	completedAt := time.Now().UTC().Add(-time.Hour).Round(0)
	persistReviewFollowUpForTest(t, svc, locator, "review-status-1", "memory-checkpoint-1", completedAt)
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(context.Context, *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		return &CanonicalReviewExecutorResult{}, nil
	}))

	resp, err := svc.GetAgentCanonicalMemoryReviewStatus(ctx, &runtimev1.GetAgentCanonicalMemoryReviewStatusRequest{
		Context: testRuntimeAgentIdentityContext(agentID),
		AgentId: localAgentRef,
	})
	if err != nil {
		t.Fatalf("GetAgentCanonicalMemoryReviewStatus: %v", err)
	}
	status := resp.GetStatus()
	if status.GetBank().GetAgentCore().GetAgentId() != localAgentRef {
		t.Fatalf("unexpected status bank: %#v", status.GetBank())
	}
	if !status.GetReviewExecutorAvailable() {
		t.Fatalf("expected review executor availability projected")
	}
	if status.GetReadiness() != runtimev1.AgentCanonicalMemoryReviewReadiness_AGENT_CANONICAL_MEMORY_REVIEW_READINESS_WAITING_FOR_WINDOW {
		t.Fatalf("unexpected readiness: %s", status.GetReadiness())
	}
	if status.GetEligibleNow() {
		t.Fatal("expected recent follow-up to suppress immediate review eligibility")
	}
	if status.GetLastReviewRunId() != "review-status-1" || status.GetCheckpointBasis() != "memory-checkpoint-1" {
		t.Fatalf("unexpected follow-up projection: %#v", status)
	}
	if !status.GetLastCompletedAt().AsTime().Equal(completedAt) {
		t.Fatalf("unexpected last completed time: got %s want %s", status.GetLastCompletedAt().AsTime(), completedAt)
	}
	if !status.GetNextEligibleAt().AsTime().Equal(completedAt.Add(canonicalReviewEligibilityWindow)) {
		t.Fatalf("unexpected next eligible time: got %s want %s", status.GetNextEligibleAt().AsTime(), completedAt.Add(canonicalReviewEligibilityWindow))
	}
	if status.GetRecoverableReviewRunId() != "" {
		t.Fatalf("unexpected recoverable run id: %#v", status)
	}
}

func TestRuntimeAgentCanonicalReviewStatusProjectsRecoverableRunBlock(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	agentID := "agent-review-status-recoverable"
	localAgentRef := testRuntimeAgentLocalRef(agentID)
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, agentID)
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:      "review-status-recoverable-1",
		AgentID:          localAgentRef,
		BankLocatorKey:   memoryservice.LocatorKey(locator),
		CheckpointBasis:  "memory-checkpoint-recoverable",
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{},
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(context.Context, *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		return &CanonicalReviewExecutorResult{}, nil
	}))

	resp, err := svc.GetAgentCanonicalMemoryReviewStatus(ctx, &runtimev1.GetAgentCanonicalMemoryReviewStatusRequest{
		Context: testRuntimeAgentIdentityContext(agentID),
		AgentId: localAgentRef,
	})
	if err != nil {
		t.Fatalf("GetAgentCanonicalMemoryReviewStatus: %v", err)
	}
	status := resp.GetStatus()
	if status.GetReadiness() != runtimev1.AgentCanonicalMemoryReviewReadiness_AGENT_CANONICAL_MEMORY_REVIEW_READINESS_RECOVERABLE_RUN_BLOCKING {
		t.Fatalf("unexpected readiness: %s", status.GetReadiness())
	}
	if status.GetEligibleNow() {
		t.Fatal("expected recoverable run to block immediate review eligibility")
	}
	if status.GetRecoverableReviewRunId() != "review-status-recoverable-1" {
		t.Fatalf("unexpected recoverable run id: %#v", status)
	}
}
