package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRuntimeAgentCanonicalReviewSchedulingSweepRunsEligibleBankOncePerWindow(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-once")
	retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"memory redesign review quality",
		"review quality redesign memory",
	)

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{
			TokensUsed: 5,
			Outcomes: memoryservice.CanonicalReviewOutcomes{
				Truths: []memoryservice.TruthCandidate{
					{
						TruthID:         fmt.Sprintf("truth-auto-once-%d", executions),
						Dimension:       "source",
						NormalizedKey:   fmt.Sprintf("auto:once:%d", executions),
						Statement:       "Automatic review scheduling ran.",
						Confidence:      0.9,
						ReviewCount:     1,
						Status:          "admitted",
						SourceMemoryIDs: append([]string(nil), req.Clusters[0].RecordIDs...),
					},
				},
			},
		}, nil
	}))

	sweepAt := time.Now().UTC().Add(-time.Hour)
	if err := svc.runCanonicalReviewSchedulingSweep(ctx, sweepAt); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep(first): %v", err)
	}
	if err := svc.runCanonicalReviewSchedulingSweep(ctx, sweepAt); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep(second): %v", err)
	}
	if executions != 1 {
		t.Fatalf("expected exactly one automatic review execution, got %d", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 1 {
		t.Fatalf("expected one persisted review run, got %d", count)
	}
	followUp, err := svc.GetReviewFollowUp(ctx, locator)
	if err != nil {
		t.Fatalf("GetReviewFollowUp: %v", err)
	}
	if followUp == nil {
		t.Fatal("expected review follow-up after automatic review")
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepSuppressesRecentFollowUp(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-recent")
	recordIDs := retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"recent review source one",
		"recent review source two",
	)
	sweepAt := time.Now().UTC().Add(-time.Hour)
	persistReviewFollowUpForTest(t, svc, locator, "review-recent", recordIDs[len(recordIDs)-1], sweepAt.Add(-23*time.Hour))

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{}, nil
	}))

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, sweepAt); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if executions != 0 {
		t.Fatalf("expected recent follow-up to suppress automatic review, got %d executions", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 0 {
		t.Fatalf("expected no new review runs, got %d", count)
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepRunsExpiredFollowUp(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-expired")
	recordIDs := retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"expired review source one",
		"expired review source two",
	)
	sweepAt := time.Now().UTC().Add(-time.Hour)
	persistReviewFollowUpForTest(t, svc, locator, "review-expired", recordIDs[len(recordIDs)-1], sweepAt.Add(-25*time.Hour))

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{
			Outcomes: memoryservice.CanonicalReviewOutcomes{
				Truths: []memoryservice.TruthCandidate{
					{
						TruthID:         "truth-auto-expired",
						Dimension:       "source",
						NormalizedKey:   "auto:expired",
						Statement:       "Expired follow-up permits a new automatic review.",
						Confidence:      0.9,
						ReviewCount:     1,
						Status:          "admitted",
						SourceMemoryIDs: append([]string(nil), req.Clusters[0].RecordIDs...),
					},
				},
			},
		}, nil
	}))

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, sweepAt); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if executions != 1 {
		t.Fatalf("expected expired follow-up to re-admit automatic review, got %d executions", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 1 {
		t.Fatalf("expected one new review run, got %d", count)
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepDefersWithoutExecutor(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-no-exec")
	retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"executor missing source one",
		"executor missing source two",
	)

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, time.Now().UTC().Add(-time.Hour)); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 0 {
		t.Fatalf("expected no automatic review run without executor, got %d", count)
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepSuppressesNonActiveAndNonIdle(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name   string
		mutate func(*Service) error
	}{
		{
			name: "non_active",
			mutate: func(svc *Service) error {
				entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-review-scheduling-state"))
				if err != nil {
					return err
				}
				entry.Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED
				return svc.updateAgent(entry)
			},
		},
		{
			name: "non_idle",
			mutate: func(svc *Service) error {
				entry, err := svc.agentByID(testRuntimeAgentLocalRef("agent-review-scheduling-state"))
				if err != nil {
					return err
				}
				entry.State.ExecutionState = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE
				entry.State.UpdatedAt = timestamppb.New(time.Now().UTC())
				return svc.updateAgent(entry)
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newRuntimeAgentTestService(t)
			ctx := context.Background()
			locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-state")
			retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
				"state gate source one",
				"state gate source two",
			)
			executions := 0
			svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
				executions++
				return &CanonicalReviewExecutorResult{}, nil
			}))
			if err := tc.mutate(svc); err != nil {
				t.Fatalf("mutate agent state: %v", err)
			}
			if err := svc.runCanonicalReviewSchedulingSweep(ctx, time.Now().UTC().Add(-time.Hour)); err != nil {
				t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
			}
			if executions != 0 {
				t.Fatalf("expected automatic review suppression for %s, got %d executions", tc.name, executions)
			}
		})
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepSuppressesRecoverableRun(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-recoverable")
	recordIDs := retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator,
		"recoverable review source one",
		"recoverable review source two",
	)
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:     "review-run-auto-recoverable",
		AgentID:         "agent-review-scheduling-recoverable",
		BankLocatorKey:  memoryservice.LocatorKey(locator),
		CheckpointBasis: recordIDs[len(recordIDs)-1],
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{
			Summary: "recoverable run should suppress duplicate automatic admission",
		},
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{}, nil
	}))

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, time.Now().UTC().Add(-time.Hour)); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if executions != 0 {
		t.Fatalf("expected recoverable review run to suppress automatic admission, got %d executions", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 1 {
		t.Fatalf("expected only the recoverable review run to exist, got %d", count)
	}
}

func TestRuntimeAgentCanonicalReviewSchedulingSweepNoClustersNoOp(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	locator := initializeCanonicalReviewSchedulingAgent(t, ctx, svc, "agent-review-scheduling-no-clusters")
	retainCanonicalReviewSchedulingInputs(t, ctx, svc, locator, "single source cannot form a review cluster")

	executions := 0
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		executions++
		return &CanonicalReviewExecutorResult{}, nil
	}))

	if err := svc.runCanonicalReviewSchedulingSweep(ctx, time.Now().UTC().Add(-time.Hour)); err != nil {
		t.Fatalf("runCanonicalReviewSchedulingSweep: %v", err)
	}
	if executions != 0 {
		t.Fatalf("expected no executor calls when no review clusters exist, got %d", executions)
	}
	if count := countReviewRunsForBank(t, svc, locator); count != 0 {
		t.Fatalf("expected no persisted review runs for no-cluster no-op, got %d", count)
	}
}

