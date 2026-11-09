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
					Delta: runtimeAgentTextStreamDelta(

						publicChatStructuredEnvelopeAPML("message-lipsync-1", "Hello world this turn drives lipsync.")),
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
	requireNoReadyVoicePresentation(t, svc)
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
					Delta: runtimeAgentTextStreamDelta(

						publicChatStructuredEnvelopeAPML("message-provider-lipsync-1", "Hello world this turn drives provider voice.")),
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
	artifact := waitForVoicePresentation(t, svc, runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_ARTIFACT_AVAILABLE)
	ready := waitForVoicePresentation(t, svc, runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_TIMING_READY)
	terminal := waitForVoicePresentation(t, svc, runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_TIMING_TERMINAL)
	acceptedPayload := publicChatPayloadMap(t, accepted)
	turnID := strings.TrimSpace(acceptedPayload["turn_id"].(string))
	streamID := strings.TrimSpace(acceptedPayload["stream_id"].(string))
	committedPayload := publicChatPayloadMap(t, committed)
	messageID := strings.TrimSpace(committedPayload["message_id"].(string))
	requirePublicChatTimelineEnvelope(t, committedPayload, turnID, streamID, publicChatTimelineChannelText)
	for _, detail := range []*runtimev1.AgentPresentationEventDetail{artifact, ready, terminal} {
		if detail.GetTurnId() != turnID || detail.GetStreamId() != streamID || detail.GetMessageId() != messageID || detail.GetConversationAnchorId() != anchorID || detail.GetAudioArtifactId() != expectedAudioArtifactID || detail.GetAudioMimeType() != "audio/wav" {
			t.Fatalf("voice presentation lost correlation or audio identity: %v", detail)
		}
	}
	if ready.GetVoiceTimingPhase() != runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_ACTIVE || terminal.GetVoiceTimingPhase() != runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_COMPLETED || terminal.GetTerminalReason() != "final_artifact_completed" {
		t.Fatalf("invalid voice lifecycle: ready=%v terminal=%v", ready, terminal)
	}
	for _, messageType := range capture.messageTypes() {
		if strings.HasPrefix(messageType, "runtime.agent.conversation.voice_") {
			t.Fatalf("voice was duplicated onto obsolete AppMessage delivery: %s", messageType)
		}
	}
	record, ok := svc.runtimeArtifacts.Get(expectedAudioArtifactID)
	if !ok || string(record.Bytes) != string(audioBytes) || record.MimeType != "audio/wav" {
		t.Fatalf("provider audio artifact is not retained unchanged: %v", record)
	}
	if record.GeneratedVoice == nil || record.GeneratedVoice.AgentID != testRuntimeAgentLocalRef("agent-alpha") || record.GeneratedVoice.ConversationAnchorID != anchorID || record.GeneratedVoice.MessageID != messageID {
		t.Fatalf("voice retention lost its owner: %v", record.GeneratedVoice)
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
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: runtimeAgentTextStreamDelta(

					publicChatStructuredEnvelopeAPML("message-provider-voice-failed", "Text remains committed after voice failure."))},
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
	terminal := waitForVoicePresentation(t, svc, runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_VOICE_TIMING_TERMINAL)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	committedDetail := publicChatPayloadMap(t, committed)["detail"].(map[string]any)
	if got := strings.TrimSpace(committedDetail["text"].(string)); got != "Text remains committed after voice failure." {
		t.Fatalf("committed text = %q", got)
	}
	if terminal.GetVoiceTimingPhase() != runtimev1.AgentVoiceTimingPhase_AGENT_VOICE_TIMING_PHASE_FAILED || terminal.GetTerminalReason() != "AI_LOCAL_EXECUTION_LOAD_FAILED" || terminal.GetAudioArtifactId() != "" {
		t.Fatalf("failure presentation lost its reason or invented audio: %v", terminal)
	}
	requireNoReadyVoicePresentation(t, svc)
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
