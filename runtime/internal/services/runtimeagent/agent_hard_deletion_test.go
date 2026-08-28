package runtimeagent

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// newRuntimeAgentHardDeleteTestService uses the active post-cut topology so
// termination tests exercise the Cognition-owned bank and Runtime-owned fence.
func newRuntimeAgentHardDeleteTestService(t *testing.T) (*Service, *memoryv1.Core) {
	t.Helper()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, owner, closeFn := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	t.Cleanup(closeFn)
	return svc, owner
}

func runtimeAgentRowCount(t *testing.T, svc *Service, table string, column string, value string) int {
	t.Helper()
	var count int
	if err := svc.backend.DB().QueryRow(
		"SELECT COUNT(*) FROM "+table+" WHERE "+column+" = ?", value,
	).Scan(&count); err != nil {
		t.Fatalf("count %s.%s=%q: %v", table, column, value, err)
	}
	return count
}

func seedCognitionMemoryForTerminationTest(t *testing.T, svc *Service, localAgentRef, content string) string {
	t.Helper()
	ctx := context.Background()
	binding, err := svc.cognitionMemoryStore.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		t.Fatalf("load Cognition Memory binding: %v", err)
	}
	envelope := cognitionMemoryMessageEnvelope(
		binding,
		time.Now().UTC(),
		&runtimev1.CognitionMemorySourceRef{Kind: "conversation_turn", Value: "turn-" + localAgentRef},
		&runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "conversation-" + localAgentRef},
		publicChatTurnOriginUser,
		content,
		nil,
		true,
	)
	if err := svc.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := svc.cognitionMemoryStore.EnqueueCommittedEventTx(tx, localAgentRef, envelope)
		return err
	}); err != nil {
		t.Fatalf("enqueue Cognition Memory fact: %v", err)
	}
	drained, err := svc.cognitionMemoryBridge.DrainOne(ctx, localAgentRef)
	if err != nil || !drained.Drained {
		t.Fatalf("transfer Cognition Memory custody: result=%+v err=%v", drained, err)
	}
	decision, err := svc.cognitionMemoryFacade.ProcessRemember(ctx, localAgentRef, drained.OperationID)
	if err != nil || decision.Outcome != memoryv1.OutcomeAdmitted {
		t.Fatalf("commit Cognition Memory: result=%+v err=%v", decision, err)
	}
	binding, err = svc.cognitionMemoryStore.BindingForAgent(ctx, localAgentRef)
	if err != nil || binding.BankRef == "" {
		t.Fatalf("reload ensured Cognition Memory binding: binding=%+v err=%v", binding, err)
	}
	return binding.BankRef
}

func attachAgentRealtimeTerminationSession(
	t *testing.T,
	svc *Service,
	runtimeSourceRef string,
	sessionID string,
	decisionSeed byte,
	withActiveTurn bool,
) (*localAppAgentRealtimeSession, accountservice.LocalAppCallerDecision) {
	t.Helper()
	decision := localAppConversationDecision(accountservice.LocalAppOperationAgentRealtimeInputAppend, decisionSeed, "user-1")
	localAgentRef := testRuntimeAgentLocalRef(runtimeSourceRef)
	anchorID := openPublicChatTestAnchor(t, svc, runtimeSourceRef, decision.AppID, decision.AccountID)
	session := &localAppAgentRealtimeSession{
		realtimeSessionID:    sessionID,
		channelID:            "channel-" + sessionID,
		generation:           7,
		accountID:            decision.AccountID,
		appID:                decision.AppID,
		registeredAppSubject: decision.RegisteredAppSubject,
		agentID:              localAgentRef,
		agentHandle:          mintLocalAppAgentHandle(decision, localAgentRef),
		conversationAnchorID: anchorID,
		privateInputRequests: make(map[string]struct{}),
	}
	if withActiveTurn {
		turnID := "agent_turn_terminate_" + sessionID
		_, cancel := context.WithCancel(context.Background())
		turn := publicChatTurnState{
			ConversationAnchorID: anchorID,
			TurnID:               turnID,
			StreamID:             "agent_stream_terminate_" + sessionID,
			AgentID:              localAgentRef,
			CallerAppID:          decision.AppID,
			SubjectUserID:        decision.AccountID,
			Cancel:               cancel,
			TimelineStartedAt:    time.Now().UTC(),
			Origin:               publicChatTurnOriginUser,
		}
		turn.Projection = newPublicChatTurnProjection(&turn)
		svc.chatSurfaceMu.Lock()
		anchor := svc.chatAnchors[anchorID]
		anchor.ActiveTurnID = turnID
		anchor.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
		svc.chatTurns[turnID] = &turn
		svc.chatActiveByAgent[localAgentRef] = turnID
		ownerSession := *clonePublicChatAnchorState(anchor)
		svc.chatSurfaceMu.Unlock()
		session.turn = &localAppAgentRealtimeTurn{
			session: ownerSession,
			turn:    turn,
			req:     publicChatTurnRequestPayload{ConversationAnchorID: anchorID, RequestID: "terminate-realtime-request-" + sessionID},
			text:    "late response must not commit",
			started: true,
		}
	}
	svc.agentRealtimeMu.Lock()
	svc.agentRealtimeSessions[sessionID] = session
	svc.agentRealtimeMu.Unlock()
	return session, decision
}

