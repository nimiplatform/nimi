package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	cbdbChainVerifierOwnerID     = "cbdb-chain-agent-chat-verifier-user"
	cbdbChainSuZheLocalAgentRef  = "local-agent:runtime-8af2c5ca8af2c5ca8af2c5ca8af2c5ca"
	cbdbChainDesktopCallerAppID  = "nimi.desktop.test.cbdb-agent-chat-runtime-chain"
	cbdbChainValidationRequestID = "cbdb-chain-validation-request"
)

var cbdbChainSuZheRuntimeSourceRef = testRuntimeAgentSourceRef("cbdb-song-slice-real-20260614-agent-8af2c5ca8a")

func TestCBDBAgentChatIgnoresForgedAnchorMetadataForModelContext(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ctx := testLocalAgentContext(cbdbChainVerifierOwnerID, cbdbChainSuZheRuntimeSourceRef)
	ctx.AppId = cbdbChainDesktopCallerAppID
	ctx.LocalAgentRef = cbdbChainSuZheLocalAgentRef

	initResp, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context:          ctx,
		LocalAgentRef:    cbdbChainSuZheLocalAgentRef,
		OwnerUserId:      cbdbChainVerifierOwnerID,
		RuntimeSourceRef: cbdbChainSuZheRuntimeSourceRef,
	})
	if err != nil {
		t.Fatalf("RealmSourceMaterialization(CBDB Su Zhe): %v", err)
	}
	if got := initResp.GetAgent().GetLocalAgentRef(); got != cbdbChainSuZheLocalAgentRef {
		t.Fatalf("expected CBDB local_agent_ref %q, got %q", cbdbChainSuZheLocalAgentRef, got)
	}
	if got := initResp.GetAgent().GetRuntimeSourceRef(); got != cbdbChainSuZheRuntimeSourceRef {
		t.Fatalf("expected CBDB runtime_source_ref %q, got %q", cbdbChainSuZheRuntimeSourceRef, got)
	}
	if got := initResp.GetAgent().GetOwnerUserId(); got != cbdbChainVerifierOwnerID {
		t.Fatalf("expected CBDB owner_user_id %q, got %q", cbdbChainVerifierOwnerID, got)
	}
	upsertPublicChatTestAgentAIConfigForContext(t, svc, ctx, publicChatTestAudioSynthesizeBinding())
	if _, err := setTestAgentPresentationProfile(svc, context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          ctx,
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{Profile: &runtimev1.AgentPresentationProfile{
			BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
			AvatarAssetRef:        "cbdb-su-zhe-avatar",
			DefaultVoiceReference: "preset_voice_id:zh_narrator",
			AvatarAutoplay:        true,
		}},
	}); err != nil {
		t.Fatalf("SetAgentPresentationProfile(CBDB Su Zhe): %v", err)
	}

	anchorMetadata, err := structpb.NewStruct(map[string]any{
		"surface": "desktop-agent-chat",
		"realm_profile_context": map[string]any{
			"owner_scope":                   "cbdb-curated-system",
			"source_profile":                "cbdb-historical",
			"display_name":                  "FORGED METADATA NAME",
			"handle":                        "forged-metadata-handle",
			"world_id":                      "forged-metadata-world-id",
			"world_name":                    "FORGED METADATA WORLD",
			"ownership_type":                "WORLD_OWNED",
			"avatar_url":                    "https://forged.invalid/metadata-avatar.png",
			"avatar_autoplay":               true,
			"default_voice_reference":       "preset_voice_id:forged_metadata_voice",
			"description":                   "FORGED METADATA DESCRIPTION",
			"greeting":                      "FORGED METADATA GREETING",
			"communication_style":           "FORGED METADATA STYLE",
			"selected_owner_setting_fields": []any{"communication.contentStyle"},
		},
	})
	if err != nil {
		t.Fatalf("structpb.NewStruct(anchorMetadata): %v", err)
	}
	anchorCtx := testLocalAgentContext(cbdbChainVerifierOwnerID, cbdbChainSuZheRuntimeSourceRef)
	anchorCtx.AppId = cbdbChainDesktopCallerAppID
	anchorCtx.LocalAgentRef = cbdbChainSuZheLocalAgentRef
	anchorResp, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:          anchorCtx,
		LocalAgentRef:    cbdbChainSuZheLocalAgentRef,
		OwnerUserId:      cbdbChainVerifierOwnerID,
		RuntimeSourceRef: cbdbChainSuZheRuntimeSourceRef,
		SubjectUserId:    cbdbChainVerifierOwnerID,
		Metadata:         anchorMetadata,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor(CBDB profile context): %v", err)
	}
	anchorID := anchorResp.GetSnapshot().GetAnchor().GetConversationAnchorId()
	if strings.TrimSpace(anchorID) == "" {
		t.Fatalf("OpenConversationAnchor(CBDB profile context) returned empty anchor id")
	}
	runtimeThreadID := publicChatTestAnchorThreadID(t, svc, anchorID)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	audioBytes := []byte("RIFF\x24\x00\x00\x00WAVEfmt ")
	if err := svc.runtimeArtifacts.Put("artifact-cbdb-chain-voice", runtimeartifact.ArtifactRecord{
		Bytes:     audioBytes,
		MimeType:  "audio/wav",
		SizeBytes: int64(len(audioBytes)),
	}); err != nil {
		t.Fatalf("Put CBDB voice artifact: %v", err)
	}
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
			if len(req.Messages) < 2 || strings.TrimSpace(req.Messages[len(req.Messages)-2].GetRole()) != "user" || strings.TrimSpace(req.Messages[len(req.Messages)-2].GetContent()) != "validate cbdb agent chat" || !strings.Contains(req.Messages[len(req.Messages)-1].GetContent(), "Runtime APML contract") {
				t.Fatalf("expected composed context to end with the CBDB validation user message, got %#v", req.Messages)
			}
			if got := req.Binding.ModelID; got != "local/default" {
				t.Fatalf("expected local/default binding, got %#v", req.Binding)
			}
			if got := req.MaxTokens; got != 777 {
				t.Fatalf("expected provider max_tokens to equal explicit manifest reserve 777, got %d", got)
			}
			var providerContext strings.Builder
			for _, message := range req.Messages {
				providerContext.WriteString(message.GetContent())
				providerContext.WriteByte('\n')
			}
			prompt := providerContext.String()
			for _, forbidden := range []string{
				"FORGED METADATA NAME",
				"FORGED METADATA WORLD",
				"FORGED METADATA DESCRIPTION",
				"FORGED METADATA GREETING",
				"FORGED METADATA STYLE",
				"forged_metadata_voice",
				"forged.invalid",
			} {
				if strings.Contains(prompt, forbidden) {
					t.Fatalf("forged anchor metadata %q reached model context: %q", forbidden, prompt)
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
			"runtime_source_ref":     cbdbChainSuZheRuntimeSourceRef,
			"conversation_anchor_id": anchorID,
			"request_id":             cbdbChainValidationRequestID,
			"thread_id":              runtimeThreadID,
			"max_output_tokens":      777,
			"messages": []any{
				map[string]any{"role": "user", "content": "validate cbdb agent chat"},
			},
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
	voiceTiming := capture.waitForMessageType(t, publicChatConversationVoiceTimingReadyType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	voicePayload := publicChatPayloadMap(t, voiceTiming)
	voiceDetail := voicePayload["detail"].(map[string]any)
	if got := strings.TrimSpace(voiceDetail["audio_artifact_id"].(string)); got == "" {
		t.Fatalf("expected Runtime-owned semantic voice artifact correlation, detail=%v", voiceDetail)
	}
	for _, forbidden := range []string{"default_voice_reference", "voice_route_binding", "model_id", "model_resolved", "scenario_job_id", "synthesis_mode", "mouth_open_y", "audio_level", "playback_target"} {
		if _, exists := voiceDetail[forbidden]; exists {
			t.Fatalf("common voice projection exposed %s: %v", forbidden, voiceDetail)
		}
	}
	if voiceAI.submitReq == nil {
		t.Fatalf("expected CBDB speech route to submit provider voice synthesis")
	}
	intent, ok := executionintent.FromContext(voiceAI.submitCtx)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != "audio.synthesize" {
		t.Fatalf("expected CBDB private Local speech intent, got %+v, ok=%v", intent, ok)
	}
	audioArtifactID := strings.TrimSpace(voiceDetail["audio_artifact_id"].(string))
	record, ok := svc.runtimeArtifacts.Get(audioArtifactID)
	if !ok {
		t.Fatalf("expected CBDB voice audio artifact to be stored: %s", audioArtifactID)
	}
	if string(record.Bytes) != string(audioBytes) {
		t.Fatalf("CBDB audio artifact bytes must not be overwritten by lipsync metadata, got %q", string(record.Bytes))
	}
	if got := strings.TrimSpace(record.MimeType); got != "audio/wav" {
		t.Fatalf("expected stored CBDB audio mime type audio/wav, got %s", got)
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
	if got := anchor.RuntimeSourceRef; got != cbdbChainSuZheRuntimeSourceRef {
		t.Fatalf("expected anchor runtime_source_ref %q, got %q", cbdbChainSuZheRuntimeSourceRef, got)
	}
	detail := publicChatSessionSnapshotDetail(t, snapshot)
	if got := detail["thread_id"]; got != runtimeThreadID {
		t.Fatalf("expected snapshot Runtime-owned thread_id %q, got=%v", runtimeThreadID, detail)
	}
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["text"]; got != "CBDB runtime validation turn complete." {
		t.Fatalf("expected CBDB runtime validation text, got=%v", lastTurn)
	}
	snapshotRaw := fmt.Sprint(snapshot.AsMap())
	if strings.Contains(snapshotRaw, "FORGED METADATA STYLE") {
		t.Fatalf("public session snapshot must not expose forged model context: %v", snapshotRaw)
	}

	waitForCBDBRuntimeAgentIdle(t, svc)
}

func waitForCBDBRuntimeAgentIdle(t *testing.T, svc *Service) {
	t.Helper()
	ctx := testLocalAgentContext(cbdbChainVerifierOwnerID, cbdbChainSuZheRuntimeSourceRef)
	ctx.AppId = cbdbChainDesktopCallerAppID
	ctx.LocalAgentRef = cbdbChainSuZheLocalAgentRef
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
