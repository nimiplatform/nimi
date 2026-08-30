package runtimeagent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestPublicChatTranscriptAndContextSummaryRecoverAcrossRestart(t *testing.T) {
	statePath := t.TempDir() + "/runtime-state.json"
	first, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	anchorID := openPublicChatTestAnchor(t, first, "agent-alpha", "desktop.app", "user-1")
	for _, pair := range [][2]string{{"first user", "first assistant"}, {"second user", "second assistant"}} {
		if err := first.commitPublicChatTurnTranscript(anchorID, &runtimev1.ChatMessage{Role: "user", Content: pair[0]}, pair[1]); err != nil {
			t.Fatalf("commit transcript pair: %v", err)
		}
	}
	if err := first.commitPublicChatFollowUpTranscript(anchorID, "turn-follow-up", "continue after a pause", "follow-up assistant"); err != nil {
		t.Fatalf("commit follow-up transcript: %v", err)
	}
	summary := &runtimev1.AgentTurnContextSummary{
		SchemaVersion:       runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V2,
		Ready:               true,
		State:               runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_READY,
		ReasonCode:          runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
		ContextContentHash:  strings.Repeat("d", 64),
		PromptHash:          strings.Repeat("e", 64),
		LocalAgentRef:       testRuntimeAgentLocalRef("agent-alpha"),
		TranscriptTurnCount: 2,
	}
	first.chatSurfaceMu.Lock()
	first.chatAnchors[anchorID].LastTurnSnapshot = &publicChatTurnProjectionState{
		TurnID:         "turn-second",
		Status:         publicChatTurnStatusCompleted,
		ContextSummary: summary,
	}
	first.chatAnchors[anchorID].LocalAppSequence = 17
	voiceTurnID := first.chatAnchors[anchorID].CommittedTranscript[0].TurnID
	first.chatAnchors[anchorID].VoiceSidecars = map[string]*publicChatVoiceSidecarState{
		voiceTurnID: {
			VoiceID: "local_app_voice_restart_1", TurnID: voiceTurnID,
			MessageID: localAppConversationMessageID(voiceTurnID, "assistant", ""),
			State:     "failed", ReasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message: "VOICE_SYNTHESIS_FAILED",
		},
	}
	first.chatSurfaceMu.Unlock()
	first.persistCurrentPublicChatSurfaceState()
	var persistedRaw string
	if err := first.backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, runtimeAgentMetaPublicChatSurfaceStateKey).Scan(&persistedRaw); err != nil {
		t.Fatalf("load persisted public chat state: %v", err)
	}
	if !strings.Contains(persistedRaw, `"committedTranscript"`) || strings.Contains(persistedRaw, `"transcript"`) || strings.Contains(persistedRaw, `"contextHistory"`) {
		t.Fatalf("persistence must contain only canonical committed transcript truth: %s", persistedRaw)
	}
	closeFirst()

	restarted, closeRestarted := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	defer closeRestarted()
	recovered, _, lastTurn, _, err := restarted.snapshotPublicChatAnchorForCaller("zhiyu.app", anchorID)
	if err != nil {
		t.Fatalf("cross-app recovered snapshot: %v", err)
	}
	recoveredPublicTranscript, projectionErr := publicChatTranscriptProjection(recovered.CommittedTranscript)
	if projectionErr != nil {
		t.Fatalf("project recovered transcript: %v", projectionErr)
	}
	if len(recoveredPublicTranscript) != 4 || recoveredPublicTranscript[0].GetContent() != "first user" || recoveredPublicTranscript[3].GetContent() != "second assistant" {
		t.Fatalf("recovered transcript mismatch: %v", recoveredPublicTranscript)
	}
	privateHistory, err := publicChatAgentTurnTranscriptInput(recovered)
	if err != nil {
		t.Fatalf("compile recovered private history: %v", err)
	}
	if len(privateHistory) != 3 || privateHistory[2].TurnID != "turn-follow-up" || !strings.Contains(privateHistory[2].UserText, "continue after a pause") || privateHistory[2].AssistantText != "follow-up assistant" {
		t.Fatalf("recovered follow-up transcript mismatch: %+v", privateHistory)
	}
	if !proto.Equal(lastTurn.ContextSummary, summary) {
		t.Fatalf("recovered context summary mismatch: got=%+v want=%+v", lastTurn.ContextSummary, summary)
	}
	if recovered.LocalAppSequence != 17 {
		t.Fatalf("recovered local-app sequence mismatch: got=%d want=17", recovered.LocalAppSequence)
	}
	if voice := recovered.VoiceSidecars[voiceTurnID]; voice == nil || voice.State != "failed" ||
		voice.MessageID != localAppConversationMessageID(voiceTurnID, "assistant", "") {
		t.Fatalf("recovered voice sidecar mismatch: %#v", voice)
	}
	ctx := testLocalAgentContext("user-1", "agent-alpha")
	ctx.AppId = "zhiyu.app"
	anchorSnapshot, err := restarted.GetConversationAnchorSnapshot(context.Background(), &runtimev1.GetConversationAnchorSnapshotRequest{
		Context: ctx, AgentId: ctx.GetLocalAgentRef(), ConversationAnchorId: anchorID,
	})
	if err != nil {
		t.Fatalf("GetConversationAnchorSnapshot after restart: %v", err)
	}
	if !proto.Equal(anchorSnapshot.GetSnapshot().GetTurnContextSummary(), summary) {
		t.Fatalf("anchor snapshot context summary mismatch: %+v", anchorSnapshot.GetSnapshot().GetTurnContextSummary())
	}
	if err := restarted.commitPublicChatTurnTranscript(anchorID, &runtimev1.ChatMessage{Role: "user", Content: "third user"}, "third assistant"); err != nil {
		t.Fatalf("commit third pair after restart: %v", err)
	}
	restarted.chatSurfaceMu.Lock()
	thirdTranscript, projectionErr := publicChatTranscriptProjection(restarted.chatAnchors[anchorID].CommittedTranscript)
	restarted.chatSurfaceMu.Unlock()
	if projectionErr != nil {
		t.Fatalf("project third-turn transcript: %v", projectionErr)
	}
	if len(thirdTranscript) != 6 || thirdTranscript[4].GetContent() != "third user" || thirdTranscript[5].GetContent() != "third assistant" {
		t.Fatalf("third turn continuity mismatch: %v", thirdTranscript)
	}
}

