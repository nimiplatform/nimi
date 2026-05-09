package memory

import (
	"context"
	"path/filepath"
	"slices"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestMemoryServiceClusterCanonicalReviewInputsUsesPersistedEmbeddingsAndDefersSingletons(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	setManagedEmbeddingProfileForTest(svc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       32,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})

	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-cluster"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "review quality memory redesign"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "green tea preference"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "preference for green tea"},
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

	clusters, leftovers, err := svc.ClusterCanonicalReviewInputs(ctx, locator, "", 10)
	if err != nil {
		t.Fatalf("ClusterCanonicalReviewInputs: %v", err)
	}
	if len(clusters) != 2 {
		t.Fatalf("expected 2 clusters, got %#v", clusters)
	}
	clusterSizes := []int{len(clusters[0].RecordIDs), len(clusters[1].RecordIDs)}
	slices.Sort(clusterSizes)
	if !slices.Equal(clusterSizes, []int{2, 2}) {
		t.Fatalf("expected two 2-record clusters, got %#v", clusterSizes)
	}
	if len(leftovers) != 1 {
		t.Fatalf("expected one singleton leftover, got %#v", leftovers)
	}
	if leftovers[0].GetMemoryId() != retainResp.GetRecords()[4].GetMemoryId() {
		t.Fatalf("expected astronomy record to remain leftover, got %#v", leftovers[0])
	}
}

func TestMemoryServiceCanonicalBindRequiresManagedProfileAndIsIdempotent(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath: filepath.Join(t.TempDir(), "local-state.json"),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-bind"},
		},
	}
	bank, err := svc.EnsureCanonicalBank(context.Background(), locator, "Agent Memory", nil)
	if err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if bank.GetEmbeddingProfile() != nil {
		t.Fatalf("expected baseline canonical bank to start unbound, got %#v", bank.GetEmbeddingProfile())
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(context.Background(), locator); status.Code(err) != codes.Unavailable {
		t.Fatalf("expected bind without managed profile to fail unavailable, got %v", err)
	}

	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	setManagedEmbeddingProfileForTest(svc, profile)
	bound, err := svc.BindCanonicalBankEmbeddingProfile(context.Background(), locator)
	if err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	if bound.GetEmbeddingProfile() == nil {
		t.Fatal("expected canonical bank to bind embedding profile")
	}
	boundAgain, err := svc.BindCanonicalBankEmbeddingProfile(context.Background(), locator)
	if err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(idempotent): %v", err)
	}
	if !proto.Equal(bound.GetEmbeddingProfile(), boundAgain.GetEmbeddingProfile()) {
		t.Fatalf("expected idempotent bind result, got %#v vs %#v", bound.GetEmbeddingProfile(), boundAgain.GetEmbeddingProfile())
	}
}

func TestMemoryServiceWorldSharedLocatorKeyUsesWorldOnly(t *testing.T) {
	t.Parallel()

	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
		Owner: &runtimev1.MemoryBankLocator_WorldShared{
			WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-1"},
		},
	}
	if got := locatorKey(locator); got != "world-shared::world-1" {
		t.Fatalf("unexpected world_shared locator key: %s", got)
	}

	filter := &runtimev1.MemoryBankOwnerFilter{
		Owner: &runtimev1.MemoryBankOwnerFilter_WorldShared{
			WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-1"},
		},
	}
	if got := ownerFilterKey(filter); got != "world-shared::world-1" {
		t.Fatalf("unexpected world_shared owner filter key: %s", got)
	}
}

