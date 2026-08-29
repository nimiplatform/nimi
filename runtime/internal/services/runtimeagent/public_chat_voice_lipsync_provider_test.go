package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
)

func TestPublicChatCommittedTurnSkipsVoiceProjectionWithoutVoiceConfiguration(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{
								Text: publicChatStructuredEnvelopeAPML("message-lipsync-1", "Hello world this turn drives lipsync."),
							},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
				},
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
			"request_id":             "lipsync-request-1",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))

	committedPayload := publicChatPayloadMap(t, committed)
	requirePublicChatTimelineEnvelope(t, committedPayload, turnID, streamID, publicChatTimelineChannelText)
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatConversationVoiceTimingReadyType ||
			messageType == publicChatConversationVoiceArtifactAvailableType {
			t.Fatalf("default text-only turn must not emit voice projection, got message types %v", capture.messageTypes())
		}
	}
}

func TestPublicChatCommittedTurnEmitsProviderVoiceProjectionWithoutAvatarAutoplay(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	installMachineAIConfigForTest(t, svc, "user-1", capabilitydriver.LlamaCapabilityContract, capabilitydriver.AudioSynthesizeContract)
	selectedText := machineLocalExecutionProjectionForTest("lcc-text", capabilitydriver.LlamaCapabilityContract, "local/default", nil)
	selectedSpeech := machineLocalExecutionProjectionForTest("lcc-audio-synthesize", capabilitydriver.AudioSynthesizeContract, "speech/qwen3tts", nil)
	selectedSpeech.DriverIdentity = &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: capabilitydriver.Qwen3TTSImplementationID,
		DriverId:         capabilitydriver.Qwen3TTSDriverID,
		DriverDialect:    capabilitydriver.Qwen3TTSDriverDialect,
	}
	selectedSpeech.Requirements[0].RequirementId = capabilitydriver.Qwen3TTSModelRequirementID
	selectedSpeech.ExactBindings[0].RequirementID = capabilitydriver.Qwen3TTSModelRequirementID
	svc.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{
		contracts: []string{capabilitydriver.LlamaCapabilityContract, capabilitydriver.AudioSynthesizeContract},
		projections: map[string]*localexecution.SelectedLocalExecution{
			capabilitydriver.LlamaCapabilityContract: selectedText,
			capabilitydriver.AudioSynthesizeContract: selectedSpeech,
		},
	})
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", false)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})

	const expectedAudioArtifactID = "artifact-provider-voice-lipsync-1"
	audioBytes := []byte("RIFF\x24\x00\x00\x00WAVEfmt ")
	if err := svc.runtimeArtifacts.Put(expectedAudioArtifactID, runtimeartifact.ArtifactRecord{
		Bytes:     audioBytes,
		MimeType:  "audio/wav",
		SizeBytes: int64(len(audioBytes)),
	}); err != nil {
		t.Fatalf("Put provider voice artifact: %v", err)
	}
	voiceAI := &fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-provider-voice-lipsync-1",
		modelResolved: "speech/qwen3tts-ready",
		artifact:      &runtimev1.ScenarioArtifact{ArtifactId: expectedAudioArtifactID, MimeType: "audio/wav"},
	}
	svc.SetVoiceLipsyncScenarioExecutor(voiceAI, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-provider-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				TraceId:   "trace-provider-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{
								Text: publicChatStructuredEnvelopeAPML("message-provider-lipsync-1", "Hello world this turn drives provider voice."),
							},
						},
					},
				},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-provider-lipsync",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
				},
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
			"request_id":             "lipsync-request-2",
			"messages": []any{
				map[string]any{"role": "user", "content": "hello"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	voiceChunk := capture.waitForMessageType(t, publicChatConversationVoiceArtifactAvailableType)
	voicePlayback := capture.waitForMessageType(t, publicChatConversationVoiceTimingReadyType)
	voiceTerminal := capture.waitForMessageType(t, publicChatConversationVoiceTimingTerminalType)

	voicePayload := publicChatPayloadMap(t, voicePlayback)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	committedPayload := publicChatPayloadMap(t, committed)
	messageID := strings.TrimSpace(committedPayload["message_id"].(string))
	requirePublicChatTimelineEnvelope(t, committedPayload, turnID, streamID, publicChatTimelineChannelText)
	chunkPayload := publicChatPayloadMap(t, voiceChunk)
	requirePublicChatTimelineEnvelope(t, chunkPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	chunkDetail := chunkPayload["detail"].(map[string]any)
	if got := strings.TrimSpace(chunkDetail["message_id"].(string)); got != messageID {
		t.Fatalf("expected semantic voice artifact message_id %s, got %s", messageID, got)
	}
	if got := strings.TrimSpace(chunkDetail["audio_artifact_id"].(string)); got != expectedAudioArtifactID {
		t.Fatalf("expected semantic voice artifact id %s, got %s", expectedAudioArtifactID, got)
	}
	if got := strings.TrimSpace(chunkDetail["audio_mime_type"].(string)); got != "audio/wav" {
		t.Fatalf("expected semantic voice artifact mime type audio/wav, got %s", got)
	}
	if got, _ := chunkDetail["artifact_sequence"].(float64); got != 1 {
		t.Fatalf("expected semantic voice artifact_sequence=1, got %v", chunkDetail["artifact_sequence"])
	}
	if got, ok := chunkDetail["artifact_complete"].(bool); !ok || !got {
		t.Fatalf("expected artifact_complete=true, got %v", chunkDetail["artifact_complete"])
	}
	if got := strings.TrimSpace(chunkDetail["voice_timing_phase"].(string)); got != "active" {
		t.Fatalf("expected semantic voice timing phase active, got %s", got)
	}
	requirePublicChatTimelineEnvelope(t, voicePayload, turnID, streamID, publicChatTimelineChannelVoice)
	voiceDetail := voicePayload["detail"].(map[string]any)
	if got := strings.TrimSpace(voiceDetail["message_id"].(string)); got != messageID {
		t.Fatalf("expected semantic voice timing message_id %s, got %s", messageID, got)
	}
	audioArtifactID := strings.TrimSpace(voiceDetail["audio_artifact_id"].(string))
	if audioArtifactID != expectedAudioArtifactID {
		t.Fatalf("expected provider audio artifact id %s, got %s", expectedAudioArtifactID, voiceDetail["audio_artifact_id"])
	}
	if got := strings.TrimSpace(voiceDetail["audio_mime_type"].(string)); got != "audio/wav" {
		t.Fatalf("expected provider audio mime type audio/wav, got %s", got)
	}
	record, ok := svc.runtimeArtifacts.Get(audioArtifactID)
	if !ok {
		t.Fatalf("expected provider audio artifact to remain readable before emit")
	}
	if string(record.Bytes) != string(audioBytes) {
		t.Fatalf("audio artifact bytes must not be overwritten by lipsync metadata, got %q", string(record.Bytes))
	}
	if got := strings.TrimSpace(record.MimeType); got != "audio/wav" {
		t.Fatalf("expected stored audio mime type audio/wav, got %s", got)
	}
	if record.GeneratedVoice == nil {
		t.Fatalf("expected generated voice retention metadata")
	}
	if got, want := strings.TrimSpace(record.GeneratedVoice.AgentID), strings.TrimSpace(voicePayload["agent_id"].(string)); got != want {
		t.Fatalf("expected generated voice agent_id %s, got %s", want, got)
	}
	if got, want := strings.TrimSpace(record.GeneratedVoice.ConversationAnchorID), strings.TrimSpace(voicePayload["conversation_anchor_id"].(string)); got != want {
		t.Fatalf("expected generated voice conversation_anchor_id %s, got %s", want, got)
	}
	if got := strings.TrimSpace(record.GeneratedVoice.MessageID); got != messageID {
		t.Fatalf("expected generated voice message_id %s, got %s", messageID, got)
	}
	if got := strings.TrimSpace(voiceDetail["voice_timing_phase"].(string)); got != "active" {
		t.Fatalf("expected semantic voice timing phase active, got %s", got)
	}
	terminalPayload := publicChatPayloadMap(t, voiceTerminal)
	requirePublicChatTimelineEnvelope(t, terminalPayload, turnID, streamID, publicChatTimelineChannelVoice, "K-AGCORE-133")
	terminalDetail := terminalPayload["detail"].(map[string]any)
	if got := strings.TrimSpace(terminalDetail["voice_timing_phase"].(string)); got != "completed" {
		t.Fatalf("expected semantic voice terminal phase completed, got %s", got)
	}
	if got := strings.TrimSpace(terminalDetail["terminal_reason"].(string)); got != "final_artifact_completed" {
		t.Fatalf("expected semantic voice terminal reason final_artifact_completed, got %s", got)
	}
	if got := strings.TrimSpace(terminalDetail["message_id"].(string)); got != messageID {
		t.Fatalf("expected semantic voice terminal message_id %s, got %s", messageID, got)
	}
	if got := strings.TrimSpace(terminalDetail["audio_artifact_id"].(string)); got != expectedAudioArtifactID {
		t.Fatalf("expected semantic voice terminal artifact id %s, got %s", expectedAudioArtifactID, got)
	}
	for _, forbidden := range []string{"playback_state", "voice_playback_state", "voice_output_mode", "voice_stream_id", "playback_target", "voice_route_binding", "mouth_open_y", "audio_level", "frames", "chunk_transport_ref"} {
		if _, exists := voiceDetail[forbidden]; exists {
			t.Fatalf("common voice projection exposed %s: %v", forbidden, voiceDetail)
		}
	}
	if voiceAI.submitReq == nil {
		t.Fatalf("expected provider voice synthesis submit")
	}
	if got := voiceAI.submitReq.GetSpec().GetSpeechSynthesize().GetTimingMode(); got != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED {
		t.Fatalf("autoplay injected unsupported timing mode %v", got)
	}
	intent, ok := executionintent.FromContext(voiceAI.submitCtx)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != "audio.synthesize" {
		t.Fatalf("expected private Local speech intent, got %+v, ok=%v", intent, ok)
	}
	captured, ok := localexecution.SelectedLocalExecutionFromContext(voiceAI.submitCtx, capabilitydriver.AudioSynthesizeContract)
	if !ok || captured.LoadoutID != selectedSpeech.LoadoutID {
		t.Fatalf("expected selected Local speech execution %q, got %+v, ok=%v", selectedSpeech.LoadoutID, captured, ok)
	}

}

func TestPublicChatCommittedTurnEmitsTypedVoiceFailureWithoutRollingBackText(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	installMachineAIConfigForTest(t, svc, "user-1", capabilitydriver.LlamaCapabilityContract, capabilitydriver.AudioSynthesizeContract)
	selectedText := machineLocalExecutionProjectionForTest("lcc-text", capabilitydriver.LlamaCapabilityContract, "local/default", nil)
	selectedSpeech := machineLocalExecutionProjectionForTest("lcc-audio-synthesize", capabilitydriver.AudioSynthesizeContract, "speech/qwen3tts", nil)
	selectedSpeech.DriverIdentity = &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: capabilitydriver.Qwen3TTSImplementationID,
		DriverId:         capabilitydriver.Qwen3TTSDriverID,
		DriverDialect:    capabilitydriver.Qwen3TTSDriverDialect,
	}
	selectedSpeech.Requirements[0].RequirementId = capabilitydriver.Qwen3TTSModelRequirementID
	selectedSpeech.ExactBindings[0].RequirementID = capabilitydriver.Qwen3TTSModelRequirementID
	svc.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{
		contracts: []string{capabilitydriver.LlamaCapabilityContract, capabilitydriver.AudioSynthesizeContract},
		projections: map[string]*localexecution.SelectedLocalExecution{
			capabilitydriver.LlamaCapabilityContract: selectedText,
			capabilitydriver.AudioSynthesizeContract: selectedSpeech,
		},
	})
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", true)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetVoiceLipsyncScenarioExecutor(&fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-provider-voice-load-failed",
		jobStatus:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		jobReasonCode: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED,
		jobReason:     "local execution model load failed",
	}, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "qwen3-chat", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				}},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
					Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{
						Text: publicChatStructuredEnvelopeAPML("message-provider-voice-failed", "Text remains committed after voice failure."),
					}},
				}},
			}); err != nil {
				return err
			}
			return emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
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
			"request_id":             "voice-failure-request",
			"messages":               []any{map[string]any{"role": "user", "content": "hello"}},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	committed := capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	terminal := capture.waitForMessageType(t, publicChatConversationVoiceTimingTerminalType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	committedDetail := publicChatPayloadMap(t, committed)["detail"].(map[string]any)
	if got := strings.TrimSpace(committedDetail["text"].(string)); got != "Text remains committed after voice failure." {
		t.Fatalf("committed text = %q", got)
	}
	terminalDetail := publicChatPayloadMap(t, terminal)["detail"].(map[string]any)
	if got := strings.TrimSpace(terminalDetail["voice_timing_phase"].(string)); got != "failed" {
		t.Fatalf("semantic voice terminal phase = %q, want failed", got)
	}
	if got := strings.TrimSpace(terminalDetail["terminal_reason"].(string)); got != "AI_LOCAL_EXECUTION_LOAD_FAILED" {
		t.Fatalf("voice terminal reason = %q, want AI_LOCAL_EXECUTION_LOAD_FAILED", got)
	}
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatConversationVoiceTimingReadyType {
			t.Fatalf("failed synthesis must not emit semantic timing ready: %v", capture.messageTypes())
		}
	}
}

func TestAgentVoicePolicyReportsMissingProductionLocalSelection(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	installMachineAIConfigForTest(t, svc, "user-1", capabilitydriver.LlamaCapabilityContract, capabilitydriver.AudioSynthesizeContract)
	svc.SetMachineLocalExecutionResolver(machineLocalExecutionResolverStub{
		contracts: []string{capabilitydriver.LlamaCapabilityContract},
		projections: map[string]*localexecution.SelectedLocalExecution{
			capabilitydriver.LlamaCapabilityContract: machineLocalExecutionProjectionForTest(
				"lcc-text", capabilitydriver.LlamaCapabilityContract, "local/default", nil,
			),
		},
	})
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", true)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	session := svc.chatAnchors[anchorID]
	svc.chatSurfaceMu.Unlock()

	policy, ok, reason := svc.publicChatRuntime().agentVoiceOutputPolicyForSession(context.Background(), *session)
	if ok {
		t.Fatalf("voice policy availability = %v, policy=%+v", ok, policy)
	}
	if reason != "AI_LOCAL_CONFIGURATION_NOT_CONFIGURED" {
		t.Fatalf("voice policy terminal reason = %q, want AI_LOCAL_CONFIGURATION_NOT_CONFIGURED", reason)
	}
}