func initializeCanonicalReviewSchedulingAgent(t *testing.T, ctx context.Context, svc *Service, agentID string) *runtimev1.MemoryBankLocator {
	t.Helper()

	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext(agentID)}); err != nil {
		t.Fatalf("InitializeAgent(%s): %v", agentID, err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef(agentID)},
		},
	}
	if _, err := svc.memorySvc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(%s): %v", agentID, err)
	}
	return locator
}

func retainCanonicalReviewSchedulingInputs(t *testing.T, ctx context.Context, svc *Service, locator *runtimev1.MemoryBankLocator, observations ...string) []string {
	t.Helper()

	inputs := make([]*runtimev1.MemoryRecordInput, 0, len(observations))
	for _, observation := range observations {
		inputs = append(inputs, &runtimev1.MemoryRecordInput{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
			Payload: &runtimev1.MemoryRecordInput_Observational{
				Observational: &runtimev1.ObservationalMemoryRecord{Observation: observation},
			},
		})
	}
	retainResp, err := svc.memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank:    locator,
		Records: inputs,
	})
	if err != nil {
		t.Fatalf("Retain(%s): %v", memoryservice.LocatorKey(locator), err)
	}
	recordIDs := make([]string, 0, len(retainResp.GetRecords()))
	for _, record := range retainResp.GetRecords() {
		recordIDs = append(recordIDs, record.GetMemoryId())
	}
	return recordIDs
}

func persistReviewFollowUpForTest(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator, reviewRunID string, checkpointBasis string, completedAt time.Time) {
	t.Helper()

	if _, err := svc.backend.DB().Exec(`
		INSERT OR REPLACE INTO runtime_local_agent_review_followup(bank_locator_key, review_run_id, checkpoint_basis, completed_at)
		VALUES (?, ?, ?, ?)
	`, memoryservice.LocatorKey(locator), reviewRunID, checkpointBasis, completedAt.UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("persist review follow-up: %v", err)
	}
}

func countReviewRunsForBank(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator) int {
	t.Helper()

	var count int
	if err := svc.backend.DB().QueryRow(`
		SELECT COUNT(*)
		FROM runtime_local_agent_review_run
		WHERE bank_locator_key = ?
	`, memoryservice.LocatorKey(locator)).Scan(&count); err != nil {
		t.Fatalf("count review runs: %v", err)
	}
	return count
}

