package runtimeagent

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
)

func TestConversationSummaryIsOptionalWholeItemBeforeRecentTranscript(t *testing.T) {
	input := agentTurnContextTestInput(t, "worldCharacter")
	input.ConversationSummary = &agentTurnConversationSummaryInput{
		Status: "ready", Revision: 2, CoveredSequenceStart: 0, CoveredSequenceEnd: 0,
		Text: "The user asked about the Agent identity and world.", RouteCorrelation: strings.Repeat("9", 64),
	}
	compiled, err := compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Manifest.ConversationSummary.Status != "ready" || compiled.Summary.GetConversationSummary().GetStatus().String() != "AGENT_CONVERSATION_SUMMARY_STATUS_READY" {
		t.Fatalf("ready conversation summary = %#v / %#v", compiled.Manifest.ConversationSummary, compiled.Summary.GetConversationSummary())
	}
	lane := agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLaneConversationSummary)
	if lane.IncludedItemCount != 1 || lane.TruncatedCount != 0 {
		t.Fatalf("ready summary lane = %#v", lane)
	}

	input.ConversationSummary.Text = strings.Repeat("large summary content ", 2500)
	compiled, err = compileAgentTurnContext(input)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Manifest.ConversationSummary.Status != "omitted" || compiled.Summary.GetConversationSummary().GetStatus().String() != "AGENT_CONVERSATION_SUMMARY_STATUS_OMITTED" {
		t.Fatalf("omitted conversation summary = %#v / %#v", compiled.Manifest.ConversationSummary, compiled.Summary.GetConversationSummary())
	}
	lane = agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLaneConversationSummary)
	if lane.IncludedItemCount != 0 || lane.TruncatedCount != 1 {
		t.Fatalf("omitted summary lane = %#v", lane)
	}
}

func TestConversationSummaryInputUsesCompleteCoveredTurns(t *testing.T) {
	anchor := &publicChatAnchorState{CommittedTranscript: make([]publicChatCommittedTranscriptTurn, 8)}
	for index := range anchor.CommittedTranscript {
		anchor.CommittedTranscript[index] = publicChatCommittedTranscriptTurn{
			TurnID: "turn-" + string(rune('a'+index)), Sequence: uint64(index), Origin: publicChatTurnOriginUser,
			InputText: "user text " + string(rune('a'+index)), AssistantText: "assistant text " + string(rune('a'+index)),
		}
	}
	text, err := publicChatConversationSummaryInput(anchor, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "[turn 0]") || !strings.Contains(text, "[turn 1]") || strings.Contains(text, "[turn 2]") {
		t.Fatalf("summary input coverage = %q", text)
	}
}

func TestConversationSummaryOutputRequiresExactMessageOnlyEnvelope(t *testing.T) {
	text, err := parsePublicChatConversationSummaryOutput(`<message id="conversation-summary">bounded summary</message>`)
	if err != nil || text != "bounded summary" {
		t.Fatalf("exact summary output = %q, %v", text, err)
	}
	if _, err := parsePublicChatConversationSummaryOutput(`<message id="message-0">wrong id</message>`); err == nil || !strings.Contains(err.Error(), "message id") {
		t.Fatalf("wrong summary message id was admitted: %v", err)
	}
	withAction := `<message id="conversation-summary">summary</message><action id="action-0" kind="image"><prompt-payload kind="image"><prompt-text>must not run</prompt-text></prompt-payload></action>`
	if _, err := parsePublicChatConversationSummaryOutput(withAction); err == nil || !strings.Contains(err.Error(), "actions are not admitted") {
		t.Fatalf("summary action shape was admitted: %v", err)
	}
	if _, err := parsePublicChatConversationSummaryOutput(`<message id="conversation-summary"><emotion>happy</emotion>summary</message>`); err == nil || !strings.Contains(err.Error(), "status cues") {
		t.Fatalf("summary status cue was admitted: %v", err)
	}
}

