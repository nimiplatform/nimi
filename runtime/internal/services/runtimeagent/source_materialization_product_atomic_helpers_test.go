package runtimeagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type atomicSourceProduct struct {
	candidate    localAgentSourceSnapshotCandidateV1
	challenge    *runtimev1.CreateSourceMaterializationChallengeResponse
	begin        *runtimev1.BeginSourceMaterializationUploadResponse
	commit       *runtimev1.CommitSourceMaterializationResponse
	agentContext *runtimev1.AgentRequestContext
	anchorID     string
	turnCanceled <-chan struct{}
}

func materializeProductionSourceProduct(t *testing.T, svc *Service, kind, suffix string) *atomicSourceProduct {
	t.Helper()
	candidate := sourceMaterializationTransportTestCandidate(t, kind, "packet-"+suffix)
	return materializeProductionSourceProductCandidate(t, svc, candidate, suffix)
}

func materializeProductionSourceProductCandidate(t *testing.T, svc *Service, candidate localAgentSourceSnapshotCandidateV1, suffix string) *atomicSourceProduct {
	t.Helper()
	kind := candidate.Normalized.SourceRef.Kind
	svc.SetSourceMaterializationAdmission(&sourceMaterializationTransportTestAdmission{candidate: candidate})
	svc.SetSourceMaterializationProductCommitter(svc)
	ctx := sourceMaterializationTransportTestContext(sourceMaterializationTransportTestAccount)
	challenge, _, _, begin := sourceMaterializationTransportTestBeginPutCandidate(t, svc, ctx, candidate, suffix)
	committed, err := svc.CommitSourceMaterialization(ctx, &runtimev1.CommitSourceMaterializationRequest{
		Context:            sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef()),
		CommitRequestId:    "commit-" + suffix,
		UploadId:           begin.GetUploadId(),
		PacketHash:         begin.GetPacketHash(),
		BundleManifestHash: begin.GetBundleManifestHash(),
	})
	if err != nil {
		t.Fatalf("CommitSourceMaterialization(%s): %v", kind, err)
	}
	if committed.GetUploadState() != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED ||
		committed.GetChallengeState() != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED ||
		committed.GetReasonCode() != runtimev1.AgentSourceMaterializationReasonCode_AGENT_SOURCE_MATERIALIZATION_REASON_CODE_NONE ||
		committed.GetLocalAgentRef() == "" {
		t.Fatalf("CommitSourceMaterialization(%s) response = %+v", kind, committed)
	}
	agentContext := sourceMaterializationTransportTestRequestContext(challenge.GetSourceRef())
	agentContext.LocalAgentRef = committed.GetLocalAgentRef()
	return &atomicSourceProduct{
		candidate:    candidate,
		challenge:    challenge,
		begin:        begin,
		commit:       committed,
		agentContext: agentContext,
	}
}

