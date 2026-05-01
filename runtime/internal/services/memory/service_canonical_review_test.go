package memory

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
)

func TestMemoryServiceCommitCanonicalReviewIsIdempotentAndQueryable(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	outcomes := CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-1",
				Topic:           "employment",
				Content:         "Alice works at Nimi and remains part of the core org.",
				SourceVersion:   "v1",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
		Truths: []TruthCandidate{
			{
				TruthID:         "truth-1",
				Dimension:       "employment",
				NormalizedKey:   "alice:works_at",
				Statement:       "Alice works at Nimi.",
				Confidence:      0.92,
				ReviewCount:     1,
				LastReviewAt:    time.Now().UTC().Format(time.RFC3339Nano),
				Status:          "admitted",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}

	if err := svc.CommitCanonicalReview(ctx, "review-1", locator, record.GetMemoryId(), outcomes); err != nil {
		t.Fatalf("CommitCanonicalReview(first): %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-1", locator, record.GetMemoryId(), outcomes); err != nil {
		t.Fatalf("CommitCanonicalReview(idempotent): %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-1", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Summary: "different outcome payload",
	}); err == nil {
		t.Fatal("expected outcome hash mismatch to fail")
	}

	truths, err := svc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-1" {
		t.Fatalf("unexpected truths: %#v", truths)
	}
	checkpoint, err := svc.GetReviewCheckpoint(ctx, locator)
	if err != nil {
		t.Fatalf("GetReviewCheckpoint: %v", err)
	}
	if checkpoint == nil || checkpoint.LastReviewRun != "review-1" || checkpoint.Checkpoint != record.GetMemoryId() {
		t.Fatalf("unexpected checkpoint: %#v", checkpoint)
	}
	narratives, err := svc.ListNarrativeContext(ctx, locator, "Alice works at Nimi", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-1" {
		t.Fatalf("unexpected narratives: %#v", narratives)
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "Where does Alice work?",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(with narrative): %v", err)
	}
	if len(recallResp.GetNarrativeHits()) != 1 {
		t.Fatalf("expected one narrative hit, got %#v", recallResp.GetNarrativeHits())
	}
	if got := recallResp.GetNarrativeHits()[0].GetSourceMemoryIds(); len(got) != 1 || got[0] != record.GetMemoryId() {
		t.Fatalf("unexpected narrative source ids: %#v", got)
	}
}

func TestMemoryServiceCanonicalReviewStoreAdapterIsQueryableAndIdempotent(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	store := svc.CanonicalReviewStore()
	if store == nil {
		t.Fatal("expected CanonicalReviewStore adapter")
	}
	scope, err := memoryengine.ScopeFromMemoryBankLocator(locator)
	if err != nil {
		t.Fatalf("ScopeFromMemoryBankLocator: %v", err)
	}
	ctx := context.Background()
	req := memoryengine.CommitCanonicalReviewRequest{
		ReviewRunID:     "review-store-1",
		Scope:           scope,
		CheckpointBasis: record.GetMemoryId(),
		Outcomes: memoryengine.ReviewOutcomes{
			Narratives: []memoryengine.NarrativeRecord{
				{
					NarrativeID:     "nar-store-1",
					Topic:           "employment",
					Content:         "Alice still works at Nimi.",
					SourceVersion:   "v1",
					Status:          "active",
					SourceMemoryIDs: []string{record.GetMemoryId()},
				},
			},
			Truths: []memoryengine.TruthRecord{
				{
					TruthID:         "truth-store-1",
					Dimension:       "employment",
					NormalizedKey:   "alice:works_at",
					Statement:       "Alice works at Nimi.",
					Confidence:      0.9,
					ReviewCount:     1,
					LastReviewAt:    time.Now().UTC().Format(time.RFC3339Nano),
					Status:          "admitted",
					SourceMemoryIDs: []string{record.GetMemoryId()},
				},
			},
		},
	}
	if err := store.CommitCanonicalReview(ctx, req); err != nil {
		t.Fatalf("CommitCanonicalReview(first): %v", err)
	}
	if err := store.CommitCanonicalReview(ctx, req); err != nil {
		t.Fatalf("CommitCanonicalReview(idempotent): %v", err)
	}
	truths, err := store.ListAdmittedTruths(ctx, scope)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-store-1" {
		t.Fatalf("unexpected truths: %#v", truths)
	}
	checkpoint, err := store.GetReviewCheckpoint(ctx, scope)
	if err != nil {
		t.Fatalf("GetReviewCheckpoint: %v", err)
	}
	if checkpoint == nil || checkpoint.LastReviewRun != "review-store-1" || checkpoint.Checkpoint != record.GetMemoryId() {
		t.Fatalf("unexpected checkpoint: %#v", checkpoint)
	}
	inputs, err := store.ListCanonicalReviewInputs(ctx, scope, "", 10)
	if err != nil {
		t.Fatalf("ListCanonicalReviewInputs: %v", err)
	}
	if len(inputs) == 0 || inputs[0].GetMemoryId() != record.GetMemoryId() {
		t.Fatalf("unexpected inputs: %#v", inputs)
	}
	narratives, err := store.ListNarrativeContext(ctx, scope, "Alice works at Nimi", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-store-1" {
		t.Fatalf("unexpected narratives: %#v", narratives)
	}
}

