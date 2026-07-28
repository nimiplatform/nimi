package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

func TestRuntimeAgentColdStartHasNoTruthsOrPostureBasis(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-cold-start"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-cold-start")},
		},
	}
	truths, err := svc.memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 0 {
		t.Fatalf("expected no admitted truths on cold start, got %#v", truths)
	}
	posture, err := svc.GetBehavioralPosture(ctx, testRuntimeAgentLocalRef("agent-cold-start"))
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if posture != nil {
		t.Fatalf("expected no posture basis on cold start, got %#v", posture)
	}
}

func TestRuntimeAgentBehavioralPosturePersistsAcrossRestart(t *testing.T) {
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
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-posture"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	want := BehavioralPosture{
		AgentID:          testRuntimeAgentLocalRef("agent-posture"),
		PostureClass:     "steady_support",
		ActionFamily:     "support",
		StatusText:       "steady and terse",
		TruthBasisIDs:    []string{"truth-1", "truth-2"},
		InterruptMode:    "cautious",
		TransitionReason: "user needs steady support",
		ModeID:           "support",
	}
	if err := svc.PutBehavioralPosture(ctx, want); err != nil {
		t.Fatalf("PutBehavioralPosture: %v", err)
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

	got, err := svc.GetBehavioralPosture(ctx, testRuntimeAgentLocalRef("agent-posture"))
	if err != nil {
		t.Fatalf("GetBehavioralPosture: %v", err)
	}
	if got == nil {
		t.Fatal("expected persisted posture")
	}
	if got.AgentID != want.AgentID || got.StatusText != want.StatusText || got.InterruptMode != want.InterruptMode || got.PostureClass != want.PostureClass || got.ActionFamily != want.ActionFamily || got.TransitionReason != want.TransitionReason || got.ModeID != want.ModeID {
		t.Fatalf("unexpected posture: %#v", got)
	}
	if len(got.TruthBasisIDs) != len(want.TruthBasisIDs) {
		t.Fatalf("unexpected truth basis ids: %#v", got.TruthBasisIDs)
	}
	for idx := range want.TruthBasisIDs {
		if got.TruthBasisIDs[idx] != want.TruthBasisIDs[idx] {
			t.Fatalf("unexpected truth basis ids: %#v", got.TruthBasisIDs)
		}
	}
}

func TestRuntimeAgentRecoversPreparedReviewRunAndCommitsMemory(t *testing.T) {
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
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-review"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-review")},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "review source memory"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceRecordID := retainResp.GetRecords()[0].GetMemoryId()
	outcomes := memoryservice.CanonicalReviewOutcomes{
		Narratives: []memoryservice.NarrativeCandidate{
			{
				NarrativeID:     "nar-review",
				Topic:           "source",
				Content:         "Review source memory is still relevant.",
				SourceVersion:   "v1",
				Status:          "active",
				SourceMemoryIDs: []string{sourceRecordID},
			},
		},
		Truths: []memoryservice.TruthCandidate{
			{
				TruthID:         "truth-review",
				Dimension:       "source",
				NormalizedKey:   "review:source",
				Statement:       "Review source memory remains relevant.",
				Confidence:      0.8,
				ReviewCount:     1,
				Status:          "admitted",
				SourceMemoryIDs: []string{sourceRecordID},
			},
		},
	}
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:      "review-run-1",
		AgentID:          "agent-review",
		BankLocatorKey:   memoryservice.LocatorKey(locator),
		CheckpointBasis:  sourceRecordID,
		PreparedOutcomes: outcomes,
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
	if err := svc.backend.DB().QueryRow(`SELECT status FROM runtime_local_agent_review_run WHERE review_run_id = ?`, "review-run-1").Scan(&statusValue); err != nil {
		t.Fatalf("load review run status: %v", err)
	}
	if statusValue != "completed" {
		t.Fatalf("expected completed review run, got %q", statusValue)
	}
	truths, err := memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-review" {
		t.Fatalf("unexpected recovered truths: %#v", truths)
	}
	narratives, err := memorySvc.ListNarrativeContext(ctx, locator, "relevant", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-review" {
		t.Fatalf("unexpected recovered narratives: %#v", narratives)
	}
	followUp, err := svc.GetReviewFollowUp(ctx, locator)
	if err != nil {
		t.Fatalf("GetReviewFollowUp: %v", err)
	}
	if followUp == nil || followUp.ReviewRunID != "review-run-1" || followUp.CheckpointBasis != sourceRecordID {
		t.Fatalf("unexpected review follow-up: %#v", followUp)
	}
}

