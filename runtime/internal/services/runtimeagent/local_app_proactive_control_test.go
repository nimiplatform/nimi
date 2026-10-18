package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func enablePublicChatTestFollowUps(t *testing.T, svc *Service, anchorID string) {
	t.Helper()
	if svc.localAppIngressRevalidator == nil {
		svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) { return ctx, nil }))
	}
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationFollowUpPolicyUpdate, 0x51, "user-1")
	svc.chatSurfaceMu.Lock()
	revision := svc.chatAnchors[anchorID].FollowUpPolicyRevision
	svc.chatSurfaceMu.Unlock()
	if _, err := svc.UpdateLocalAppConversationFollowUpPolicy(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.UpdateLocalAppConversationFollowUpPolicyRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID, ExpectedRevision: revision, Enabled: true}); err != nil {
		t.Fatal(err)
	}
}
func openEnabledPublicChatTestAnchor(t *testing.T, svc *Service, agentID, callerAppID, subjectUserID string) string {
	t.Helper()
	id := openPublicChatTestAnchor(t, svc, agentID, callerAppID, subjectUserID)
	enablePublicChatTestFollowUps(t, svc, id)
	return id
}

func TestConversationFollowUpPolicyIsDefaultOffAndControlFailureKeepsTimer(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	state := svc.localAppConversationStateLocked(svc.chatAnchors[anchorID])
	svc.chatSurfaceMu.Unlock()
	if state.FollowUpEnabled || state.MaxFollowUpTurns != 8 {
		t.Fatalf("default policy=%+v", state)
	}
	enablePublicChatTestFollowUps(t, svc, anchorID)
	turnID := reserveConversationPublicationTestTurn(t, svc, anchorID)
	svc.chatSurfaceMu.Lock()
	session := *svc.chatAnchors[anchorID]
	turn := *svc.chatTurns[turnID]
	svc.chatSurfaceMu.Unlock()
	structured, err := parsePublicChatStructuredEnvelope(`<message>body</message><time-hook><delay-ms>3600000</delay-ms><effect kind="follow-up-turn"><prompt-text>continue privately</prompt-text></effect></time-hook>`)
	if err != nil {
		t.Fatal(err)
	}
	assignPublicChatOutputIdentities(structured, turnID)
	outcome := svc.schedulePublicChatFollowUp(session, turn, publicChatTurnRequestPayload{}, structured)
	if outcome.Status != "scheduled" {
		t.Fatalf("schedule=%+v", outcome)
	}
	canceled := 0
	svc.chatSurfaceMu.Lock()
	pending := svc.chatFollowUps[outcome.FollowUpID]
	pending.Cancel = func() { canceled++ }
	revision := pending.Revision
	svc.chatSurfaceMu.Unlock()
	if _, err := svc.backend.DB().Exec(`CREATE TRIGGER reject_followup_cancel BEFORE UPDATE ON runtime_conversation_followup BEGIN SELECT RAISE(FAIL, 'save unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationFollowUpUpdate, 0x51, "user-1")
	req := &runtimev1.UpdateLocalAppConversationFollowUpRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID, TaskId: outcome.FollowUpID, ExpectedRevision: revision, Action: runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_CANCEL}
	callCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	if _, err := svc.UpdateLocalAppConversationFollowUp(callCtx, req); err == nil {
		t.Fatal("failed save reported canceled")
	}
	svc.chatSurfaceMu.Lock()
	same := svc.chatFollowUps[outcome.FollowUpID] == pending && svc.chatAnchors[anchorID].PendingFollowUpID == outcome.FollowUpID
	svc.chatSurfaceMu.Unlock()
	if !same || canceled != 0 {
		t.Fatalf("failed cancel destroyed timer: same=%v canceled=%d", same, canceled)
	}
	if _, err := svc.backend.DB().Exec(`DROP TRIGGER reject_followup_cancel`); err != nil {
		t.Fatal(err)
	}
	changed, err := svc.UpdateLocalAppConversationFollowUp(callCtx, req)
	if err != nil || changed.State.PendingFollowUp != nil || canceled != 1 {
		t.Fatalf("durable cancel=%+v err=%v count=%d", changed, err, canceled)
	}
	if _, err := svc.UpdateLocalAppConversationFollowUp(callCtx, req); err == nil {
		t.Fatal("already canceled task was reported as newly canceled")
	}
}

func TestPendingHookControlDoesNotTrustModelReasonAndCannotEditCadence(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	agentID := testRuntimeAgentLocalRef("agent-alpha")
	now := time.Now().UTC()
	intent := timeHookIntentForDelay(agentID, time.Hour, autonomyCadenceHookReason)
	intent.IntentId = "model-reason-task"
	if err := svc.admitPendingHook(agentID, &runtimev1.PendingHook{Intent: intent, ScheduledFor: timestamppb.New(now.Add(time.Hour)), AdmittedAt: timestamppb.New(now)}); err != nil {
		t.Fatal(err)
	}
	decision := localAppConversationDecision(accountservice.LocalAppOperationAgentPendingHooksList, 0x51, "user-1")
	decision.OperationCapability = "agent.configure"
	handle := mintLocalAppAgentHandle(decision, agentID)
	list, err := svc.ListLocalAppAgentPendingHooks(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.ListLocalAppAgentPendingHooksRequest{AgentHandle: handle})
	if err != nil {
		t.Fatal(err)
	}
	var task *runtimev1.LocalAppAgentPendingHook
	for _, item := range list.Hooks {
		if item.TaskId == "model-reason-task" {
			task = item
		}
	}
	if task == nil || task.SystemCadence || !task.CanModify {
		t.Fatalf("model reason acquired system authority: %+v", task)
	}
	if err := svc.mutateAgent(agentID, func(entry *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		entry.Hooks[task.TaskId].RuntimeCadence = true
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	decision.Operation = localappop.OperationAgentPendingHookUpdate
	if _, err := svc.UpdateLocalAppAgentPendingHook(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), &runtimev1.UpdateLocalAppAgentPendingHookRequest{AgentHandle: handle, TaskId: task.TaskId, ExpectedRevision: task.Revision + 1, Action: runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_CANCEL}); err == nil {
		t.Fatal("system cadence was editable")
	}
	entry, err := svc.agentByID(agentID)
	if err != nil {
		t.Fatal(err)
	}
	if hookAdmissionState(entry.Hooks[task.TaskId]) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
		t.Fatal("rejected control changed system task")
	}
}

func TestCanceledLifeTrackInvalidResultChargesUsageWithoutRevivingActivity(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	agentID := testRuntimeAgentLocalRef("agent-alpha")
	now := time.Now().UTC()
	intent := timeHookIntentForDelay(agentID, time.Second, "test activity")
	intent.IntentId = "late-result"
	if err := svc.admitPendingHook(agentID, &runtimev1.PendingHook{Intent: intent, ScheduledFor: timestamppb.New(now), AdmittedAt: timestamppb.New(now)}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.markHookRunningAt(agentID, intent.IntentId, now); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.cancelHook(agentID, intent.IntentId, "test user", "stop"); err != nil {
		t.Fatal(err)
	}
	before, err := svc.agentByID(agentID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.lifeTrackController().applyResult(context.Background(), agentID, intent.IntentId, &lifeTurnResult{NextHookIntent: &runtimev1.HookIntent{}, TokensUsed: 7}, now); err != nil {
		t.Fatal(err)
	}
	after, err := svc.agentByID(agentID)
	if err != nil {
		t.Fatal(err)
	}
	if hookAdmissionState(after.Hooks[intent.IntentId]) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED || len(after.Hooks) != len(before.Hooks) || after.Agent.Autonomy.Enabled != before.Agent.Autonomy.Enabled {
		t.Fatal("late result revived canceled activity or changed autonomy")
	}
	if after.Agent.Autonomy.UsedTokensInWindow != before.Agent.Autonomy.UsedTokensInWindow+7 {
		t.Fatalf("actual usage lost: before=%d after=%d", before.Agent.Autonomy.UsedTokensInWindow, after.Agent.Autonomy.UsedTokensInWindow)
	}
}
