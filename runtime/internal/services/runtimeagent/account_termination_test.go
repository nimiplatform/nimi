package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	cognitionservice "github.com/nimiplatform/nimi/runtime/internal/services/cognition"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type failNthSourceCognitionDelete struct {
	*sourceCognitionBridgeStub
	failOn      int
	deleteCalls int
}

func (b *failNthSourceCognitionDelete) DeleteAgentSource(ctx context.Context, accountID, scopeID, snapshot string) (cognitionservice.AgentSourceOutcome, error) {
	b.deleteCalls++
	if b.failOn > 0 && b.deleteCalls == b.failOn {
		return cognitionservice.AgentSourceOutcome{}, errors.New("injected source Cognition delete failure")
	}
	return b.sourceCognitionBridgeStub.DeleteAgentSource(ctx, accountID, scopeID, snapshot)
}

func observedRealmAccountDeletedResult(t *testing.T, accountID, operationID string, deletedAt time.Time) accountservice.ObservedRealmAccountDeletedResult {
	t.Helper()
	result, err := accountservice.NewObservedRealmAccountDeletedResult(accountID, operationID, deletedAt, accountservice.RealmAccountDeletedReason)
	if err != nil {
		t.Fatalf("construct observed Realm Account deletion: %v", err)
	}
	return result
}

func materializeAccountTerminationAgent(t *testing.T, svc *Service, accountID, fixture string) *runtimev1.LocalAgentRecord {
	t.Helper()
	result, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testLocalAgentContext(accountID, fixture)})
	if err != nil {
		t.Fatalf("materialize %s/%s: %v", accountID, fixture, err)
	}
	return result.GetAgent()
}

func seedPendingAccountTerminationWork(t *testing.T, svc *Service, agent *runtimev1.LocalAgentRecord) string {
	t.Helper()
	binding, err := svc.cognitionMemoryStore.BindingForAgent(context.Background(), agent.GetLocalAgentRef())
	if err != nil {
		t.Fatalf("load pending-work binding: %v", err)
	}
	envelope := cognitionMemoryMessageEnvelope(
		binding, time.Now().UTC(),
		&runtimev1.CognitionMemorySourceRef{Kind: "conversation_turn", Value: "late-turn-" + agent.GetLocalAgentRef()},
		&runtimev1.CognitionMemorySourceRef{Kind: "conversation", Value: "late-conversation-" + agent.GetLocalAgentRef()},
		publicChatTurnOriginUser, "late Memory work", nil, true,
	)
	operationID := ""
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		item, err := svc.cognitionMemoryStore.EnqueueCommittedEventTx(tx, agent.GetLocalAgentRef(), envelope)
		if err != nil {
			return err
		}
		operationID = item.OperationID
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_, err = tx.Exec(`INSERT INTO runtime_cognition_memory_ai_job(operation_id, local_agent_ref, account_namespace, config_revision, request_key, profile_json, status, created_at, updated_at) VALUES(?, ?, ?, 1, 'late-request', X'01', 'running', ?, ?)`, "late-ai-"+agent.GetLocalAgentRef(), agent.GetLocalAgentRef(), agent.GetOwnerUserId(), now, now)
		return err
	}); err != nil {
		t.Fatalf("seed pending Account termination work: %v", err)
	}
	return operationID
}