func assertProductionSourceProduct(t *testing.T, svc *Service, product *atomicSourceProduct) {
	t.Helper()
	localAgentRef := product.commit.GetLocalAgentRef()
	agentResp, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: product.agentContext, AgentId: localAgentRef})
	if err != nil {
		t.Fatalf("GetAgent(%s): %v", localAgentRef, err)
	}
	agent := agentResp.GetAgent()
	if agent.GetDisplayName() != atomicSourceProductDisplayName(product.candidate) {
		t.Fatalf("Agent.display_name = %q, want %q", agent.GetDisplayName(), atomicSourceProductDisplayName(product.candidate))
	}
	if agent.GetOwnerUserId() != sourceMaterializationTransportTestAccount || agent.GetRuntimeSourceRef() != runtimeSourceRefForMaterialization(product.challenge.GetSourceRef()) {
		t.Fatalf("Agent identity = %+v", agent)
	}
	if !proto.Equal(agent.GetSourceContextStatus(), product.commit.GetSourceContextStatus()) || !agent.GetSourceContextStatus().GetReady() {
		t.Fatalf("Agent source status = %+v, commit status = %+v", agent.GetSourceContextStatus(), product.commit.GetSourceContextStatus())
	}
	stateResp, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{Context: product.agentContext, AgentId: localAgentRef})
	if err != nil {
		t.Fatalf("GetAgentState(%s): %v", localAgentRef, err)
	}
	if stateResp.GetState().GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE || stateResp.GetState().GetActiveWorldId() != product.challenge.GetSourceRef().GetWorldId() {
		t.Fatalf("materialized Agent state = %+v", stateResp.GetState())
	}
	configResp, err := svc.GetRuntimeAgentAIConfig(context.Background(), &runtimev1.GetRuntimeAgentAIConfigRequest{Context: product.agentContext})
	if err != nil {
		t.Fatalf("GetRuntimeAgentAIConfig(%s): %v", localAgentRef, err)
	}
	config := configResp.GetConfig()
	if config.GetAgentInstanceId() != localAgentRef || config.GetRevision() != 1 || len(config.GetIntents()) != 2 {
		t.Fatalf("materialized Agent AI config = %+v", config)
	}
	snapshot, found, err := svc.sourceMaterializationRepo.sourceSnapshot(context.Background(), localAgentRef)
	if err != nil || !found {
		t.Fatalf("sourceSnapshot(%s): found=%v err=%v", localAgentRef, found, err)
	}
	if snapshot.SnapshotHash != product.candidate.Normalized.SnapshotHash || snapshot.LocalAgentRef != localAgentRef || snapshot.PacketID != product.candidate.Normalized.PacketID {
		t.Fatalf("persisted snapshot = %+v", snapshot)
	}

	assertAtomicProductRows(t, svc, localAgentRef, 1)
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent_source_snapshot", "local_agent_ref", localAgentRef); got != 1 {
		t.Fatalf("source snapshot rows = %d, want 1", got)
	}
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent_source_provenance", "local_agent_ref", localAgentRef); got != 1 {
		t.Fatalf("source provenance rows = %d, want 1", got)
	}

	var uploadState int
	var committedRef string
	var committedStatus []byte
	var controlLength int
	if err := svc.backend.DB().QueryRow(`
		SELECT state, committed_local_agent_ref, committed_source_context_status, COALESCE(length(control_bytes), 0)
		FROM runtime_source_materialization_upload WHERE upload_id = ?
	`, product.begin.GetUploadId()).Scan(&uploadState, &committedRef, &committedStatus, &controlLength); err != nil {
		t.Fatalf("load committed upload ledger: %v", err)
	}
	if runtimev1.AgentSourceMaterializationUploadState(uploadState) != runtimev1.AgentSourceMaterializationUploadState_AGENT_SOURCE_MATERIALIZATION_UPLOAD_STATE_COMMITTED || committedRef != localAgentRef || controlLength != 0 {
		t.Fatalf("committed upload ledger state=%d ref=%q control_length=%d", uploadState, committedRef, controlLength)
	}
	ledgerStatus := &runtimev1.LocalAgentSourceContextStatus{}
	if err := proto.Unmarshal(committedStatus, ledgerStatus); err != nil || !proto.Equal(ledgerStatus, product.commit.GetSourceContextStatus()) {
		t.Fatalf("committed upload source status = %+v err=%v", ledgerStatus, err)
	}
	var challengeState int
	if err := svc.backend.DB().QueryRow(`SELECT state FROM runtime_source_materialization_challenge WHERE challenge_id = ?`, product.challenge.GetChallengeId()).Scan(&challengeState); err != nil {
		t.Fatalf("load consumed challenge ledger: %v", err)
	}
	if runtimev1.AgentSourceMaterializationChallengeState(challengeState) != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED {
		t.Fatalf("challenge state = %d, want CONSUMED", challengeState)
	}
	assertSourceMaterializationNoRawUploadBytes(t, svc, product.begin.GetUploadId())
}

func atomicSourceProductDisplayName(candidate localAgentSourceSnapshotCandidateV1) string {
	if candidate.Normalized.Character != nil {
		return candidate.Normalized.Character.Core.Presentation.DisplayName
	}
	return candidate.Normalized.Persona.Core.Presentation.DisplayName
}

