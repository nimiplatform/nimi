package runtimeagent

import (
	"context"
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestProactiveTextLeavesVoiceForExplicitAuthorizedRender(t *testing.T) {
	for _, origin := range []string{"contact", "life", publicChatTurnOriginFollowUp} {
		t.Run(origin, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", false)
			capture := newPublicChatEmitCapture()
			svc.SetPublicChatAppEmitter(capture.emit)
			called := false
			svc.voiceLipsync = retryVoiceSynth(func(voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
				called = true
				return voiceLipsyncSynthesisOutput{}, errors.New("background text has no App Job admission")
			})
			svc.chatSurfaceMu.Lock()
			session := *svc.chatAnchors[anchorID]
			svc.chatSurfaceMu.Unlock()
			svc.publicChatRuntime().projectCommittedConversationVoice(context.Background(), session, publicChatTurnState{
				ConversationAnchorID: anchorID, TurnID: "proactive-voice", StreamID: "proactive-stream", Origin: origin,
			}, &publicChatStructuredEnvelope{
				Message: publicChatStructuredMessage{MessageID: "proactive-message", Text: "A quiet evening."},
			})
			if called || len(capture.messageTypes()) != 0 {
				t.Fatal("autonomous text started an unauthorized speech Job or published a failed voice sidecar")
			}
		})
	}
}

func TestPublicChatCommittedTurnSkipsConversationVoiceOnEmptyText(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	session := publicChatAnchorState{
		ConversationAnchorID: "anchor-empty-1",
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}
	turn := publicChatTurnState{
		ConversationAnchorID: session.ConversationAnchorID,
		TurnID:               "turn-empty-1",
		StreamID:             "stream-empty-1",
	}
	emitted := 0
	svc.SetPublicChatAppEmitter(func(_ context.Context, _ *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
		emitted++
		return &runtimev1.SendAppMessageResponse{Accepted: true}, nil
	})

	svc.publicChatRuntime().projectCommittedConversationVoice(context.Background(), session, turn, &publicChatStructuredEnvelope{
		Message: publicChatStructuredMessage{MessageID: "message-empty", Text: "   "},
	})
	if emitted != 0 {
		t.Fatalf("expected zero emitted events for empty committed text, got %d", emitted)
	}
}

func TestPublicChatCommittedTurnDoesNotExposeReadyVoiceWithoutArtifactStore(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, publicChatTestAudioSynthesizeBinding())
	metadata := publicChatVoicePolicyMetadata(t, false)
	anchorID := openPublicChatTestAnchorWithMetadata(t, svc, "agent-alpha", "desktop.app", "user-1", metadata)
	setPublicChatTestPresentationProfile(t, svc, "agent-alpha", "desktop.app", "user-1", false)
	svc.SetVoiceLipsyncScenarioExecutor(&fakeVoiceLipsyncScenarioExecutor{
		jobID:    "job-no-store-voice",
		artifact: &runtimev1.ScenarioArtifact{ArtifactId: "artifact-no-store-voice", MimeType: "audio/wav"},
	}, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetRuntimeArtifactStore(nil)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)

	svc.publicChatRuntime().projectCommittedConversationVoice(context.Background(), publicChatAnchorState{
		ConversationAnchorID: anchorID,
		AgentID:              "agent-alpha",
		CallerAppID:          "desktop.app",
		SubjectUserID:        "user-1",
	}, publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               "turn-no-store-1",
		StreamID:             "stream-no-store-1",
	}, &publicChatStructuredEnvelope{
		Message: publicChatStructuredMessage{
			MessageID: "message-no-store-1",
			Text:      "artifact custody is required before Conversation voice becomes ready",
		},
	})
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatConversationVoiceTimingReadyType ||
			messageType == publicChatConversationVoiceArtifactAvailableType {
			t.Fatalf("voice without artifact custody became ready: %v", capture.messageTypes())
		}
	}
}