func TestTerminateAgentFencesRealtimeGenerationBeforeProjectionDelete(t *testing.T) {
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const targetSource = "agent-realtime-hard-delete"
	const survivorSource = "agent-realtime-hard-delete-survivor"
	for _, source := range []string{targetSource, survivorSource} {
		if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)}); err != nil {
			t.Fatalf("materialize %s: %v", source, err)
		}
	}
	target, _ := attachAgentRealtimeTerminationSession(t, svc, targetSource, "realtime-target", 0x31, true)
	survivor, _ := attachAgentRealtimeTerminationSession(t, svc, survivorSource, "realtime-survivor", 0x41, false)
	type closeRequestRecord struct {
		realtimeSessionID string
		generation        uint64
	}
	closeRequests := make([]closeRequestRecord, 0, 1)
	lateProjected := false
	svc.SetAgentRealtimeAIExecutor(agentRealtimeExecutorStub{onCloseRequest: func(req *runtimev1.CloseRealtimeSessionRequest) {
		closeRequests = append(closeRequests, closeRequestRecord{
			realtimeSessionID: req.GetRealtimeSessionId(),
			generation:        req.GetGeneration(),
		})
		for _, event := range []*runtimev1.AiRealtimeEvent{
			{Event: &runtimev1.AiRealtimeEvent_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameOutput{OutputTrackId: "late-track", FrameSequence: 9, Frame: []byte{1, 2}}}},
			{Event: &runtimev1.AiRealtimeEvent_RequestTerminal{RequestTerminal: &runtimev1.AiRealtimeRequestTerminal{RequestId: "late-final"}}},
		} {
			projected, err := svc.projectAgentRealtimeEvent(context.Background(), target, agentRealtimeExecutorStub{}, event)
			if err != nil || projected != nil {
				lateProjected = true
			}
		}
	}})
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext(targetSource), Reason: "delete Realtime Agent"}); err != nil {
		t.Fatalf("TerminateAgent: %v", err)
	}
	if len(closeRequests) != 1 || closeRequests[0].realtimeSessionID != target.realtimeSessionID || closeRequests[0].generation != 7 {
		t.Fatalf("target Realtime close requests = %#v", closeRequests)
	}
	if lateProjected {
		t.Fatal("late audio/final crossed the terminated Realtime generation fence")
	}
	if !target.isClosed() || survivor.isClosed() {
		t.Fatalf("Realtime fence scope: target_closed=%v survivor_closed=%v", target.isClosed(), survivor.isClosed())
	}
	svc.agentRealtimeMu.RLock()
	targetStored := svc.agentRealtimeSessions[target.realtimeSessionID]
	survivorStored := svc.agentRealtimeSessions[survivor.realtimeSessionID]
	svc.agentRealtimeMu.RUnlock()
	if targetStored != nil || survivorStored != survivor {
		t.Fatalf("Realtime session scope after delete: target=%p survivor=%p", targetStored, survivorStored)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(survivorSource)}); err != nil {
		t.Fatalf("survivor Agent changed: %v", err)
	}
}

