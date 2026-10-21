package runtimeagent

import (
	"context"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"math"
	"strings"
	"testing"
	"time"
)

func lifeExecutorTestInput(t *testing.T, cap int64) lifeFrameExecutionInput {
	t.Helper()
	base := agentTurnContextTestInput(t, "personaCharacter")
	now := time.Now().UTC()
	entry := &agentEntry{Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: base.LocalAgentRef, OwnerUserId: "owner", Autonomy: &runtimev1.AgentAutonomyState{Config: &runtimev1.AgentAutonomyConfig{MaxBackgroundOutputTokens: cap}}}, Life: newAgentLifeState()}
	return lifeFrameExecutionInput{Entry: entry, Source: base.Source, Now: now, RequestID: "life-test", Context: projectLifeContext(entry.Life, true, false, nil, now, 1), Binding: publicChatExecutionBinding{ModelID: "local/test", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ContextWindowTokens: 32768, RouteDigest: base.Route.RouteDigest}}
}

func TestLifeFrameExecutorUsesCommonCompilerCommittedRouteAndActualUsage(t *testing.T) {
	input := lifeExecutorTestInput(t, 73)
	// ExecuteScenario's real contract is exercised with a controlled provider
	// result here; live model acceptance is a separate supported product path.
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: &runtimev1.UsageStats{InputTokens: 91, OutputTokens: 17}}}
	ai.response.Output = &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"past":[],"future":[],"explanation":"Resting","contact":"","next_check_minutes":60}`}}}
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.aiBridge.lifeFrameAI = ai
	ref := testRuntimeAgentLocalRef("agent-alpha")
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM
		e.Agent.Autonomy.Config.MaxBackgroundOutputTokens = 73
		e.Agent.Autonomy.Config.DailyTokenBudget = 0
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	input.Entry, _ = svc.agentByID(ref)
	input.Source, _ = svc.turnSourceView(ref)
	input.Context = projectLifeContext(input.Entry.Life, true, false, nil, input.Now, 1)
	input.Work = svc.claimAgentBackground(context.Background(), ref)
	defer svc.releaseAgentBackground(ref, input.Work)
	result, usage, err := svc.executeLifeFrames(context.Background(), &input)
	if err != nil || result == nil || usage != 108 || len(ai.requests) != 1 {
		t.Fatalf("result=%+v usage=%d err=%v", result, usage, err)
	}
	req := ai.requests[0]
	if req.GetSpec().GetTextGenerate().GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		t.Fatal("planner omitted its structured response contract")
	}
	schema := req.GetSpec().GetTextGenerate().GetResponseFormat().GetJsonSchema().AsMap()
	props := schema["properties"].(map[string]any)
	if props["past"].(map[string]any)["maxItems"] != float64(0) {
		t.Fatal("planner can invent past frames without an admitted window")
	}
	if req.GetSpec().GetTextGenerate().GetMaxTokens() != 73 {
		t.Fatal("output cap not carried")
	}
	intent, ok := executionintent.FromContext(ai.contexts[0])
	if !ok || !intent.IsLocal() || intent.CapabilityContract != "text.generate" {
		t.Fatal("committed route lost")
	}
	compiled, err := compileLifeFrameContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if len(compiled.ProviderPrompt.Messages) != 2 || compiled.ProviderPrompt.Messages[0].Role != "system" || compiled.ProviderPrompt.Messages[1].Content != lifeFrameOutputContract {
		t.Fatal("life planner did not compose one system envelope and its Runtime instruction")
	}
	for _, lane := range compiled.PrivateLanes {
		if lane.LaneID == agentTurnContextLaneCurrentUserTurn || lane.LaneID == agentTurnContextLaneConversationHistory {
			for _, item := range lane.Items {
				if item.Included {
					t.Fatal("life invented a conversation")
				}
			}
		}
	}
	ai.response.Output.GetTextGenerate().Text = `not JSON`
	if _, usage, err := svc.executeLifeFrames(context.Background(), &input); err == nil || usage != 108 {
		t.Fatal("invalid model result replaced real usage")
	}
	ai.err = errors.New("configured cap unsupported")
	before := len(ai.requests)
	if _, _, err := svc.executeLifeFrames(context.Background(), &input); err == nil || len(ai.requests) != before+1 {
		t.Fatal("unsupported output cap retried")
	}
	input.Entry.Agent.Autonomy.Config.MaxBackgroundOutputTokens = math.MaxInt64
	before = len(ai.requests)
	if _, _, err := svc.executeLifeFrames(context.Background(), &input); err == nil || len(ai.requests) != before {
		t.Fatal("unrepresentable cap reached executor")
	}
}

func TestLifeFrameJSONRejectsUnreadableAndUnboundedOutput(t *testing.T) {
	for _, raw := range []string{`<message intent="reply">hello</message>`, `{"next_check_minutes":60} {}`, strings.Repeat("x", 16385)} {
		if _, err := decodeLifeFrameResult(raw); err == nil {
			t.Fatalf("accepted %q", raw[:min(60, len(raw))])
		}
	}
	result, err := decodeLifeFrameResult(`{"next_check_minutes":1,"commitment":{},"explanation":"` + strings.Repeat("x", 601) + `","contact":"` + strings.Repeat("x", 161) + `"}`)
	if err != nil || len(result.Future) != 0 || len(result.Past) != 0 || result.Contact != "" || result.Explanation != "" || result.NextCheckMinutes != 15 {
		t.Fatal("unused or invalid optional fields did not degrade locally")
	}
}

func TestLifeBudgetPruningDoesNotSealPastWithOmittedConversation(t *testing.T) {
	input := lifeExecutorTestInput(t, 73)
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	from := input.Now.Add(-time.Hour)
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
		e.Agent.Autonomy.Config.MaxBackgroundOutputTokens = 73
		e.Life.StartedAt, e.Life.SettledAt = from, from
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	input.Entry, _ = svc.agentByID(ref)
	input.Source, _ = svc.turnSourceView(ref)
	input.Source.KnownAt = from.Add(-time.Hour)
	input.Source.LifeFlowRatio = 1
	input.Context = projectLifeContext(input.Entry.Life, true, false, nil, input.Now, 1)
	base, err := compileLifeFrameContext(input)
	if err != nil {
		t.Fatal(err)
	}
	minimum, err := lifeCallEstimate(base)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Config.DailyTokenBudget = int64(minimum) + 200
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	input.Entry, _ = svc.agentByID(ref)
	input.Transcript = []agentTurnTranscriptPairInput{{TurnID: "recent-turn", Sequence: 1, UserText: strings.Repeat("A quiet conversation. ", 100), AssistantText: "I understand."}}
	input.Transcript[0].KnownAt = input.Now
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"past":[],"future":[],"contact":"","next_check_minutes":60}`}}}}}
	svc.aiBridge.lifeFrameAI = ai
	input.Work = svc.claimAgentBackground(context.Background(), ref)
	defer svc.releaseAgentBackground(ref, input.Work)
	if _, _, err := svc.executeLifeFrames(context.Background(), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.Transcript) != 0 || !input.PastFrom.Equal(from) || !strings.Contains(input.Context.Core, "past_window") || len(ai.requests) != 1 {
		t.Fatalf("omitted conversation still narrowed past: transcript=%d from=%v context=%s", len(input.Transcript), input.PastFrom, input.Context.Core)
	}
}

