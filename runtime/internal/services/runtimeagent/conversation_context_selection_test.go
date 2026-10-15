package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestConversationContextSelectionPreservesRecordsAndSummaryFallback(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchor := svc.chatAnchors[anchorID]
	for i := 0; i < 10; i++ {
		pair := [2]string{"ordinary question", "ordinary answer"}
		if i == 0 {
			pair[0] = "ghp_" + strings.Repeat("aB3", 12)
		}
		turn := testPublicChatCommittedTranscript(pair)[0]
		turn.Sequence, turn.TurnID = uint64(i), string(rune('a'+i))
		anchor.CommittedTranscript = append(anchor.CommittedTranscript, turn)
	}
	anchor.ConversationSummary = &publicChatConversationSummaryState{
		LastAttempt: publicChatConversationSummaryAttemptState{Status: "failed", TargetSequenceEnd: 3, AttemptedAt: time.Now()},
		LastValid:   &publicChatConversationSummaryValidState{Revision: 1, CoveredSequenceEnd: 0, Text: anchor.CommittedTranscript[0].InputText, GeneratedAt: time.Now(), RouteCorrelation: strings.Repeat("a", 64)},
	}
	anchor.LastTurnSnapshot = &publicChatTurnProjectionState{ReasonCode: runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED}
	before := clonePublicChatCommittedTranscript(anchor.CommittedTranscript)
	decision, ctx := localAppConfigureContext(accountservice.LocalAppOperationUpdateConversationContext, 0x35, "user-1")
	handle := mintLocalAppAgentHandle(decision, anchor.LocalAgentRef)
	req := &runtimev1.UpdateLocalAppAgentConversationContextRequest{AgentHandle: handle, ConversationAnchorId: anchorID, ExpectedContextRevision: 1, FirstTurnSequence: 1, OmitSupplementalContext: true}
	response, err := svc.UpdateLocalAppAgentConversationContext(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetProjection().GetContextRevision() != 2 || response.GetProjection().GetCommittedTurnCount() != 10 {
		t.Fatalf("selection = %v", response)
	}
	if !reflect.DeepEqual(before, anchor.CommittedTranscript) {
		t.Fatal("context selection changed committed history")
	}
	if activeConversationSummary(anchor) != nil {
		t.Fatal("prior summary remained active")
	}
	for _, attempt := range []string{"failed", "unavailable"} {
		anchor.ConversationSummary = &publicChatConversationSummaryState{ContextRevision: 2, LastAttempt: publicChatConversationSummaryAttemptState{Status: attempt, TargetSequenceEnd: 0, AttemptedAt: time.Now()}}
		selected, err := publicChatAgentTurnTranscriptInput(*anchor)
		if err != nil {
			t.Fatal(err)
		}
		for _, turn := range selected {
			if turn.Sequence < 1 || strings.Contains(turn.UserText, "ghp_") {
				t.Fatal("summary fallback restored excluded history")
			}
		}
		input, err := publicChatConversationSummaryInput(anchor, 3)
		if err != nil || strings.Contains(input, "ghp_") || !strings.Contains(input, "[turn 1]") {
			t.Fatalf("summary input: %v %q", err, input)
		}
	}
	// The owner snapshot persists the selection on the same anchor without a
	// replacement transcript or separate inspection record.
	svc.chatSurfaceMu.Lock()
	snapshot, err := svc.capturePublicChatSurfaceSnapshotLocked(anchorID)
	svc.chatSurfaceMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Anchors[0].ConversationContext != anchor.ConversationContext {
		t.Fatal("context selection missing from persistence")
	}
	if _, err := svc.UpdateLocalAppAgentConversationContext(ctx, req); status.Code(err) != codes.Aborted {
		t.Fatalf("stale selection: %v", err)
	}
	req.ExpectedContextRevision = 2
	anchor.ActiveTurnID = "another-surface-turn"
	_, busyErr := svc.UpdateLocalAppAgentConversationContext(ctx, req)
	if reason, _ := grpcerr.ExtractReasonCode(busyErr); reason != runtimev1.ReasonCode_AGENT_BUSY {
		t.Fatalf("active turn: %v", busyErr)
	}
	anchor.ActiveTurnID = ""
	if _, err := svc.UpdateLocalAppAgentConversationContext(context.Background(), req); err == nil {
		t.Fatal("unadmitted caller changed context")
	}
	chatDecision := localAppConfigureDecision(accountservice.LocalAppOperationUpdateConversationContext, 0x35, "user-1")
	chatDecision.OperationCapability = "agent.local"
	chatOnly := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), chatDecision)
	if _, err := svc.UpdateLocalAppAgentConversationContext(chatOnly, req); err == nil {
		t.Fatal("ordinary agent.local operation obtained management authority")
	}
	// Restoring complete input selection is explicit, and does not whitelist
	// the old sensitive value or change the original transcript.
	req.FirstTurnSequence, req.OmitSupplementalContext = 0, false
	if _, err := svc.UpdateLocalAppAgentConversationContext(ctx, req); err != nil {
		t.Fatal(err)
	}
	selected, err := publicChatAgentTurnTranscriptInput(*anchor)
	if err != nil || len(selected) == 0 || !strings.Contains(selected[0].UserText, "ghp_") {
		t.Fatalf("explicit restoration: %v", err)
	}
}