func TestTerminateAgentCognitionFailureRetainsAgentButFencesRealtime(t *testing.T) {
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const targetSource = "agent-realtime-cognition-failure"
	const survivorSource = "agent-realtime-cognition-failure-survivor"
	for _, source := range []string{targetSource, survivorSource} {
		if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)}); err != nil {
			t.Fatalf("materialize %s: %v", source, err)
		}
	}
	target, targetDecision := attachAgentRealtimeTerminationSession(t, svc, targetSource, "realtime-cognition-target", 0x51, true)
	survivor, _ := attachAgentRealtimeTerminationSession(t, svc, survivorSource, "realtime-cognition-survivor", 0x61, false)
	closed := make([]string, 0, 1)
	svc.SetAgentRealtimeAIExecutor(agentRealtimeExecutorStub{onCloseRequest: func(req *runtimev1.CloseRealtimeSessionRequest) {
		closed = append(closed, req.GetRealtimeSessionId())
	}})
	svc.sourceCognitionBridge = &sourceCognitionBridgeStub{deleteOutcome: cognitionservice.AgentSourceOutcome{Status: "failure"}}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext(targetSource), Reason: "Cognition failure fence"}); status.Code(err) != codes.Unavailable {
		t.Fatalf("TerminateAgent Cognition failure = %v", err)
	}
	for _, source := range []string{targetSource, survivorSource} {
		if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(source)}); err != nil {
			t.Fatalf("Cognition failure removed %s: %v", source, err)
		}
	}
	if len(closed) != 1 || closed[0] != target.realtimeSessionID || !target.isClosed() || survivor.isClosed() {
		t.Fatalf("Cognition failure Realtime scope: closed=%v target=%v survivor=%v", closed, target.isClosed(), survivor.isClosed())
	}
	assertAgentRealtimeTurnReleased(t, svc, target, targetDecision.AppID)
	anchor, ok := svc.publicChatAnchorSnapshot(target.conversationAnchorID)
	if !ok || len(anchor.CommittedTranscript) != 0 {
		t.Fatalf("late Realtime final committed after Cognition failure: anchor=%+v ok=%v", anchor, ok)
	}
	projected, err := svc.projectAgentRealtimeEvent(ctx, target, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{
		Event: &runtimev1.AiRealtimeEvent_RequestTerminal{RequestTerminal: &runtimev1.AiRealtimeRequestTerminal{RequestId: "post-failure-late-final"}},
	})
	if err != nil || projected != nil {
		t.Fatalf("post-failure late final projection=%+v err=%v", projected, err)
	}
}

// TestTerminateAgentHardDeletesProjectionAndCognitionBank proves the active
// lifecycle deletes the Cognition-owned bank and Runtime-owned Agent state,
// while leaving a different Agent and bank intact.
func TestTerminateAgentHardDeletesProjectionAndCognitionBank(t *testing.T) {
	t.Parallel()
	svc, owner := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-hard-delete"
	const survivorRuntimeSourceRef = "agent-hard-delete-survivor"
	localRef := testRuntimeAgentLocalRef(runtimeSourceRef)
	survivorRef := testRuntimeAgentLocalRef(survivorRuntimeSourceRef)
	for _, source := range []string{runtimeSourceRef, survivorRuntimeSourceRef} {
		if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)}); err != nil {
			t.Fatalf("RealmSourceMaterialization(%s): %v", source, err)
		}
	}
	targetBankRef := seedCognitionMemoryForTerminationTest(t, svc, localRef, "I prefer target memory for hard delete")
	survivorBankRef := seedCognitionMemoryForTerminationTest(t, svc, survivorRef, "I prefer survivor memory remains")
	if memories, err := owner.ListMemories(ctx, targetBankRef, true); err != nil || len(memories) != 1 {
		t.Fatalf("target Cognition bank precondition: memories=%+v err=%v", memories, err)
	}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
		Reason:  "agent friend removed",
	}); err != nil {
		t.Fatalf("TerminateAgent: %v", err)
	}
	for _, table := range []struct{ name, column string }{
		{"runtime_local_agent", "local_agent_ref"},
		{"runtime_local_agent_state_projection", "local_agent_ref"},
		{"runtime_local_agent_hook", "local_agent_ref"},
		{"runtime_local_agent_event_log", "local_agent_ref"},
		{"runtime_cognition_memory_agent", "local_agent_ref"},
		{"runtime_cognition_memory_stream", "local_agent_ref"},
		{"runtime_cognition_memory_committed_event", "local_agent_ref"},
		{"runtime_cognition_memory_ai_job", "local_agent_ref"},
	} {
		if got := runtimeAgentRowCount(t, svc, table.name, table.column, localRef); got != 0 {
			t.Fatalf("%s rows for terminated Agent = %d, want 0", table.name, got)
		}
	}
	if _, err := owner.ListMemories(ctx, targetBankRef, true); !memoryv1.IsOutcome(err, memoryv1.OutcomeConflict) {
		t.Fatalf("deleted Cognition bank remained readable: %v", err)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetAgent after terminate: status = %s, want NotFound", status.Code(err))
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(survivorRuntimeSourceRef)}); err != nil {
		t.Fatalf("survivor Agent changed: %v", err)
	}
	if memories, err := owner.ListMemories(ctx, survivorBankRef, true); err != nil || len(memories) != 1 || memories[0].Content != "I prefer survivor memory remains" {
		t.Fatalf("survivor Cognition bank changed: memories=%+v err=%v", memories, err)
	}
	if got := runtimeAgentRowCount(t, svc, "runtime_cognition_memory_agent", "local_agent_ref", survivorRef); got != 1 {
		t.Fatalf("survivor Runtime binding rows = %d, want 1", got)
	}
	svc.mu.RLock()
	_, terminatedTurnSourceFound := svc.turnSourceViews[localRef]
	_, survivorTurnSourceFound := svc.turnSourceViews[survivorRef]
	svc.mu.RUnlock()
	if terminatedTurnSourceFound || !survivorTurnSourceFound {
		t.Fatalf("turn source views after terminate: target=%v survivor=%v", terminatedTurnSourceFound, survivorTurnSourceFound)
	}
}