func TestConversationSummaryStreamFailurePreservesTypedAttemptClass(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		reason runtimev1.ReasonCode
		want   string
	}{
		{name: "provider unavailable", reason: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, want: "unavailable"},
		{name: "provider timeout", reason: runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, want: "unavailable"},
		{name: "provider quota", reason: runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, want: "unavailable"},
		{name: "invalid output", reason: runtimev1.ReasonCode_AI_OUTPUT_INVALID, want: "failed"},
		{name: "invalid protocol", reason: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, want: "failed"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := publicChatConversationSummaryStreamFailureError(&runtimev1.ScenarioStreamFailed{ReasonCode: testCase.reason})
			if got := publicChatConversationSummaryAttemptStatusForError(err); got != testCase.want {
				t.Fatalf("summary attempt status = %q, want %q for %s", got, testCase.want, testCase.reason)
			}
		})
	}
	_, err := (&Service{}).executePublicChatConversationSummaryWithExecution(
		context.Background(),
		publicChatConversationSummaryIdentity{OwnerUserID: "user-1", SubjectUserID: "user-1", CallerAppID: "desktop.app"},
		publicChatConversationSummaryExecution{Input: "bounded summary input"},
	)
	if err == nil || publicChatConversationSummaryAttemptStatusForError(err) != "unavailable" {
		t.Fatalf("missing summary executor was not typed unavailable: %v", err)
	}
}

func TestConversationSummaryCutoffMatchesRecentEligibleWholeTurns(t *testing.T) {
	anchor := &publicChatAnchorState{CommittedTranscript: make([]publicChatCommittedTranscriptTurn, 8)}
	for index := range anchor.CommittedTranscript {
		anchor.CommittedTranscript[index] = publicChatCommittedTranscriptTurn{
			TurnID: "turn-" + string(rune('a'+index)), Sequence: uint64(index), Origin: publicChatTurnOriginUser,
			InputText: "user text " + string(rune('a'+index)), AssistantText: "assistant text " + string(rune('a'+index)),
		}
	}
	anchor.CommittedTranscript[6].AssistantText = ""
	anchor.CommittedTranscript[6].InputAttachment = &publicChatCommittedTranscriptAttachment{
		ArtifactID: "artifact-feature-mismatch", MimeType: "image/png",
	}

	targetEnd, shouldSummarize, err := publicChatConversationSummaryTarget(anchor)
	if err != nil {
		t.Fatal(err)
	}
	if !shouldSummarize || targetEnd != 0 {
		t.Fatalf("summary target = %d, %v; want 0, true", targetEnd, shouldSummarize)
	}
	recent, err := publicChatAgentTurnTranscriptInput(*anchor)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != publicChatRecentVerbatimTurnLimit+1 || recent[0].Sequence != 0 || recent[len(recent)-1].Sequence != 7 {
		t.Fatalf("pending-summary eligible transcript = %#v", recent)
	}
}

func TestConversationSummaryPendingWithoutLastValidKeepsFirstEligibleTurn(t *testing.T) {
	anchor := publicChatAnchorState{CommittedTranscript: testPublicChatCommittedTranscript(
		[2]string{"user 0", "assistant 0"},
		[2]string{"user 1", "assistant 1"},
		[2]string{"user 2", "assistant 2"},
		[2]string{"user 3", "assistant 3"},
		[2]string{"user 4", "assistant 4"},
		[2]string{"user 5", "assistant 5"},
		[2]string{"user 6", "assistant 6"},
	)}

	transcript, err := publicChatAgentTurnTranscriptInput(anchor)
	if err != nil {
		t.Fatal(err)
	}
	if len(transcript) != 7 || transcript[0].Sequence != 0 || transcript[len(transcript)-1].Sequence != 6 {
		t.Fatalf("pending transcript = %#v", transcript)
	}
}