func seedAtomicMaterializedRuntimeState(t *testing.T, svc *Service, product *atomicSourceProduct) {
	t.Helper()
	localAgentRef := product.commit.GetLocalAgentRef()
	if _, err := svc.UpdateAgentState(context.Background(), &runtimev1.UpdateAgentStateRequest{
		Context: product.agentContext,
		AgentId: localAgentRef,
		Mutations: []*runtimev1.AgentStateMutation{{Mutation: &runtimev1.AgentStateMutation_SetDyadicContext{
			SetDyadicContext: &runtimev1.AgentStateSetDyadicContext{UserId: sourceMaterializationTransportTestAccount},
		}}},
	}); err != nil {
		t.Fatalf("UpdateAgentState(dyadic): %v", err)
	}
	evidence := completePromotionEvidence(t, svc)
	core := atomicAgentCoreLocator(localAgentRef)
	dyadic := atomicAgentDyadicLocator(localAgentRef, sourceMaterializationTransportTestAccount)
	write, err := svc.WriteAgentMemory(context.Background(), &runtimev1.WriteAgentMemoryRequest{
		Context: product.agentContext,
		AgentId: localAgentRef,
		Candidates: []*runtimev1.CanonicalMemoryCandidate{
			atomicMemoryCandidate(runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED, core, evidence, "atomic core memory"),
			atomicMemoryCandidate(runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC, dyadic, evidence, "atomic dyadic memory"),
		},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory: %v", err)
	}
	if len(write.GetAccepted()) != 2 || len(write.GetRejected()) != 0 {
		t.Fatalf("WriteAgentMemory accepted=%d rejected=%d", len(write.GetAccepted()), len(write.GetRejected()))
	}
	for _, bankKey := range sortedAtomicKeys(memoryservice.LocatorKey(core), memoryservice.LocatorKey(dyadic)) {
		if got := runtimeAgentRowCount(t, svc, "memory_bank", "locator_key", bankKey); got != 1 {
			t.Fatalf("memory bank %q rows = %d, want 1", bankKey, got)
		}
		if got := runtimeAgentRowCount(t, svc, "memory_record", "locator_key", bankKey); got != 1 {
			t.Fatalf("memory record %q rows = %d, want 1", bankKey, got)
		}
	}

	now := time.Now().UTC()
	hook := newTestTimePendingHook(t, "hook-atomic-delete", "placeholder", now.Add(time.Hour), now)
	hook.Intent.AgentId = localAgentRef
	if err := svc.admitPendingHook(localAgentRef, hook); err != nil {
		t.Fatalf("admitPendingHook: %v", err)
	}

	metadata, err := structpb.NewStruct(map[string]any{"atomic_delete": true})
	if err != nil {
		t.Fatal(err)
	}
	anchor, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       product.agentContext,
		SubjectUserId: sourceMaterializationTransportTestAccount,
		Metadata:      metadata,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor: %v", err)
	}
	product.anchorID = anchor.GetSnapshot().GetAnchor().GetConversationAnchorId()
	svc.chatSurfaceMu.Lock()
	state := svc.chatAnchors[product.anchorID]
	if state != nil {
		state.CommittedTranscript = testPublicChatCommittedTranscript([2]string{"persist this transcript through rollback", "persisted assistant reply"})
	}
	chatSnapshot, snapshotErr := svc.capturePublicChatSurfaceSnapshotLocked()
	svc.chatSurfaceMu.Unlock()
	if state == nil {
		t.Fatalf("opened anchor %q is missing in-memory", product.anchorID)
	}
	if snapshotErr != nil {
		t.Fatalf("capture chat snapshot: %v", snapshotErr)
	}
	if err := svc.chatStateRepo.persistPublicChatSurfaceState(chatSnapshot); err != nil {
		t.Fatalf("persist chat transcript: %v", err)
	}
	assertPersistedAtomicChatAnchor(t, svc, product.anchorID, true)

	turnContext, cancelTurn := context.WithCancel(context.Background())
	turnID := "atomic-delete-active-turn"
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turnID] = &publicChatTurnState{
		ConversationAnchorID: product.anchorID,
		TurnID:               turnID,
		AgentID:              localAgentRef,
		Cancel:               cancelTurn,
	}
	svc.chatActiveByAgent[localAgentRef] = turnID
	svc.chatSurfaceMu.Unlock()
	product.turnCanceled = turnContext.Done()
}

func atomicMemoryCandidate(class runtimev1.MemoryCanonicalClass, target *runtimev1.MemoryBankLocator, evidence *structpb.Struct, observation string) *runtimev1.CanonicalMemoryCandidate {
	return &runtimev1.CanonicalMemoryCandidate{
		CanonicalClass: class,
		TargetBank:     target,
		SourceEventId:  "event-" + observation,
		PolicyReason:   "atomic deletion fixture",
		Extensions:     evidence,
		Record: &runtimev1.MemoryRecordInput{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
			Payload: &runtimev1.MemoryRecordInput_Observational{
				Observational: &runtimev1.ObservationalMemoryRecord{Observation: observation},
			},
		},
	}
}