func TestCopiedOwnerRootReopensConversationUnderSameAccount(t *testing.T) {
	rootOne := filepath.Join(t.TempDir(), "owner-root-one")
	stateOne := filepath.Join(rootOne, "accounts", "runtime", "local-state.json")
	first, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, stateOne)
	anchorID := openPublicChatTestAnchor(t, first, "agent-alpha", "desktop.app", "user-1")
	if err := first.commitPublicChatTurnTranscript(anchorID, &runtimev1.ChatMessage{Role: "user", Content: "portable question"}, "portable answer"); err != nil {
		t.Fatal(err)
	}
	closeFirst()

	rootTwo := filepath.Join(t.TempDir(), "owner-root-two")
	if err := os.CopyFS(rootTwo, os.DirFS(rootOne)); err != nil {
		t.Fatal(err)
	}
	second, closeSecond := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, filepath.Join(rootTwo, "accounts", "runtime", "local-state.json"))
	defer closeSecond()
	recovered, _, _, _, err := second.snapshotPublicChatAnchorForCaller("desktop.app", anchorID)
	if err != nil {
		t.Fatal(err)
	}
	transcript, err := publicChatTranscriptProjection(recovered.CommittedTranscript)
	if err != nil || len(transcript) != 2 || transcript[0].GetContent() != "portable question" || transcript[1].GetContent() != "portable answer" {
		t.Fatalf("copied owner root transcript = %+v err=%v", transcript, err)
	}
	if resolved := openPublicChatTestAnchor(t, second, "agent-alpha", "desktop.app", "user-1"); resolved != anchorID {
		t.Fatalf("same-account copied root resolved anchor %q, want %q", resolved, anchorID)
	}
}