func TestMemoryServiceApplyReplicationObservationUpdatesCommittedStateAndEvents(t *testing.T) {
	t.Parallel()

	svc, locator, record := newTestMemoryRecord(t)
	if record.GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING {
		t.Fatalf("expected retained record to start pending, got %s", record.GetReplication().GetOutcome())
	}

	stream := newMemoryEventCaptureStream(context.Background(), 1)
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeMemoryEvents(&runtimev1.SubscribeMemoryEventsRequest{
			ScopeFilters: []runtimev1.MemoryBankScope{locator.GetScope()},
			OwnerFilters: []*runtimev1.MemoryBankOwnerFilter{
				{
					Owner: &runtimev1.MemoryBankOwnerFilter_AppPrivate{
						AppPrivate: &runtimev1.AppPrivateBankOwner{
							AccountId: "acct-1",
							AppId:     "app.test",
						},
					},
				},
			},
		}, stream)
	}()
	waitForMemoryCondition(t, 2*time.Second, func() bool {
		svc.mu.RLock()
		defer svc.mu.RUnlock()
		return len(svc.subscribers) == 1
	})

	observedAt := time.Now().UTC()
	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Synced{
			Synced: &runtimev1.MemoryReplicationSynced{
				RealmVersion: "realm-v1",
				SyncedAt:     timestamppb.New(observedAt),
			},
		},
	}, observedAt); err != nil {
		t.Fatalf("ApplyReplicationObservation: %v", err)
	}
	if err := <-done; err != context.Canceled {
		t.Fatalf("SubscribeMemoryEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 1 {
		t.Fatalf("expected one replication event, got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED {
		t.Fatalf("expected replication_updated event, got %#v", stream.events[0])
	}
	if stream.events[0].GetReplicationUpdated().GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED {
		t.Fatalf("expected synced replication event, got %#v", stream.events[0].GetReplicationUpdated())
	}

	historyResp, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(historyResp.GetRecords()) != 1 {
		t.Fatalf("expected one record after sync, got %d", len(historyResp.GetRecords()))
	}
	if historyResp.GetRecords()[0].GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED {
		t.Fatalf("expected synced replication in history, got %#v", historyResp.GetRecords()[0].GetReplication())
	}
}

func TestMemoryServiceApplyReplicationObservationFailClosesIllegalTransitionAndHidesInvalidated(t *testing.T) {
	t.Parallel()

	svc, locator, record := newTestMemoryRecord(t)
	observedAt := time.Now().UTC()
	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Conflict{
			Conflict: &runtimev1.MemoryReplicationConflict{
				ConflictId:     "conflict-1",
				LocalVersion:   record.GetReplication().GetLocalVersion(),
				RemoteVersion:  "realm-v2",
				ConflictReason: "version diverged",
				DetectedAt:     timestamppb.New(observedAt),
			},
		},
	}, observedAt); err != nil {
		t.Fatalf("ApplyReplicationObservation(conflict): %v", err)
	}
	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Invalidation{
			Invalidation: &runtimev1.MemoryInvalidation{
				InvalidationId:     "inv-1",
				InvalidatedVersion: record.GetReplication().GetLocalVersion(),
				Authority:          "realm",
				InvalidationReason: "moderation",
				InvalidatedAt:      timestamppb.New(observedAt.Add(time.Second)),
			},
		},
	}, observedAt.Add(time.Second)); err != nil {
		t.Fatalf("ApplyReplicationObservation(invalidated): %v", err)
	}

	historyHidden, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History(hidden): %v", err)
	}
	if len(historyHidden.GetRecords()) != 0 {
		t.Fatalf("expected invalidated record hidden by default, got %d", len(historyHidden.GetRecords()))
	}
	historyVisible, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(visible): %v", err)
	}
	if len(historyVisible.GetRecords()) != 1 {
		t.Fatalf("expected invalidated record visible when requested, got %d", len(historyVisible.GetRecords()))
	}
	if historyVisible.GetRecords()[0].GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED {
		t.Fatalf("expected invalidated replication state, got %#v", historyVisible.GetRecords()[0].GetReplication())
	}

	recallHidden, err := svc.Recall(context.Background(), &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "Where does Alice work?",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(hidden): %v", err)
	}
	if len(recallHidden.GetHits()) != 0 {
		t.Fatalf("expected invalidated record hidden from recall, got %d", len(recallHidden.GetHits()))
	}
	recallVisible, err := svc.Recall(context.Background(), &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query:              "Where does Alice work?",
			Limit:              5,
			IncludeInvalidated: true,
		},
	})
	if err != nil {
		t.Fatalf("Recall(visible): %v", err)
	}
	if len(recallVisible.GetHits()) != 1 {
		t.Fatalf("expected invalidated record visible when requested, got %d", len(recallVisible.GetHits()))
	}

	err = svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Pending{
			Pending: &runtimev1.MemoryReplicationPending{
				EnqueuedAt: timestamppb.New(observedAt.Add(2 * time.Second)),
			},
		},
	}, observedAt.Add(2*time.Second))
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected illegal terminal transition to fail precondition, got %v", err)
	}

	historyAfterIllegal, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(after illegal): %v", err)
	}
	if len(historyAfterIllegal.GetRecords()) != 1 {
		t.Fatalf("expected record preserved after illegal transition, got %d", len(historyAfterIllegal.GetRecords()))
	}
	if historyAfterIllegal.GetRecords()[0].GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED {
		t.Fatalf("expected invalidated state preserved, got %#v", historyAfterIllegal.GetRecords()[0].GetReplication())
	}
}

