package runtimeagent

import (
	"context"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
	"time"
)

func TestBackgroundBudgetFailureDefersOnlyItsPurpose(t *testing.T) {
	for _, source := range []string{"life_planning", "contact_judgment"} {
		t.Run(source, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			now := time.Now().UTC()
			_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Agent.Autonomy.Enabled = true
				e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM
				e.Agent.Autonomy.Config.FreeContactEnabled = true
				e.Life.NextCheckAt, e.Life.ContactNextAt = now.Add(time.Hour), now.Add(2*time.Hour)
				return nil, nil, nil
			})
			before, _ := svc.agentByID(ref)
			work := svc.claimAgentBackgroundFor(context.Background(), ref, source)
			defer svc.releaseAgentBackground(ref, work)
			svc.recordLifePlanningFailure(work, before, &lifeBudgetUnavailable{minimum: true}, 0)
			after, _ := svc.agentByID(ref)
			window := before.Agent.Autonomy.WindowStartedAt.AsTime().Add(24 * time.Hour)
			if source == "life_planning" {
				if !after.Life.NextCheckAt.Equal(window) || !after.Life.ContactNextAt.Equal(before.Life.ContactNextAt) || !after.Life.LifeBudgetWaiting || after.Life.ContactBudgetWaiting {
					t.Fatal("life budget failure blocked contact")
				}
			} else if !after.Life.ContactNextAt.Equal(window) || !after.Life.NextCheckAt.Equal(before.Life.NextCheckAt) || !after.Life.ContactBudgetWaiting || after.Life.LifeBudgetWaiting {
				t.Fatal("contact budget failure blocked life")
			}
		})
	}
}

func TestLateContactFailureKeepsCostWithoutReschedulingRetiredWork(t *testing.T) {
	for _, sourceChanged := range []bool{false, true} {
		t.Run(map[bool]string{false: "disabled", true: "reopened"}[sourceChanged], func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Agent.Autonomy.Config.FreeContactEnabled = true
				return nil, nil, nil
			})
			before, _ := svc.agentByID(ref)
			work := svc.claimAgentBackgroundFor(context.Background(), ref, "contact_judgment")
			defer svc.releaseAgentBackground(ref, work)
			nextAt := time.Time{}
			if sourceChanged {
				nextAt = time.Now().UTC().Add(30 * time.Minute)
			} else {
				work.cancel()
			}
			_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Agent.Autonomy.Config.FreeContactEnabled = sourceChanged
				e.Life.ContactEpoch++
				e.Life.ContactNextAt = nextAt
				return nil, nil, nil
			})
			svc.recordLifePlanningFailure(work, before, errors.New("late provider failure"), 17)
			after, _ := svc.agentByID(ref)
			if after.Agent.Autonomy.UsedTokensInWindow != before.Agent.Autonomy.UsedTokensInWindow+17 || !after.Life.ContactNextAt.Equal(nextAt) {
				t.Fatal("late failure lost cost or rewrote the new contact opportunity")
			}
		})
	}
}

func TestBudgetIncreaseResumesOnlyBlockedPurposeEvenDuringInteraction(t *testing.T) {
	for _, contact := range []bool{false, true} {
		t.Run(map[bool]string{false: "life", true: "contact"}[contact], func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			now := time.Now().UTC()
			_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Agent.Autonomy.Enabled = true
				e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM
				e.Agent.Autonomy.Config.FreeContactEnabled = true
				e.Life.LifeBudgetWaiting, e.Life.ContactBudgetWaiting = !contact, contact
				e.Life.NextCheckAt, e.Life.ContactNextAt = now.Add(time.Hour), now.Add(2*time.Hour)
				_, err := e.Life.beginInteraction("user-turn", now, false, false)
				return nil, nil, err
			})
			before, _ := svc.agentByID(ref)
			identity, err := validateLocalAgentIdentity(before.Agent.OwnerUserId, before.Agent.RuntimeSourceRef, ref)
			if err != nil {
				t.Fatal(err)
			}
			config := proto.Clone(before.Agent.Autonomy.Config).(*runtimev1.AgentAutonomyConfig)
			config.DailyTokenBudget *= 2
			if _, err := svc.updateAgentAutonomyCAS(identity, before.Agent.Autonomy.Revision, agentAutonomyMutationIntent{config: config}); err != nil {
				t.Fatal(err)
			}
			after, _ := svc.agentByID(ref)
			if after.Life.LifeBudgetWaiting || after.Life.ContactBudgetWaiting || after.Life.Interaction == nil {
				t.Fatal("budget recovery retained a wait or erased the interaction")
			}
			if contact {
				if after.Life.ContactNextAt.After(time.Now().UTC()) || !after.Life.NextCheckAt.Equal(before.Life.NextCheckAt) {
					t.Fatal("contact budget recovery changed life scheduling")
				}
			} else if after.Life.NextCheckAt.After(time.Now().UTC()) || !after.Life.ContactNextAt.Equal(before.Life.ContactNextAt) {
				t.Fatal("life budget recovery changed contact cadence")
			}
		})
	}
}