func TestPublicChatRestartRecoveryInterruptsTurnWithoutClosingConversationAnchor(t *testing.T) {
	statePath := t.TempDir() + "/runtime-state.json"
	first, closeFirst := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	anchorID := openPublicChatTestAnchor(t, first, "agent-alpha", "desktop.app", "user-1")
	first.chatSurfaceMu.Lock()
	first.chatAnchors[anchorID].CommittedTranscript = []publicChatCommittedTranscriptTurn{{
		TurnID: "turn-interrupted-by-restart", Sequence: 0, Origin: publicChatTurnOriginUser,
		InputText: "draw", AssistantText: "drawing",
	}}
	first.chatAnchors[anchorID].ActiveTurnSnapshot = &publicChatTurnProjectionState{
		TurnID: "turn-interrupted-by-restart", Status: publicChatTurnStatusStarted,
		Structured: &publicChatStructuredEnvelope{Actions: []publicChatStructuredAction{{
			ActionID: "action-interrupted-by-restart", Modality: "image", Operation: "image.generate",
		}}},
		ActionStatus: publicChatActionStatusStarted,
	}
	first.chatAnchors[anchorID].ActiveTurnID = "turn-interrupted-by-restart"
	first.chatAnchors[anchorID].UpdatedAt = time.Now().UTC()
	first.chatSurfaceMu.Unlock()
	first.persistCurrentPublicChatSurfaceState()
	closeFirst()

	restarted, closeRestarted := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	defer closeRestarted()
	recovered, ok := restarted.publicChatAnchorSnapshot(anchorID)
	if !ok {
		t.Fatalf("recovered anchor %q not found", anchorID)
	}
	if recovered.Status != runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE {
		t.Fatalf("restart recovery changed anchor status to %s", recovered.Status)
	}
	if recovered.ActiveTurnSnapshot != nil || recovered.LastTurnSnapshot == nil ||
		recovered.LastTurnSnapshot.Status != publicChatTurnStatusInterrupted ||
		recovered.LastTurnSnapshot.ReasonCode != runtimev1.ReasonCode_AI_STREAM_BROKEN {
		t.Fatalf("restart recovery turn projection mismatch: active=%+v last=%+v", recovered.ActiveTurnSnapshot, recovered.LastTurnSnapshot)
	}
	snapshotDecision := localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x44, "user-1")
	handle := mintLocalAppAgentHandle(snapshotDecision, testRuntimeAgentLocalRef("agent-alpha"))
	protected, err := restarted.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil {
		t.Fatalf("GetLocalAppConversationSnapshot after restart: %v", err)
	}
	if len(protected.GetSnapshot().GetTurns()) != 1 ||
		protected.GetSnapshot().GetTurns()[0].GetStatus() != runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_INTERRUPTED {
		t.Fatalf("protected restart turn closure = %+v", protected.GetSnapshot().GetTurns())
	}
	if len(protected.GetSnapshot().GetActions()) != 1 ||
		protected.GetSnapshot().GetActions()[0].GetStatus() != runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_FAILED {
		t.Fatalf("protected restart action closure = %+v", protected.GetSnapshot().GetActions())
	}
	if resolved := openPublicChatTestAnchor(t, restarted, "agent-alpha", "web.app", "user-1"); resolved != anchorID {
		t.Fatalf("post-restart open resolved %q, want active canonical anchor %q", resolved, anchorID)
	}
}

func TestPersistedConversationSingletonValidationRejectsAllDuplicateDurableAnchors(t *testing.T) {
	anchors := []persistedPublicChatAnchor{
		{
			ConversationAnchorID: "anchor-active",
			OwnerUserID:          "user-1",
			LocalAgentRef:        "local-agent:alpha",
			Status:               int32(runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE),
		},
		{
			ConversationAnchorID: "anchor-closed",
			OwnerUserID:          "user-1",
			LocalAgentRef:        "local-agent:alpha",
			Status:               int32(runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED),
		},
	}
	err := validatePersistedPublicChatConversationSingletons(anchors)
	if err == nil || !strings.Contains(err.Error(), "multiple durable conversation anchors") {
		t.Fatalf("duplicate durable anchors must fail closed, got %v", err)
	}
	if got := anchors[1].Status; got != int32(runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED) {
		t.Fatalf("validation mutated persisted state: status=%d", got)
	}
}

