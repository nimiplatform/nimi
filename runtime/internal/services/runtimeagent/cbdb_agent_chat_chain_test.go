package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	cbdbChainVerifierOwnerID     = "cbdb-chain-agent-chat-verifier-user"
	cbdbChainSuZheRealmAgentID   = "cbdb-song-slice-real-20260614-agent-8af2c5ca8a"
	cbdbChainSuZheLocalAgentRef  = "local-agent:cbdb-chain-agent-chat-verifier-user:cbdb-song-slice-real-20260614-agent-8af2c5ca8a"
	cbdbChainDesktopCallerAppID  = "nimi.desktop.test.cbdb-agent-chat-runtime-chain"
	cbdbChainValidationThreadID  = "cbdb-chain-validation-thread"
	cbdbChainValidationRequestID = "cbdb-chain-validation-request"
)

func TestCBDBSeededRealmAgentLocalAgentRunsPublicChatTurn(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := testLocalAgentContext(cbdbChainVerifierOwnerID, cbdbChainSuZheRealmAgentID)
	ctx.AppId = cbdbChainDesktopCallerAppID

	initResp, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:       ctx,
		LocalAgentRef: cbdbChainSuZheLocalAgentRef,
		OwnerUserId:   cbdbChainVerifierOwnerID,
		RealmAgentId:  cbdbChainSuZheRealmAgentID,
		DisplayName:   "CBDB Su Zhe",
	})
	if err != nil {
		t.Fatalf("InitializeAgent(CBDB Su Zhe): %v", err)
	}
	if got := initResp.GetAgent().GetLocalAgentRef(); got != cbdbChainSuZheLocalAgentRef {
		t.Fatalf("expected CBDB local_agent_ref %q, got %q", cbdbChainSuZheLocalAgentRef, got)
	}
	if got := initResp.GetAgent().GetRealmAgentId(); got != cbdbChainSuZheRealmAgentID {
		t.Fatalf("expected CBDB realm_agent_id %q, got %q", cbdbChainSuZheRealmAgentID, got)
	}
	if got := initResp.GetAgent().GetOwnerUserId(); got != cbdbChainVerifierOwnerID {
		t.Fatalf("expected CBDB owner_user_id %q, got %q", cbdbChainVerifierOwnerID, got)
	}

	anchorMetadata, err := structpb.NewStruct(map[string]any{
		"surface": "desktop-agent-chat",
		"realm_profile_context": map[string]any{
			"owner_scope":                   "cbdb-curated-system",
			"source_profile":                "cbdb-historical",
			"display_name":                  "CBDB Su Zhe",
			"handle":                        "su-zhe",
			"world_id":                      "cbdb-song-slice-real-20260614-world",
			"world_name":                    "CBDB Song slice",
			"ownership_type":                "WORLD_OWNED",
			"avatar_url":                    "https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png",
			"default_voice_reference":       "preset_voice_id:zh_narrator",
			"speech_model_id":               "speech/qwen3tts",
			"speech_route_policy":           "local",
			"description":                   "Reviewed sparse CBDB profile for Runtime prompt validation.",
			"greeting":                      "Ask what the record supports before imagining.",
			"communication_style":           "Uses reviewed Song-literati register.",
			"selected_owner_setting_fields": []any{"communication.contentStyle"},
		},
	})
	if err != nil {
		t.Fatalf("structpb.NewStruct(anchorMetadata): %v", err)
	}
	anchorCtx := testLocalAgentContext(cbdbChainVerifierOwnerID, cbdbChainSuZheRealmAgentID)
	anchorCtx.AppId = cbdbChainDesktopCallerAppID
	anchorResp, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       anchorCtx,
		LocalAgentRef: cbdbChainSuZheLocalAgentRef,
		OwnerUserId:   cbdbChainVerifierOwnerID,
		RealmAgentId:  cbdbChainSuZheRealmAgentID,
		SubjectUserId: cbdbChainVerifierOwnerID,
		Metadata:      anchorMetadata,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor(CBDB profile context): %v", err)
	}
	anchorID := anchorResp.GetSnapshot().GetAnchor().GetConversationAnchorId()
	if strings.TrimSpace(anchorID) == "" {
		t.Fatalf("OpenConversationAnchor(CBDB profile context) returned empty anchor id")
	}
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	voiceAI := &fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-cbdb-chain-voice",
		modelResolved: "speech/qwen3tts-ready",
		artifact:      &runtimev1.ScenarioArtifact{ArtifactId: "artifact-cbdb-chain-voice", MimeType: "audio/wav"},
	}
	svc.SetVoiceLipsyncScenarioExecutor(voiceAI, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, req *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if got := strings.TrimSpace(req.AppID); got != cbdbChainDesktopCallerAppID {
				t.Fatalf("expected executor AppID %q, got %q", cbdbChainDesktopCallerAppID, got)
			}
			if got := strings.TrimSpace(req.SubjectUserID); got != cbdbChainVerifierOwnerID {
				t.Fatalf("expected executor SubjectUserID %q, got %q", cbdbChainVerifierOwnerID, got)
			}
			if len(req.Messages) != 1 || strings.TrimSpace(req.Messages[0].GetContent()) != "validate cbdb agent chat" {
				t.Fatalf("expected one CBDB validation user message, got %#v", req.Messages)
			}
			if got := req.Binding.ModelID; got != "local/default" {
				t.Fatalf("expected local/default binding, got %#v", req.Binding)
			}
			prompt := strings.TrimSpace(req.SystemPrompt)
			for _, expected := range []string{
				publicChatRealmProfilePromptHeader,
				"CBDB historical profile",
				"CBDB Su Zhe",
				"Ask what the record supports before imagining.",
				"Uses reviewed Song-literati register.",
				"https://cdn.example.com/cbdb/su-zhe-reviewed-portrait.png",
				"preset_voice_id:zh_narrator",
				"communication.contentStyle",
			} {
				if !strings.Contains(prompt, expected) {
					t.Fatalf("expected CBDB profile prompt to contain %q, got %q", expected, prompt)
				}
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-cbdb-chain",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "local/default",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-cbdb-chain",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{
								Text: publicChatStructuredEnvelopeAPML(
									"message-cbdb-chain",
									"CBDB runtime validation turn complete.",
								),
							},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-cbdb-chain",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			})
		},
	})

	if err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     cbdbChainDesktopCallerAppID,
		SubjectUserId: cbdbChainVerifierOwnerID,
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        cbdbChainSuZheLocalAgentRef,
			"owner_user_id":          cbdbChainVerifierOwnerID,
			"realm_agent_id":         cbdbChainSuZheRealmAgentID,
			"conversation_anchor_id": anchorID,
			"request_id":             cbdbChainValidationRequestID,
			"thread_id":              cbdbChainValidationThreadID,
			"messages": []any{
				map[string]any{"role": "user", "content": "validate cbdb agent chat"},
			},
			"execution_bindings": map[string]any{"text.generate": map[string]any{
				"route":    "local",
				"model_id": "local/default",
			}},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(CBDB turn): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	acceptedDetail := publicChatTurnDetail(t, accepted)
	if got := acceptedDetail["request_id"]; got != cbdbChainValidationRequestID {
		t.Fatalf("expected accepted request_id %q, got=%v", cbdbChainValidationRequestID, acceptedDetail)
	}
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnTextDeltaType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	voicePlayback := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackRequestedType)
	lipsyncBatch := capture.waitForMessageType(t, publicChatPresentationLipsyncFrameBatchType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	voicePayload := publicChatPayloadMap(t, voicePlayback)
	voiceDetail := voicePayload["detail"].(map[string]any)
	if got := strings.TrimSpace(voiceDetail["default_voice_reference"].(string)); got != "preset_voice_id:zh_narrator" {
		t.Fatalf("expected reviewed CBDB default voice reference on voice playback, got %q detail=%v", got, voiceDetail)
	}
	voiceRouteBinding, ok := voiceDetail["voice_route_binding"].(map[string]any)
	if !ok {
		t.Fatalf("expected CBDB voice playback to carry voice_route_binding, got %v", voiceDetail)
	}
	if got := strings.TrimSpace(voiceRouteBinding["capability"].(string)); got != "audio.synthesize" {
		t.Fatalf("expected CBDB voice route capability audio.synthesize, got %q", got)
	}
	if got := strings.TrimSpace(voiceRouteBinding["voice_reference_kind"].(string)); got != "preset_voice_id" {
		t.Fatalf("expected CBDB voice reference kind preset_voice_id, got %q", got)
	}
	if got := strings.TrimSpace(voiceRouteBinding["voice_reference_value"].(string)); got != "zh_narrator" {
		t.Fatalf("expected CBDB voice reference value zh_narrator, got %q", got)
	}
	if voiceAI.submitReq == nil {
		t.Fatalf("expected CBDB speech route to submit provider voice synthesis")
	}
	if got := voiceAI.submitReq.GetHead().GetModelId(); got != "speech/qwen3tts" {
		t.Fatalf("expected CBDB speech model id speech/qwen3tts, got %q", got)
	}
	if got := voiceAI.submitReq.GetHead().GetRoutePolicy(); got != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("expected CBDB speech route policy local, got %v", got)
	}
	if got := strings.TrimSpace(voiceRouteBinding["model_id"].(string)); got != "speech/qwen3tts" {
		t.Fatalf("expected CBDB voice model id speech/qwen3tts, got %q", got)
	}
	if got := strings.TrimSpace(voiceRouteBinding["synthesis_mode"].(string)); got != "provider_audio_with_synthetic_lipsync" {
		t.Fatalf("expected CBDB voice synthesis mode provider_audio_with_synthetic_lipsync, got %q", got)
	}
	if got := strings.TrimSpace(voiceRouteBinding["status"].(string)); got != "bound" {
		t.Fatalf("expected CBDB voice route status bound, got %q", got)
	}
	if got := strings.TrimSpace(voiceRouteBinding["reason"].(string)); got != "tts_provider_route_bound" {
		t.Fatalf("expected CBDB voice route reason tts_provider_route_bound, got %q", got)
	}
	audioArtifactID := strings.TrimSpace(voiceDetail["audio_artifact_id"].(string))
	record, ok := svc.runtimeArtifacts.Get(audioArtifactID)
	if !ok {
		t.Fatalf("expected CBDB voice lipsync artifact to be stored: %s", audioArtifactID)
	}
	if !strings.Contains(string(record.Bytes), "default_voice_reference=preset_voice_id:zh_narrator") {
		t.Fatalf("expected stored CBDB lipsync artifact to carry reviewed voice reference, got %q", string(record.Bytes))
	}
	if !strings.Contains(string(record.Bytes), "voice_route_status=bound") ||
		!strings.Contains(string(record.Bytes), "voice_route_reason=tts_provider_route_bound") {
		t.Fatalf("expected stored CBDB lipsync artifact to carry bound voice route binding, got %q", string(record.Bytes))
	}
	lipsyncPayload := publicChatPayloadMap(t, lipsyncBatch)
	lipsyncDetail := lipsyncPayload["detail"].(map[string]any)
	if got := strings.TrimSpace(lipsyncDetail["audio_artifact_id"].(string)); got != audioArtifactID {
		t.Fatalf("expected CBDB lipsync batch to use voice audio artifact %q, got %q", audioArtifactID, got)
	}

	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-cbdb-chain")
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	svc.chatSurfaceMu.Unlock()
	if anchor == nil {
		t.Fatalf("expected CBDB chat anchor %s to remain available", anchorID)
	}
	if got := anchor.LocalAgentRef; got != cbdbChainSuZheLocalAgentRef {
		t.Fatalf("expected anchor local_agent_ref %q, got %q", cbdbChainSuZheLocalAgentRef, got)
	}
	if got := anchor.OwnerUserID; got != cbdbChainVerifierOwnerID {
		t.Fatalf("expected anchor owner_user_id %q, got %q", cbdbChainVerifierOwnerID, got)
	}
	if got := anchor.RealmAgentID; got != cbdbChainSuZheRealmAgentID {
		t.Fatalf("expected anchor realm_agent_id %q, got %q", cbdbChainSuZheRealmAgentID, got)
	}
	detail := publicChatSessionSnapshotDetail(t, snapshot)
	if got := detail["thread_id"]; got != cbdbChainValidationThreadID {
		t.Fatalf("expected snapshot thread_id %q, got=%v", cbdbChainValidationThreadID, detail)
	}
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["text"]; got != "CBDB runtime validation turn complete." {
		t.Fatalf("expected CBDB runtime validation text, got=%v", lastTurn)
	}
	snapshotRaw := fmt.Sprint(snapshot.AsMap())
	if strings.Contains(snapshotRaw, "Uses reviewed Song-literati register.") {
		t.Fatalf("public session snapshot must not expose CBDB profile prompt context: %v", snapshotRaw)
	}

	waitForCBDBRuntimeAgentIdle(t, svc)
}

func waitForCBDBRuntimeAgentIdle(t *testing.T, svc *Service) {
	t.Helper()
	ctx := testLocalAgentContext(cbdbChainVerifierOwnerID, cbdbChainSuZheRealmAgentID)
	ctx.AppId = cbdbChainDesktopCallerAppID
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{
			Context: ctx,
			AgentId: cbdbChainSuZheLocalAgentRef,
		})
		if err == nil && resp.GetState().GetExecutionState() == runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for CBDB runtime agent %s to return to idle", cbdbChainSuZheLocalAgentRef)
}