func TestRealmAccountDeletionFencesBeforePartialCleanupAndPreservesOtherAccounts(t *testing.T) {
	svc, cognitionOwner := newRuntimeAgentHardDeleteTestService(t)
	targetA := materializeAccountTerminationAgent(t, svc, "acct-target", "target-a")
	targetB := materializeAccountTerminationAgent(t, svc, "acct-target", "target-b")
	survivor := materializeAccountTerminationAgent(t, svc, "acct-survivor", "survivor")
	seedCognitionMemoryForTerminationTest(t, svc, targetA.GetLocalAgentRef(), "I prefer target A tea")
	seedCognitionMemoryForTerminationTest(t, svc, targetB.GetLocalAgentRef(), "I prefer target B tea")
	survivorBank := seedCognitionMemoryForTerminationTest(t, svc, survivor.GetLocalAgentRef(), "I prefer survivor coffee")
	lateOutboxOperations := map[string]string{
		targetA.GetLocalAgentRef(): seedPendingAccountTerminationWork(t, svc, targetA),
		targetB.GetLocalAgentRef(): seedPendingAccountTerminationWork(t, svc, targetB),
	}

	// The snapshot includes non-ACTIVE persisted LocalAgents.
	svc.mu.Lock()
	svc.agents[targetB.GetLocalAgentRef()].Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED
	if err := svc.stateRepo.saveStateLocked(svc); err != nil {
		svc.mu.Unlock()
		t.Fatalf("persist suspended target: %v", err)
	}
	svc.mu.Unlock()

	failingSource := &failNthSourceCognitionDelete{sourceCognitionBridgeStub: &sourceCognitionBridgeStub{}, failOn: 2}
	svc.SetSourceCognitionBridge(failingSource)
	svc.sourceCognitionWG.Wait()
	deletedAt := time.Now().UTC().Truncate(time.Millisecond)
	if err := svc.ConsumeRealmAccountDeletedResult(context.Background(), observedRealmAccountDeletedResult(t, "acct-target", "operation-partial", deletedAt)); err != nil {
		t.Fatalf("durable Account fence was not accepted: %v", err)
	}

	var phase string
	if err := svc.backend.DB().QueryRow(`SELECT phase FROM runtime_realm_account_termination WHERE account_id = 'acct-target' AND operation_id = 'operation-partial'`).Scan(&phase); err != nil || phase != "fenced" {
		t.Fatalf("permanent Account fence phase=%q err=%v", phase, err)
	}
	var completed, pending int
	_ = svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_realm_account_termination_item WHERE operation_id = 'operation-partial' AND phase = 'completed'`).Scan(&completed)
	_ = svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_realm_account_termination_item WHERE operation_id = 'operation-partial' AND phase = 'pending'`).Scan(&pending)
	if completed != 1 || pending != 1 {
		t.Fatalf("partial fan-out state completed=%d pending=%d", completed, pending)
	}
	var remaining realmAccountTerminationItemRow
	if err := svc.backend.DB().QueryRow(`SELECT operation_id, local_agent_ref, owner_account_id, runtime_source_ref, child_operation_id FROM runtime_realm_account_termination_item WHERE operation_id = 'operation-partial' AND phase = 'pending'`).Scan(&remaining.OperationID, &remaining.LocalAgentRef, &remaining.OwnerAccountID, &remaining.RuntimeSourceRef, &remaining.ChildOperationID); err != nil {
		t.Fatalf("load remaining child: %v", err)
	}
	var memoryState, outboxState, aiState, aiFailure string
	var payloadPresent, resultPresent bool
	if err := svc.backend.DB().QueryRow(`SELECT state FROM runtime_cognition_memory_agent WHERE local_agent_ref = ?`, remaining.LocalAgentRef).Scan(&memoryState); err != nil || memoryState != "terminating" {
		t.Fatalf("remaining Memory fence state=%q err=%v", memoryState, err)
	}
	if err := svc.backend.DB().QueryRow(`SELECT state, payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE operation_id = ?`, lateOutboxOperations[remaining.LocalAgentRef]).Scan(&outboxState, &payloadPresent); err != nil || outboxState != "terminated" || payloadPresent {
		t.Fatalf("remaining outbox state=%q payload=%v err=%v", outboxState, payloadPresent, err)
	}
	if err := svc.backend.DB().QueryRow(`SELECT status, failure_code, result_json IS NOT NULL FROM runtime_cognition_memory_ai_job WHERE local_agent_ref = ?`, remaining.LocalAgentRef).Scan(&aiState, &aiFailure, &resultPresent); err != nil || aiState != "failed" || aiFailure != string(memoryv1.DeleteReasonAccountTermination) || resultPresent {
		t.Fatalf("remaining AI state=%q failure=%q result=%v err=%v", aiState, aiFailure, resultPresent, err)
	}
	if _, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{Context: &runtimev1.AgentRequestContext{OwnerUserId: remaining.OwnerAccountID, SubjectUserId: remaining.OwnerAccountID, RuntimeSourceRef: remaining.RuntimeSourceRef, LocalAgentRef: remaining.LocalAgentRef}, SubjectUserId: remaining.OwnerAccountID, OwnerUserId: remaining.OwnerAccountID, RuntimeSourceRef: remaining.RuntimeSourceRef, LocalAgentRef: remaining.LocalAgentRef}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("fenced Account opened new turn: %v", err)
	}
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testLocalAgentContext("acct-target", "late-agent")}); err == nil {
		t.Fatal("terminal Account materialized a new LocalAgent")
	}
	newAccountAgent := materializeAccountTerminationAgent(t, svc, "acct-new", "new-account-agent")
	if newAccountAgent.GetOwnerUserId() != "acct-new" {
		t.Fatal("unrelated new Account was changed by target fence")
	}
	if _, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: &runtimev1.AgentRequestContext{OwnerUserId: survivor.GetOwnerUserId(), RuntimeSourceRef: survivor.GetRuntimeSourceRef(), LocalAgentRef: survivor.GetLocalAgentRef()}}); err != nil {
		t.Fatalf("other Account Agent changed during partial fan-out: %v", err)
	}

	failingSource.failOn = 0
	if err := svc.ResumeRealmAccountTerminations(context.Background()); err != nil {
		t.Fatalf("resume partial Realm Account termination: %v", err)
	}
	if err := svc.backend.DB().QueryRow(`SELECT phase FROM runtime_realm_account_termination WHERE account_id = 'acct-target'`).Scan(&phase); err != nil || phase != "completed" {
		t.Fatalf("completed permanent Account fence phase=%q err=%v", phase, err)
	}
	for _, target := range []*runtimev1.LocalAgentRecord{targetA, targetB} {
		if _, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: &runtimev1.AgentRequestContext{OwnerUserId: target.GetOwnerUserId(), RuntimeSourceRef: target.GetRuntimeSourceRef(), LocalAgentRef: target.GetLocalAgentRef()}}); status.Code(err) != codes.NotFound {
			t.Fatalf("target Agent %s remains: %v", target.GetLocalAgentRef(), err)
		}
	}
	memories, err := cognitionOwner.ListMemories(context.Background(), survivorBank, false)
	if err != nil || len(memories) != 1 || memories[0].Content != "I prefer survivor coffee" {
		t.Fatalf("other Account Cognition changed: memories=%+v err=%v", memories, err)
	}
}