func TestMemoryServiceApplyReplicationObservationRejectsEmptyEvidenceBeforeMutation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name        string
		replication func(record *runtimev1.MemoryRecord) *runtimev1.MemoryReplicationState
	}{
		{
			name: "synced",
			replication: func(record *runtimev1.MemoryRecord) *runtimev1.MemoryReplicationState {
				return &runtimev1.MemoryReplicationState{
					Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
					LocalVersion: record.GetReplication().GetLocalVersion(),
					BasisVersion: record.GetReplication().GetLocalVersion(),
					Detail:       &runtimev1.MemoryReplicationState_Synced{Synced: &runtimev1.MemoryReplicationSynced{}},
				}
			},
		},
		{
			name: "conflict",
			replication: func(record *runtimev1.MemoryRecord) *runtimev1.MemoryReplicationState {
				return &runtimev1.MemoryReplicationState{
					Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT,
					LocalVersion: record.GetReplication().GetLocalVersion(),
					BasisVersion: record.GetReplication().GetLocalVersion(),
					Detail:       &runtimev1.MemoryReplicationState_Conflict{Conflict: &runtimev1.MemoryReplicationConflict{}},
				}
			},
		},
		{
			name: "invalidated",
			replication: func(record *runtimev1.MemoryRecord) *runtimev1.MemoryReplicationState {
				return &runtimev1.MemoryReplicationState{
					Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
					LocalVersion: record.GetReplication().GetLocalVersion(),
					BasisVersion: record.GetReplication().GetLocalVersion(),
					Detail:       &runtimev1.MemoryReplicationState_Invalidation{Invalidation: &runtimev1.MemoryInvalidation{}},
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, locator, record := newCanonicalTestMemoryRecord(t)
			if backlog := svc.ListReplicationBacklog(); len(backlog) != 1 {
				t.Fatalf("expected one pending backlog before invalid observation, got %#v", backlog)
			}
			err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), tc.replication(record), time.Now().UTC())
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("expected invalid evidence to fail before mutation, got %v", err)
			}
			historyResp, historyErr := svc.History(context.Background(), &runtimev1.HistoryRequest{
				Bank:  locator,
				Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
			})
			if historyErr != nil {
				t.Fatalf("History: %v", historyErr)
			}
			if len(historyResp.GetRecords()) != 1 {
				t.Fatalf("expected record preserved after invalid observation, got %d", len(historyResp.GetRecords()))
			}
			if got := historyResp.GetRecords()[0].GetReplication().GetOutcome(); got != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING {
				t.Fatalf("expected replication outcome to remain pending, got %s", got)
			}
			if backlog := svc.ListReplicationBacklog(); len(backlog) != 1 {
				t.Fatalf("expected backlog preserved after invalid observation, got %#v", backlog)
			}
		})
	}
}

func TestMemoryServiceCanonicalRetainEnqueuesBacklogAndInfraRetainDoesNot(t *testing.T) {
	t.Parallel()

	canonicalSvc, _, canonicalRecord := newCanonicalTestMemoryRecord(t)
	backlog := canonicalSvc.ListReplicationBacklog()
	if len(backlog) != 1 {
		t.Fatalf("expected one canonical backlog item, got %d", len(backlog))
	}
	if backlog[0].MemoryID != canonicalRecord.GetMemoryId() {
		t.Fatalf("expected backlog memory %s, got %#v", canonicalRecord.GetMemoryId(), backlog[0])
	}
	if backlog[0].LocalVersion != canonicalRecord.GetReplication().GetLocalVersion() {
		t.Fatalf("expected backlog local version %s, got %#v", canonicalRecord.GetReplication().GetLocalVersion(), backlog[0])
	}

	infraSvc, _, _ := newTestMemoryRecord(t)
	if got := len(infraSvc.ListReplicationBacklog()); got != 0 {
		t.Fatalf("expected infra retain to skip backlog, got %d items", got)
	}
}