func TestConversationSummaryStaleReadyAttemptKeepsTurnsAfterLastValid(t *testing.T) {
	now := time.Now().UTC()
	anchor := publicChatAnchorState{
		CommittedTranscript: testPublicChatCommittedTranscript(
			[2]string{"user 0", "assistant 0"},
			[2]string{"user 1", "assistant 1"},
			[2]string{"user 2", "assistant 2"},
			[2]string{"user 3", "assistant 3"},
			[2]string{"user 4", "assistant 4"},
			[2]string{"user 5", "assistant 5"},
			[2]string{"user 6", "assistant 6"},
			[2]string{"user 7", "assistant 7"},
		),
		ConversationSummary: &publicChatConversationSummaryState{
			LastValid: &publicChatConversationSummaryValidState{
				Revision: 1, CoveredSequenceStart: 0, CoveredSequenceEnd: 0,
				Text: "summary through turn zero", GeneratedAt: now, RouteCorrelation: strings.Repeat("a", 64),
			},
			LastAttempt: publicChatConversationSummaryAttemptState{
				Status: "ready", TargetSequenceEnd: 0, AttemptedAt: now,
			},
		},
	}

	transcript, err := publicChatAgentTurnTranscriptInput(anchor)
	if err != nil {
		t.Fatal(err)
	}
	if len(transcript) != 7 || transcript[0].Sequence != 1 || transcript[len(transcript)-1].Sequence != 7 {
		t.Fatalf("stale-ready transcript = %#v", transcript)
	}
}

func TestConversationSummaryCoveredUnavailableWithoutLastValidKeepsRecentWindow(t *testing.T) {
	now := time.Now().UTC()
	anchor := publicChatAnchorState{
		CommittedTranscript: testPublicChatCommittedTranscript(
			[2]string{"user 0", "assistant 0"},
			[2]string{"user 1", "assistant 1"},
			[2]string{"user 2", "assistant 2"},
			[2]string{"user 3", "assistant 3"},
			[2]string{"user 4", "assistant 4"},
			[2]string{"user 5", "assistant 5"},
			[2]string{"user 6", "assistant 6"},
		),
		ConversationSummary: &publicChatConversationSummaryState{
			LastAttempt: publicChatConversationSummaryAttemptState{
				Status: "unavailable", TargetSequenceEnd: 0, AttemptedAt: now,
			},
		},
	}

	transcript, err := publicChatAgentTurnTranscriptInput(anchor)
	if err != nil {
		t.Fatal(err)
	}
	if len(transcript) != publicChatRecentVerbatimTurnLimit || transcript[0].Sequence != 1 || transcript[len(transcript)-1].Sequence != 6 {
		t.Fatalf("covered-unavailable transcript = %#v", transcript)
	}
	input, err := publicChatAgentTurnConversationSummaryInput(anchor, transcript)
	if err != nil {
		t.Fatal(err)
	}
	if input == nil || input.Status != "unavailable" || input.Text != "" {
		t.Fatalf("covered-unavailable summary input = %#v", input)
	}
}