func TestMemoryServiceRecallFeedbackIsIdempotentAndBiasesRanking(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-feedback"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project note"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project plan"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	firstID := retainResp.GetRecords()[0].GetMemoryId()
	secondID := retainResp.GetRecords()[1].GetMemoryId()
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-helpful-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   secondID,
		Polarity:   recallFeedbackHelpful,
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(helpful): %v", err)
	}
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-helpful-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   secondID,
		Polarity:   recallFeedbackHelpful,
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(idempotent helpful): %v", err)
	}
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-unhelpful-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   firstID,
		Polarity:   recallFeedbackUnhelpful,
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(unhelpful): %v", err)
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "alpha",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(with feedback): %v", err)
	}
	if len(recallResp.GetHits()) < 2 {
		t.Fatalf("expected at least 2 recall hits, got %#v", recallResp.GetHits())
	}
	if recallResp.GetHits()[0].GetRecord().GetMemoryId() != secondID {
		t.Fatalf("expected helpful record to rank first, got %#v", recallResp.GetHits())
	}
	if recallResp.GetHits()[1].GetRecord().GetMemoryId() != firstID {
		t.Fatalf("expected unhelpful record to rank after helpful record, got %#v", recallResp.GetHits())
	}
}

func TestMemoryServiceRecallFeedbackRejectsConflictingPayloadForSameID(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-feedback-conflict"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project note"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "beta project note"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	firstID := retainResp.GetRecords()[0].GetMemoryId()
	secondID := retainResp.GetRecords()[1].GetMemoryId()
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-conflict-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   firstID,
		Polarity:   recallFeedbackHelpful,
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(initial): %v", err)
	}
	err = svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-conflict-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   secondID,
		Polarity:   recallFeedbackHelpful,
		QueryText:  "alpha",
	})
	if err == nil {
		t.Fatal("expected conflicting feedback payload error")
	}
	if !strings.Contains(err.Error(), "already recorded with different payload") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestMemoryServiceRecallExpandsCanonicalReviewRelations(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-relations"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "astronomy telescope note"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "totally unrelated archive"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceID := retainResp.GetRecords()[0].GetMemoryId()
	targetID := retainResp.GetRecords()[1].GetMemoryId()
	otherID := retainResp.GetRecords()[2].GetMemoryId()
	if err := svc.CommitCanonicalReview(ctx, "review-rel-1", locator, sourceID, CanonicalReviewOutcomes{
		Relations: []RelationCandidate{
			{
				SourceID:     sourceID,
				TargetID:     targetID,
				RelationType: "thematic",
				Confidence:   0.95,
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(relations): %v", err)
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "memory redesign",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(with relations): %v", err)
	}
	targetIndex := -1
	otherIndex := -1
	for idx, hit := range recallResp.GetHits() {
		switch hit.GetRecord().GetMemoryId() {
		case targetID:
			targetIndex = idx
		case otherID:
			otherIndex = idx
		}
	}
	if targetIndex == -1 || otherIndex == -1 {
		t.Fatalf("expected both relation target and unrelated record in recall hits, got %#v", recallResp.GetHits())
	}
	if targetIndex >= otherIndex {
		t.Fatalf("expected relation target %s to outrank unrelated record %s, got %#v", targetID, otherID, recallResp.GetHits())
	}
}