func TestMemoryServiceReplicationLoopDefaultBridgeKeepsPendingBacklog(t *testing.T) {
	t.Parallel()

	svc, _, _ := newCanonicalTestMemoryRecord(t)
	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartReplicationLoop(loopCtx); err != nil {
		t.Fatalf("StartReplicationLoop: %v", err)
	}
	t.Cleanup(svc.StopReplicationLoop)

	waitForMemoryCondition(t, 2*time.Second, func() bool {
		backlog := svc.ListReplicationBacklog()
		return len(backlog) == 1 && backlog[0].AttemptCount > 0 && backlog[0].Status == replicationBacklogStatusPending
	})

	backlog := svc.ListReplicationBacklog()
	if len(backlog) != 1 {
		t.Fatalf("expected one pending backlog item, got %d", len(backlog))
	}
	if backlog[0].Status != replicationBacklogStatusPending {
		t.Fatalf("expected pending backlog status, got %#v", backlog[0])
	}
	if backlog[0].LastAttemptOutcome != replicationAttemptUnavailable {
		t.Fatalf("expected unavailable attempt outcome, got %#v", backlog[0])
	}
}

func TestMemoryServiceReplicationLoopFakeBridgeResolvesBacklogAndEmitsCommittedEvents(t *testing.T) {
	t.Parallel()

	svc, locator, first := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	secondRetain, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "second canonical memory"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(second): %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	thirdRetain, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "third canonical memory"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(third): %v", err)
	}
	initialBacklog := svc.ListReplicationBacklog()
	if len(initialBacklog) != 3 {
		t.Fatalf("expected three backlog items, got %d", len(initialBacklog))
	}

	adapter := &fakeReplicationBridgeAdapter{
		results: map[string]*runtimev1.MemoryReplicationState{
			first.GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
				LocalVersion: first.GetReplication().GetLocalVersion(),
				BasisVersion: first.GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Synced{
					Synced: &runtimev1.MemoryReplicationSynced{
						RealmVersion: "realm-1",
						SyncedAt:     timestamppb.Now(),
					},
				},
			},
			secondRetain.GetRecords()[0].GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT,
				LocalVersion: secondRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
				BasisVersion: secondRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Conflict{
					Conflict: &runtimev1.MemoryReplicationConflict{
						ConflictId:     "conflict-2",
						LocalVersion:   secondRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
						RemoteVersion:  "realm-2",
						ConflictReason: "diverged",
						DetectedAt:     timestamppb.Now(),
					},
				},
			},
			thirdRetain.GetRecords()[0].GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
				LocalVersion: thirdRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
				BasisVersion: thirdRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Invalidation{
					Invalidation: &runtimev1.MemoryInvalidation{
						InvalidationId:     "inv-3",
						InvalidatedVersion: thirdRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
						Authority:          "realm",
						InvalidationReason: "moderation",
						InvalidatedAt:      timestamppb.Now(),
					},
				},
			},
		},
	}
	svc.SetReplicationBridgeAdapter(adapter)

	stream := newMemoryEventCaptureStream(context.Background(), 3)
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeMemoryEvents(&runtimev1.SubscribeMemoryEventsRequest{
			ScopeFilters: []runtimev1.MemoryBankScope{locator.GetScope()},
			OwnerFilters: []*runtimev1.MemoryBankOwnerFilter{
				{
					Owner: &runtimev1.MemoryBankOwnerFilter_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-canonical"},
					},
				},
			},
		}, stream)
	}()
	waitForMemoryCondition(t, 2*time.Second, func() bool {
		svc.mu.RLock()
		defer svc.mu.RUnlock()
		return len(svc.subscribers) == 1
	})

	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartReplicationLoop(loopCtx); err != nil {
		t.Fatalf("StartReplicationLoop: %v", err)
	}
	t.Cleanup(svc.StopReplicationLoop)

	waitForMemoryCondition(t, 2*time.Second, func() bool {
		return len(svc.ListReplicationBacklog()) == 0
	})
	if err := <-done; err != context.Canceled {
		t.Fatalf("SubscribeMemoryEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 3 {
		t.Fatalf("expected three replication events, got %d", len(stream.events))
	}
	if got := adapter.seenMemoryIDs(); len(got) != 3 {
		t.Fatalf("expected bridge adapter to process three memory ids, got %#v", got)
	}
	for _, event := range stream.events {
		if event.GetEventType() != runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED {
			t.Fatalf("expected replication event, got %#v", event)
		}
	}

	historyResp, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(historyResp.GetRecords()) != 3 {
		t.Fatalf("expected three visible records with include_invalidated, got %d", len(historyResp.GetRecords()))
	}
	historyHidden, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History(hidden): %v", err)
	}
	if len(historyHidden.GetRecords()) != 2 {
		t.Fatalf("expected invalidated record hidden from default history, got %d", len(historyHidden.GetRecords()))
	}
}

