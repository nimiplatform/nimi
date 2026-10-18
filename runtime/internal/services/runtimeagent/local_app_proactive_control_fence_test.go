package runtimeagent

import (
	"context"
	"encoding/json"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Reuses the existing owner fixtures. The admitted call is invalidated before
// owner execution, exactly the context/signal supplied by protected admission
// after session invalidation. This does not emulate registration SQL or UI.
func TestProactiveControlRejectsInvalidatedCall(t *testing.T) {
	t.Run("conversation policy", func(t *testing.T) {
		svc := newRuntimeAgentServiceForPublicChatTest(t)
		anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
		decision := localAppConversationDecision(accountservice.LocalAppOperationConversationFollowUpPolicyUpdate, 0x51, "user-1")
		invalidated := make(chan struct{})
		decision.SessionInvalidated = invalidated
		ctx, cancel := context.WithCancel(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision))
		close(invalidated)
		cancel()
		response, err := svc.UpdateLocalAppConversationFollowUpPolicy(ctx, &runtimev1.UpdateLocalAppConversationFollowUpPolicyRequest{
			AgentHandle:          mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")),
			ConversationAnchorId: anchorID, ExpectedRevision: 0, Enabled: true,
		})
		svc.chatSurfaceMu.Lock()
		enabled := svc.chatAnchors[anchorID].FollowUpEnabled
		svc.chatSurfaceMu.Unlock()
		var persisted string
		if readErr := svc.backend.DB().QueryRow(`SELECT anchor_json FROM runtime_conversation_anchor WHERE anchor_id=?`, anchorID).Scan(&persisted); readErr != nil {
			t.Fatal(readErr)
		}
		var anchor publicChatAnchorState
		if e := json.Unmarshal([]byte(persisted), &anchor); e != nil {
			t.Fatal(e)
		}
		if err == nil || enabled || anchor.FollowUpEnabled {
			t.Fatalf("invalidated policy call committed: err=%v response_enabled=%v owner_enabled=%v persisted_bytes=%d", err, response.GetState().GetFollowUpEnabled(), enabled, len(persisted))
		}
	})
	t.Run("agent pending TIME cancellation", func(t *testing.T) {
		svc := newRuntimeAgentServiceForPublicChatTest(t)
		agentID := testRuntimeAgentLocalRef("agent-alpha")
		now := time.Now().UTC()
		intent := timeHookIntentForDelay(agentID, time.Hour, "closure audit isolated fixture")
		intent.IntentId = "closure-audit-pending"
		if err := svc.admitPendingHook(agentID, &runtimev1.PendingHook{Intent: intent, ScheduledFor: timestamppb.New(now.Add(time.Hour)), AdmittedAt: timestamppb.New(now)}); err != nil {
			t.Fatal(err)
		}
		entry, err := svc.agentByID(agentID)
		if err != nil {
			t.Fatal(err)
		}
		revision := entry.Hooks[intent.IntentId].GetRevision()
		decision := localAppConversationDecision(accountservice.LocalAppOperationAgentPendingHookUpdate, 0x51, "user-1")
		decision.OperationCapability = "agent.configure"
		invalidated := make(chan struct{})
		decision.SessionInvalidated = invalidated
		ctx, cancel := context.WithCancel(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision))
		close(invalidated)
		cancel()
		_, err = svc.UpdateLocalAppAgentPendingHook(ctx, &runtimev1.UpdateLocalAppAgentPendingHookRequest{
			AgentHandle: mintLocalAppAgentHandle(decision, agentID), TaskId: intent.IntentId, ExpectedRevision: revision,
			Action: runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_CANCEL,
		})
		var status int
		if readErr := svc.backend.DB().QueryRow(`SELECT status FROM runtime_local_agent_hook WHERE local_agent_ref=? AND hook_id=?`, agentID, intent.IntentId).Scan(&status); readErr != nil {
			t.Fatal(readErr)
		}
		if err == nil || runtimev1.HookAdmissionState(status) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
			t.Fatalf("invalidated task call committed: err=%v durable_status=%v", err, runtimev1.HookAdmissionState(status))
		}
	})
}

