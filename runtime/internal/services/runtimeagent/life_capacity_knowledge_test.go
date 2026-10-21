package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
)

func TestCapacityPrunedCorrectionDoesNotCloseUnknownPast(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	ctx := context.Background()
	seedCognitionMemoryForTerminationTest(t, svc, ref, "I prefer watercolor cloud studies")
	before, err := svc.cognitionMemoryFacade.Inspect(ctx, cognitionmemory.InspectIntent{LocalAgentRef: ref, Limit: 8})
	if err != nil || len(before.Items) != 1 {
		t.Fatalf("seed: %+v %v", before, err)
	}
	from := time.Now().UTC().Add(-time.Hour)
	if err := svc.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
		e.Agent.Autonomy.Enabled = true
		e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW
		e.Agent.Autonomy.Config.MaxBackgroundOutputTokens = 73
		e.Agent.Autonomy.Config.DailyTokenBudget = 0
		e.Life.StartedAt, e.Life.SettledAt = from, from
		if _, err := acceptSelfIntention(e.Life, &selfIntentionProposal{Action: "adopt", Title: "Watercolor study", Kind: "project"}, from); err != nil {
			return nil, nil, err
		}
		return nil, nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	const canary = "watercolor-correction-canary "
	decision, callCtx := localAppConfigureContext(accountservice.LocalAppOperationMemoryCorrect, 0x53, "user-1")
	corrected, err := svc.CorrectLocalAppAgentMemory(callCtx, &runtimev1.CorrectLocalAppAgentMemoryRequest{AgentHandle: mintLocalAppAgentHandle(decision, ref), MemoryId: before.Items[0].MemoryRef, CorrectedContent: "I prefer " + strings.Repeat(canary, 230) + "cloud studies."})
	if err != nil || corrected.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_ADMITTED {
		t.Fatalf("formal correction: %+v %v", corrected, err)
	}
	svc.cognitionMemoryWG.Wait()
	entry, _ := svc.agentByID(ref)
	if entry.Life.Interaction != nil || !entry.Life.SettledAt.Equal(from) {
		t.Fatalf("correction changed the past/interaction prerequisite: %+v", entry.Life)
	}
	view := projectLifeContext(entry.Life, true, false, nil, time.Now().UTC(), 1)
	query := entry.Agent.GetDisplayName() + " ongoing activities interests " + view.RecallQuery
	recalled, err := svc.cognitionMemoryFacade.Recall(ctx, cognitionmemory.RecallIntent{LocalAgentRef: ref, Query: query, IncludeRecentLife: true, Limit: 8})
	if err != nil || len(recalled.Hits) != 1 || !strings.Contains(recalled.Hits[0].Content, canary) {
		t.Fatalf("Recall corrected Memory: %+v %v", recalled, err)
	}
	input := lifeExecutorTestInput(t, 73)
	input.Entry = entry
	input.Source, _ = svc.turnSourceView(ref)
	// Existing source and empty open life interval are historical state fixtures.
	// The correction's UpdatedAt/KnownAt is obtained from the real Memory owner.
	input.Source.KnownAt = from.Add(-time.Hour)
	input.Source.LifeFlowRatio = 1
	input.Binding.ContextWindowTokens = 16384
	input.Context = projectLifeContext(entry.Life, true, false, nil, input.Now, 1)
	control, err := compileLifeFrameContext(input)
	if err != nil || !strings.Contains(input.Context.Core, "past_window") {
		t.Fatalf("same-capacity source-only positive control: %v", err)
	}
	_ = control
	input.Memory, err = publicChatCognitionMemoryInputs(recalled.Hits)
	if err != nil {
		t.Fatal(err)
	}
	input.ReadSet = recalled.ReadSet
	knownAt := input.Memory[0].KnownAt
	if !knownAt.After(from) {
		t.Fatal("formal correction did not supply later owner knowledge time")
	}
	ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: &runtimev1.UsageStats{InputTokens: 23, OutputTokens: 8}, Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{TextGenerate: &runtimev1.TextGenerateOutput{Text: `{"past":[],"future":[],"explanation":"","contact":"","self_intention":null,"next_check_minutes":60}`}}}}}
	svc.aiBridge.lifeFrameAI = ai
	input.Work = svc.claimAgentBackground(ctx, ref)
	defer svc.releaseAgentBackground(ref, input.Work)
	result, usage, err := svc.executeLifeFrames(ctx, &input)
	if err != nil || len(ai.requests) != 1 {
		t.Fatalf("execution: calls=%d err=%v", len(ai.requests), err)
	}
	for _, m := range ai.requests[0].GetSpec().GetTextGenerate().GetInput() {
		if strings.Contains(m.GetContent(), canary) {
			t.Fatal("precondition: corrected Memory was not pruned")
		}
	}
	if len(input.ReadSet.Refs) != 0 {
		t.Fatalf("precondition: omitted Memory still registered as consumed: %+v", input.ReadSet)
	}
	props := ai.requests[0].GetSpec().GetTextGenerate().GetResponseFormat().GetJsonSchema().AsMap()["properties"].(map[string]any)
	if err := svc.commitLifeFramePlanning(input.Work, input, result, usage); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.agentByID(ref)
	t.Logf("formal correction admitted; no Interaction and SettledAt preserved before call; production life query=%q; real Memory KnownAt=%s; capacity=16384 actual Memory reads=0 canary omitted=true; past.maxItems=%v from=%s PastFrom=%s settled=%s", query, knownAt.Format(time.RFC3339Nano), props["past"].(map[string]any)["maxItems"], from.Format(time.RFC3339Nano), input.PastFrom.Format(time.RFC3339Nano), after.Life.SettledAt.Format(time.RFC3339Nano))
	if !input.PastFrom.Equal(from) || !strings.Contains(input.Context.Core, "past_window") {
		t.Fatal("a real management correction that was not consumed still removed the legal past window")
	}
}

func TestLifeConversationKnowledgeDoesNotMoveWithLateUsage(t *testing.T) {
	svc, session, _, _ := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
	turnID := session.turn.turn.TurnID
	_, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{Event: &runtimev1.AiRealtimeEvent_TextOutput{TextOutput: &runtimev1.AiRealtimeTextOutput{RequestId: turnID, OutputTrackId: "reply", Text: "A quiet afternoon."}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.completeAgentRealtimeTurn(context.Background(), session, nil); err != nil {
		t.Fatal(err)
	}
	before, _, _, err := svc.lifeConversationInput(session.agentID)
	if err != nil || len(before) == 0 || before[len(before)-1].KnownAt.IsZero() {
		t.Fatalf("missing committed knowledge: %+v %v", before, err)
	}
	svc.recordAgentRealtimeUsage(session, turnID, &runtimev1.UsageStats{InputTokens: 23, OutputTokens: 8})
	after, _, _, err := svc.lifeConversationInput(session.agentID)
	if err != nil || !after[len(after)-1].KnownAt.Equal(before[len(before)-1].KnownAt) {
		t.Fatalf("usage rewrote content known time: %+v %v", after, err)
	}
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	projection := svc.chatAnchors[session.conversationAnchorID].CompletedTurnSnapshots[turnID]
	if projection == nil || projection.Usage.GetInputTokens() != 23 || !projection.UpdatedAt.After(before[len(before)-1].KnownAt) {
		t.Fatal("late usage was not actually applied to the terminal projection")
	}
}