func TestMemoryServicePendingBacklogMetadataSurvivesRestart(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	svc, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	setManagedEmbeddingProfileForTest(svc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-backlog-restart"},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "pending backlog restart"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartReplicationLoop(loopCtx); err != nil {
		t.Fatalf("StartReplicationLoop: %v", err)
	}
	waitForMemoryCondition(t, 2*time.Second, func() bool {
		backlog := svc.ListReplicationBacklog()
		return len(backlog) == 1 && backlog[0].AttemptCount > 0
	})
	svc.StopReplicationLoop()
	before := svc.ListReplicationBacklog()
	if len(before) != 1 {
		t.Fatalf("expected one pending backlog item before restart, got %#v", before)
	}
	if err := svc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	restarted, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(restart): %v", err)
	}
	closeMemoryServiceForTest(t, restarted)
	defer func() {
		if err := restarted.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	after := restarted.ListReplicationBacklog()
	if len(after) != 1 {
		t.Fatalf("expected one pending backlog item after restart, got %#v", after)
	}
	if after[0].BacklogKey != before[0].BacklogKey ||
		after[0].MemoryID != retainResp.GetRecords()[0].GetMemoryId() ||
		after[0].LocalVersion != before[0].LocalVersion ||
		after[0].BasisVersion != before[0].BasisVersion ||
		after[0].AttemptCount != before[0].AttemptCount ||
		after[0].Status != before[0].Status ||
		after[0].LastAttemptOutcome != before[0].LastAttemptOutcome ||
		!after[0].EnqueuedAt.Equal(before[0].EnqueuedAt) ||
		!after[0].LastAttemptAt.Equal(before[0].LastAttemptAt) ||
		after[0].Locator.String() != before[0].Locator.String() {
		t.Fatalf("pending backlog metadata drifted across restart: before=%#v after=%#v", before[0], after[0])
	}
}

func TestMemoryServiceTerminalBacklogDoesNotReviveAfterRestart(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	svc, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	setManagedEmbeddingProfileForTest(svc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-backlog-terminal"},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "terminal backlog restart"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	record := retainResp.GetRecords()[0]
	if len(svc.ListReplicationBacklog()) != 1 {
		t.Fatalf("expected one backlog item before terminal observation, got %#v", svc.ListReplicationBacklog())
	}
	observedAt := time.Now().UTC()
	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Synced{
			Synced: &runtimev1.MemoryReplicationSynced{
				RealmVersion: "realm-terminal",
				SyncedAt:     timestamppb.New(observedAt),
			},
		},
	}, observedAt); err != nil {
		t.Fatalf("ApplyReplicationObservation(synced): %v", err)
	}
	if got := len(svc.ListReplicationBacklog()); got != 0 {
		t.Fatalf("expected terminal observation to remove backlog, got %d items", got)
	}
	if err := svc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	restarted, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(restart): %v", err)
	}
	closeMemoryServiceForTest(t, restarted)
	defer func() {
		if err := restarted.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	if got := len(restarted.ListReplicationBacklog()); got != 0 {
		t.Fatalf("expected no backlog after restart for terminal record, got %#v", restarted.ListReplicationBacklog())
	}
	historyResp, err := restarted.History(ctx, &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(restart): %v", err)
	}
	if len(historyResp.GetRecords()) != 1 {
		t.Fatalf("expected one record after restart, got %d", len(historyResp.GetRecords()))
	}
	if historyResp.GetRecords()[0].GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED {
		t.Fatalf("expected synced replication state after restart, got %#v", historyResp.GetRecords()[0].GetReplication())
	}
}