func TestRealmAccountDeletionRejectsOrdinaryOrConflictingResultsBeforeCustody(t *testing.T) {
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	target := materializeAccountTerminationAgent(t, svc, "acct-target", "target")
	if err := svc.ConsumeRealmAccountDeletedResult(context.Background(), accountservice.ObservedRealmAccountDeletedResult{}); !errors.Is(err, ErrRealmAccountTerminationConflict) {
		t.Fatalf("ordinary zero result error=%v", err)
	}
	if _, err := accountservice.NewObservedRealmAccountDeletedResult("acct-target", "operation", time.Now().UTC(), "SUSPENDED"); err == nil {
		t.Fatal("ordinary Account status constructed an observed deletion")
	}
	var terminations int
	_ = svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_realm_account_termination`).Scan(&terminations)
	if terminations != 0 {
		t.Fatalf("ordinary result created Account fence count=%d", terminations)
	}
	if _, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: &runtimev1.AgentRequestContext{OwnerUserId: target.GetOwnerUserId(), RuntimeSourceRef: target.GetRuntimeSourceRef(), LocalAgentRef: target.GetLocalAgentRef()}}); err != nil {
		t.Fatalf("ordinary result changed target Agent: %v", err)
	}
}

func TestRealmAccountDeletionReturnsErrorOnlyWhenDurableFenceCannotCommit(t *testing.T) {
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	target := materializeAccountTerminationAgent(t, svc, "acct-fence-failure", "target")
	if _, err := svc.backend.DB().Exec(`CREATE TRIGGER inject_account_fence_failure BEFORE INSERT ON runtime_realm_account_termination BEGIN SELECT RAISE(FAIL, 'injected Account fence failure'); END`); err != nil {
		t.Fatalf("install Account fence failure: %v", err)
	}
	result := observedRealmAccountDeletedResult(t, "acct-fence-failure", "operation-fence-failure", time.Now().UTC().Truncate(time.Millisecond))
	if err := svc.ConsumeRealmAccountDeletedResult(context.Background(), result); err == nil {
		t.Fatal("failed durable Account fence returned success")
	}
	var rows int
	_ = svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_realm_account_termination`).Scan(&rows)
	if rows != 0 {
		t.Fatalf("failed Account fence left custody rows=%d", rows)
	}
	if _, err := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: &runtimev1.AgentRequestContext{OwnerUserId: target.GetOwnerUserId(), RuntimeSourceRef: target.GetRuntimeSourceRef(), LocalAgentRef: target.GetLocalAgentRef()}}); err != nil {
		t.Fatalf("failed Account fence changed existing Agent: %v", err)
	}
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{Context: testLocalAgentContext("acct-fence-failure", "retryable-new-agent")}); err != nil {
		t.Fatalf("failed durable fence leaked a transient Account fence: %v", err)
	}
}