// TestTerminateAgentSnapshotDoesNotReinsertDeletedRef proves a deleted
// local_agent_ref does not reappear after a snapshot reload (K-AGCORE-141
// "runtime snapshot persistence must not re-insert a deleted local_agent_ref").
func TestTerminateAgentSnapshotDoesNotReinsertDeletedRef(t *testing.T) {
	t.Parallel()

	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-snapshot-delete"
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
		AgentId: runtimeSourceRef,
	}); err != nil {
		t.Fatalf("TerminateAgent: %v", err)
	}
	// Reload in-memory state from the persisted snapshot.
	if err := svc.loadState(); err != nil {
		t.Fatalf("loadState after terminate: %v", err)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetAgent after snapshot reload: status = %s, want NotFound (deleted ref must not reappear)", status.Code(err))
	}
}

// TestTerminateAgentIdempotentTypedNoOpForAbsentRef proves TerminateAgent for
// a never-materialized local_agent_ref succeeds as a typed no-op rather than
// failing not-found (K-AGCORE-141 fixed rule).
func TestTerminateAgentIdempotentTypedNoOpForAbsentRef(t *testing.T) {
	t.Parallel()

	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	resp, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-never-existed"),
		AgentId: "agent-never-existed",
	})
	if err != nil {
		t.Fatalf("TerminateAgent(absent ref): %v", err)
	}
	if !resp.GetAck().GetOk() {
		t.Fatalf("TerminateAgent(absent ref) ack = %#v, want ok", resp.GetAck())
	}

	// And idempotent after a real delete: a second terminate is still a no-op.
	const runtimeSourceRef = "agent-idempotent-delete"
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	for i := 0; i < 2; i++ {
		resp, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
			Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
			AgentId: runtimeSourceRef,
		})
		if err != nil {
			t.Fatalf("TerminateAgent attempt %d: %v", i, err)
		}
		if !resp.GetAck().GetOk() {
			t.Fatalf("TerminateAgent attempt %d ack = %#v, want ok", i, resp.GetAck())
		}
	}
}

func TestTerminateAgentFailsClosedWhenSourceCognitionOwnerIsUnavailable(t *testing.T) {
	t.Parallel()
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-cognition-unavailable-delete"
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		t.Fatal(err)
	}
	svc.sourceCognitionBridge = nil
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); status.Code(err) != codes.Unavailable {
		t.Fatalf("TerminateAgent with unavailable Cognition owner = %v", err)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		t.Fatalf("failed termination removed Runtime Agent: %v", err)
	}
}