func TestPersistedConversationSingletonValidationRejectsClosedSingleton(t *testing.T) {
	anchors := []persistedPublicChatAnchor{{
		ConversationAnchorID: "anchor-closed",
		OwnerUserID:          "user-1",
		LocalAgentRef:        "local-agent:alpha",
		Status:               int32(runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED),
	}}
	err := validatePersistedPublicChatConversationSingletons(anchors)
	if err == nil || !strings.Contains(err.Error(), "cannot satisfy LocalAgent singleton continuity") {
		t.Fatalf("closed durable singleton must fail closed, got %v", err)
	}
	if got := anchors[0].Status; got != int32(runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED) {
		t.Fatalf("validation mutated persisted state: status=%d", got)
	}
}

func TestPublicChatSurfaceLoadRejectsDuplicateDurableAnchorsWithoutMutation(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	existingAnchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	state := persistedPublicChatSurfaceState{
		Version: 100,
		Anchors: []persistedPublicChatAnchor{
			{
				ConversationAnchorID: "legacy-anchor-a",
				AgentID:              testRuntimeAgentLocalRef("agent-alpha"),
				LocalAgentRef:        testRuntimeAgentLocalRef("agent-alpha"),
				OwnerUserID:          "user-1",
				RuntimeSourceRef:     testRuntimeAgentSourceRef("agent-alpha"),
				SubjectUserID:        "user-1",
				Status:               int32(runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE),
			},
			{
				ConversationAnchorID: "legacy-anchor-b",
				AgentID:              testRuntimeAgentLocalRef("agent-alpha"),
				LocalAgentRef:        testRuntimeAgentLocalRef("agent-alpha"),
				OwnerUserID:          "user-1",
				RuntimeSourceRef:     testRuntimeAgentSourceRef("agent-alpha"),
				SubjectUserID:        "user-1",
				Status:               int32(runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED),
			},
		},
	}
	if err := svc.chatStateRepo.persistPublicChatSurfaceState(state); err != nil {
		t.Fatalf("persist duplicate forged state: %v", err)
	}
	err := svc.loadPublicChatSurfaceStateFromDB()
	if err == nil || !strings.Contains(err.Error(), "explicit offline repair") {
		t.Fatalf("duplicate durable state must fail closed with repair direction, got %v", err)
	}
	if _, ok := svc.publicChatAnchorSnapshot(existingAnchorID); !ok {
		t.Fatal("failed load mutated the previously loaded in-memory conversation")
	}
}

func TestPublicChatStrictTranscriptPersistenceFailureRollsBackBeforeCommitEvent(t *testing.T) {
	statePath := t.TempDir() + "/runtime-state.json"
	svc, closeSvc := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	firstClosed := false
	defer func() {
		if !firstClosed {
			closeSvc()
		}
	}()
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	if _, err := svc.backend.DB().Exec(`
		CREATE TRIGGER runtime_test_reject_public_chat_transcript_commit
		BEFORE UPDATE OF value ON runtime_local_agent_meta
		WHEN OLD.key = 'public_chat_surface_state'
		BEGIN
			SELECT RAISE(FAIL, 'injected public chat transcript persistence failure');
		END
	`); err != nil {
		t.Fatalf("create strict transcript persistence trigger: %v", err)
	}
	triggerActive := true
	dropTrigger := func() {
		if !triggerActive {
			return
		}
		if _, err := svc.backend.DB().Exec(`DROP TRIGGER IF EXISTS runtime_test_reject_public_chat_transcript_commit`); err != nil {
			t.Errorf("drop strict transcript persistence trigger: %v", err)
			return
		}
		triggerActive = false
	}
	defer dropTrigger()

	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-strict-persist-failure",
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "qwen3-chat",
					RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				}},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-strict-persist-failure",
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDelta(

					publicChatStructuredEnvelopeAPML("message-strict-persist-failure", "must not become committed"))},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-strict-persist-failure",
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				}},
			})
		},
	})
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
			"messages":               []any{map[string]any{"role": "user", "content": "strict persist input"}},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnFailedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatTurnMessageCommittedType {
			t.Fatalf("strict persistence failure emitted message_committed: %v", capture.messageTypes())
		}
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-strict-persist-failure")
	if got := publicChatSessionSnapshotDetail(t, snapshot)["transcript_message_count"]; got != float64(0) {
		t.Fatalf("strict persistence failure must roll transcript back to zero: %v", publicChatSessionSnapshotDetail(t, snapshot))
	}
	if got := publicChatLastTurnSnapshot(t, snapshot)["status"]; got != publicChatTurnStatusFailed {
		t.Fatalf("pre-boundary persistence failure must remain failed: %v", publicChatLastTurnSnapshot(t, snapshot))
	}
	var persistedRaw string
	if err := svc.backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, runtimeAgentMetaPublicChatSurfaceStateKey).Scan(&persistedRaw); err != nil {
		t.Fatalf("load state after strict persistence failure: %v", err)
	}
	if strings.Contains(persistedRaw, "strict persist input") || strings.Contains(persistedRaw, "must not become committed") {
		t.Fatalf("failed strict transaction leaked transcript into SQLite: %s", persistedRaw)
	}

	dropTrigger()
	svc.persistCurrentPublicChatSurfaceState()
	closeSvc()
	firstClosed = true
	restarted, closeRestarted := newRuntimeAgentServiceForPublicChatStatePathWithClose(t, statePath)
	defer closeRestarted()
	restartedCapture := newPublicChatEmitCapture()
	restarted.SetPublicChatAppEmitter(restartedCapture.emit)
	recovered := requestPublicChatSessionSnapshot(t, restarted, restartedCapture, anchorID, "snapshot-strict-persist-restarted")
	if got := publicChatSessionSnapshotDetail(t, recovered)["transcript_message_count"]; got != float64(0) {
		t.Fatalf("restart recovered a rolled-back transcript: %v", publicChatSessionSnapshotDetail(t, recovered))
	}
}

