package memory

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestMemoryServiceNarrativeRecallUsesEmbeddingAndFallsBack(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-narrative-1", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-semantic-1",
				Topic:           "miscellaneous",
				Content:         "unrelated prose only",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(narrative): %v", err)
	}
	query := "semantic-key"
	vector := marshalFloatVector(computeEmbeddingVector(query, 4))
	if _, err := svc.PersistenceBackend().DB().Exec(`
		UPDATE memory_narrative_embedding
		SET vector_json = ?
		WHERE locator_key = ? AND narrative_id = ?
	`, vector, locatorKey(locator), "nar-semantic-1"); err != nil {
		t.Fatalf("update memory_narrative_embedding: %v", err)
	}

	recallWithEmbedding, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: query,
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(with narrative embedding): %v", err)
	}
	if len(recallWithEmbedding.GetNarrativeHits()) != 1 || recallWithEmbedding.GetNarrativeHits()[0].GetNarrativeId() != "nar-semantic-1" {
		t.Fatalf("expected semantic narrative hit, got %#v", recallWithEmbedding.GetNarrativeHits())
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		DELETE FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), "nar-semantic-1"); err != nil {
		t.Fatalf("delete memory_narrative_embedding: %v", err)
	}

	recallWithoutEmbedding, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: query,
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(without narrative embedding): %v", err)
	}
	if len(recallWithoutEmbedding.GetNarrativeHits()) != 0 {
		t.Fatalf("expected FTS-only fallback to produce no hit for non-lexical query, got %#v", recallWithoutEmbedding.GetNarrativeHits())
	}
}

func TestMemoryServiceNarrativeEmbeddingDeletedWhenNarrativeBecomesStale(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-narrative-active", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-stale-1",
				Topic:           "project direction",
				Content:         "initial active narrative",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(active narrative): %v", err)
	}
	var beforeCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), "nar-stale-1").Scan(&beforeCount); err != nil {
		t.Fatalf("count active narrative embedding: %v", err)
	}
	if beforeCount != 1 {
		t.Fatalf("expected active narrative embedding row, got %d", beforeCount)
	}
	vector := marshalFloatVector(computeEmbeddingVector("semantic-key", 4))
	if _, err := svc.PersistenceBackend().DB().Exec(`
		UPDATE memory_narrative_embedding
		SET vector_json = ?
		WHERE locator_key = ? AND narrative_id = ?
	`, vector, locatorKey(locator), "nar-stale-1"); err != nil {
		t.Fatalf("update active narrative embedding: %v", err)
	}
	activeSemanticResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "semantic-key",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(active narrative semantic-only): %v", err)
	}
	if len(activeSemanticResp.GetNarrativeHits()) != 1 || activeSemanticResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-stale-1" {
		t.Fatalf("expected active narrative embedding hit before stale, got %#v", activeSemanticResp.GetNarrativeHits())
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), "nar-stale-1", "semantic key", "semantic key", 3, 0, narrativeAliasStatusActive, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert active alias row: %v", err)
	}
	activeAliasResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "semantic key",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(active narrative alias-only): %v", err)
	}
	if len(activeAliasResp.GetNarrativeHits()) != 1 || activeAliasResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-stale-1" {
		t.Fatalf("expected active narrative alias hit before stale, got %#v", activeAliasResp.GetNarrativeHits())
	}
	if err := svc.CommitCanonicalReview(ctx, "review-narrative-stale", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-stale-1",
				Topic:           "project direction",
				Content:         "stale narrative no longer active",
				SourceVersion:   "review-runtime",
				Status:          "stale",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(stale narrative): %v", err)
	}
	var afterCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), "nar-stale-1").Scan(&afterCount); err != nil {
		t.Fatalf("count stale narrative embedding: %v", err)
	}
	if afterCount != 0 {
		t.Fatalf("expected stale narrative embedding row to be removed, got %d", afterCount)
	}
	if err := svc.cleanupAcceleratorStateAt(ctx, time.Now().UTC()); err != nil {
		t.Fatalf("cleanupAcceleratorStateAt: %v", err)
	}
	var aliasCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), "nar-stale-1").Scan(&aliasCount); err != nil {
		t.Fatalf("count stale narrative alias rows: %v", err)
	}
	if aliasCount != 0 {
		t.Fatalf("expected stale narrative alias rows to be removed, got %d", aliasCount)
	}
	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "project direction",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(stale narrative): %v", err)
	}
	if len(recallResp.GetNarrativeHits()) != 1 || recallResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-stale-1" {
		t.Fatalf("expected stale narrative to remain recallable, got %#v", recallResp.GetNarrativeHits())
	}
	if !recallResp.GetNarrativeHits()[0].GetIsStale() {
		t.Fatalf("expected stale narrative hit to keep stale marker, got %#v", recallResp.GetNarrativeHits()[0])
	}
	semanticResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "semantic-key",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(stale narrative semantic-only): %v", err)
	}
	if len(semanticResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected stale narrative to lose embedding-only recall advantage, got %#v", semanticResp.GetNarrativeHits())
	}
	aliasResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "semantic key",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(stale narrative alias-only): %v", err)
	}
	if len(aliasResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected stale narrative to lose alias acceleration advantage, got %#v", aliasResp.GetNarrativeHits())
	}
}

