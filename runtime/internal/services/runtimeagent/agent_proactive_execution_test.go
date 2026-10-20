package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestContactOnlyUsesOneGenerationForSendOrNoSend(t *testing.T) {
	for _, tc := range []struct {
		name  string
		text  string
		usage int64
	}{
		{"no-send", "", 40},
		{"send", "The evening is quiet here.", 40},
		{"no-send-exhausts-allowance", "", 24000},
		{"send-exhausts-allowance", "The evening is quiet here.", 24000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			text := tc.text
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			raw, _ := json.Marshal(map[string]any{"contact": text, "next_check_minutes": 360})
			ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{
				FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				Usage:        &runtimev1.UsageStats{InputTokens: tc.usage - 10, OutputTokens: 10},
				Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{Text: string(raw)},
				}},
			}}
			svc.aiBridge.lifeFrameAI = ai
			svc.SetPublicChatAppEmitter(newPublicChatEmitCapture().emit)
			svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
				t.Error("contact was generated twice")
				return context.Canceled
			}})
			now := time.Now().UTC()
			if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Agent.Autonomy.Enabled = false
				e.Agent.Autonomy.Config.FreeContactEnabled = true
				e.Agent.Autonomy.Config.DailyTokenBudget = 24000
				e.Life.ContactNextAt = now
				return nil, nil, nil
			}); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := svc.runLifeFrameSweep(context.Background(), now.Add(time.Second)); err != nil {
					t.Fatal(err)
				}
				svc.lifeFrameWG.Wait()
			}
			waitForPublicChatAsyncDrain(t, svc)
			entry, _ := svc.agentByID(ref)
			if len(ai.requests) != 1 || entry.Agent.Autonomy.UsedTokensInWindow != tc.usage ||
				entry.Life.Current != nil || len(entry.Life.Future) != 0 || entry.Life.Interaction != nil {
				t.Fatalf("contact cost or purpose isolation wrong: calls=%d state=%+v", len(ai.requests), entry)
			}
			if entry.Life.ContactConsideredAt.IsZero() || entry.Life.ContactNextAt.Before(now.Add(6*time.Hour)) {
				t.Fatal("completed contact judgment lost its considered position after accounting")
			}
			svc.chatSurfaceMu.Lock()
			defer svc.chatSurfaceMu.Unlock()
			if text == "" {
				if len(svc.chatAnchors) != 0 || len(entry.Life.ContactTimes) != 0 || entry.Life.ContactSinceUser || len(entry.Life.Intents) != 0 {
					t.Fatal("no-send created a Conversation, message or continuation")
				}
			} else {
				if len(svc.chatAnchors) != 1 || len(entry.Life.ContactTimes) != 1 || !entry.Life.ContactSinceUser || len(entry.Life.Intents) != 0 {
					t.Fatal("single generation did not settle exactly one contact")
				}
				for _, anchor := range svc.chatAnchors {
					if len(anchor.CommittedTranscript) != 1 || anchor.CommittedTranscript[0].AssistantText != text {
						t.Fatal("generated contact text was replaced")
					}
				}
			}
		})
	}
}

