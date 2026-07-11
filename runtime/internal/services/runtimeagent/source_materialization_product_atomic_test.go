package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestProductionSourceMaterializationProductCommitsCharacterAndPersonaAtomicallyAcrossRestart(t *testing.T) {
	for _, kind := range []string{"worldCharacter", "realmPersona"} {
		t.Run(kind, func(t *testing.T) {
			statePath := filepath.Join(t.TempDir(), "state.json")
			first, closeFirst := openSourceMaterializationTransportTestService(t, statePath)
			defer closeFirst()
			first.SetSourceMaterializationProductCommitter(first)

			product := materializeProductionSourceProduct(t, first, kind, "production-atomic-"+kind)
			assertProductionSourceProduct(t, first, product)

			closeFirst()
			restarted, closeRestarted := openSourceMaterializationTransportTestService(t, statePath)
			defer closeRestarted()
			assertProductionSourceProduct(t, restarted, product)
			restarted.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{})
			restarted.SetSourceMaterializationProductCommitter(restarted)
			replay, err := restarted.CommitSourceMaterialization(
				sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount),
				&runtimev1.CommitSourceMaterializationRequest{
					Context:            sourceMaterializationTransportTestRequestContext(product.challenge.GetSourceRef()),
					CommitRequestId:    "commit-production-atomic-" + kind,
					UploadId:           product.begin.GetUploadId(),
					PacketHash:         product.begin.GetPacketHash(),
					BundleManifestHash: product.begin.GetBundleManifestHash(),
				},
			)
			if err != nil || replay.GetLocalAgentRef() != product.commit.GetLocalAgentRef() ||
				replay.GetSourceContextStatus().GetSnapshotHash() != product.commit.GetSourceContextStatus().GetSnapshotHash() {
				t.Fatalf("restart committed replay = %+v err=%v", replay, err)
			}
		})
	}
}

func TestPrepareSourceMaterializationProductRollbackIsInvisibleAndLeavesNoProduct(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()

	candidate := sourceMaterializationTransportTestCandidate(t, "worldCharacter", "packet-direct-product-rollback")
	localAgentRef := sourceMaterializationTransportTestLocalAgentRef("direct-product-rollback")
	capturedAt := time.Date(2026, 7, 11, 3, 4, 5, 0, time.UTC)
	snapshot, err := finalizeLocalAgentSourceSnapshotV1(candidate, localAgentRef, capturedAt)
	if err != nil {
		t.Fatalf("finalizeLocalAgentSourceSnapshotV1: %v", err)
	}

	sub := addAtomicProductSubscriber(svc, localAgentRef)
	defer svc.eventStreamRuntime().removeSubscriber(sub.id)
	prepared, err := svc.PrepareSourceMaterializationProduct(
		context.Background(),
		localAgentRef,
		sourceMaterializationTransportTestAccount,
		sourceMaterializationProtoRef(candidate.Normalized.SourceRef),
		snapshot,
	)
	if err != nil {
		t.Fatalf("PrepareSourceMaterializationProduct: %v", err)
	}
	finalized := false
	defer func() {
		if !finalized {
			prepared.SourceMaterializationProductRolledBack()
		}
	}()

	type readerResult struct {
		entry *agentEntry
		err   error
	}
	readerDone := make(chan readerResult, 1)
	go func() {
		entry, readErr := svc.agentByID(localAgentRef)
		readerDone <- readerResult{entry: entry, err: readErr}
	}()
	readerReturnedBeforeFinalize := false
	select {
	case <-readerDone:
		readerReturnedBeforeFinalize = true
	case <-time.After(40 * time.Millisecond):
	}

	sentinel := errors.New("injected failure after product rows")
	visibleDuringTransaction := make(map[string]int)
	var visibilityErr error
	err = svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if err := prepared.CommitSourceMaterializationProductTx(tx); err != nil {
			return err
		}
		for _, table := range []struct {
			name   string
			column string
		}{
			{"runtime_local_agent", "local_agent_ref"},
			{"runtime_local_agent_state_projection", "local_agent_ref"},
			{"runtime_local_agent_event_log", "local_agent_ref"},
			{"runtime_agent_ai_config", "agent_instance_id"},
		} {
			var count int
			query := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s = ?", table.name, table.column)
			if queryErr := svc.backend.DB().QueryRowContext(context.Background(), query, localAgentRef).Scan(&count); queryErr != nil {
				visibilityErr = fmt.Errorf("read %s during uncommitted product: %w", table.name, queryErr)
				break
			}
			visibleDuringTransaction[table.name] = count
		}
		return sentinel
	})
	prepared.SourceMaterializationProductRolledBack()
	finalized = true

	if !errors.Is(err, sentinel) {
		t.Fatalf("product transaction error = %v, want injected sentinel", err)
	}
	if visibilityErr != nil {
		t.Fatal(visibilityErr)
	}
	if readerReturnedBeforeFinalize {
		t.Fatal("Agent reader observed Prepare state before transaction finalization")
	}
	for table, count := range visibleDuringTransaction {
		if count != 0 {
			t.Fatalf("external reader saw %d uncommitted %s rows", count, table)
		}
	}
	select {
	case result := <-readerDone:
		if result.entry != nil || status.Code(result.err) != codes.NotFound {
			t.Fatalf("reader after rollback = entry:%+v err:%v, want NotFound", result.entry, result.err)
		}
	case <-time.After(time.Second):
		t.Fatal("Agent reader remained blocked after product rollback")
	}

	assertAtomicProductRows(t, svc, localAgentRef, 0)
	if config, found, loadErr := svc.agentAIConfigRepo.load(localAgentRef); loadErr != nil || found || config != nil {
		t.Fatalf("AI config after rollback = found:%v config:%+v err:%v", found, config, loadErr)
	}
	svc.mu.RLock()
	agentCount, eventCount, sequence := len(svc.agents), len(svc.events), svc.sequence
	svc.mu.RUnlock()
	if agentCount != 0 || eventCount != 0 || sequence != 0 {
		t.Fatalf("in-memory state after rollback agents=%d events=%d sequence=%d", agentCount, eventCount, sequence)
	}
	select {
	case event := <-sub.ch:
		t.Fatalf("rolled-back product broadcast event: %+v", event)
	default:
	}
}