func TestTerminateAgentRejectsNonTerminalSourceCognitionDeleteOutcome(t *testing.T) {
	t.Parallel()
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-cognition-nonterminal-delete"
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		t.Fatal(err)
	}
	svc.sourceCognitionBridge = &sourceCognitionBridgeStub{deleteOutcome: cognitionservice.AgentSourceOutcome{Status: "failure"}}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); status.Code(err) != codes.Unavailable {
		t.Fatalf("TerminateAgent with non-terminal Cognition outcome = %v", err)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		t.Fatalf("non-terminal Cognition outcome removed Runtime Agent: %v", err)
	}
}

func TestSourceCognitionIngestSerializesWithAgentTermination(t *testing.T) {
	t.Parallel()
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-cognition-ingest-termination"
	localAgentRef := testRuntimeAgentLocalRef(runtimeSourceRef)
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		t.Fatal(err)
	}
	svc.mu.RLock()
	ownerUserID := svc.agents[localAgentRef].Agent.GetOwnerUserId()
	svc.mu.RUnlock()
	bridge := newLifecycleBlockingSourceCognitionBridge()
	svc.sourceCognitionBridge = bridge
	rebuildDone := make(chan error, 1)
	go func() {
		rebuildDone <- svc.rebuildSourceCognition(ctx, ownerUserID, localAgentRef, true)
	}()
	select {
	case <-bridge.ingestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("source Cognition ingest did not reach the lifecycle boundary")
	}
	if svc.mu.TryLock() {
		svc.mu.Unlock()
		t.Fatal("source Cognition building commit did not hold the Agent lifecycle read lock")
	}
	terminateDone := make(chan error, 1)
	go func() {
		_, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef), Reason: "race closure"})
		terminateDone <- err
	}()
	close(bridge.ingestRelease)
	select {
	case err := <-rebuildDone:
		if err != nil {
			t.Fatalf("source Cognition rebuild: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("source Cognition rebuild did not finish")
	}
	select {
	case err := <-terminateDone:
		if err != nil {
			t.Fatalf("TerminateAgent: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("TerminateAgent did not finish")
	}
	select {
	case <-bridge.deleteCalled:
	default:
		t.Fatal("termination did not delete the source Cognition scope")
	}
	if bridge.sourceScopePresent() {
		t.Fatal("termination left a source Cognition orphan after a concurrent ingest")
	}
}

type lifecycleBlockingSourceCognitionBridge struct {
	ingestStarted chan struct{}
	ingestRelease chan struct{}
	deleteCalled  chan struct{}
	startOnce     sync.Once
	deleteOnce    sync.Once
	mu            sync.Mutex
	scopePresent  bool
}

func newLifecycleBlockingSourceCognitionBridge() *lifecycleBlockingSourceCognitionBridge {
	return &lifecycleBlockingSourceCognitionBridge{ingestStarted: make(chan struct{}), ingestRelease: make(chan struct{}), deleteCalled: make(chan struct{})}
}

func (b *lifecycleBlockingSourceCognitionBridge) IngestAgentSource(_ context.Context, _, _, scopeID, snapshot, partition string, units []cognitionservice.AgentSourceUnit, omissions []cognitionservice.AgentSourceOmission) (cognitionservice.AgentSourceOutcome, error) {
	b.startOnce.Do(func() { close(b.ingestStarted) })
	<-b.ingestRelease
	b.mu.Lock()
	b.scopePresent = true
	b.mu.Unlock()
	return cognitionservice.AgentSourceOutcome{Status: "building", ScopeID: scopeID, SnapshotIdentity: snapshot, PartitionIdentity: partition, Generation: 1, UnitCount: uint32(len(units)), OmissionCount: uint32(len(omissions))}, nil
}

func (b *lifecycleBlockingSourceCognitionBridge) SearchAgentSource(context.Context, string, string, string, string, string, int) (cognitionservice.AgentSourceOutcome, error) {
	return cognitionservice.AgentSourceOutcome{}, nil
}

func (b *lifecycleBlockingSourceCognitionBridge) InspectAgentSource(context.Context, string, string, string) (cognitionservice.AgentSourceOutcome, error) {
	return cognitionservice.AgentSourceOutcome{}, nil
}

func (b *lifecycleBlockingSourceCognitionBridge) DeleteAgentSource(_ context.Context, _, scopeID, snapshot string) (cognitionservice.AgentSourceOutcome, error) {
	b.mu.Lock()
	b.scopePresent = false
	b.mu.Unlock()
	b.deleteOnce.Do(func() { close(b.deleteCalled) })
	return cognitionservice.AgentSourceOutcome{Status: "deleted", ScopeID: scopeID, SnapshotIdentity: snapshot}, nil
}

func (b *lifecycleBlockingSourceCognitionBridge) sourceScopePresent() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.scopePresent
}

// TestTerminateAgentSubstrateFailureFailsClosed proves a persistence-substrate
// failure returns a typed error before either owner is mutated.
func TestTerminateAgentSubstrateFailureFailsClosed(t *testing.T) {
	t.Parallel()

	svc, owner := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	const runtimeSourceRef = "agent-fail-closed"
	localRef := testRuntimeAgentLocalRef(runtimeSourceRef)
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	bankRef := seedCognitionMemoryForTerminationTest(t, svc, localRef, "I prefer memory retained on substrate failure")

	// Close the shared persistence backend so the deletion transaction fails.
	if err := svc.backend.Close(); err != nil {
		t.Fatalf("close backend: %v", err)
	}

	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext(runtimeSourceRef),
		AgentId: runtimeSourceRef,
	}); err == nil {
		t.Fatal("TerminateAgent on a failed substrate must return a typed error, not pseudo-success")
	}

	// No partial deletion: the in-memory projection and Cognition-owned bank
	// both survive because Runtime could not load the committed source binding.
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		t.Fatalf("GetAgent after failed terminate: %v (the row must not be partially deleted)", err)
	}
	if memories, err := owner.ListMemories(ctx, bankRef, true); err != nil || len(memories) != 1 {
		t.Fatalf("Cognition bank after failed terminate: memories=%+v err=%v", memories, err)
	}
}