func TestContactWaitsForAccountWithoutConsumingOpportunity(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:        &runtimev1.UsageStats{InputTokens: 30, OutputTokens: 10},
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"contact":"","next_check_minutes":360}`},
		}},
	}}
	svc.aiBridge.lifeFrameAI = ai
	svc.SetRuntimeAccountProjectionProvider(bundledAvatarTestProjectionProvider{})
	now := time.Now().UTC()
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Config.FreeContactEnabled = true
		e.Life.ContactNextAt = now
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.runLifeFrameSweep(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	entry, _ := svc.agentByID(ref)
	if len(ai.requests) != 0 || entry.Agent.Autonomy.UsedTokensInWindow != 0 || !entry.Life.ContactNextAt.Equal(now) {
		t.Fatal("account preparation consumed or delayed the contact opportunity")
	}
	svc.SetRuntimeAccountProjectionProvider(bundledAvatarTestProjectionProvider{accountID: "user-1"})
	if err := svc.runLifeFrameSweep(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	if len(ai.requests) != 1 {
		t.Fatal("restored account required a new user message to resume")
	}
}

func TestContactGenerationReadsSelectedRecentConversationAndLifeWithoutPlanningWindows(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	var pairs [][2]string
	for index := range 9 {
		pairs = append(pairs, [2]string{fmt.Sprintf("selected-message-%d", index), "A normal reply."})
	}
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	anchor.CommittedTranscript = testPublicChatCommittedTranscript(pairs...)
	anchor.ConversationContext.Revision = 2
	anchor.ConversationContext.FirstTurnSequence = 3
	anchor.ConversationContext.OmitSupplementalContext = true
	svc.chatSurfaceMu.Unlock()
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"contact":"","next_check_minutes":360}`},
		}},
	}}
	svc.aiBridge.lifeFrameAI = ai
	now := time.Now().UTC()
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Config.FreeContactEnabled = true
		e.Life.ContactNextAt = now
		e.Life.Activities["own"] = &lifeActivity{Ref: "own", Title: "own-painting-canary", Kind: "project", Phase: lifePlanned}
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.runLifeFrameSweep(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	svc.lifeFrameWG.Wait()
	if len(ai.requests) != 1 {
		t.Fatal("contact did not use one generation")
	}
	var content strings.Builder
	for _, message := range ai.requests[0].GetSpec().GetTextGenerate().GetInput() {
		content.WriteString(message.GetContent())
	}
	for _, want := range []string{"selected-message-3", "selected-message-8", "own-painting-canary"} {
		if !strings.Contains(content.String(), want) {
			t.Fatalf("contact generation lost eligible context %q", want)
		}
	}
	for _, excluded := range []string{"selected-message-2", `"past_window"`, `"future_window"`} {
		if strings.Contains(content.String(), excluded) {
			t.Fatalf("contact consumed excluded history or simulation instructions %q", excluded)
		}
	}
}

// Owner integration with the existing controlled executor fixture. This is
// not a substitute for the real protected UI/model acceptance journey.
func TestGeneratedContactCommitsOnceWithoutRegenerationOrDoubleCharging(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		t.Error("already generated contact invoked a second model")
		return context.Canceled
	}})
	now := time.Now().UTC()
	var intent lifeProactiveIntent
	err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Config.FreeContactEnabled = true
		e.Agent.Autonomy.Config.DailyTokenBudget = 40
		e.Agent.Autonomy.UsedTokensInWindow = 40
		e.Agent.Autonomy.BudgetExhausted = true
		e.Life.Intents = []lifeProactiveIntent{{ID: "first-contact", Source: "contact", DueAt: now, ExpiresAt: now.Add(time.Hour), Text: "Good morning."}}
		intent = e.Life.Intents[0]
		return nil, nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	svc.chatSurfaceMu.Lock()
	anchors := len(svc.chatAnchors)
	svc.chatSurfaceMu.Unlock()
	if anchors != 0 {
		t.Fatal("configuration opened a Conversation")
	}
	svc.launchLifeProactive(ref, intent)
	capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	entry, err := svc.agentByID(ref)
	if err != nil {
		t.Fatal(err)
	}
	if !entry.Life.ContactSinceUser || len(entry.Life.Intents) != 0 || entry.Agent.Autonomy.UsedTokensInWindow != 40 {
		t.Fatal("message commit did not settle occurrence")
	}
	svc.launchLifeProactive(ref, intent)
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	if len(svc.chatAnchors) != 1 {
		t.Fatal("first contact did not create unique Conversation")
	}
	for _, anchor := range svc.chatAnchors {
		if len(anchor.CommittedTranscript) != 1 || anchor.CommittedTranscript[0].Origin != "contact" || anchor.CommittedTranscript[0].AssistantText != "Good morning." {
			t.Fatalf("wrong proactive transcript: %+v", anchor.CommittedTranscript)
		}
	}
}