func BenchmarkConversationContextSelectedTranscript(b *testing.B) {
	turns := testPublicChatCommittedTranscript([2]string{"ordinary question", "ordinary answer"})
	anchor := &publicChatAnchorState{}
	for i := 0; i < 1000; i++ {
		turn := turns[0]
		turn.Sequence, turn.TurnID = uint64(i), "turn-"+fmt.Sprint(i)
		anchor.CommittedTranscript = append(anchor.CommittedTranscript, turn)
	}
	for name, first := range map[string]uint64{"full": 0, "selected": 900} {
		b.Run(name, func(b *testing.B) {
			anchor.ConversationContext = publicChatConversationContextSelection{Revision: 2, FirstTurnSequence: first}
			b.ReportAllocs()
			for b.Loop() {
				if _, err := selectedCommittedTranscript(anchor); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestConversationContextRejectsLateSummaryAcrossSelectionRevision(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	id := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchor := svc.chatAnchors[id]
	anchor.CommittedTranscript = testPublicChatCommittedTranscript([2]string{"old", "old answer"}, [2]string{"new", "new answer"})
	anchor.ConversationContext = publicChatConversationContextSelection{Revision: 2, FirstTurnSequence: 1}
	job := &publicChatConversationSummaryJob{ContextRevision: 1}
	svc.chatConversationSummaryJobs = map[string]*publicChatConversationSummaryJob{id: job}
	err := svc.commitPublicChatConversationSummaryForJob(job, id, 1, "late old summary", strings.Repeat("b", 64))
	if err != context.Canceled || anchor.ConversationSummary != nil {
		t.Fatalf("late summary accepted: %v", err)
	}
}

func TestConversationContentRefusalActionUsesIncludedOwnerLanes(t *testing.T) {
	value := "ghp_" + strings.Repeat("aB3", 12)
	item := agentTurnContextItem{Included: true, Segments: []agentTurnContextSegment{{Role: "system", Content: value}}}
	for lane, want := range map[agentTurnContextLaneID]string{
		agentTurnContextLaneCurrentUserTurn:     "edit_current_input",
		agentTurnContextLaneConversationHistory: "adjust_conversation_history",
		agentTurnContextLaneConversationSummary: "adjust_conversation_history",
		agentTurnContextLaneCanonicalMemory:     "adjust_supplemental_context",
		agentTurnContextLanePrivateRecall:       "adjust_supplemental_context",
		agentTurnContextLaneSourceIdentity:      "review_agent_source",
	} {
		compiled := &agentTurnContextCompilation{PrivateLanes: []agentTurnContextLane{{LaneID: lane, Items: []agentTurnContextItem{item}}}}
		if got := conversationContentRefusalAction(compiled); got != want {
			t.Fatalf("lane %s: %s", lane, got)
		}
		compiled.PrivateLanes[0].Items[0].Included = false
		if got := conversationContentRefusalAction(compiled); got != "review_input_or_context" {
			t.Fatalf("omitted lane guided recovery: %s", got)
		}
	}
	compiled := &agentTurnContextCompilation{PrivateLanes: []agentTurnContextLane{
		{LaneID: agentTurnContextLaneCurrentUserTurn, Items: []agentTurnContextItem{item}},
		{LaneID: agentTurnContextLaneConversationHistory, Items: []agentTurnContextItem{item}},
	}}
	if got := conversationContentRefusalAction(compiled); got != "review_input_or_context" {
		t.Fatalf("ambiguous origin suggested reset: %s", got)
	}
}

func TestConversationContextSelectionRollsBackFailedWriteAndRestoresOnRestart(t *testing.T) {
	path := t.TempDir() + "/runtime-state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, path)
	closed := false
	t.Cleanup(func() {
		if !closed {
			closeSvc()
		}
	})
	id := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchor := svc.chatAnchors[id]
	anchor.CommittedTranscript = testPublicChatCommittedTranscript([2]string{"original record", "original answer"})
	before := clonePublicChatCommittedTranscript(anchor.CommittedTranscript)
	svc.chatSurfaceMu.Lock()
	err := svc.persistPublicChatSurfaceStateLocked(id)
	svc.chatSurfaceMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	decision, ctx := localAppConfigureContext(accountservice.LocalAppOperationUpdateConversationContext, 0x41, "user-1")
	req := &runtimev1.UpdateLocalAppAgentConversationContextRequest{
		AgentHandle: mintLocalAppAgentHandle(decision, anchor.LocalAgentRef), ConversationAnchorId: id,
		ExpectedContextRevision: 1, FirstTurnSequence: 1, OmitSupplementalContext: true,
	}
	if _, err := svc.backend.DB().Exec(`CREATE TRIGGER context_test_write_failure BEFORE UPDATE ON runtime_conversation_anchor BEGIN SELECT RAISE(FAIL, 'injected context write failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateLocalAppAgentConversationContext(ctx, req); status.Code(err) != codes.Unavailable {
		t.Fatalf("write failure: %v", err)
	}
	if anchor.ConversationContext != (publicChatConversationContextSelection{}) || !reflect.DeepEqual(before, anchor.CommittedTranscript) {
		t.Fatal("failed persistence changed visible context or transcript")
	}
	if _, err := svc.backend.DB().Exec(`DROP TRIGGER context_test_write_failure`); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateLocalAppAgentConversationContext(ctx, req); err != nil {
		t.Fatal(err)
	}
	closeSvc()
	closed = true
	restored := newRuntimeAgentServiceForPublicChatStatePath(t, path)
	opened := openPublicChatTestAnchor(t, restored, "agent-alpha", "other-app", "user-1")
	if opened != id {
		t.Fatal("reopen created a different Conversation")
	}
	state := restored.chatAnchors[id]
	if state.ConversationContext.FirstTurnSequence != 1 || state.ConversationContext.Revision != 2 || !state.ConversationContext.OmitSupplementalContext || !reflect.DeepEqual(before, state.CommittedTranscript) {
		t.Fatal("restart lost the context choice or changed old records")
	}
}

func TestConversationContextOmissionRemovesSupplementalInputsBeforeCompilation(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	id := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	anchor := clonePublicChatAnchorState(svc.chatAnchors[id])
	anchor.Binding.ContextWindowTokens = 32768
	anchor.Binding.RouteDigest = strings.Repeat("a", 64)
	anchor.ConversationContext = publicChatConversationContextSelection{Revision: 2, OmitSupplementalContext: true}
	req := publicChatTurnRequestPayload{Messages: []publicChatMessagePayload{{Role: "user", Content: "ordinary question"}}, MaxOutputTokens: 1024}
	turn := publicChatTurnState{TurnID: "context-omission-turn", RequestID: "context-omission-request"}
	// This private owner input would fail validation if it reached the compiler.
	// Omission must remove it, not fabricate a successful recall result.
	recall := &agentTurnPrivateRecallInput{Query: "supplemental-secret-marker", Status: "invalid"}
	compiled, err := svc.publicChatRuntime().composePublicChatTurnContextWithRecall(context.Background(), *anchor, turn, req, recall)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Manifest.MemoryItemCount != 0 || compiled.Manifest.PrivateRecallCount != 0 || compiled.Manifest.Cognition.CandidateCount != 0 {
		t.Fatal("supplemental input survived user-selected omission")
	}
	data, _ := json.Marshal(compiled.ProviderPrompt)
	if strings.Contains(string(data), "supplemental-secret-marker") || strings.Contains(string(data), "a Runtime-private recall result is already present") {
		t.Fatal("omission retained or fabricated recall")
	}
	firstRound, err := svc.publicChatRuntime().composePublicChatTurnContext(context.Background(), *anchor, turn, req)
	if err != nil {
		t.Fatal(err)
	}
	for _, prompt := range []*agentTurnContextCompilation{compiled, firstRound} {
		data, _ := json.Marshal(prompt.ProviderPrompt)
		if !strings.Contains(string(data), "Runtime APML contract") || !strings.Contains(string(data), "Supplemental recall is disabled") {
			t.Fatal("Chat must retain its APML contract and explicitly disable supplemental recall in both rounds")
		}
	}
	anchor.ConversationContext.OmitSupplementalContext = false
	if _, err := svc.publicChatRuntime().composePublicChatTurnContextWithRecall(context.Background(), *anchor, turn, req, recall); err == nil {
		t.Fatal("normal mode accepted invalid private recall")
	}
}