func TestTerminateAgentResumesAfterOwnerDeleteAndRuntimeCommitFailure(t *testing.T) {
	root := t.TempDir()
	localStatePath := filepath.Join(root, "local-state.json")
	svc, owner, closeFirst := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	ctx := context.Background()
	const runtimeSourceRef = "agent-owner-deleted-runtime-pending"
	localRef := testRuntimeAgentLocalRef(runtimeSourceRef)
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		closeFirst()
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	bankRef := seedCognitionMemoryForTerminationTest(t, svc, localRef, "I prefer memory deleted before Runtime commit retry")
	triggerSQL := `CREATE TRIGGER inject_agent_delete_failure BEFORE DELETE ON runtime_local_agent_source_snapshot_v2 WHEN OLD.local_agent_ref = '` + localRef + `' BEGIN SELECT RAISE(ABORT, 'injected final Runtime delete failure'); END`
	if _, err := svc.backend.DB().Exec(triggerSQL); err != nil {
		closeFirst()
		t.Fatalf("install final Runtime delete failure: %v", err)
	}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef), Reason: "exercise durable termination recovery"}); err == nil {
		closeFirst()
		t.Fatal("TerminateAgent must report the failed final Runtime transaction")
	}
	if _, err := owner.ListMemories(ctx, bankRef, true); !memoryv1.IsOutcome(err, memoryv1.OutcomeConflict) {
		closeFirst()
		t.Fatalf("Cognition bank was not durably deleted before injected Runtime failure: %v", err)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); err != nil {
		closeFirst()
		t.Fatalf("failed Runtime transaction did not restore its in-memory Agent projection: %v", err)
	}
	if !svc.agentDurableTerminationFenced(localRef) {
		closeFirst()
		t.Fatal("partial cross-owner termination did not retain a durable Runtime fence")
	}
	if _, err := svc.cognitionMemoryStore.BindingForAgent(ctx, localRef); err == nil {
		closeFirst()
		t.Fatal("deleted Cognition binding was silently recreated before restart")
	}
	if _, err := svc.backend.DB().Exec(`DROP TRIGGER inject_agent_delete_failure`); err != nil {
		closeFirst()
		t.Fatalf("remove final Runtime delete failure: %v", err)
	}
	closeFirst()

	reopened, _, closeSecond := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	defer closeSecond()
	if _, err := reopened.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: testRuntimeAgentIdentityContext(runtimeSourceRef)}); status.Code(err) != codes.NotFound {
		t.Fatalf("startup did not resume durable termination: status=%s err=%v", status.Code(err), err)
	}
	if _, err := reopened.cognitionMemoryStore.BindingForAgent(ctx, localRef); err == nil {
		t.Fatal("startup recovery rebuilt an empty Cognition bank for the terminated Agent")
	}
}
