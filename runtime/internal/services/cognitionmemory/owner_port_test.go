package cognitionmemory

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestOwnerAdapterRejectsUnsupportedContractVersionForEveryOperation(t *testing.T) {
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	port := NewOwnerAdapter(core, func(context.Context, string) (Binding, error) {
		return Binding{BindingRef: "binding-version", BankRef: "bank-version", LifecycleRef: "cutoff-version"}, nil
	}, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, error) {
		return memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil
	})

	unsupported := uint32(memoryv1.ContractVersion + 1)
	tests := []struct {
		name   string
		invoke func() (runtimev1.CognitionMemoryOutcome, error)
	}{
		{"ensure", func() (runtimev1.CognitionMemoryOutcome, error) {
			response, err := port.EnsureBank(context.Background(), &runtimev1.CognitionMemoryEnsureBankRequest{ContractVersion: unsupported})
			return response.GetOutcome(), err
		}},
		{"commit", func() (runtimev1.CognitionMemoryOutcome, error) {
			response, err := port.Commit(context.Background(), &runtimev1.CognitionMemoryCommitRequest{Envelope: &runtimev1.CognitionMemoryCommittedEventEnvelope{ContractVersion: unsupported}})
			return response.GetOutcome(), err
		}},
		{"recall", func() (runtimev1.CognitionMemoryOutcome, error) {
			response, err := port.Recall(context.Background(), &runtimev1.CognitionMemoryRecallRequest{ContractVersion: unsupported}, nil)
			return response.GetOutcome(), err
		}},
		{"forget", func() (runtimev1.CognitionMemoryOutcome, error) {
			response, err := port.Forget(context.Background(), &runtimev1.CognitionMemoryForgetRequest{ContractVersion: unsupported})
			return response.GetOutcome(), err
		}},
		{"cutoff", func() (runtimev1.CognitionMemoryOutcome, error) {
			response, err := port.ApplyCutoff(context.Background(), &runtimev1.CognitionMemoryApplyCutoffRequest{ContractVersion: unsupported})
			return response.GetOutcome(), err
		}},
		{"delete", func() (runtimev1.CognitionMemoryOutcome, error) {
			response, err := port.DeleteBank(context.Background(), &runtimev1.CognitionMemoryDeleteBankRequest{ContractVersion: unsupported})
			return response.GetOutcome(), err
		}},
		{"inspect-status", func() (runtimev1.CognitionMemoryOutcome, error) {
			response, err := port.InspectStatus(context.Background(), &runtimev1.CognitionMemoryInspectStatusRequest{ContractVersion: unsupported})
			return response.GetOutcome(), err
		}},
		{"inspect", func() (runtimev1.CognitionMemoryOutcome, error) {
			response, err := port.Inspect(context.Background(), &runtimev1.CognitionMemoryInspectRequest{ContractVersion: unsupported})
			return response.GetOutcome(), err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			outcome, err := test.invoke()
			if outcome != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNSUPPORTED || !memoryv1.IsOutcome(err, memoryv1.OutcomeUnsupported) {
				t.Fatalf("outcome=%s err=%v, want typed unsupported", outcome, err)
			}
		})
	}
}