func TestConversationSummaryFailedAttemptPreservesLastValidAndProjectsTypedStatus(t *testing.T) {
	statePath := t.TempDir() + "/runtime-state.json"
	first, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	anchorID := openPublicChatTestAnchor(t, first, "agent-alpha", "desktop.app", "user-1")
	transcript := testPublicChatCommittedTranscript(
		[2]string{"user 0", "assistant 0"},
		[2]string{"user 1", "assistant 1"},
		[2]string{"user 2", "assistant 2"},
		[2]string{"user 3", "assistant 3"},
		[2]string{"user 4", "assistant 4"},
		[2]string{"user 5", "assistant 5"},
		[2]string{"user 6", "assistant 6"},
		[2]string{"user 7", "assistant 7"},
	)
	now := time.Now().UTC()
	first.chatSurfaceMu.Lock()
	first.chatAnchors[anchorID].CommittedTranscript = transcript
	first.chatAnchors[anchorID].ConversationSummary = &publicChatConversationSummaryState{
		LastValid: &publicChatConversationSummaryValidState{
			Revision: 3, CoveredSequenceStart: 0, CoveredSequenceEnd: 0,
			Text: "last valid summary", GeneratedAt: now, RouteCorrelation: strings.Repeat("a", 64),
		},
		LastAttempt: publicChatConversationSummaryAttemptState{Status: "ready", TargetSequenceEnd: 0, AttemptedAt: now},
	}
	if err := first.persistPublicChatSurfaceStateLocked(); err != nil {
		first.chatSurfaceMu.Unlock()
		t.Fatal(err)
	}
	first.chatSurfaceMu.Unlock()
	first.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		executionCtx context.Context,
		_ *PublicChatTurnExecutionRequest,
		emit func(*runtimev1.StreamScenarioEvent) error,
	) error {
		if accountID, ok := executionintent.RuntimeAccountSubjectFromContext(executionCtx); !ok || accountID != "user-1" {
			t.Fatalf("summary execution account binding = %q, %v", accountID, ok)
		}
		return emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
			Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
				ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			}},
		})
	}})
	if !first.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("summary provider failure attempt was not scheduled")
	}
	waitForPublicChatAsyncDrain(t, first)
	closeFirst()

	second, closeSecond := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	defer closeSecond()
	second.chatSurfaceMu.Lock()
	restored := clonePublicChatAnchorState(second.chatAnchors[anchorID])
	second.chatSurfaceMu.Unlock()
	if restored == nil || restored.ConversationSummary == nil {
		t.Fatal("conversation summary did not survive restart")
	}
	state := restored.ConversationSummary
	if state.LastAttempt.Status != "unavailable" || state.LastAttempt.TargetSequenceEnd != 1 {
		t.Fatalf("last attempt = %#v", state.LastAttempt)
	}
	if state.LastValid == nil || state.LastValid.Revision != 3 || state.LastValid.Text != "last valid summary" || state.LastValid.CoveredSequenceEnd != 0 {
		t.Fatalf("last valid summary was overwritten: %#v", state.LastValid)
	}
	recent, err := publicChatAgentTurnTranscriptInput(*restored)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 7 || recent[0].Sequence != 1 {
		t.Fatalf("failed summary did not preserve continuous eligible history: %#v", recent)
	}
	input, err := publicChatAgentTurnConversationSummaryInput(*restored, recent)
	if err != nil {
		t.Fatal(err)
	}
	if input == nil || input.Status != "unavailable" || input.Revision != 3 || input.Text != "last valid summary" {
		t.Fatalf("summary input = %#v", input)
	}
	compiledInput := agentTurnContextTestInput(t, "worldCharacter")
	compiledInput.Transcript = recent
	compiledInput.ConversationSummary = input
	compiled, err := compileAgentTurnContext(compiledInput)
	if err != nil {
		t.Fatal(err)
	}
	if got := compiled.Summary.GetConversationSummary().GetStatus().String(); got != "AGENT_CONVERSATION_SUMMARY_STATUS_UNAVAILABLE" {
		t.Fatalf("projected summary status = %s", got)
	}
	continuousLane := agentTurnContextTestLane(t, compiled.PrivateLanes, agentTurnContextLaneConversationSummary)
	if continuousLane.IncludedItemCount != 1 {
		t.Fatalf("continuous last-valid summary was not admitted: %#v", continuousLane)
	}

	restored.ConversationSummary.LastAttempt.Status = "failed"
	failedInput, err := publicChatAgentTurnConversationSummaryInput(*restored, recent)
	if err != nil {
		t.Fatal(err)
	}
	compiledInput.ConversationSummary = failedInput
	failedCompilation, err := compileAgentTurnContext(compiledInput)
	if err != nil {
		t.Fatal(err)
	}
	if got := failedCompilation.Summary.GetConversationSummary().GetStatus().String(); got != "AGENT_CONVERSATION_SUMMARY_STATUS_FAILED" {
		t.Fatalf("next-turn failed summary status = %s", got)
	}
	// The prior unavailable admission is immutable; compiling a later turn with
	// a different attempt status must not rewrite its typed facts or hashes.
	if got := compiled.Summary.GetConversationSummary().GetStatus().String(); got != "AGENT_CONVERSATION_SUMMARY_STATUS_UNAVAILABLE" || compiled.Summary.GetManifestInstanceHash() == "" {
		t.Fatalf("prior turn admission was mutated: %#v", compiled.Summary)
	}

	gappedInput, err := publicChatAgentTurnConversationSummaryInput(*restored, recent[1:])
	if err != nil {
		t.Fatal(err)
	}
	if gappedInput.Text != "" || gappedInput.Status != "unavailable" || gappedInput.Revision != 3 {
		t.Fatalf("non-contiguous last-valid summary was admitted: %#v", gappedInput)
	}
	compiledInput.Transcript = recent[1:]
	compiledInput.ConversationSummary = gappedInput
	gappedCompilation, err := compileAgentTurnContext(compiledInput)
	if err != nil {
		t.Fatal(err)
	}
	for _, lane := range gappedCompilation.PrivateLanes {
		if lane.LaneID == agentTurnContextLaneConversationSummary {
			t.Fatalf("non-contiguous last-valid summary entered provider lane: %#v", lane)
		}
	}
}