func TestGeneratedContactRechecksPermissionAndCancellationAtCommit(t *testing.T) {
	for _, cancelTurn := range []bool{false, true} {
		t.Run(map[bool]string{false: "permission closed", true: "canceled"}[cancelTurn], func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			ref := testRuntimeAgentLocalRef("agent-alpha")
			now := time.Now().UTC()
			intent := lifeProactiveIntent{ID: "prepared", Source: "contact", DueAt: now, ExpiresAt: now.Add(time.Minute), Text: "Hello."}
			_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
				e.Agent.Autonomy.Config.FreeContactEnabled = true
				e.Agent.Autonomy.UsedTokensInWindow = 40
				e.Life.Intents = []lifeProactiveIntent{intent}
				return nil, nil, nil
			})
			capture := newPublicChatEmitCapture()
			svc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
				if req.GetMessageType() == publicChatTurnStartedType {
					if cancelTurn {
						svc.chatSurfaceMu.Lock()
						cancel := svc.chatTurns[svc.chatActiveByAgent[ref]].Cancel
						svc.chatSurfaceMu.Unlock()
						cancel()
					} else {
						_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
							e.Agent.Autonomy.Config.FreeContactEnabled = false
							return nil, nil, nil
						})
					}
				}
				return capture.emit(ctx, req)
			})
			svc.launchLifeProactive(ref, intent)
			entry, _ := svc.agentByID(ref)
			if len(entry.Life.ContactTimes) != 0 || entry.Life.ContactSinceUser || entry.Agent.Autonomy.UsedTokensInWindow != 40 {
				t.Fatal("rejected contact was sent or lost its original generation cost")
			}
			svc.chatSurfaceMu.Lock()
			defer svc.chatSurfaceMu.Unlock()
			if svc.chatActiveByAgent[ref] != "" || svc.backgroundByAgent[ref] != nil {
				t.Fatal("canceled delivery retained an execution slot")
			}
			for _, anchor := range svc.chatAnchors {
				if len(anchor.CommittedTranscript) != 0 {
					t.Fatal("rejected contact committed a message")
				}
			}
		})
	}
}

func TestNewUserInputRetiresPreparedContactButPreservesLifeIntent(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	anchor := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	_ = svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Life.Intents = []lifeProactiveIntent{{ID: "prepared", Source: "contact", Text: "Earlier check-in."}, {ID: "life", Source: "life", Purpose: "Share a drawing"}}
		return nil, nil, nil
	})
	reserveConversationPublicationTestTurn(t, svc, anchor)
	entry, _ := svc.agentByID(ref)
	if len(entry.Life.Intents) != 1 || entry.Life.Intents[0].ID != "life" {
		t.Fatal("new user input kept the stale contact or erased the separate life intention")
	}
}

func TestProactivePreparationOwnsOneCancelableAgentSlot(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetPublicChatAppEmitter(newPublicChatEmitCapture().emit)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
		t.Error("canceled preparation reached inference")
		return context.Canceled
	}})
	ref := testRuntimeAgentLocalRef("agent-alpha")
	now := time.Now().UTC()
	var intent lifeProactiveIntent
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Config.FreeContactEnabled = true
		e.Life.Intents = []lifeProactiveIntent{{ID: "preparation", Source: "contact", DueAt: now, ExpiresAt: now.Add(time.Hour), Text: "Hello"}}
		intent = e.Life.Intents[0]
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	entered, released, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	svc.SetPublicChatBindingResolver(stubPublicChatBindingResolver{resolve: func(ctx context.Context, _ PublicChatBindingResolutionRequest) (PublicChatBindingResolution, error) {
		if calls.Add(1) == 1 {
			close(entered)
		}
		<-released
		return PublicChatBindingResolution{}, ctx.Err()
	}})
	go func() { defer close(finished); svc.launchLifeProactive(ref, intent) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("preparation did not enter binding resolution")
	}
	svc.launchLifeProactive(ref, intent)
	if calls.Load() != 1 {
		t.Fatal("same Agent prepared a duplicate occurrence")
	}
	yielded := make(chan struct{})
	go func() {
		release, err := svc.yieldAgentBackground(context.Background(), ref)
		if err == nil {
			release()
		}
		close(yielded)
	}()
	waitForRuntimeAgentCondition(t, time.Second, func() bool {
		svc.chatSurfaceMu.Lock()
		defer svc.chatSurfaceMu.Unlock()
		return svc.backgroundByAgent[ref] != nil && svc.backgroundByAgent[ref].ctx.Err() != nil
	})
	select {
	case <-yielded:
		t.Fatal("foreground proceeded before preparation released")
	default:
	}
	close(released)
	<-finished
	select {
	case <-yielded:
	case <-time.After(time.Second):
		t.Fatal("foreground remained blocked after actual release")
	}
}
