package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestRuntimeAgentCurrentEmotionTransitionRules(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	if _, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		AgentId: "agent-emotion-state",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	entry, err := svc.agentByID("agent-emotion-state")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	origin := stateEventOrigin{
		ConversationAnchorID: "anchor-emotion",
		OriginatingTurnID:    "turn-emotion",
		OriginatingStreamID:  "stream-emotion",
	}
	now := time.Date(2026, 4, 26, 0, 0, 0, 0, time.UTC)
	event, err := svc.applyCurrentEmotionTransition(entry, "joy", "chat_status_cue", origin, now)
	if err != nil {
		t.Fatalf("applyCurrentEmotionTransition: %v", err)
	}
	if event == nil {
		t.Fatal("expected first emotion transition event")
	}
	if got := entry.State.GetCurrentEmotion(); got != "joy" {
		t.Fatalf("expected current emotion joy, got %q", got)
	}
	detail := event.GetState()
	if detail.GetCurrentEmotion() != "joy" || detail.GetPreviousEmotion() != "" || detail.GetEmotionSource() != "chat_status_cue" {
		t.Fatalf("unexpected emotion event detail: %#v", detail)
	}
	if detail.GetConversationAnchorId() != "anchor-emotion" || detail.GetOriginatingTurnId() != "turn-emotion" || detail.GetOriginatingStreamId() != "stream-emotion" {
		t.Fatalf("expected origin linkage on emotion event, got %#v", detail)
	}
	duplicate, err := svc.applyCurrentEmotionTransition(entry, "joy", "chat_status_cue", origin, now.Add(time.Second))
	if err != nil {
		t.Fatalf("duplicate emotion transition errored: %v", err)
	}
	if duplicate != nil {
		t.Fatalf("expected duplicate emotion transition to emit no event, got %#v", duplicate)
	}
	if _, err := svc.applyCurrentEmotionTransition(entry, "curious", "chat_status_cue", origin, now); err == nil || !strings.Contains(err.Error(), "not admitted") {
		t.Fatalf("expected invalid emotion rejection, got %v", err)
	}
	if _, err := svc.applyCurrentEmotionTransition(entry, "calm", "", origin, now); err == nil || !strings.Contains(err.Error(), "source is required") {
		t.Fatalf("expected missing source rejection, got %v", err)
	}
	clearEvent, err := svc.clearCurrentEmotion(entry, stateEventOrigin{}, now.Add(2*time.Second))
	if err != nil {
		t.Fatalf("clearCurrentEmotion: %v", err)
	}
	if clearEvent == nil || entry.State.GetCurrentEmotion() != neutralCurrentEmotion {
		t.Fatalf("expected clear to replace emotion with neutral, event=%#v state=%q", clearEvent, entry.State.GetCurrentEmotion())
	}
}

func TestRuntimeAgentEmotionDecayDoesNotOverrideNewerTruth(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	if _, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		AgentId: "agent-emotion-decay",
	}); err != nil {
		t.Fatalf("InitializeAgent: %v", err)
	}
	entry, err := svc.agentByID("agent-emotion-decay")
	if err != nil {
		t.Fatalf("agentByID: %v", err)
	}
	now := time.Date(2026, 4, 26, 0, 0, 0, 0, time.UTC)
	if _, err := svc.applyCurrentEmotionTransition(entry, "joy", "chat_status_cue", stateEventOrigin{}, now); err != nil {
		t.Fatalf("apply joy: %v", err)
	}
	if _, err := svc.applyCurrentEmotionTransition(entry, "calm", "runtime", stateEventOrigin{}, now.Add(time.Second)); err != nil {
		t.Fatalf("apply calm: %v", err)
	}
	stale, err := svc.decayCurrentEmotion(entry, "joy", stateEventOrigin{}, now.Add(2*time.Second))
	if err != nil {
		t.Fatalf("stale decay errored: %v", err)
	}
	if stale != nil || entry.State.GetCurrentEmotion() != "calm" {
		t.Fatalf("stale decay must not override newer emotion, event=%#v state=%q", stale, entry.State.GetCurrentEmotion())
	}
	decayed, err := svc.decayCurrentEmotion(entry, "calm", stateEventOrigin{}, now.Add(3*time.Second))
	if err != nil {
		t.Fatalf("current decay errored: %v", err)
	}
	if decayed == nil || decayed.GetState().GetCurrentEmotion() != neutralCurrentEmotion || decayed.GetState().GetEmotionSource() != "decay" {
		t.Fatalf("expected decay to neutral event, got %#v", decayed)
	}
	if got := entry.State.GetCurrentEmotion(); got != neutralCurrentEmotion {
		t.Fatalf("expected current emotion neutral after decay, got %q", got)
	}
}