func TestConversationSummaryRunsAfterTurnTerminalAndReservationRelease(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)

	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript(
		[2]string{"user 0", "assistant 0"},
		[2]string{"user 1", "assistant 1"},
		[2]string{"user 2", "assistant 2"},
		[2]string{"user 3", "assistant 3"},
		[2]string{"user 4", "assistant 4"},
		[2]string{"user 5", "assistant 5"},
	)
	if err := svc.persistPublicChatSurfaceStateLocked(); err != nil {
		svc.chatSurfaceMu.Unlock()
		t.Fatal(err)
	}
	svc.chatSurfaceMu.Unlock()

	summaryStarted := make(chan bool, 1)
	summaryRelease := make(chan struct{})
	var releaseOnce sync.Once
	releaseSummary := func() { releaseOnce.Do(func() { close(summaryRelease) }) }
	defer releaseSummary()
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		ctx context.Context,
		req *PublicChatTurnExecutionRequest,
		emit func(*runtimev1.StreamScenarioEvent) error,
	) error {
		isSummary := len(req.Messages) > 0 && strings.Contains(req.Messages[0].GetContent(), "Summarize the supplied committed conversation turns")
		if isSummary {
			completedBeforeSummary := false
			for _, messageType := range capture.messageTypes() {
				if messageType == publicChatTurnCompletedType {
					completedBeforeSummary = true
					break
				}
			}
			summaryStarted <- completedBeforeSummary
			select {
			case <-summaryRelease:
			case <-ctx.Done():
				return ctx.Err()
			}
			if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{Text: `<message id="conversation-summary">async summary</message>`}}}}}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}}})
		}
		if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{Text: `<message id="message-async-summary">answer</message>`}}}}}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}}})
	}})

	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          "user-1",
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "async-conversation-summary",
			"thread_id":              publicChatTestAnchorThreadID(t, svc, anchorID),
			"messages":               []any{map[string]any{"role": "user", "content": "seventh turn"}},
		}),
	}); err != nil {
		t.Fatal(err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	select {
	case completedBeforeSummary := <-summaryStarted:
		if !completedBeforeSummary {
			t.Fatal("summary attempt started before turn.completed was emitted")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("post-terminal summary attempt did not start")
	}
	if svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("duplicate per-anchor summary attempt was admitted")
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	releaseSummary()
	waitForPublicChatAsyncDrain(t, svc)

	svc.chatSurfaceMu.Lock()
	summary := clonePublicChatConversationSummary(svc.chatAnchors[anchorID].ConversationSummary)
	svc.chatSurfaceMu.Unlock()
	if summary == nil || summary.LastAttempt.Status != "ready" || summary.LastValid == nil || summary.LastValid.Text != "async summary" {
		t.Fatalf("post-terminal summary state = %#v", summary)
	}
}

func TestConversationSummaryCoalescesAdvancedTargetWhileAttemptRuns(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript(
		[2]string{"user 0", "assistant 0"},
		[2]string{"user 1", "assistant 1"},
		[2]string{"user 2", "assistant 2"},
		[2]string{"user 3", "assistant 3"},
		[2]string{"user 4", "assistant 4"},
		[2]string{"user 5", "assistant 5"},
		[2]string{"user 6", "assistant 6"},
	)
	svc.chatAnchors[anchorID].Binding.RouteDigest = strings.Repeat("b", 64)
	svc.chatSurfaceMu.Unlock()

	firstStarted := make(chan struct{})
	firstRelease := make(chan struct{})
	var releaseOnce sync.Once
	releaseFirst := func() { releaseOnce.Do(func() { close(firstRelease) }) }
	defer releaseFirst()
	inputs := make([]string, 0, 2)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		ctx context.Context,
		req *PublicChatTurnExecutionRequest,
		emit func(*runtimev1.StreamScenarioEvent) error,
	) error {
		inputs = append(inputs, req.Messages[1].GetContent())
		call := len(inputs)
		if call == 1 {
			close(firstStarted)
			select {
			case <-firstRelease:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		summaryText := "summary target zero"
		if call == 2 {
			summaryText = "summary target one"
		}
		if err := emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA, Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{Text: `<message id="conversation-summary">` + summaryText + `</message>`}}}}}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED, Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}}})
	}})
	if !svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("initial summary target was not scheduled")
	}
	select {
	case <-firstStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("initial summary attempt did not start")
	}

	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = append(
		svc.chatAnchors[anchorID].CommittedTranscript,
		publicChatCommittedTranscriptTurn{
			TurnID: "turn-7", Sequence: 7, Origin: publicChatTurnOriginUser,
			InputText: "user 7", AssistantText: "assistant 7",
		},
	)
	if err := svc.persistPublicChatSurfaceStateLocked(); err != nil {
		svc.chatSurfaceMu.Unlock()
		t.Fatal(err)
	}
	svc.chatSurfaceMu.Unlock()
	if svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("advanced target started a concurrent summary attempt")
	}
	releaseFirst()
	waitForPublicChatAsyncDrain(t, svc)
	if len(inputs) != 2 || !strings.Contains(inputs[0], "[turn 0]") || strings.Contains(inputs[0], "[turn 1]") || !strings.Contains(inputs[1], "[turn 1]") {
		t.Fatalf("coalesced summary inputs = %#v", inputs)
	}
	svc.chatSurfaceMu.Lock()
	summary := clonePublicChatConversationSummary(svc.chatAnchors[anchorID].ConversationSummary)
	svc.chatSurfaceMu.Unlock()
	if summary == nil || summary.LastValid == nil || summary.LastValid.CoveredSequenceEnd != 1 || summary.LastValid.Text != "summary target one" || summary.LastAttempt.TargetSequenceEnd != 1 {
		t.Fatalf("coalesced summary state = %#v", summary)
	}
}