func TestPublicChatSurfaceStateRejectsInvalidCommittedTranscript(t *testing.T) {
	t.Parallel()
	tests := map[string][]publicChatCommittedTranscriptTurn{
		"sequence": {{TurnID: "turn-1", Sequence: 1, Origin: publicChatTurnOriginUser, InputText: "user", AssistantText: "assistant"}},
		"origin":   {{TurnID: "turn-1", Sequence: 0, Origin: "caller", InputText: "user", AssistantText: "assistant"}},
		"duplicate": {
			{TurnID: "turn-1", Sequence: 0, Origin: publicChatTurnOriginUser, InputText: "user", AssistantText: "assistant"},
			{TurnID: "turn-1", Sequence: 1, Origin: publicChatTurnOriginFollowUp, InputText: "continue", AssistantText: "continued"},
		},
	}
	for name, transcript := range tests {
		name, transcript := name, transcript
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			state := persistedPublicChatSurfaceState{
				Version: 100,
				Anchors: []persistedPublicChatAnchor{{
					ConversationAnchorID: "agent_anchor_invalid_" + name,
					AgentID:              testRuntimeAgentLocalRef("agent-alpha"),
					LocalAgentRef:        testRuntimeAgentLocalRef("agent-alpha"),
					OwnerUserID:          "user-1",
					RuntimeSourceRef:     testRuntimeAgentSourceRef("agent-alpha"),
					SubjectUserID:        "user-1",
					CommittedTranscript:  transcript,
				}},
			}
			if err := svc.chatStateRepo.persistPublicChatSurfaceState(state); err != nil {
				t.Fatalf("persist forged transcript: %v", err)
			}
			if err := svc.loadPublicChatSurfaceStateFromDB(); err == nil {
				t.Fatal("invalid persisted committed transcript must fail closed")
			}
		})
	}
}