func TestInvalidLifeOutputWaitsForNormalPlanningOpportunity(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_HIGH
		e.Agent.Autonomy.Config.DailyTokenBudget = 0
		return nil, nil, nil
	})
	entry, _ := svc.agentByID(ref)
	work := svc.claimAgentBackground(context.Background(), ref)
	defer svc.releaseAgentBackground(ref, work)
	svc.recordLifePlanningFailure(work, entry, errors.New("invalid model output"), 17)
	after, _ := svc.agentByID(ref)
	if after.Life.canPlanAt(time.Now().Add(time.Minute), 1) ||
		after.Agent.Autonomy.UsedTokensInWindow != entry.Agent.Autonomy.UsedTokensInWindow+17 {
		t.Fatal("invalid output caused a rapid retry or lost incurred usage")
	}
}

func TestForegroundYieldDoesNotBackoffLifePlanning(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM
		return nil, nil, nil
	})
	entry, _ := svc.agentByID(ref)
	work := svc.claimAgentBackground(context.Background(), ref)
	ready := make(chan func(), 1)
	go func() { release, _ := svc.yieldAgentBackground(context.Background(), ref); ready <- release }()
	select {
	case <-work.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("yield did not cancel")
	}
	svc.recordLifePlanningFailure(work, entry, context.Canceled, 17)
	after, _ := svc.agentByID(ref)
	if !after.Life.NextCheckAt.Equal(entry.Life.NextCheckAt) || after.Life.WaitReason != entry.Life.WaitReason || after.Agent.Autonomy.UsedTokensInWindow != entry.Agent.Autonomy.UsedTokensInWindow+17 {
		t.Fatal("normal yield became planning failure or lost usage")
	}
	svc.releaseAgentBackground(ref, work)
	(<-ready)()
}

func TestConfirmationAndBackgroundCannotStartImageOrFollowUp(t *testing.T) {
	session := publicChatAnchorState{Bindings: map[string]publicChatExecutionBinding{"image.generate": {ModelID: "image", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL}}}
	for _, actions := range []publicChatAvailableActions{{TextOnly: true, ImageGenerate: publicChatImageActionAvailable}, {ImageGenerate: publicChatImageActionNotConfigured}} {
		if _, err := validateImageActionExecutionBinding(session, publicChatTurnState{AvailableActions: actions}, publicChatStructuredAction{Operation: "image.generate"}); err == nil {
			t.Fatal("forbidden image action admitted")
		}
	}
	structured, _ := parsePublicChatStructuredEnvelope(`<message intent="reply">Saved.</message><time-hook><delay-ms>1000</delay-ms></time-hook>`)
	// No service is needed: the denied phase must return before scheduling.
	result := (publicChatRuntime{}).applyPostTurn(context.Background(), session, publicChatTurnState{AvailableActions: publicChatAvailableActions{TextOnly: true, FollowUpEnabled: true}}, publicChatTurnRequestPayload{}, structured)
	if result.FollowUp.Status != "skipped" {
		t.Fatal("confirmation scheduled another action")
	}
}