func TestRealmAccountDeletionDuplicateIsIdempotentAndConflictingReplayFails(t *testing.T) {
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	target := materializeAccountTerminationAgent(t, svc, "acct-duplicate", "target")
	deletedAt := time.Now().UTC().Truncate(time.Millisecond)
	result := observedRealmAccountDeletedResult(t, "acct-duplicate", "operation-duplicate", deletedAt)
	if err := svc.ConsumeRealmAccountDeletedResult(context.Background(), result); err != nil {
		t.Fatalf("first observed deletion: %v", err)
	}
	var firstChild string
	if err := svc.backend.DB().QueryRow(`SELECT child_operation_id FROM runtime_realm_account_termination_item WHERE operation_id = 'operation-duplicate' AND local_agent_ref = ?`, target.GetLocalAgentRef()).Scan(&firstChild); err != nil {
		t.Fatalf("load first child identity: %v", err)
	}
	if err := svc.ConsumeRealmAccountDeletedResult(context.Background(), result); err != nil {
		t.Fatalf("exact duplicate observed deletion: %v", err)
	}
	var secondChild string
	var itemCount int
	_ = svc.backend.DB().QueryRow(`SELECT child_operation_id FROM runtime_realm_account_termination_item WHERE operation_id = 'operation-duplicate' AND local_agent_ref = ?`, target.GetLocalAgentRef()).Scan(&secondChild)
	_ = svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_realm_account_termination_item WHERE operation_id = 'operation-duplicate'`).Scan(&itemCount)
	if firstChild == "" || secondChild != firstChild || itemCount != 1 {
		t.Fatalf("duplicate changed stable child first=%q second=%q count=%d", firstChild, secondChild, itemCount)
	}
	changed := observedRealmAccountDeletedResult(t, "acct-duplicate", "operation-conflict", deletedAt)
	if err := svc.ConsumeRealmAccountDeletedResult(context.Background(), changed); !errors.Is(err, ErrRealmAccountTerminationConflict) {
		t.Fatalf("changed operation replay error=%v", err)
	}
	wrongAccount := observedRealmAccountDeletedResult(t, "acct-other", "operation-duplicate", deletedAt)
	if err := svc.ConsumeRealmAccountDeletedResult(context.Background(), wrongAccount); !errors.Is(err, ErrRealmAccountTerminationConflict) {
		t.Fatalf("cross-Account operation replay error=%v", err)
	}
}

func TestRealmAccountDeletionStartupResumesPendingChildrenAndKeepsPermanentFence(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, _, closeFirst := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	firstClosed := false
	defer func() {
		if !firstClosed {
			closeFirst()
		}
	}()
	target := materializeAccountTerminationAgent(t, svc, "acct-restart", "target")
	seedCognitionMemoryForTerminationTest(t, svc, target.GetLocalAgentRef(), "I prefer restart jasmine")
	svc.SetSourceCognitionBridge(&failNthSourceCognitionDelete{sourceCognitionBridgeStub: &sourceCognitionBridgeStub{}, failOn: 1})
	result := observedRealmAccountDeletedResult(t, "acct-restart", "operation-restart", time.Now().UTC().Truncate(time.Millisecond))
	if err := svc.ConsumeRealmAccountDeletedResult(context.Background(), result); err != nil {
		closeFirst()
		firstClosed = true
		t.Fatalf("durable pre-restart fence was not accepted: %v", err)
	}
	var phase string
	if err := svc.backend.DB().QueryRow(`SELECT phase FROM runtime_realm_account_termination WHERE account_id = 'acct-restart'`).Scan(&phase); err != nil || phase != "fenced" {
		closeFirst()
		firstClosed = true
		t.Fatalf("pre-restart fence phase=%q err=%v", phase, err)
	}
	closeFirst()
	firstClosed = true

	reopened, _, closeSecond := openRuntimeAgentTestCompositionWithOwner(t, localStatePath)
	defer closeSecond()
	if err := reopened.backend.DB().QueryRow(`SELECT phase FROM runtime_realm_account_termination WHERE account_id = 'acct-restart'`).Scan(&phase); err != nil || phase != "completed" {
		t.Fatalf("startup recovery phase=%q err=%v", phase, err)
	}
	if _, err := reopened.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: &runtimev1.AgentRequestContext{OwnerUserId: target.GetOwnerUserId(), RuntimeSourceRef: target.GetRuntimeSourceRef(), LocalAgentRef: target.GetLocalAgentRef()}}); status.Code(err) != codes.NotFound {
		t.Fatalf("startup restored terminal Account Agent: %v", err)
	}
	if _, err := materializeRealmSourceTestAgent(t, reopened, context.Background(), &realmSourceTestAgentInput{Context: testLocalAgentContext("acct-restart", "namespace-reuse")}); err == nil {
		t.Fatal("completed permanent fence allowed Account namespace reuse")
	}
	if agent := materializeAccountTerminationAgent(t, reopened, "acct-new-after-restart", "new-account"); agent.GetOwnerUserId() != "acct-new-after-restart" {
		t.Fatal("permanent fence changed unrelated new Account")
	}
}