func atomicAgentCoreLocator(localAgentRef string) *runtimev1.MemoryBankLocator {
	return &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: localAgentRef}},
	}
}

func atomicAgentDyadicLocator(localAgentRef, userID string) *runtimev1.MemoryBankLocator {
	return &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
		Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
			AgentDyadic: &runtimev1.AgentDyadicBankOwner{AgentId: localAgentRef, UserId: userID},
		},
	}
}

func atomicAgentCoreBankKey(localAgentRef string) string {
	return memoryservice.LocatorKey(atomicAgentCoreLocator(localAgentRef))
}

func atomicAgentDyadicBankKey(localAgentRef, userID string) string {
	return memoryservice.LocatorKey(atomicAgentDyadicLocator(localAgentRef, userID))
}

func installAtomicSnapshotDeleteFailureTrigger(t *testing.T, svc *Service) func() {
	t.Helper()
	const triggerName = "test_atomic_source_snapshot_delete_failure"
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`CREATE TRIGGER ` + triggerName + `
			BEFORE DELETE ON runtime_local_agent_source_snapshot
			BEGIN SELECT RAISE(ABORT, 'injected source snapshot delete failure'); END`)
		return err
	}); err != nil {
		t.Fatalf("install snapshot delete trigger: %v", err)
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
				_, err := tx.Exec(`DROP TRIGGER IF EXISTS ` + triggerName)
				return err
			}); err != nil {
				t.Errorf("drop snapshot delete trigger: %v", err)
			}
		})
	}
}

func assertAtomicTerminationRollback(t *testing.T, svc *Service, product *atomicSourceProduct, before *agentEntry, coreBankKey, dyadicBankKey string, beforeEventRows, beforeInMemoryEventCount int, beforeSequence uint64) {
	t.Helper()
	localAgentRef := product.commit.GetLocalAgentRef()
	after, err := svc.agentByID(localAgentRef)
	if err != nil {
		t.Fatalf("agent missing after failed terminate: %v", err)
	}
	if !proto.Equal(after.Agent, before.Agent) || !proto.Equal(after.State, before.State) || len(after.Hooks) != len(before.Hooks) {
		t.Fatalf("Agent in-memory projection changed after rollback: before=%+v after=%+v", before, after)
	}
	for hookID, beforeHook := range before.Hooks {
		if !proto.Equal(after.Hooks[hookID], beforeHook) {
			t.Fatalf("hook %q changed after rollback", hookID)
		}
	}
	svc.mu.RLock()
	afterInMemoryEventCount, afterSequence := len(svc.events), svc.sequence
	svc.mu.RUnlock()
	if afterInMemoryEventCount != beforeInMemoryEventCount || afterSequence != beforeSequence {
		t.Fatalf("in-memory event state after rollback count=%d sequence=%d, want count=%d sequence=%d", afterInMemoryEventCount, afterSequence, beforeInMemoryEventCount, beforeSequence)
	}
	for _, table := range []struct{ name, column string }{
		{"runtime_local_agent", "local_agent_ref"},
		{"runtime_local_agent_state_projection", "local_agent_ref"},
		{"runtime_local_agent_hook", "local_agent_ref"},
		{"runtime_local_agent_source_snapshot", "local_agent_ref"},
		{"runtime_local_agent_source_provenance", "local_agent_ref"},
		{"runtime_agent_ai_config", "agent_instance_id"},
		{"runtime_source_materialization_upload", "committed_local_agent_ref"},
	} {
		if got := runtimeAgentRowCount(t, svc, table.name, table.column, localAgentRef); got != 1 {
			t.Fatalf("%s rows after failed terminate = %d, want 1", table.name, got)
		}
	}
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent_event_log", "local_agent_ref", localAgentRef); got != beforeEventRows {
		t.Fatalf("event rows after failed terminate = %d, want %d", got, beforeEventRows)
	}
	for _, bank := range []struct {
		key     string
		locator *runtimev1.MemoryBankLocator
	}{
		{coreBankKey, atomicAgentCoreLocator(localAgentRef)},
		{dyadicBankKey, atomicAgentDyadicLocator(localAgentRef, sourceMaterializationTransportTestAccount)},
	} {
		bankKey := bank.key
		if got := runtimeAgentRowCount(t, svc, "memory_bank", "locator_key", bankKey); got != 1 {
			t.Fatalf("memory bank %q after failed terminate = %d, want 1", bankKey, got)
		}
		if got := runtimeAgentRowCount(t, svc, "memory_record", "locator_key", bankKey); got != 1 {
			t.Fatalf("memory record %q after failed terminate = %d, want 1", bankKey, got)
		}
		if _, err := svc.memorySvc.GetBank(context.Background(), &runtimev1.GetBankRequest{Locator: bank.locator}); err != nil {
			t.Fatalf("in-memory memory bank %q after failed terminate: %v", bankKey, err)
		}
		history, err := svc.memorySvc.History(context.Background(), &runtimev1.HistoryRequest{
			Bank:  bank.locator,
			Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
		})
		if err != nil || len(history.GetRecords()) != 1 {
			t.Fatalf("memory history %q after failed terminate records=%d err=%v", bankKey, len(history.GetRecords()), err)
		}
	}
	if config, found, loadErr := svc.agentAIConfigRepo.load(localAgentRef); loadErr != nil || !found || config == nil {
		t.Fatalf("AI config after failed terminate = found:%v config:%+v err:%v", found, config, loadErr)
	}
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[product.anchorID]
	anchorPresent := anchor != nil && len(anchor.CommittedTranscript) == 1
	svc.chatSurfaceMu.Unlock()
	if !anchorPresent {
		t.Fatalf("chat anchor/transcript %q was not restored", product.anchorID)
	}
	assertPersistedAtomicChatAnchor(t, svc, product.anchorID, true)
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent_meta", "key", runtimeAgentConversationAnchorMetadataKey(product.anchorID)); got != 1 {
		t.Fatalf("anchor metadata rows after failed terminate = %d, want 1", got)
	}
	assertConsumedAtomicChallenge(t, svc, product.challenge.GetChallengeId())
}