func TestTerminateMaterializedProductRollsBackThenAtomicallyHardDeletes(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	svc, closeService := openSourceMaterializationTransportTestService(t, statePath)
	defer closeService()
	svc.SetSourceMaterializationProductCommitter(svc)
	product := materializeProductionSourceProduct(t, svc, "realmPersona", "atomic-terminate-first")
	seedAtomicMaterializedRuntimeState(t, svc, product)

	localAgentRef := product.commit.GetLocalAgentRef()
	coreBankKey := atomicAgentCoreBankKey(localAgentRef)
	dyadicBankKey := atomicAgentDyadicBankKey(localAgentRef, sourceMaterializationTransportTestAccount)
	before, err := svc.agentByID(localAgentRef)
	if err != nil {
		t.Fatalf("agentByID before terminate: %v", err)
	}
	svc.mu.RLock()
	beforeInMemoryEventCount, beforeSequence := len(svc.events), svc.sequence
	svc.mu.RUnlock()
	beforeEventRows := runtimeAgentRowCount(t, svc, "runtime_local_agent_event_log", "local_agent_ref", localAgentRef)
	sub := addAtomicProductSubscriber(svc, localAgentRef)
	defer svc.eventStreamRuntime().removeSubscriber(sub.id)

	dropFailureTrigger := installAtomicSnapshotDeleteFailureTrigger(t, svc)
	defer dropFailureTrigger()
	_, err = svc.TerminateAgent(context.Background(), &runtimev1.TerminateAgentRequest{
		Context: product.agentContext,
		AgentId: localAgentRef,
		Reason:  "injected atomic rollback",
	})
	if status.Code(err) != codes.Internal {
		t.Fatalf("TerminateAgent with snapshot trigger error = %v, want Internal", err)
	}
	assertAtomicTerminationRollback(t, svc, product, before, coreBankKey, dyadicBankKey, beforeEventRows, beforeInMemoryEventCount, beforeSequence)
	select {
	case <-product.turnCanceled:
		t.Fatal("failed TerminateAgent irreversibly canceled the restored active turn")
	default:
	}
	select {
	case event := <-sub.ch:
		t.Fatalf("failed TerminateAgent broadcast event: %+v", event)
	default:
	}

	dropFailureTrigger()
	terminated, err := svc.TerminateAgent(context.Background(), &runtimev1.TerminateAgentRequest{
		Context: product.agentContext,
		AgentId: localAgentRef,
		Reason:  "atomic hard delete retry",
	})
	if err != nil || !terminated.GetAck().GetOk() {
		t.Fatalf("TerminateAgent retry = %+v err=%v", terminated, err)
	}
	assertAtomicTerminationDeleted(t, svc, product, coreBankKey, dyadicBankKey)
	assertDeletedSourceMaterializationCommitReplay(t, svc, product, "commit-atomic-terminate-first")
	select {
	case <-product.turnCanceled:
	case <-time.After(time.Second):
		t.Fatal("successful TerminateAgent did not cancel the deleted active turn")
	}

	replayed, err := svc.TerminateAgent(context.Background(), &runtimev1.TerminateAgentRequest{
		Context: product.agentContext,
		AgentId: localAgentRef,
		Reason:  "idempotent hard delete replay",
	})
	if err != nil || !replayed.GetAck().GetOk() {
		t.Fatalf("TerminateAgent idempotent replay = %+v err=%v", replayed, err)
	}

	rematerialized := materializeProductionSourceProduct(t, svc, "realmPersona", "atomic-terminate-second")
	if rematerialized.commit.GetLocalAgentRef() == localAgentRef {
		t.Fatalf("rematerialization reused deleted opaque ref %q", localAgentRef)
	}
	if !sameSourceMaterializationSourceRef(product.challenge.GetSourceRef(), rematerialized.challenge.GetSourceRef()) {
		t.Fatalf("rematerialization source changed: first=%+v second=%+v", product.challenge.GetSourceRef(), rematerialized.challenge.GetSourceRef())
	}
	if product.candidate.Normalized.SnapshotHash != rematerialized.candidate.Normalized.SnapshotHash {
		t.Fatalf("same semantic source produced different snapshot hashes: first=%s second=%s", product.candidate.Normalized.SnapshotHash, rematerialized.candidate.Normalized.SnapshotHash)
	}
	assertProductionSourceProduct(t, svc, rematerialized)

	closeService()
	restarted, closeRestarted := openSourceMaterializationTransportTestService(t, statePath)
	defer closeRestarted()
	restarted.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{})
	restarted.SetSourceMaterializationProductCommitter(restarted)
	assertDeletedSourceMaterializationCommitReplay(t, restarted, product, "commit-atomic-terminate-first")
	assertProductionSourceProduct(t, restarted, rematerialized)
}