func TestOwnerAdapterRecallBindsAuthorizedContextAcrossCutoff(t *testing.T) {
	ctx := context.Background()
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	bank, err := core.EnsureBank(ctx, memoryv1.EnsureBankRequest{ContractVersion: memoryv1.ContractVersion, BindingRef: "binding-recall-old", OperationID: "ensure-recall-context"})
	if err != nil {
		t.Fatal(err)
	}
	if err := core.RebuildFTS(ctx, bank.BankRef); err != nil {
		t.Fatal(err)
	}
	bindings := map[string]Binding{
		bank.BindingRef: {BindingRef: bank.BindingRef, BankRef: bank.BankRef, LifecycleRef: bank.LifecycleRef, AccountSubjectRef: "subject-recall"},
	}
	port := NewOwnerAdapter(core, func(_ context.Context, bindingRef string) (Binding, error) {
		binding, ok := bindings[bindingRef]
		if !ok {
			return Binding{}, ErrConflict
		}
		return binding, nil
	}, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, error) {
		return memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}, nil
	})
	recall := func(operationID, bindingRef, subjectRef string) (*runtimev1.CognitionMemoryRecallResponse, error) {
		return port.Recall(ctx, &runtimev1.CognitionMemoryRecallRequest{
			ContractVersion: memoryv1.ContractVersion,
			BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: bindingRef},
			Bank:            &runtimev1.CognitionMemoryBankRef{Value: bank.BankRef},
			Operation:       &runtimev1.CognitionMemoryOperationRef{Value: operationID},
			Query:           "jasmine tea",
			SubjectScope:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: subjectRef}},
			Limit:           8,
			Capabilities:    &runtimev1.CognitionMemoryCapabilitySnapshot{Available: []runtimev1.CognitionMemoryCapability{runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_FTS_INDEX}},
		}, nil)
	}
	if response, err := recall("recall-authorized-context", bank.BindingRef, "subject-recall"); err != nil || response.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_NO_HITS {
		t.Fatalf("initial recall: response=%+v err=%v", response, err)
	}
	if response, err := recall("recall-wrong-subject", bank.BindingRef, "subject-other"); !memoryv1.IsOutcome(err, memoryv1.OutcomeConflict) || response.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_CONFLICT {
		t.Fatalf("wrong subject scope was admitted: response=%+v err=%v", response, err)
	}
	cutoff, err := core.ApplyCutoff(ctx, memoryv1.CutoffRequest{
		ContractVersion: memoryv1.ContractVersion, BindingRef: bank.BindingRef, BankRef: bank.BankRef,
		OperationID: "cutoff-recall-context", CurrentLifecycleRef: bank.LifecycleRef,
		NewLifecycleRef: "lifecycle-recall-new", ReplacementBindingRef: "binding-recall-new",
	})
	if err != nil {
		t.Fatal(err)
	}
	bindings[cutoff.ReplacementBindingRef] = Binding{BindingRef: cutoff.ReplacementBindingRef, BankRef: bank.BankRef, LifecycleRef: cutoff.LifecycleRef, AccountSubjectRef: "subject-recall"}
	if response, err := recall("recall-authorized-context", cutoff.ReplacementBindingRef, "subject-recall"); !memoryv1.IsOutcome(err, memoryv1.OutcomeConflict) || response.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_CONFLICT {
		t.Fatalf("same recall operation crossed binding lifecycle: response=%+v err=%v", response, err)
	}
}

