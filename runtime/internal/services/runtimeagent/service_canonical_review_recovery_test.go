package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func TestRuntimeAgentExecuteCanonicalReviewWithAIBackedExecutorAppliesWave4Normalization(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	setRuntimeAgentManagedEmbeddingProfileForTest(memorySvc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       32,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-canonical-review-ai"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-canonical-review-ai")},
		},
	}
	if _, err := memorySvc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "memory redesign review quality"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "review quality memory redesign"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "astronomy telescope note"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	svc.SetCanonicalReviewExecutor(NewAIBackedCanonicalReviewExecutor(&fakeLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: fmt.Sprintf(`<canonical-review>
  <summary>wave 4 review</summary>
  <tokens-used>64</tokens-used>
  <narratives>
    <narrative id="nar-ai-exec-1" topic="memory redesign" source-version="wave4" status="active">
      <content>The current focus remains memory redesign review quality.</content>
      <source-memory-id>%s</source-memory-id>
      <source-memory-id>%s</source-memory-id>
    </narrative>
  </narratives>
  <truths>
    <truth id="truth-ai-exec-1" dimension="relational" normalized-key="relationship:review-cadence" confidence="0.9" source-count="2" status="admitted">
      <statement>The agent and user are iterating closely on review quality.</statement>
      <source-memory-id>%s</source-memory-id>
      <source-memory-id>%s</source-memory-id>
    </truth>
  </truths>
  <relations>
    <relation source-id="%s" target-id="%s" relation-type="thematic" confidence="0.9"/>
  </relations>
</canonical-review>`, retainResp.GetRecords()[0].GetMemoryId(), retainResp.GetRecords()[1].GetMemoryId(), retainResp.GetRecords()[0].GetMemoryId(), retainResp.GetRecords()[1].GetMemoryId(), retainResp.GetRecords()[0].GetMemoryId(), retainResp.GetRecords()[2].GetMemoryId()),
					},
				},
			},
		},
	}))

	result, err := svc.ExecuteCanonicalReview(ctx, CanonicalReviewRequest{
		AgentID: testRuntimeAgentLocalRef("agent-canonical-review-ai"),
		Bank:    locator,
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("ExecuteCanonicalReview: %v", err)
	}
	if result.Skipped {
		t.Fatalf("expected review execution, got skipped result %#v", result)
	}
	if result.NarrativeCount != 1 || result.TruthCount != 1 || result.LeftoverCount != 1 {
		t.Fatalf("unexpected execution result: %#v", result)
	}
	var reviewStatus string
	if err := svc.backend.DB().QueryRow(`SELECT status FROM runtime_local_agent_review_run WHERE review_run_id = ?`, result.ReviewRunID).Scan(&reviewStatus); err != nil {
		t.Fatalf("load review run status: %v", err)
	}
	if reviewStatus != "completed" {
		t.Fatalf("expected completed review run, got %q", reviewStatus)
	}
	var truthStatus string
	var sourceCount int32
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`
		SELECT status, truth_json
		FROM agent_truth
		WHERE truth_id = ?
	`, "truth-ai-exec-1").Scan(&truthStatus, new(string)); err != nil {
		t.Fatalf("load truth row: %v", err)
	}
	truths, err := memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 0 {
		t.Fatalf("expected no admitted truths after Wave 4 normalization, got %#v", truths)
	}
	var truthJSON string
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`SELECT truth_json FROM agent_truth WHERE truth_id = ?`, "truth-ai-exec-1").Scan(&truthJSON); err != nil {
		t.Fatalf("load truth json: %v", err)
	}
	var storedTruth memoryservice.TruthCandidate
	if err := json.Unmarshal([]byte(truthJSON), &storedTruth); err != nil {
		t.Fatalf("unmarshal stored truth: %v", err)
	}
	sourceCount = storedTruth.SourceCount
	if truthStatus != "candidate" || sourceCount != 2 {
		t.Fatalf("expected stored truth to downgrade to candidate with source_count=2, got status=%q source_count=%d truth=%#v", truthStatus, sourceCount, storedTruth)
	}
}