func assertDeletedSourceMaterializationCommitReplay(t *testing.T, svc *Service, product *atomicSourceProduct, commitRequestID string) {
	t.Helper()
	replay, err := svc.CommitSourceMaterialization(
		sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount),
		&runtimev1.CommitSourceMaterializationRequest{
			Context:            sourceMaterializationTransportTestRequestContext(product.challenge.GetSourceRef()),
			CommitRequestId:    commitRequestID,
			UploadId:           product.begin.GetUploadId(),
			PacketHash:         product.begin.GetPacketHash(),
			BundleManifestHash: product.begin.GetBundleManifestHash(),
		},
	)
	if err != nil {
		t.Fatalf("deleted source commit replay: %v", err)
	}
	if replay.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_UPLOAD_NOT_FOUND ||
		replay.GetLocalAgentRef() != "" || replay.GetSourceContextStatus() != nil {
		t.Fatalf("deleted source commit replay returned stale success: %+v", replay)
	}
}

func addAtomicProductSubscriber(svc *Service, localAgentRef string) *subscriber {
	sub := &subscriber{
		agentID:      localAgentRef,
		eventFilters: make(map[runtimev1.AgentEventType]struct{}),
		ch:           make(chan *runtimev1.AgentEvent, subscriberBuffer),
	}
	svc.mu.Lock()
	svc.nextSubscriberID++
	sub.id = svc.nextSubscriberID
	svc.subscribers[sub.id] = sub
	svc.mu.Unlock()
	return sub
}

func assertAtomicProductRows(t *testing.T, svc *Service, localAgentRef string, want int) {
	t.Helper()
	for _, table := range []struct {
		name   string
		column string
	}{
		{"runtime_local_agent", "local_agent_ref"},
		{"runtime_local_agent_state_projection", "local_agent_ref"},
		{"runtime_local_agent_event_log", "local_agent_ref"},
		{"runtime_agent_ai_config", "agent_instance_id"},
	} {
		got := runtimeAgentRowCount(t, svc, table.name, table.column, localAgentRef)
		if want == 0 && got != 0 {
			t.Fatalf("%s rows after rollback = %d, want 0", table.name, got)
		}
		if want > 0 && got < want {
			t.Fatalf("%s rows = %d, want at least %d", table.name, got, want)
		}
	}
}

func sortedAtomicKeys(values ...string) []string {
	out := append([]string(nil), values...)
	slices.Sort(out)
	return out
}