func TestOwnerAdapterMapsStableContractIdentityAndOutcomes(t *testing.T) {
	ctx := context.Background()
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	bindings := map[string]Binding{}
	resolvedCapabilities := memoryv1.CapabilitySnapshot{Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex}}
	port := NewOwnerAdapter(core, func(_ context.Context, bindingRef string) (Binding, error) {
		binding, ok := bindings[bindingRef]
		if !ok {
			return Binding{}, ErrConflict
		}
		return binding, nil
	}, func(context.Context, Binding) (memoryv1.CapabilitySnapshot, error) {
		return resolvedCapabilities, nil
	})

	ensure, err := port.EnsureBank(ctx, &runtimev1.CognitionMemoryEnsureBankRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"},
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: "ensure-a"},
	})
	if err != nil || ensure.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_COMMITTED ||
		ensure.GetBankBinding().GetValue() != "binding-a" || ensure.GetBank().GetValue() == "" || ensure.GetLifecycleCutoff().GetValue() == "" {
		t.Fatalf("ensure mapping: response=%+v err=%v", ensure, err)
	}
	bindings["binding-a"] = Binding{BindingRef: "binding-a", BankRef: ensure.GetBank().GetValue(), LifecycleRef: ensure.GetLifecycleCutoff().GetValue(), AccountSubjectRef: "subject-a"}

	committedAt := time.Date(2026, 8, 28, 8, 0, 0, 0, time.UTC)
	commit, err := port.Commit(ctx, &runtimev1.CognitionMemoryCommitRequest{Envelope: &runtimev1.CognitionMemoryCommittedEventEnvelope{
		ContractVersion:  memoryv1.ContractVersion,
		BankBinding:      &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"},
		Bank:             ensure.GetBank(),
		Event:            &runtimev1.CognitionMemoryEventRef{Value: "event-a"},
		DeliverySequence: 1,
		Operation:        &runtimev1.CognitionMemoryOperationRef{Value: "commit-a"},
		Subjects:         []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: "subject-a"}},
		Sources:          []*runtimev1.CognitionMemorySourceRef{{Kind: "conversation", Value: "conversation-a"}, {Kind: "message", Value: "message-a"}},
		CommittedAt:      timestamppb.New(committedAt),
		LifecycleCutoff:  ensure.GetLifecycleCutoff(),
		Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_MessageCommitted{MessageCommitted: &runtimev1.CognitionMemoryMessageCommitted{
			Actor:        runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER,
			Conversation: &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "conversation-a"},
			Message:      &runtimev1.CognitionMemorySourceRef{Kind: "message", Value: "message-a"},
			Parts: []*runtimev1.CognitionMemoryMessagePart{{
				Part:    &runtimev1.CognitionMemorySourceRef{Kind: "message_part", Value: "part-a"},
				Content: &runtimev1.CognitionMemoryMessagePart_Text{Text: &runtimev1.CognitionMemoryTextPart{Text: "I prefer cedar forests"}},
			}},
		}},
	}})
	if err != nil || commit.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED ||
		commit.GetBank().GetValue() != ensure.GetBank().GetValue() || commit.GetEvent().GetValue() != "event-a" || commit.GetOperation().GetValue() != "commit-a" ||
		commit.GetDeliverySequence() != 1 || commit.GetReceivedFrontier() != 1 {
		t.Fatalf("commit mapping: response=%+v err=%v", commit, err)
	}
	decision, err := port.ExecuteRemember(ctx, "commit-a")
	if err != nil || decision.Outcome != memoryv1.OutcomeAdmitted || len(decision.AffectedMemoryRefs) != 1 {
		t.Fatalf("remember execution: result=%+v err=%v", decision, err)
	}
	memoryRef := decision.AffectedMemoryRefs[0]

	recall, err := port.Recall(ctx, &runtimev1.CognitionMemoryRecallRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"},
		Bank:            ensure.GetBank(),
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: "recall-a"},
		Query:           "cedar forests",
		SubjectScope:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: "subject-a"}},
		Limit:           8,
		Capabilities: &runtimev1.CognitionMemoryCapabilitySnapshot{
			Available: []runtimev1.CognitionMemoryCapability{runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_FTS_INDEX},
		},
	}, nil)
	if err != nil || recall.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_READY || len(recall.GetHits()) != 1 {
		t.Fatalf("recall mapping: response=%+v err=%v", recall, err)
	}
	hit := recall.GetHits()[0]
	if hit.GetBank().GetValue() != ensure.GetBank().GetValue() || hit.GetMemory().GetValue() != memoryRef || hit.GetContent() != "I prefer cedar forests" ||
		hit.GetEpistemicStatus() != runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_EXPLICIT ||
		hit.GetLifecycle() != runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_CURRENT || hit.GetOccurredAt() == nil || hit.GetUpdatedAt() == nil ||
		!hasOwnerSourceRef(hit.GetSources(), "committed_event", "event-a") {
		t.Fatalf("hit identity mapping: %+v", hit)
	}
	resolvedCapabilities = memoryv1.CapabilitySnapshot{
		ConfigRevision: 7, EmbeddingSpaceRef: "embedding-space-a",
		Available: []memoryv1.Capability{memoryv1.CapabilityFTSIndex, memoryv1.CapabilityTextEmbed, memoryv1.CapabilityVectorIndex},
	}
	embedding := ownerConformanceEmbeddingPort{}
	if outcome, err := port.RebuildEmbedding(ctx, "embedding-build-a", ensure.GetBank().GetValue(), resolvedCapabilities, embedding); err != nil || outcome != memoryv1.OutcomeReady {
		t.Fatalf("build embedding through owner-internal port: outcome=%s err=%v", outcome, err)
	}
	embeddingRecall, err := port.Recall(ctx, &runtimev1.CognitionMemoryRecallRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"},
		Bank:            ensure.GetBank(),
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: "recall-embedding-a"},
		Query:           "cedar forests",
		SubjectScope:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: "subject-a"}},
		Limit:           8,
		Capabilities: &runtimev1.CognitionMemoryCapabilitySnapshot{
			ConfigRevision: 7,
			Available: []runtimev1.CognitionMemoryCapability{
				runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_FTS_INDEX,
				runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_TEXT_EMBED,
				runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_VECTOR_INDEX,
			},
		},
	}, embedding)
	if err != nil || embeddingRecall.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_READY || len(embeddingRecall.GetHits()) != 1 || embeddingRecall.GetHits()[0].GetMemory().GetValue() != memoryRef {
		t.Fatalf("embedding identity mapping: response=%+v err=%v", embeddingRecall, err)
	}
	staleRecall, err := port.Recall(ctx, &runtimev1.CognitionMemoryRecallRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"},
		Bank:            ensure.GetBank(),
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: "recall-stale-embedding-a"},
		Query:           "cedar forests",
		SubjectScope:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: "subject-a"}},
		Limit:           8,
		Capabilities: &runtimev1.CognitionMemoryCapabilitySnapshot{
			ConfigRevision: 8,
			Available: []runtimev1.CognitionMemoryCapability{
				runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_TEXT_EMBED,
				runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_VECTOR_INDEX,
			},
		},
	}, embedding)
	if staleRecall.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_CONFLICT || !memoryv1.IsOutcome(err, memoryv1.OutcomeConflict) {
		t.Fatalf("stale embedding identity: response=%+v err=%v", staleRecall, err)
	}

	statusResponse, err := port.InspectStatus(ctx, &runtimev1.CognitionMemoryInspectStatusRequest{
		ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"}, Bank: ensure.GetBank(), Operation: &runtimev1.CognitionMemoryOperationRef{Value: "inspect-status-a"},
	})
	if err != nil || statusResponse.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_READY || statusResponse.GetFrontiers().GetReceivedFrontier() != 1 || statusResponse.GetFrontiers().GetReadyFrontier() != 1 || len(statusResponse.GetEvents()) != 1 || statusResponse.GetEvents()[0].GetEvent().GetValue() != "event-a" || statusResponse.GetCurrentCount() != 1 {
		t.Fatalf("status mapping: response=%+v err=%v", statusResponse, err)
	}
	inspect, err := port.Inspect(ctx, &runtimev1.CognitionMemoryInspectRequest{
		ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"}, Bank: ensure.GetBank(), Operation: &runtimev1.CognitionMemoryOperationRef{Value: "inspect-a"}, Limit: 100,
	})
	if err != nil || inspect.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_READY || len(inspect.GetMemories()) != 1 || inspect.GetMemories()[0].GetMemory().GetValue() != memoryRef {
		t.Fatalf("inspect mapping: response=%+v err=%v", inspect, err)
	}

	forgotten, err := port.Forget(ctx, &runtimev1.CognitionMemoryForgetRequest{
		ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"}, Bank: ensure.GetBank(), Operation: &runtimev1.CognitionMemoryOperationRef{Value: "forget-a"}, Targets: []*runtimev1.CognitionMemoryRef{{Value: memoryRef}}, Confirmed: true,
	})
	if err != nil || forgotten.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_FORGOTTEN || len(forgotten.GetAffectedMemories()) != 1 || forgotten.GetAffectedMemories()[0].GetValue() != memoryRef {
		t.Fatalf("forget mapping: response=%+v err=%v", forgotten, err)
	}

	cutoff, err := port.ApplyCutoff(ctx, &runtimev1.CognitionMemoryApplyCutoffRequest{
		ContractVersion:        memoryv1.ContractVersion,
		BankBinding:            &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-a"},
		Bank:                   ensure.GetBank(),
		Operation:              &runtimev1.CognitionMemoryOperationRef{Value: "cutoff-a"},
		Cutoff:                 &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: "cutoff-b"},
		ReplacementBankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-b"},
	})
	if err != nil || cutoff.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_COMMITTED || cutoff.GetCutoff().GetValue() != "cutoff-b" || cutoff.GetReplacementBankBinding().GetValue() != "binding-b" {
		t.Fatalf("cutoff mapping: response=%+v err=%v", cutoff, err)
	}
	bindings["binding-b"] = Binding{BindingRef: "binding-b", BankRef: ensure.GetBank().GetValue(), LifecycleRef: "cutoff-b"}
	deleted, err := port.DeleteBank(ctx, &runtimev1.CognitionMemoryDeleteBankRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-b"},
		Bank:            ensure.GetBank(),
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: "delete-a"},
		Reason:          runtimev1.CognitionMemoryDeleteReason_COGNITION_MEMORY_DELETE_REASON_AGENT_TERMINATION,
		Cutoff:          &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: "cutoff-b"},
	})
	if err != nil || deleted.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_DELETED {
		t.Fatalf("delete mapping: response=%+v err=%v", deleted, err)
	}
}

