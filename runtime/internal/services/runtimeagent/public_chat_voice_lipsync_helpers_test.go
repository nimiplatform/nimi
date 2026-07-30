package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type idempotentVoiceLipsyncScenarioExecutor struct {
	submitReqs    []*runtimev1.SubmitScenarioJobRequest
	jobsByKey     map[string]string
	artifactByJob map[string]*runtimev1.ScenarioArtifact
	modelResolved string
	artifactIDs   []string
}

func (f *idempotentVoiceLipsyncScenarioExecutor) SubmitScenarioJob(_ context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	if f.jobsByKey == nil {
		f.jobsByKey = make(map[string]string)
	}
	if f.artifactByJob == nil {
		f.artifactByJob = make(map[string]*runtimev1.ScenarioArtifact)
	}
	key := strings.TrimSpace(req.GetIdempotencyKey())
	if jobID := f.jobsByKey[key]; jobID != "" {
		return &runtimev1.SubmitScenarioJobResponse{
			Job: &runtimev1.ScenarioJob{
				JobId:         jobID,
				Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
				ModelResolved: f.modelResolved,
			},
		}, nil
	}
	if len(f.submitReqs) >= len(f.artifactIDs) {
		return nil, fmt.Errorf("unexpected voice synthesis submission %d", len(f.submitReqs)+1)
	}
	jobID := fmt.Sprintf("job-provider-voice-history-%d", len(f.submitReqs)+1)
	f.submitReqs = append(f.submitReqs, req)
	f.jobsByKey[key] = jobID
	f.artifactByJob[jobID] = &runtimev1.ScenarioArtifact{
		ArtifactId: f.artifactIDs[len(f.submitReqs)-1],
		MimeType:   "audio/wav",
	}
	return &runtimev1.SubmitScenarioJobResponse{
		Job: &runtimev1.ScenarioJob{
			JobId:         jobID,
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			ModelResolved: f.modelResolved,
		},
	}, nil
}

func (f *idempotentVoiceLipsyncScenarioExecutor) GetScenarioJob(_ context.Context, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	return &runtimev1.GetScenarioJobResponse{
		Job: &runtimev1.ScenarioJob{
			JobId:         req.GetJobId(),
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			ModelResolved: f.modelResolved,
		},
	}, nil
}

func (f *idempotentVoiceLipsyncScenarioExecutor) GetScenarioArtifacts(_ context.Context, req *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	artifact := f.artifactByJob[strings.TrimSpace(req.GetJobId())]
	return &runtimev1.GetScenarioArtifactsResponse{
		JobId:     req.GetJobId(),
		Artifacts: []*runtimev1.ScenarioArtifact{artifact},
	}, nil
}

func publicChatVoicePolicyMetadata(t *testing.T, avatarAutoplay bool) *structpb.Struct {
	t.Helper()
	metadata, err := structpb.NewStruct(map[string]any{
		"realm_profile_context": map[string]any{
			"avatar_autoplay":         avatarAutoplay,
			"default_voice_reference": "preset_voice_id:nimi-default",
		},
	})
	if err != nil {
		t.Fatalf("structpb.NewStruct(voice policy metadata): %v", err)
	}
	return metadata
}

func setPublicChatTestPresentationProfile(t *testing.T, svc *Service, agentID string, callerAppID string, subjectUserID string, avatarAutoplay bool) {
	t.Helper()
	ctx := testLocalAgentContext(subjectUserID, agentID)
	ctx.AppId = callerAppID
	_, err := setTestAgentPresentationProfile(svc, context.Background(), &runtimev1.SetAgentPresentationProfileRequest{
		Context:          ctx,
		AgentId:          ctx.GetLocalAgentRef(),
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Profile{
			Profile: &runtimev1.AgentPresentationProfile{
				BackendKind:           runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM,
				AvatarAssetRef:        "runtime-presentation-avatar:test-vrm",
				ExpressionProfileRef:  "expression:test/calm",
				IdlePreset:            "idle-soft",
				InteractionPolicyRef:  "policy:test/ambient",
				DefaultVoiceReference: "preset_voice_id:nimi-default",
				AvatarAutoplay:        avatarAutoplay,
			},
		},
	})
	if err != nil {
		t.Fatalf("SetAgentPresentationProfile: %v", err)
	}
}