func assertAtomicTerminationDeleted(t *testing.T, svc *Service, product *atomicSourceProduct, coreBankKey, dyadicBankKey string) {
	t.Helper()
	localAgentRef := product.commit.GetLocalAgentRef()
	for _, table := range []struct{ name, column string }{
		{"runtime_local_agent", "local_agent_ref"},
		{"runtime_local_agent_state_projection", "local_agent_ref"},
		{"runtime_local_agent_hook", "local_agent_ref"},
		{"runtime_local_agent_event_log", "local_agent_ref"},
		{"runtime_local_agent_behavioral_posture", "local_agent_ref"},
		{"runtime_local_agent_review_run", "local_agent_ref"},
		{"runtime_local_agent_source_snapshot", "local_agent_ref"},
		{"runtime_local_agent_source_provenance", "local_agent_ref"},
		{"runtime_agent_ai_config", "agent_instance_id"},
		{"runtime_source_materialization_upload", "committed_local_agent_ref"},
	} {
		if got := runtimeAgentRowCount(t, svc, table.name, table.column, localAgentRef); got != 0 {
			t.Fatalf("%s rows after successful terminate = %d, want 0", table.name, got)
		}
	}
	for _, bankKey := range []string{coreBankKey, dyadicBankKey} {
		if got := runtimeAgentRowCount(t, svc, "memory_bank", "locator_key", bankKey); got != 0 {
			t.Fatalf("memory bank %q after successful terminate = %d, want 0", bankKey, got)
		}
		if got := runtimeAgentRowCount(t, svc, "memory_record", "locator_key", bankKey); got != 0 {
			t.Fatalf("memory record %q after successful terminate = %d, want 0", bankKey, got)
		}
	}
	if _, err := svc.agentByID(localAgentRef); status.Code(err) != codes.NotFound {
		t.Fatalf("agentByID after successful terminate error = %v, want NotFound", err)
	}
	svc.mu.RLock()
	for _, event := range svc.events {
		if event.GetLocalAgentRef() == localAgentRef {
			svc.mu.RUnlock()
			t.Fatalf("in-memory event for deleted Agent remains: %+v", event)
		}
	}
	svc.mu.RUnlock()
	if _, found, err := svc.sourceMaterializationRepo.sourceSnapshot(context.Background(), localAgentRef); err != nil || found {
		t.Fatalf("source snapshot after successful terminate found=%v err=%v", found, err)
	}
	svc.chatSurfaceMu.Lock()
	_, anchorPresent := svc.chatAnchors[product.anchorID]
	svc.chatSurfaceMu.Unlock()
	if anchorPresent {
		t.Fatalf("chat anchor %q remains in-memory", product.anchorID)
	}
	for _, locator := range []*runtimev1.MemoryBankLocator{
		atomicAgentCoreLocator(localAgentRef),
		atomicAgentDyadicLocator(localAgentRef, sourceMaterializationTransportTestAccount),
	} {
		if _, err := svc.memorySvc.GetBank(context.Background(), &runtimev1.GetBankRequest{Locator: locator}); status.Code(err) != codes.NotFound {
			t.Fatalf("in-memory memory bank %q after successful terminate error=%v, want NotFound", memoryservice.LocatorKey(locator), err)
		}
	}
	assertPersistedAtomicChatAnchor(t, svc, product.anchorID, false)
	if got := runtimeAgentRowCount(t, svc, "runtime_local_agent_meta", "key", runtimeAgentConversationAnchorMetadataKey(product.anchorID)); got != 0 {
		t.Fatalf("anchor metadata rows after successful terminate = %d, want 0", got)
	}
	if got := runtimeAgentRowCount(t, svc, "runtime_source_materialization_upload", "upload_id", product.begin.GetUploadId()); got != 0 {
		t.Fatalf("bounded upload replay result rows = %d, want 0", got)
	}
	if got := runtimeAgentRowCount(t, svc, "runtime_source_materialization_chunk", "upload_id", product.begin.GetUploadId()); got != 0 {
		t.Fatalf("raw upload chunk rows = %d, want 0", got)
	}
	assertConsumedAtomicChallenge(t, svc, product.challenge.GetChallengeId())
	svc.agentAIConfigReadinessMu.RLock()
	_, readinessPresent := svc.agentAIConfigReadiness[localAgentRef]
	svc.agentAIConfigReadinessMu.RUnlock()
	if readinessPresent {
		t.Fatalf("AI config readiness for %q remains after successful terminate", localAgentRef)
	}
}