func TestMemoryServiceNarrativeEmbeddingRejectsStaleGenerationWriterAfterCutover(t *testing.T) {
	ctx := context.Background()
	svc := newMemoryEmbeddingRuntimePrivateService(t)
	locator := testMemoryEmbeddingLocator("agent-narrative-generation-race")
	oldProfile := testManagedEmbeddingProfile("local/embed-narrative-old")
	oldProfile.Dimension = 2
	targetProfile := testManagedEmbeddingProfile("local/embed-narrative-target")
	targetProfile.Dimension = 2
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankResolvedEmbeddingProfile(ctx, locator, oldProfile); err != nil {
		t.Fatalf("BindCanonicalBankResolvedEmbeddingProfile(old): %v", err)
	}

	narrative := NarrativeCandidate{
		NarrativeID:   "narrative-generation-race",
		Topic:         "generation topic",
		Content:       "generation content",
		SourceVersion: "v1",
		Status:        "active",
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	oldProfileRaw, err := protojson.Marshal(oldProfile)
	if err != nil {
		t.Fatalf("marshal old profile: %v", err)
	}
	if _, err := svc.backend.DB().Exec(`
		INSERT INTO memory_narrative(narrative_id, bank_locator_key, topic, content, source_version, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, narrative.NarrativeID, locatorKey(locator), narrative.Topic, narrative.Content, narrative.SourceVersion, narrative.Status, now, now); err != nil {
		t.Fatalf("insert narrative: %v", err)
	}
	if _, err := svc.backend.DB().Exec(`
		INSERT INTO memory_narrative_embedding(locator_key, narrative_id, embedding_profile_json, vector_json, updated_at)
		VALUES (?, ?, ?, '[1,0]', ?)
	`, locatorKey(locator), narrative.NarrativeID, string(oldProfileRaw), now); err != nil {
		t.Fatalf("insert old narrative embedding: %v", err)
	}

	svc.SetRuntimeEmbeddingProfileResolver(func(context.Context, *MemoryEmbeddingTextEmbedIntentSnapshot) MemoryEmbeddingResolvedProfile {
		return MemoryEmbeddingResolvedProfile{
			Profile:         cloneEmbeddingProfile(targetProfile),
			ResolutionState: memoryEmbeddingResolutionStateResolved,
		}
	})
	setMemoryEmbeddingIntentForTest(t, svc, locator, testLocalBindingSnapshot(targetProfile.GetModelId()))
	oldExecutorEntered := make(chan struct{})
	releaseOldExecutor := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(releaseOldExecutor) }) })
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, profile *runtimev1.MemoryEmbeddingProfile, raws []string) ([][]float64, error) {
		switch profile.GetModelId() {
		case oldProfile.GetModelId():
			close(oldExecutorEntered)
			<-releaseOldExecutor
		case targetProfile.GetModelId():
		default:
			return nil, fmt.Errorf("unexpected embedding profile: %q", profile.GetModelId())
		}
		vectors := make([][]float64, len(raws))
		for index := range vectors {
			if profile.GetModelId() == oldProfile.GetModelId() {
				vectors[index] = []float64{1, 0}
			} else {
				vectors[index] = []float64{0, 1}
			}
		}
		return vectors, nil
	})
	if _, err := svc.RequestCanonicalMemoryEmbeddingBind(ctx, RequestCanonicalMemoryEmbeddingBindRequest{Locator: locator}); err != nil {
		t.Fatalf("RequestCanonicalMemoryEmbeddingBind(stage): %v", err)
	}

	staleWriterDone := make(chan error, 1)
	go func() {
		staleWriterDone <- svc.upsertNarrativeEmbeddings(context.Background(), locator, []NarrativeCandidate{narrative})
	}()
	select {
	case <-oldExecutorEntered:
	case <-time.After(time.Second):
		t.Fatal("old-profile narrative materialization did not start")
	}

	result, err := svc.RequestMemoryEmbeddingCutover(ctx, RequestMemoryEmbeddingCutoverRequest{Locator: locator})
	if err != nil {
		t.Fatalf("RequestMemoryEmbeddingCutover: %v", err)
	}
	if result.Outcome != "cutover_committed" {
		t.Fatalf("cutover outcome = %q, want cutover_committed", result.Outcome)
	}
	assertNarrativeEmbeddingProfileAndVector(t, svc, locator, narrative.NarrativeID, targetProfile.GetModelId(), "[0,1]")

	releaseOnce.Do(func() { close(releaseOldExecutor) })
	select {
	case staleErr := <-staleWriterDone:
		if status.Code(staleErr) != codes.Aborted {
			t.Fatalf("stale narrative writer error = %v, want Aborted", staleErr)
		}
	case <-time.After(time.Second):
		t.Fatal("stale narrative writer did not finish")
	}
	assertNarrativeEmbeddingProfileAndVector(t, svc, locator, narrative.NarrativeID, targetProfile.GetModelId(), "[0,1]")
}

func assertNarrativeEmbeddingProfileAndVector(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator, narrativeID string, wantModelID string, wantVector string) {
	t.Helper()
	var profileRaw, vectorRaw string
	if err := svc.backend.DB().QueryRow(`
		SELECT embedding_profile_json, vector_json
		FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), narrativeID).Scan(&profileRaw, &vectorRaw); err != nil {
		t.Fatalf("load narrative embedding: %v", err)
	}
	var profile runtimev1.MemoryEmbeddingProfile
	if err := protojson.Unmarshal([]byte(profileRaw), &profile); err != nil {
		t.Fatalf("unmarshal narrative embedding profile: %v", err)
	}
	if profile.GetModelId() != wantModelID || vectorRaw != wantVector {
		t.Fatalf("narrative embedding = profile %q vector %s, want profile %q vector %s", profile.GetModelId(), vectorRaw, wantModelID, wantVector)
	}
}