func TestRuntimeAgentRecoversMemoryCommittedReviewRunWithoutRecommittingMemory(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-review-committed"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-review-committed")},
		},
	}
	if _, err := memorySvc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "already committed source"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceRecordID := retainResp.GetRecords()[0].GetMemoryId()
	outcomes := memoryservice.CanonicalReviewOutcomes{
		Truths: []memoryservice.TruthCandidate{
			{
				TruthID:         "truth-review-committed",
				Dimension:       "source",
				NormalizedKey:   "review:committed",
				Statement:       "Committed review truth.",
				Confidence:      0.9,
				ReviewCount:     1,
				Status:          "admitted",
				SourceMemoryIDs: []string{sourceRecordID},
			},
		},
	}
	if err := memorySvc.CommitCanonicalReview(ctx, "review-run-committed", locator, sourceRecordID, outcomes); err != nil {
		t.Fatalf("CommitCanonicalReview: %v", err)
	}
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:      "review-run-committed",
		AgentID:          "agent-review-committed",
		BankLocatorKey:   memoryservice.LocatorKey(locator),
		CheckpointBasis:  sourceRecordID,
		Status:           "memory_committed",
		PreparedOutcomes: outcomes,
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun(memory_committed): %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

	var statusValue string
	if err := svc.backend.DB().QueryRow(`SELECT status FROM runtime_local_agent_review_run WHERE review_run_id = ?`, "review-run-committed").Scan(&statusValue); err != nil {
		t.Fatalf("load review run status: %v", err)
	}
	if statusValue != "completed" {
		t.Fatalf("expected completed review run, got %q", statusValue)
	}
	var truthCount int
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`SELECT COUNT(*) FROM agent_truth WHERE truth_id = ?`, "truth-review-committed").Scan(&truthCount); err != nil {
		t.Fatalf("count truths: %v", err)
	}
	if truthCount != 1 {
		t.Fatalf("expected one committed truth after replay, got %d", truthCount)
	}
	followUp, err := svc.GetReviewFollowUp(ctx, locator)
	if err != nil {
		t.Fatalf("GetReviewFollowUp: %v", err)
	}
	if followUp == nil || followUp.ReviewRunID != "review-run-committed" {
		t.Fatalf("unexpected review follow-up: %#v", followUp)
	}
}

func TestRuntimeAgentRecoveryFailClosesOnInvalidReviewLocatorKey(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	ctx := context.Background()
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:     "review-run-invalid-locator",
		AgentID:         "agent-invalid-locator",
		BankLocatorKey:  "broken::locator::key",
		CheckpointBasis: "mem-001",
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{
			Summary: "should fail closed during recovery",
		},
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(restart): %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(restart): %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

	var statusValue string
	var failureMessage string
	if err := svc.backend.DB().QueryRow(`
		SELECT status, failure_message
		FROM runtime_local_agent_review_run
		WHERE review_run_id = ?
	`, "review-run-invalid-locator").Scan(&statusValue, &failureMessage); err != nil {
		t.Fatalf("load review run failure state: %v", err)
	}
	if statusValue != "failed" {
		t.Fatalf("expected failed review run, got %q", statusValue)
	}
	if !strings.Contains(failureMessage, "resolve bank locator") {
		t.Fatalf("expected locator resolution failure message, got %q", failureMessage)
	}

	var followUpCount int
	if err := svc.backend.DB().QueryRow(`
		SELECT COUNT(*)
		FROM runtime_local_agent_review_followup
		WHERE review_run_id = ?
	`, "review-run-invalid-locator").Scan(&followUpCount); err != nil {
		t.Fatalf("count review follow-ups: %v", err)
	}
	if followUpCount != 0 {
		t.Fatalf("expected no follow-up for failed recovery, got %d", followUpCount)
	}
}

func TestRuntimeAgentRecoveryWritesFollowUpExactlyOnceAcrossRestarts(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err := New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New: %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	ctx := context.Background()
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-followup-once"),
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-followup-once")},
		},
	}
	if _, err := memorySvc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "follow-up once source"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceRecordID := retainResp.GetRecords()[0].GetMemoryId()
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:     "review-run-followup-once",
		AgentID:         "agent-followup-once",
		BankLocatorKey:  memoryservice.LocatorKey(locator),
		CheckpointBasis: sourceRecordID,
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{
			Truths: []memoryservice.TruthCandidate{
				{
					TruthID:         "truth-followup-once",
					Dimension:       "source",
					NormalizedKey:   "followup:once",
					Statement:       "Follow-up should only be persisted once.",
					Confidence:      0.9,
					ReviewCount:     1,
					Status:          "admitted",
					SourceMemoryIDs: []string{sourceRecordID},
				},
			},
		},
	}); err != nil {
		t.Fatalf("SavePreparedReviewRun: %v", err)
	}

	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(first restart): %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(first restart): %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)
	if err := memorySvc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(second backend): %v", err)
	}

	memorySvc, err = memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New(second restart): %v", err)
	}
	closeRuntimeAgentMemoryServiceForTest(t, memorySvc)
	defer func() {
		if err := memorySvc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(third backend): %v", err)
		}
	}()
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		t.Fatalf("runtimeagent.New(second restart): %v", err)
	}
	closeRuntimeAgentServiceForTest(t, svc)

	var followUpCount int
	if err := svc.backend.DB().QueryRow(`
		SELECT COUNT(*)
		FROM runtime_local_agent_review_followup
		WHERE review_run_id = ?
	`, "review-run-followup-once").Scan(&followUpCount); err != nil {
		t.Fatalf("count review follow-ups: %v", err)
	}
	if followUpCount != 1 {
		t.Fatalf("expected exactly one follow-up row after repeated restarts, got %d", followUpCount)
	}
}