func TestAIBackedCanonicalReviewExecutorDecodesValidOutput(t *testing.T) {
	t.Parallel()

	fakeAI := &fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<canonical-review>
  <summary>review complete</summary>
  <tokens-used>42</tokens-used>
  <narratives>
    <narrative id="nar-ai-1" topic="review quality" source-version="wave4" status="active">
      <content>The work remains focused on review quality.</content>
      <source-memory-id>mem-1</source-memory-id>
      <source-memory-id>mem-2</source-memory-id>
    </narrative>
  </narratives>
  <truths>
    <truth id="truth-ai-1" dimension="relational" normalized-key="relationship:review-quality" confidence="0.91" source-count="2" review-count="1" status="admitted">
      <statement>The agent and user are collaborating on review quality.</statement>
      <source-memory-id>mem-1</source-memory-id>
      <source-memory-id>mem-3</source-memory-id>
    </truth>
  </truths>
  <relations></relations>
</canonical-review>`,
					},
				},
			},
		},
	}
	executor := NewAIBackedCanonicalReviewExecutor(fakeAI)

	result, err := executor.ExecuteCanonicalReview(context.Background(), &CanonicalReviewExecutorRequest{
		Agent: &runtimev1.AgentRecord{AgentId: "agent-review-ai"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "user-1"},
		Bank: &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-review-ai")},
			},
		},
		CheckpointBasis: "mem-0",
		Clusters: []memoryservice.ReviewTopicCluster{
			{RecordIDs: []string{"mem-1", "mem-2"}},
		},
		Leftovers: []*runtimev1.MemoryRecord{
			{MemoryId: "mem-3"},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteCanonicalReview: %v", err)
	}
	if len(fakeAI.requests) != 1 {
		t.Fatalf("expected one AI request, got %d", len(fakeAI.requests))
	}
	if result.TokensUsed != 42 || result.Outcomes.Summary != "review complete" {
		t.Fatalf("unexpected canonical review result: %#v", result)
	}
	if len(result.Outcomes.Narratives) != 1 || result.Outcomes.Narratives[0].NarrativeID != "nar-ai-1" {
		t.Fatalf("unexpected narratives: %#v", result.Outcomes.Narratives)
	}
	if len(result.Outcomes.Truths) != 1 || result.Outcomes.Truths[0].TruthID != "truth-ai-1" {
		t.Fatalf("unexpected truths: %#v", result.Outcomes.Truths)
	}
}

func TestAIBackedCanonicalReviewExecutorRejectsInvalidOutput(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		output  string
		wantErr string
	}{
		{
			name:    "markdown",
			output:  "```xml\n<canonical-review><summary>bad</summary></canonical-review>\n```",
			wantErr: "must begin with <canonical-review>",
		},
		{
			name: "unknown_field",
			output: `<canonical-review>
  <summary>bad</summary>
  <narratives></narratives>
  <truths></truths>
  <relations></relations>
  <extra-field></extra-field>
</canonical-review>`,
			wantErr: "unsupported <extra-field> tag",
		},
		{
			name: "invalid_dimension",
			output: `<canonical-review>
  <summary>bad</summary>
  <narratives></narratives>
  <truths>
    <truth id="truth-bad-1" dimension="employment" normalized-key="bad:key" confidence="0.9">
      <statement>bad</statement>
      <source-memory-id>mem-1</source-memory-id>
    </truth>
  </truths>
  <relations></relations>
</canonical-review>`,
			wantErr: "dimension must be relational, cognitive, value, or procedural",
		},
		{
			name: "invalid_relation_type",
			output: `<canonical-review>
  <summary>bad</summary>
  <narratives></narratives>
  <truths></truths>
  <relations>
    <relation source-id="mem-1" target-id="mem-2" relation-type="same_event" confidence="0.9"/>
  </relations>
</canonical-review>`,
			wantErr: "relation_type must be causal, emotional, or thematic",
		},
		{
			name: "narrative_from_leftover_only",
			output: `<canonical-review>
  <summary>bad</summary>
  <narratives>
    <narrative id="nar-bad-1" topic="singleton">
      <content>bad singleton narrative</content>
      <source-memory-id>mem-3</source-memory-id>
      <source-memory-id>mem-3</source-memory-id>
    </narrative>
  </narratives>
  <truths></truths>
  <relations></relations>
</canonical-review>`,
			wantErr: "must cite at least 2 distinct source_memory_ids",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			executor := NewAIBackedCanonicalReviewExecutor(&fakeLifeTurnAI{
				response: &runtimev1.ExecuteScenarioResponse{
					Output: &runtimev1.ScenarioOutput{
						Output: &runtimev1.ScenarioOutput_TextGenerate{
							TextGenerate: &runtimev1.TextGenerateOutput{Text: tt.output},
						},
					},
				},
			})
			_, err := executor.ExecuteCanonicalReview(context.Background(), &CanonicalReviewExecutorRequest{
				Agent: &runtimev1.AgentRecord{AgentId: "agent-review-ai"},
				State: &runtimev1.AgentStateProjection{ActiveUserId: "user-1"},
				Bank: &runtimev1.MemoryBankLocator{
					Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
					Owner: &runtimev1.MemoryBankLocator_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-review-ai")},
					},
				},
				Clusters: []memoryservice.ReviewTopicCluster{
					{RecordIDs: []string{"mem-1", "mem-2"}},
				},
				Leftovers: []*runtimev1.MemoryRecord{
					{MemoryId: "mem-3"},
				},
			})
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}