func TestMemoryServiceDeleteMemoryCascadesDerivedState(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	target := seedCanonicalCascadeFixture(t, svc, locator, record, "delete")
	ctx := context.Background()

	if _, err := svc.DeleteMemory(ctx, &runtimev1.DeleteMemoryRequest{
		Bank:      locator,
		MemoryIds: []string{record.GetMemoryId()},
		Reason:    "cleanup",
	}); err != nil {
		t.Fatalf("DeleteMemory: %v", err)
	}

	assertNarrativeCascadeState(t, svc, locator, "nar-delete", "invalidated")
	assertTruthCascadeState(t, svc, locator, "truth-delete", "invalidated")
	assertRelationInactive(t, svc, locator, record.GetMemoryId(), target.GetMemoryId(), "thematic")

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "project direction",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(after delete cascade): %v", err)
	}
	if len(recallResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected invalidated narrative hidden from recall, got %#v", recallResp.GetNarrativeHits())
	}
}

func TestMemoryServiceReplicationInvalidationCascadesDerivedState(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	target := seedCanonicalCascadeFixture(t, svc, locator, record, "replication")
	ctx := context.Background()
	observedAt := time.Now().UTC()

	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Invalidation{
			Invalidation: &runtimev1.MemoryInvalidation{
				InvalidationId:     "inv-derived-1",
				InvalidatedVersion: record.GetReplication().GetLocalVersion(),
				Authority:          "realm",
				InvalidationReason: "moderation",
				InvalidatedAt:      timestamppb.New(observedAt),
			},
		},
	}, observedAt); err != nil {
		t.Fatalf("ApplyReplicationObservation(invalidated): %v", err)
	}

	assertNarrativeCascadeState(t, svc, locator, "nar-replication", "invalidated")
	assertTruthCascadeState(t, svc, locator, "truth-replication", "invalidated")
	assertRelationInactive(t, svc, locator, record.GetMemoryId(), target.GetMemoryId(), "thematic")

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "project direction",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(after replication cascade): %v", err)
	}
	if len(recallResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected invalidated narrative hidden from recall, got %#v", recallResp.GetNarrativeHits())
	}
}