type blockingNativeVoiceScenarioExecutor struct {
	streamReq  *runtimev1.StreamScenarioRequest
	firstChunk chan struct{}
	release    chan struct{}
	canceled   chan struct{}
}

func newBlockingNativeVoiceScenarioExecutor() *blockingNativeVoiceScenarioExecutor {
	return &blockingNativeVoiceScenarioExecutor{
		firstChunk: make(chan struct{}),
		release:    make(chan struct{}),
		canceled:   make(chan struct{}),
	}
}

func (f *blockingNativeVoiceScenarioExecutor) SubmitScenarioJob(context.Context, *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	return nil, fmt.Errorf("blocking native voice test must not submit async batch job")
}

func (f *blockingNativeVoiceScenarioExecutor) GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	return nil, fmt.Errorf("blocking native voice test must not poll async batch job")
}

func (f *blockingNativeVoiceScenarioExecutor) GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return nil, fmt.Errorf("blocking native voice test must not read async batch artifacts")
}

func (f *blockingNativeVoiceScenarioExecutor) StreamScenario(req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	f.streamReq = req
	if err := stream.Send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
		Payload: &runtimev1.StreamScenarioEvent_Started{
			Started: &runtimev1.ScenarioStreamStarted{
				ModelResolved:   "speech/qwen3tts-native-interrupt",
				RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				VoiceOutputMode: runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
			},
		},
	}); err != nil {
		return err
	}
	if err := stream.Send(nativeVoiceArtifactDeltaEvent([]byte("RIFF-native-interrupt-1"))); err != nil {
		return err
	}
	close(f.firstChunk)
	select {
	case <-stream.Context().Done():
		close(f.canceled)
		return stream.Context().Err()
	case <-f.release:
		return stream.Send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
			Payload: &runtimev1.StreamScenarioEvent_Completed{
				Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
			},
		})
	}
}

func (f *blockingNativeVoiceScenarioExecutor) waitCanceled(t *testing.T) {
	t.Helper()
	timeout := time.NewTimer(10 * time.Second)
	defer timeout.Stop()
	select {
	case <-f.canceled:
	case <-timeout.C:
		t.Fatal("timed out waiting for native voice provider stream cancellation")
	}
}

func nativeVoiceArtifactDeltaEvent(chunk []byte) *runtimev1.StreamScenarioEvent {
	return &runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
		Payload: &runtimev1.StreamScenarioEvent_Delta{
			Delta: &runtimev1.ScenarioStreamDelta{
				Delta: &runtimev1.ScenarioStreamDelta_Artifact{
					Artifact: &runtimev1.ArtifactStreamDelta{
						Chunk:    chunk,
						MimeType: "audio/wav",
					},
				},
			},
		},
	}
}

func indexOfMessageType(types []string, want string) int {
	for index, messageType := range types {
		if messageType == want {
			return index
		}
	}
	return -1
}

func openPublicChatTestAnchorWithMetadata(t *testing.T, svc *Service, agentID string, callerAppID string, subjectUserID string, metadata *structpb.Struct) string {
	t.Helper()
	ctx := testLocalAgentContext(subjectUserID, agentID)
	ctx.AppId = callerAppID
	resp, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       ctx,
		SubjectUserId: subjectUserID,
		Metadata:      metadata,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor: %v", err)
	}
	anchorID := resp.GetSnapshot().GetAnchor().GetConversationAnchorId()
	if strings.TrimSpace(anchorID) == "" {
		t.Fatalf("OpenConversationAnchor returned empty anchor id")
	}
	return anchorID
}