func TestLifeFrameLoopPlansWithoutConversationAndPersistsAcceptedCoverage(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: &runtimev1.UsageStats{InputTokens: 100, OutputTokens: 40}, Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"past":[],"future":[{"title":"Sketch the lake","kind":"project","duration_minutes":60,"end_progress":40,"completes_activity":false}],"explanation":"Continue the landscape","contact":"","next_check_minutes":60}`}}}}}
	svc.aiBridgeMu.Lock()
	svc.aiBridge.lifeFrameAI = ai
	svc.aiBridgeMu.Unlock()
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartLifeFrameLoop(ctx); err != nil {
		t.Fatal(err)
	}
	waitForRuntimeAgentCondition(t, 5*time.Second, func() bool { e, _ := svc.agentByID(ref); return e.Life.Current != nil })
	cancel()
	svc.StopLifeFrameLoop()
	entry, _ := svc.agentByID(ref)
	if entry.Agent.Autonomy.UsedTokensInWindow != 140 || entry.Life.Current.Title != "Sketch the lake" {
		t.Fatalf("loop state: %+v", entry)
	}
	if len(ai.requests) != 1 {
		t.Fatal("coverage caused repeated inference")
	}
	svc.chatSurfaceMu.Lock()
	anchors := len(svc.chatAnchors)
	svc.chatSurfaceMu.Unlock()
	if anchors != 0 {
		t.Fatal("private planning invented a conversation")
	}
	if err := svc.stateRepo.loadAgentLifeState(svc); err != nil {
		t.Fatal(err)
	}
	restored, _ := svc.agentByID(ref)
	if restored.Life.Current != nil || restored.Life.Activities[entry.Life.Current.ActivityRef].Title != "Sketch the lake" || restored.Life.Activities[entry.Life.Current.ActivityRef].Progress != 0 {
		t.Fatal("recovery lost the intention or fabricated offline progress")
	}
}