func TestMemoryServiceTruthSupersessionMarksPriorTruthStale(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339Nano)

	if err := svc.CommitCanonicalReview(ctx, "review-truth-old", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Truths: []TruthCandidate{
			{
				TruthID:         "truth-old",
				Dimension:       "relational",
				NormalizedKey:   "alice:works_at",
				Statement:       "Alice works at Nimi.",
				Confidence:      0.92,
				ReviewCount:     1,
				LastReviewAt:    now,
				Status:          "admitted",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(old truth): %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-truth-new", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Truths: []TruthCandidate{
			{
				TruthID:           "truth-new",
				Dimension:         "relational",
				NormalizedKey:     "alice:role",
				Statement:         "Alice is part of the core org.",
				Confidence:        0.95,
				ReviewCount:       2,
				LastReviewAt:      now,
				Status:            "admitted",
				SupersedesTruthID: "truth-old",
				SourceMemoryIDs:   []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(new truth): %v", err)
	}

	assertTruthCascadeState(t, svc, locator, "truth-old", "stale")
	truths, err := svc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-new" {
		t.Fatalf("expected only new truth admitted after supersession, got %#v", truths)
	}
}

func TestMemoryServiceNarrativeAliasPromotesSuppressesAndAffectsRecall(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	if err := svc.CommitCanonicalReview(ctx, "review-alias-1", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-alias-1",
				Topic:           "miscellaneous",
				Content:         "unrelated prose only",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(narrative): %v", err)
	}

	queryResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "zorb",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(before alias): %v", err)
	}
	if len(queryResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected no narrative hits before alias promotion, got %#v", queryResp.GetNarrativeHits())
	}

	for idx := 1; idx <= 2; idx++ {
		if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
			FeedbackID: fmt.Sprintf("narrative-alias-helpful-%d", idx),
			Bank:       locator,
			TargetKind: recallFeedbackTargetNarrative,
			TargetID:   "nar-alias-1",
			Polarity:   recallFeedbackHelpful,
			QueryText:  "zorb",
		}); err != nil {
			t.Fatalf("RecordRecallFeedback(helpful %d): %v", idx, err)
		}
	}
	var candidateStatus string
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT status
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-alias-1", "zorb").Scan(&candidateStatus); err != nil {
		t.Fatalf("load candidate alias row: %v", err)
	}
	if candidateStatus != narrativeAliasStatusCandidate {
		t.Fatalf("expected candidate alias status after 2 helpful events, got %q", candidateStatus)
	}

	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "narrative-alias-helpful-3",
		Bank:       locator,
		TargetKind: recallFeedbackTargetNarrative,
		TargetID:   "nar-alias-1",
		Polarity:   recallFeedbackHelpful,
		QueryText:  "zorb",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(helpful 3): %v", err)
	}
	var activeStatus string
	var helpfulCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT status, helpful_count
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-alias-1", "zorb").Scan(&activeStatus, &helpfulCount); err != nil {
		t.Fatalf("load active alias row: %v", err)
	}
	if activeStatus != narrativeAliasStatusActive || helpfulCount != 3 {
		t.Fatalf("expected active alias after 3 helpful events, got status=%q helpful_count=%d", activeStatus, helpfulCount)
	}
	exactResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "zorb",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(active alias): %v", err)
	}
	if len(exactResp.GetNarrativeHits()) != 1 || exactResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-alias-1" {
		t.Fatalf("expected alias-promoted narrative hit, got %#v", exactResp.GetNarrativeHits())
	}
	nonExactResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "zorb extra",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(non-exact alias): %v", err)
	}
	if len(nonExactResp.GetNarrativeHits()) != 1 || nonExactResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-alias-1" {
		t.Fatalf("expected narrative feedback hit to remain available, got %#v", nonExactResp.GetNarrativeHits())
	}
	if exactResp.GetNarrativeHits()[0].GetRelevanceScore() <= nonExactResp.GetNarrativeHits()[0].GetRelevanceScore() {
		t.Fatalf("expected exact alias match to outrank non-exact query, got exact=%#v non_exact=%#v", exactResp.GetNarrativeHits(), nonExactResp.GetNarrativeHits())
	}

	for idx := 1; idx <= 3; idx++ {
		if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
			FeedbackID: fmt.Sprintf("narrative-alias-unhelpful-%d", idx),
			Bank:       locator,
			TargetKind: recallFeedbackTargetNarrative,
			TargetID:   "nar-alias-1",
			Polarity:   recallFeedbackUnhelpful,
			QueryText:  "zorb",
		}); err != nil {
			t.Fatalf("RecordRecallFeedback(unhelpful %d): %v", idx, err)
		}
	}
	var suppressedStatus string
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT status
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-alias-1", "zorb").Scan(&suppressedStatus); err != nil {
		t.Fatalf("load suppressed alias row: %v", err)
	}
	if suppressedStatus != narrativeAliasStatusSuppressed {
		t.Fatalf("expected suppressed alias status, got %q", suppressedStatus)
	}
	queryResp, err = svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "zorb",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(suppressed alias): %v", err)
	}
	if len(queryResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected alias suppression to remove narrative hit, got %#v", queryResp.GetNarrativeHits())
	}
}