func TestConversationControlsReauthorizeAtCommitAndKeepPendingTimer(t *testing.T) {
	for _, policy := range []bool{false, true} {
		t.Run(map[bool]string{false: "pending-task", true: "policy"}[policy], func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			anchorID := openEnabledPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			turnID := reserveConversationPublicationTestTurn(t, svc, anchorID)
			svc.chatSurfaceMu.Lock()
			session := *svc.chatAnchors[anchorID]
			turn := *svc.chatTurns[turnID]
			svc.chatSurfaceMu.Unlock()
			structured, err := parsePublicChatStructuredEnvelope(`<message>body</message><time-hook><delay-ms>3600000</delay-ms><effect kind="follow-up-turn"><prompt-text>later</prompt-text></effect></time-hook>`)
			if err != nil {
				t.Fatal(err)
			}
			assignPublicChatOutputIdentities(structured, turnID)
			outcome := svc.schedulePublicChatFollowUp(session, turn, publicChatTurnRequestPayload{}, structured)
			if outcome.Status != "scheduled" {
				t.Fatalf("schedule=%+v", outcome)
			}
			canceled := false
			svc.chatSurfaceMu.Lock()
			pending := svc.chatFollowUps[outcome.FollowUpID]
			pending.Cancel = func() { canceled = true }
			before := *svc.chatAnchors[anchorID]
			svc.chatSurfaceMu.Unlock()
			op := accountservice.LocalAppOperationConversationFollowUpUpdate
			ingress := localappop.IngressConversationFollowUpUpdate
			if policy {
				op = accountservice.LocalAppOperationConversationFollowUpPolicyUpdate
				ingress = localappop.IngressConversationFollowUpPolicyUpdate
			}
			decision := localAppConversationDecision(op, 0x51, "user-1")
			ctx, cancel := context.WithCancel(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision))
			defer cancel()
			visited := false
			svc.SetLocalAppIngressRevalidator(voiceCommitTestFence{beforeCommit: func() { visited = true; cancel() }, authorize: func(c context.Context, got localappop.Ingress) (context.Context, error) {
				if got != ingress {
					t.Fatalf("ingress=%v", got)
				}
				return accountservice.ContextWithAuthorizedLocalAppDecision(c, decision), nil
			}})
			handle := mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
			if policy {
				_, err = svc.UpdateLocalAppConversationFollowUpPolicy(ctx, &runtimev1.UpdateLocalAppConversationFollowUpPolicyRequest{AgentHandle: handle, ConversationAnchorId: anchorID, ExpectedRevision: before.FollowUpPolicyRevision, Enabled: false})
			} else {
				_, err = svc.UpdateLocalAppConversationFollowUp(ctx, &runtimev1.UpdateLocalAppConversationFollowUpRequest{AgentHandle: handle, ConversationAnchorId: anchorID, TaskId: pending.FollowUpID, ExpectedRevision: pending.Revision, Action: runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_CANCEL})
			}
			svc.chatSurfaceMu.Lock()
			after := *svc.chatAnchors[anchorID]
			same := svc.chatFollowUps[pending.FollowUpID] == pending
			svc.chatSurfaceMu.Unlock()
			if err == nil || !visited || canceled || !same || after.FollowUpPolicyRevision != before.FollowUpPolicyRevision || after.LocalAppSequence != before.LocalAppSequence || after.PendingFollowUpID != pending.FollowUpID {
				t.Fatalf("invalidated control changed state: err=%v visited=%v canceled=%v same=%v", err, visited, canceled, same)
			}
		})
	}
}

func TestPendingHookReauthorizesAtSQLCommit(t *testing.T) {
	for _, stale := range []bool{true, false} {
		t.Run(map[bool]string{true: "canceled-at-commit", false: "authorized"}[stale], func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			now := time.Now().UTC()
			intent := timeHookIntentForDelay(ref, time.Hour, "existing non-system activity")
			intent.IntentId = "fence-test-task"
			if err := svc.admitPendingHook(ref, &runtimev1.PendingHook{Intent: intent, ScheduledFor: timestamppb.New(now.Add(time.Hour)), AdmittedAt: timestamppb.New(now)}); err != nil {
				t.Fatal(err)
			}
			entry, err := svc.agentByID(ref)
			if err != nil {
				t.Fatal(err)
			}
			revision := entry.Hooks[intent.IntentId].Revision
			decision := localAppConversationDecision(accountservice.LocalAppOperationAgentPendingHookUpdate, 0x51, "user-1")
			decision.OperationCapability = "agent.configure"
			ctx, cancel := context.WithCancel(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision))
			defer cancel()
			visited := false
			svc.SetLocalAppIngressRevalidator(voiceCommitTestFence{beforeCommit: func() {
				visited = true
				if stale {
					cancel()
				}
			}, authorize: func(c context.Context, ingress localappop.Ingress) (context.Context, error) {
				if ingress != localappop.IngressAgentPendingHookUpdate {
					t.Fatalf("ingress=%v", ingress)
				}
				return accountservice.ContextWithAuthorizedLocalAppDecision(c, decision), nil
			}})
			_, err = svc.UpdateLocalAppAgentPendingHook(ctx, &runtimev1.UpdateLocalAppAgentPendingHookRequest{AgentHandle: mintLocalAppAgentHandle(decision, ref), TaskId: intent.IntentId, ExpectedRevision: revision, Action: runtimev1.LocalAppScheduledTaskAction_LOCAL_APP_SCHEDULED_TASK_ACTION_CANCEL})
			var state int
			if readErr := svc.backend.DB().QueryRow(`SELECT status FROM runtime_local_agent_hook WHERE local_agent_ref=? AND hook_id=?`, ref, intent.IntentId).Scan(&state); readErr != nil {
				t.Fatal(readErr)
			}
			want := runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED
			if stale {
				want = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING
			}
			entry, readErr := svc.agentByID(ref)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if !visited || (err != nil) != stale || runtimev1.HookAdmissionState(state) != want || hookAdmissionState(entry.Hooks[intent.IntentId]) != want {
				t.Fatalf("bad commit: visited=%v err=%v SQL=%v", visited, err, state)
			}
		})
	}
}