func TestPublicChatSurfaceStateStrictlyRoundTripsTurnContextSummary(t *testing.T) {
	summary := &runtimev1.AgentTurnContextSummary{
		SchemaVersion:        runtimev1.AgentTurnContextSummarySchemaVersion_AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V2,
		Ready:                true,
		State:                runtimev1.AgentTurnContextState_AGENT_TURN_CONTEXT_STATE_READY,
		ReasonCode:           runtimev1.AgentContextProjectionReasonCode_AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE,
		ManifestInstanceHash: strings.Repeat("a", 64),
		ContextContentHash:   strings.Repeat("b", 64),
		PromptHash:           strings.Repeat("c", 64),
		LocalAgentRef:        "local-agent:user-1:alpha",
		TranscriptTurnCount:  3,
		MemoryItemCount:      2,
	}
	state := persistedPublicChatSurfaceState{
		Version: 1,
		Anchors: []persistedPublicChatAnchor{{
			ConversationAnchorID: "agent_anchor_summary",
			AgentID:              "local-agent:user-1:alpha",
			LocalAgentRef:        "local-agent:user-1:alpha",
			OwnerUserID:          "user-1",
			RuntimeSourceRef:     "alpha",
			SubjectUserID:        "user-1",
			LastTurnSnapshot: toPersistedPublicChatTurnSnapshot(&publicChatTurnProjectionState{
				TurnID:         "turn-summary",
				Status:         publicChatTurnStatusCompleted,
				ContextSummary: summary,
			}),
		}},
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal state: %v", err)
	}
	if strings.Contains(string(raw), "systemPrompt") || strings.Contains(string(raw), "executionParams") || !strings.Contains(string(raw), "context_content_hash") {
		t.Fatalf("summary persistence must use bounded proto JSON, got %s", raw)
	}
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal state: %v", err)
	}
	projection := fromPersistedPublicChatTurnSnapshot(restored.Anchors[0].LastTurnSnapshot)
	if !proto.Equal(projection.ContextSummary, summary) {
		t.Fatalf("context summary round trip mismatch: got=%+v want=%+v", projection.ContextSummary, summary)
	}

	forged := strings.Replace(string(raw), `"context_content_hash":`, `"unknown_private_lane":"forged","context_content_hash":`, 1)
	if err := json.Unmarshal([]byte(forged), &persistedPublicChatSurfaceState{}); err == nil {
		t.Fatal("unknown persisted context summary fields must fail closed")
	}
}

func TestPublicChatSurfaceStateRoundTripsDurableTargetRef(t *testing.T) {
	selectedParams, err := structpb.NewStruct(map[string]any{
		"size":  "768x768",
		"steps": "7",
	})
	if err != nil {
		t.Fatalf("selected params: %v", err)
	}
	targetRef := &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ProfileBindingID: "local-runtime:profile-1"}}
	state := persistedPublicChatSurfaceState{
		Version: 1,
		Anchors: []persistedPublicChatAnchor{{
			ConversationAnchorID: "agent_anchor_1",
			AgentID:              "local-agent:alpha",
			LocalAgentRef:        "local-agent:alpha",
			OwnerUserID:          "user-1",
			RuntimeSourceRef:     "alpha",
			CallerAppID:          "nimi.zhiyu",
			SubjectUserID:        "user-1",
			Binding: publicChatExecutionBinding{
				BindingAlias:   "local/default",
				ModelID:        "local.chat.gemma",
				RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				TargetRef:      targetRef,
				SelectedParams: selectedParams,
			},
			Bindings: publicChatExecutionBindings{
				"text.generate": {
					BindingAlias:   "local/default",
					ModelID:        "local.chat.gemma",
					RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					TargetRef:      targetRef,
					SelectedParams: selectedParams,
				},
			},
		}},
	}

	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal public chat state: %v", err)
	}
	rawText := string(raw)
	if !strings.Contains(rawText, `"local"`) || !strings.Contains(rawText, `"profileBindingId"`) {
		t.Fatalf("private chat state target must preserve local profile binding, got %s", rawText)
	}
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal public chat state: %v\njson=%s", err, raw)
	}
	assertPublicChatBindingProfileTarget(t, restored.Anchors[0].Binding, "local-runtime:profile-1")
	assertPublicChatBindingProfileTarget(t, restored.Anchors[0].Bindings["text.generate"], "local-runtime:profile-1")
	if restored.Anchors[0].Binding.BindingAlias != "local/default" || restored.Anchors[0].Bindings["text.generate"].BindingAlias != "local/default" {
		t.Fatalf("public chat state lost alias binding: %#v", restored.Anchors[0])
	}
	if got := restored.Anchors[0].Binding.SelectedParams.AsMap(); got["size"] != "768x768" || got["steps"] != "7" {
		t.Fatalf("public chat state lost selected params: %#v", got)
	}
	if got := restored.Anchors[0].Bindings["text.generate"].SelectedParams.AsMap(); got["size"] != "768x768" || got["steps"] != "7" {
		t.Fatalf("public chat bindings lost selected params: %#v", got)
	}
}