func TestOwnerAdapterInspectUsesStableSeekPagination(t *testing.T) {
	ctx := context.Background()
	core, err := memoryv1.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = core.Close() })
	bindings := map[string]Binding{}
	port := NewOwnerAdapter(core, func(_ context.Context, bindingRef string) (Binding, error) {
		binding, ok := bindings[bindingRef]
		if !ok {
			return Binding{}, ErrConflict
		}
		return binding, nil
	}, nil)
	ensure, err := port.EnsureBank(ctx, &runtimev1.CognitionMemoryEnsureBankRequest{
		ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-page"}, Operation: &runtimev1.CognitionMemoryOperationRef{Value: "ensure-page"},
	})
	if err != nil {
		t.Fatal(err)
	}
	bindings["binding-page"] = Binding{BindingRef: "binding-page", BankRef: ensure.GetBank().GetValue(), LifecycleRef: ensure.GetLifecycleCutoff().GetValue()}
	for index, content := range []string{"I prefer cedar forests", "I prefer jasmine tea", "I prefer quiet mornings"} {
		sequence := uint64(index + 1)
		operationID := "commit-page-" + strconv.Itoa(index+1)
		eventID := "event-page-" + strconv.Itoa(index+1)
		response, err := port.Commit(ctx, &runtimev1.CognitionMemoryCommitRequest{Envelope: &runtimev1.CognitionMemoryCommittedEventEnvelope{
			ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-page"}, Bank: ensure.GetBank(),
			Event: &runtimev1.CognitionMemoryEventRef{Value: eventID}, DeliverySequence: sequence, Operation: &runtimev1.CognitionMemoryOperationRef{Value: operationID},
			Subjects: []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: "subject-page"}}, Sources: []*runtimev1.CognitionMemorySourceRef{{Kind: "message", Value: "message-page-" + strconv.Itoa(index+1)}},
			CommittedAt: timestamppb.New(time.Date(2026, 8, 28, 9, index, 0, 0, time.UTC)), LifecycleCutoff: ensure.GetLifecycleCutoff(),
			Fact: &runtimev1.CognitionMemoryCommittedEventEnvelope_MessageCommitted{MessageCommitted: &runtimev1.CognitionMemoryMessageCommitted{
				Actor: runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER, Conversation: &runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "conversation-page"}, Message: &runtimev1.CognitionMemorySourceRef{Kind: "message", Value: "message-page-" + strconv.Itoa(index+1)},
				Parts: []*runtimev1.CognitionMemoryMessagePart{{Part: &runtimev1.CognitionMemorySourceRef{Kind: "message_part", Value: "part-page-" + strconv.Itoa(index+1)}, Content: &runtimev1.CognitionMemoryMessagePart_Text{Text: &runtimev1.CognitionMemoryTextPart{Text: content}}}},
			}},
		}})
		if err != nil || response.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED {
			t.Fatalf("commit page item %d: response=%+v err=%v", index, response, err)
		}
		if _, err := port.ExecuteRemember(ctx, operationID); err != nil {
			t.Fatalf("remember page item %d: %v", index, err)
		}
	}

	first, err := port.Inspect(ctx, &runtimev1.CognitionMemoryInspectRequest{
		ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-page"}, Bank: ensure.GetBank(), Operation: &runtimev1.CognitionMemoryOperationRef{Value: "inspect-page-1"}, Limit: 2,
	})
	if err != nil || len(first.GetMemories()) != 2 || first.GetNextPageToken() == "" {
		t.Fatalf("first page: response=%+v err=%v", first, err)
	}
	second, err := port.Inspect(ctx, &runtimev1.CognitionMemoryInspectRequest{
		ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: "binding-page"}, Bank: ensure.GetBank(), Operation: &runtimev1.CognitionMemoryOperationRef{Value: "inspect-page-2"}, Limit: 2, PageToken: first.GetNextPageToken(),
	})
	if err != nil || len(second.GetMemories()) != 1 || second.GetNextPageToken() != "" {
		t.Fatalf("second page: response=%+v err=%v", second, err)
	}
	seen := map[string]struct{}{}
	for _, item := range append(first.GetMemories(), second.GetMemories()...) {
		if _, duplicate := seen[item.GetMemory().GetValue()]; duplicate {
			t.Fatalf("stable seek returned duplicate memory %q", item.GetMemory().GetValue())
		}
		seen[item.GetMemory().GetValue()] = struct{}{}
	}
	if len(seen) != 3 {
		t.Fatalf("stable seek returned %d unique memories, want 3", len(seen))
	}
}

func hasOwnerSourceRef(refs []*runtimev1.CognitionMemorySourceRef, kind, value string) bool {
	for _, ref := range refs {
		if ref.GetKind() == kind && ref.GetValue() == value {
			return true
		}
	}
	return false
}

type ownerConformanceEmbeddingPort struct{}

func (ownerConformanceEmbeddingPort) Embed(_ context.Context, request memoryv1.AIEmbeddingRequest) (memoryv1.AIEmbeddingResult, error) {
	vectors := make([][]float64, len(request.Inputs))
	for index := range vectors {
		vectors[index] = []float64{1, 1}
	}
	return memoryv1.AIEmbeddingResult{Vectors: vectors, Dimension: 2}, nil
}