func TestRuntimeAgentRecoveryDowngradesTruthBelowAdmissionFloor(t *testing.T) {
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
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-admission-floor"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-admission-floor")},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "shared project planning"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "ongoing collaboration cadence"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceIDs := []string{
		retainResp.GetRecords()[0].GetMemoryId(),
		retainResp.GetRecords()[1].GetMemoryId(),
	}
	if err := svc.SavePreparedReviewRun(ctx, ReviewRunRecord{
		ReviewRunID:     "review-run-admission-floor",
		AgentID:         "agent-admission-floor",
		BankLocatorKey:  memoryservice.LocatorKey(locator),
		CheckpointBasis: sourceIDs[1],
		PreparedOutcomes: memoryservice.CanonicalReviewOutcomes{
			Truths: []memoryservice.TruthCandidate{
				{
					TruthID:         "truth-admission-floor",
					Dimension:       "relational",
					NormalizedKey:   "relationship:cadence",
					Statement:       "The relationship cadence is becoming stable.",
					Confidence:      0.9,
					Status:          "admitted",
					SourceMemoryIDs: sourceIDs,
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

	var truthStatus string
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`
		SELECT status
		FROM agent_truth
		WHERE truth_id = ?
	`, "truth-admission-floor").Scan(&truthStatus); err != nil {
		t.Fatalf("load truth status: %v", err)
	}
	if truthStatus != "candidate" {
		t.Fatalf("expected relational truth to downgrade to candidate, got %q", truthStatus)
	}
	truths, err := memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 0 {
		t.Fatalf("expected no admitted truths after downgrade, got %#v", truths)
	}
}

func TestRuntimeAgentExecuteCanonicalReviewCommitsExecutorOutputs(t *testing.T) {
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
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-canonical-review"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: testRuntimeAgentLocalRef("agent-canonical-review")},
		},
	}
	if _, err := memorySvc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
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

	var sawRequest *CanonicalReviewExecutorRequest
	svc.SetCanonicalReviewExecutor(canonicalReviewExecutorFunc(func(_ context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
		sawRequest = req
		return &CanonicalReviewExecutorResult{
			TokensUsed: 77,
			Outcomes: memoryservice.CanonicalReviewOutcomes{
				Narratives: []memoryservice.NarrativeCandidate{
					{
						NarrativeID:     "nar-exec-1",
						Topic:           "memory redesign",
						Content:         "The current focus remains memory redesign review quality.",
						SourceVersion:   "admission-floor",
						Status:          "active",
						SourceMemoryIDs: []string{req.Clusters[0].RecordIDs[0], req.Clusters[0].RecordIDs[1]},
					},
				},
				Truths: []memoryservice.TruthCandidate{
					{
						TruthID:         "truth-exec-1",
						Dimension:       "source",
						NormalizedKey:   "relationship:review-cadence",
						Statement:       "The agent and user are iterating closely on review quality.",
						Confidence:      0.9,
						Status:          "admitted",
						SourceMemoryIDs: []string{req.Clusters[0].RecordIDs[0], req.Clusters[0].RecordIDs[1], retainResp.GetRecords()[2].GetMemoryId(), req.Clusters[0].RecordIDs[0]},
					},
				},
				Relations: []memoryservice.RelationCandidate{
					{
						SourceID:     req.Clusters[0].RecordIDs[0],
						TargetID:     retainResp.GetRecords()[2].GetMemoryId(),
						RelationType: "thematic",
						Confidence:   0.9,
					},
				},
			},
		}, nil
	}))

	result, err := svc.ExecuteCanonicalReview(ctx, CanonicalReviewRequest{
		AgentID: testRuntimeAgentLocalRef("agent-canonical-review"),
		Bank:    locator,
		Limit:   10,
	})
	if err != nil {
		t.Fatalf("ExecuteCanonicalReview: %v", err)
	}
	if result.Skipped {
		t.Fatalf("expected review execution, got skipped result %#v", result)
	}
	if result.ClusterCount != 1 || result.LeftoverCount != 1 || result.NarrativeCount != 1 || result.TruthCount != 1 || result.TokensUsed != 77 {
		t.Fatalf("unexpected execution result: %#v", result)
	}
	if sawRequest == nil {
		t.Fatal("expected executor request to be captured")
	}
	if len(sawRequest.Clusters) != 1 || len(sawRequest.Clusters[0].RecordIDs) != 2 {
		t.Fatalf("expected one 2-record cluster, got %#v", sawRequest.Clusters)
	}
	if len(sawRequest.Leftovers) != 1 || sawRequest.Leftovers[0].GetMemoryId() != retainResp.GetRecords()[2].GetMemoryId() {
		t.Fatalf("expected astronomy record leftover, got %#v", sawRequest.Leftovers)
	}

	var reviewStatus string
	if err := svc.backend.DB().QueryRow(`SELECT status FROM runtime_local_agent_review_run WHERE review_run_id = ?`, result.ReviewRunID).Scan(&reviewStatus); err != nil {
		t.Fatalf("load review run status: %v", err)
	}
	if reviewStatus != "completed" {
		t.Fatalf("expected completed review run, got %q", reviewStatus)
	}
	truths, err := memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-exec-1" || truths[0].Status != "admitted" {
		t.Fatalf("unexpected admitted truths: %#v", truths)
	}
	narratives, err := memorySvc.ListNarrativeContext(ctx, locator, "memory redesign", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-exec-1" {
		t.Fatalf("unexpected narratives: %#v", narratives)
	}
	var relationCount int
	if err := memorySvc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(*)
		FROM memory_relation
		WHERE bank_locator_key = ? AND relation_type = 'thematic'
	`, memoryservice.LocatorKey(locator)).Scan(&relationCount); err != nil {
		t.Fatalf("count memory_relation: %v", err)
	}
	if relationCount != 1 {
		t.Fatalf("expected one persisted relation, got %d", relationCount)
	}
}

type canonicalReviewExecutorFunc func(context.Context, *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error)

func (fn canonicalReviewExecutorFunc) ExecuteCanonicalReview(ctx context.Context, req *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
	return fn(ctx, req)
}