func TestPublicChatSurfaceStateRoundTripsDurableReadinessTargetRef(t *testing.T) {
	targetRef := &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{ReadinessRef: "local-runtime:readiness-1"}}
	state := persistedPublicChatSurfaceState{
		Version: 1,
		Anchors: []persistedPublicChatAnchor{{
			ConversationAnchorID: "agent_anchor_1",
			AgentID:              "local-agent:alpha",
			LocalAgentRef:        "local-agent:alpha",
			OwnerUserID:          "user-1",
			RuntimeSourceRef:     "alpha",
			CallerAppID:          "nimi.zhiyu",
			SubjectUserID:        "user-1",
			Binding: publicChatExecutionBinding{
				ModelID:     "local.chat.gemma",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				TargetRef:   targetRef,
			},
		}},
	}

	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal public chat state: %v", err)
	}
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal public chat state: %v\njson=%s", err, raw)
	}
	assertPublicChatBindingReadinessTarget(t, restored.Anchors[0].Binding, "local-runtime:readiness-1")
}

func TestPublicChatSurfaceStateRoundTripsCloudDurableTargetRef(t *testing.T) {
	targetRef := &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID:          "connector-openai",
		RemoteModelCatalogID: "catalog-gpt",
		ProviderModelID:      "gpt-5-mini",
		Provider:             "openai",
	}}
	state := persistedPublicChatSurfaceState{
		Version: 1,
		Anchors: []persistedPublicChatAnchor{{
			ConversationAnchorID: "agent_anchor_1",
			AgentID:              "local-agent:alpha",
			LocalAgentRef:        "local-agent:alpha",
			OwnerUserID:          "user-1",
			RuntimeSourceRef:     "alpha",
			CallerAppID:          "nimi.zhiyu",
			SubjectUserID:        "user-1",
			Binding: publicChatExecutionBinding{
				ModelID:     "cloud.chat.gpt",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorID: "connector-openai",
				TargetRef:   targetRef,
			},
		}},
	}

	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal public chat state: %v", err)
	}
	rawText := string(raw)
	if !strings.Contains(rawText, `"cloud"`) || !strings.Contains(rawText, `"connectorId"`) {
		t.Fatalf("private chat state must preserve the exact cloud target, got %s", rawText)
	}
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal public chat state: %v\njson=%s", err, raw)
	}
	assertPublicChatBindingCloudTarget(t, restored.Anchors[0].Binding, "connector-openai", "catalog-gpt", "gpt-5-mini", "openai")
}

func assertPublicChatBindingProfileTarget(t *testing.T, binding publicChatExecutionBinding, want string) {
	t.Helper()
	if got := binding.TargetRef.GetLocalRuntime().GetProfileBindingId(); got != want {
		t.Fatalf("expected local runtime profile target %q, got %q", want, got)
	}
}

func assertPublicChatBindingReadinessTarget(t *testing.T, binding publicChatExecutionBinding, want string) {
	t.Helper()
	if got := binding.TargetRef.GetLocalRuntime().GetReadinessRef(); got != want {
		t.Fatalf("expected local runtime readiness target %q, got %q", want, got)
	}
}

func assertPublicChatBindingCloudTarget(t *testing.T, binding publicChatExecutionBinding, connectorID string, catalogID string, providerModelID string, provider string) {
	t.Helper()
	cloud := binding.TargetRef.GetCloud()
	if cloud == nil {
		t.Fatal("expected cloud target ref")
	}
	if cloud.GetConnectorId() != connectorID || cloud.GetRemoteModelCatalogId() != catalogID || cloud.GetProviderModelId() != providerModelID || cloud.GetProvider() != provider {
		t.Fatalf(
			"expected cloud target %q/%q/%q/%q, got %q/%q/%q/%q",
			connectorID,
			catalogID,
			providerModelID,
			provider,
			cloud.GetConnectorId(),
			cloud.GetRemoteModelCatalogId(),
			cloud.GetProviderModelId(),
			cloud.GetProvider(),
		)
	}
}