func TestConversationSummaryAsyncAttemptIsCanceledAndDrainedOnClose(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript(
		[2]string{"user 0", "assistant 0"},
		[2]string{"user 1", "assistant 1"},
		[2]string{"user 2", "assistant 2"},
		[2]string{"user 3", "assistant 3"},
		[2]string{"user 4", "assistant 4"},
		[2]string{"user 5", "assistant 5"},
		[2]string{"user 6", "assistant 6"},
	)
	svc.chatSurfaceMu.Unlock()
	started := make(chan struct{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{stream: func(
		ctx context.Context,
		_ *PublicChatTurnExecutionRequest,
		_ func(*runtimev1.StreamScenarioEvent) error,
	) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}})
	if !svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("summary attempt was not scheduled")
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("summary attempt did not start")
	}
	closed := make(chan struct{})
	go func() {
		svc.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("Service Close left summary async work running")
	}
}

func TestConversationSummaryAsyncMissingExecutorPersistsUnavailable(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript(
		[2]string{"user 0", "assistant 0"},
		[2]string{"user 1", "assistant 1"},
		[2]string{"user 2", "assistant 2"},
		[2]string{"user 3", "assistant 3"},
		[2]string{"user 4", "assistant 4"},
		[2]string{"user 5", "assistant 5"},
		[2]string{"user 6", "assistant 6"},
	)
	svc.chatSurfaceMu.Unlock()
	if !svc.schedulePublicChatConversationSummary(anchorID) {
		t.Fatal("summary attempt was not scheduled")
	}
	waitForPublicChatAsyncDrain(t, svc)
	svc.chatSurfaceMu.Lock()
	summary := clonePublicChatConversationSummary(svc.chatAnchors[anchorID].ConversationSummary)
	svc.chatSurfaceMu.Unlock()
	if summary == nil || summary.LastValid != nil || summary.LastAttempt.Status != "unavailable" || summary.LastAttempt.TargetSequenceEnd != 0 {
		t.Fatalf("missing executor summary state = %#v", summary)
	}
}