func assertPersistedAtomicChatAnchor(t *testing.T, svc *Service, anchorID string, want bool) {
	t.Helper()
	var raw string
	if err := svc.backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, runtimeAgentMetaPublicChatSurfaceStateKey).Scan(&raw); err != nil {
		t.Fatalf("load persisted chat surface state: %v", err)
	}
	var persisted persistedPublicChatSurfaceState
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		t.Fatalf("decode persisted chat surface state: %v", err)
	}
	found := false
	for _, anchor := range persisted.Anchors {
		if anchor.ConversationAnchorID != anchorID {
			continue
		}
		found = true
		if want && len(anchor.CommittedTranscript) != 1 {
			t.Fatalf("persisted anchor committed transcript length = %d, want 1", len(anchor.CommittedTranscript))
		}
	}
	if found != want {
		t.Fatalf("persisted anchor %q found=%v, want %v", anchorID, found, want)
	}
}

func assertConsumedAtomicChallenge(t *testing.T, svc *Service, challengeID string) {
	t.Helper()
	var state int
	if err := svc.backend.DB().QueryRow(`SELECT state FROM runtime_source_materialization_challenge WHERE challenge_id = ?`, challengeID).Scan(&state); err != nil {
		t.Fatalf("load consumed challenge %q: %v", challengeID, err)
	}
	if runtimev1.AgentSourceMaterializationChallengeState(state) != runtimev1.AgentSourceMaterializationChallengeState_AGENT_SOURCE_MATERIALIZATION_CHALLENGE_STATE_CONSUMED {
		t.Fatalf("challenge %q state = %d, want CONSUMED", challengeID, state)
	}
	var nonceReplayCount int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_source_materialization_nonce_replay WHERE challenge_id = ?`, challengeID).Scan(&nonceReplayCount); err != nil {
		t.Fatalf("load nonce replay ledger for challenge %q: %v", challengeID, err)
	}
	if nonceReplayCount != 1 {
		t.Fatalf("challenge %q nonce replay rows = %d, want 1", challengeID, nonceReplayCount)
	}
}
