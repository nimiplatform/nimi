package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

type ownerCapturingNativeVoiceExecutor struct {
	*fakeVoiceLipsyncScenarioExecutor
	streamContext context.Context
}

type ownerAwareRuntimeAIVoiceAssetService struct {
	publicCalls  int
	privateCalls int
	asset        *runtimev1.VoiceAsset
}

func (s *ownerAwareRuntimeAIVoiceAssetService) GetVoiceAsset(
	context.Context,
	*runtimev1.GetVoiceAssetRequest,
) (*runtimev1.GetVoiceAssetResponse, error) {
	s.publicCalls++
	return nil, nil
}

func (s *ownerAwareRuntimeAIVoiceAssetService) ResolveRuntimeAgentVoiceAsset(
	_ context.Context,
	_ string,
	_ string,
) (*runtimev1.VoiceAsset, error) {
	s.privateCalls++
	return proto.Clone(s.asset).(*runtimev1.VoiceAsset), nil
}

func (f *ownerCapturingNativeVoiceExecutor) StreamScenario(
	req *runtimev1.StreamScenarioRequest,
	stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent],
) error {
	f.streamContext = stream.Context()
	return f.fakeVoiceLipsyncScenarioExecutor.StreamScenario(req, stream)
}

func TestAIBackedVoiceAssetResolverUsesOwnerAwareRuntimePrivateLookupForAutoplay(t *testing.T) {
	t.Parallel()
	aiService := &ownerAwareRuntimeAIVoiceAssetService{
		asset: &runtimev1.VoiceAsset{
			VoiceAssetId:  "voice-asset-song-lian",
			AppId:         "nimi.voice-demo",
			SubjectUserId: "user-1",
		},
	}
	resolver := NewAIBackedVoiceAssetResolver(aiService)
	asset, err := resolver.ResolveVoiceAsset(
		withRuntimeAgentVoiceAssetOwner(context.Background(), "user-1"),
		"voice-asset-song-lian",
	)
	if err != nil {
		t.Fatalf("ResolveVoiceAsset(runtime owner): %v", err)
	}
	if aiService.privateCalls != 1 || aiService.publicCalls != 0 {
		t.Fatalf("resolver calls private=%d public=%d, want private=1 public=0", aiService.privateCalls, aiService.publicCalls)
	}
	if asset.GetAppId() != "nimi.voice-demo" || asset.GetSubjectUserId() != "user-1" {
		t.Fatalf("owner-aware asset = %v", asset)
	}
}

func TestPublicChatVoiceAssetAutoplayPreservesVoiceDemoOwnerAndDashScopeTarget(t *testing.T) {
	t.Parallel()

	const (
		voiceDemoAppID = "nimi.voice-demo"
		ownerUserID    = "user-1"
		voiceAssetID   = "voice-asset-song-lian"
		connectorID    = "connector-dashscope-owner"
	)
	targetRef := &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
			Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
				Version:              "v2",
				ConnectorId:          connectorID,
				RemoteModelCatalogId: "dashscope/cosyvoice-v3-flash",
				ProviderModelId:      "cosyvoice-v3-flash",
				Provider:             "dashscope",
			},
		},
	}

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	upsertPublicChatTestAgentAIConfig(t, svc, &runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityAudioSynthesize,
		ModelId:     "dashscope/cosyvoice-v3-flash",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorId: connectorID,
		TargetRef:   proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
		Provider:    "dashscope",
	})
	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(_ context.Context, requestedID string) (*runtimev1.VoiceAsset, error) {
		return &runtimev1.VoiceAsset{
			VoiceAssetId:        requestedID,
			AppId:               voiceDemoAppID,
			SubjectUserId:       ownerUserID,
			WorkflowType:        runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_CLONE,
			Provider:            "dashscope",
			TargetModelId:       "dashscope/cosyvoice-v3-flash",
			ProviderVoiceRef:    "cosyvoice-song-lian",
			Persistence:         runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
			Status:              runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE,
			TargetRef:           proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
			VoiceAssetTargetRef: proto.Clone(targetRef).(*runtimev1.RuntimeDurableTargetRef),
		}, nil
	}))

	presentationContext := testLocalAgentContext(ownerUserID, "agent-alpha")
	presentationContext.AppId = voiceDemoAppID
	commitContext := metadata.NewIncomingContext(
		authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: ownerUserID}),
		metadata.Pairs("x-nimi-app-id", voiceDemoAppID),
	)
	if _, err := setTestAgentPresentationProfile(svc, commitContext, &runtimev1.SetAgentPresentationProfileRequest{
		Context:          presentationContext,
		AgentId:          presentationContext.GetLocalAgentRef(),
		ExpectedRevision: proto.Uint64(0),
		Mutation: &runtimev1.SetAgentPresentationProfileRequest_Patch{
			Patch: &runtimev1.AgentPresentationProfilePatch{
				DefaultVoiceReference: proto.String("voice_asset_id:" + voiceAssetID),
				AvatarAutoplay:        proto.Bool(true),
			},
		},
	}); err != nil {
		t.Fatalf("commit Voice Demo-owned presentation voice: %v", err)
	}

	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", ownerUserID)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	voiceAI := &ownerCapturingNativeVoiceExecutor{
		fakeVoiceLipsyncScenarioExecutor: &fakeVoiceLipsyncScenarioExecutor{
			modelResolved: "dashscope/cosyvoice-v3-flash",
			streamEvents: []*runtimev1.StreamScenarioEvent{
				{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
					Payload: &runtimev1.StreamScenarioEvent_Started{
						Started: &runtimev1.ScenarioStreamStarted{
							ModelResolved:   "dashscope/cosyvoice-v3-flash",
							RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
							VoiceOutputMode: runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM,
						},
					},
				},
				nativeVoiceArtifactDeltaEvent([]byte("RIFF-song-lian-native-audio")),
				{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
					Payload: &runtimev1.StreamScenarioEvent_Completed{
						Completed: &runtimev1.ScenarioStreamCompleted{
							FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
						},
					},
				},
			},
		},
	}
	svc.SetVoiceLipsyncScenarioExecutor(voiceAI, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "gemma-4-26b",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			}); err != nil {
				return err
			}
			if err := emit(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{
								Text: publicChatStructuredEnvelopeAPML(
									"message-song-lian-native-voice",
									"宋濂的 Runtime Agent 回复应自动生成原生语音。",
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
		FromAppId:     "desktop.app",
		SubjectUserId: ownerUserID,
		MessageType:   publicChatTurnRequestType,
		Payload: publicChatStructPayload(t, map[string]any{
			"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
			"owner_user_id":          ownerUserID,
			"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
			"conversation_anchor_id": anchorID,
			"request_id":             "song-lian-native-voice-request",
			"messages": []any{
				map[string]any{"role": "user", "content": "请做一次自动语音回复"},
			},
		}),
	}); err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(request): %v", err)
	}

	_ = capture.waitForMessageType(t, publicChatPresentationVoiceStreamChunkType)
	_ = capture.waitForMessageType(t, publicChatPresentationVoicePlaybackRequestedType)
	terminal := capture.waitForMessageType(t, publicChatPresentationVoicePlaybackTerminalType)
	terminalDetail := publicChatPayloadMap(t, terminal)["detail"].(map[string]any)
	if got := strings.TrimSpace(terminalDetail["voice_playback_state"].(string)); got != "completed" {
		t.Fatalf("voice playback terminal state = %q, want completed", got)
	}

	if voiceAI.streamReq == nil {
		t.Fatal("expected native DashScope StreamScenario request")
	}
	head := voiceAI.streamReq.GetHead()
	if head.GetAppId() != voiceDemoAppID || head.GetSubjectUserId() != ownerUserID {
		t.Fatalf("voice execution owner = %q/%q, want %q/%q", head.GetAppId(), head.GetSubjectUserId(), voiceDemoAppID, ownerUserID)
	}
	if head.GetConnectorId() != connectorID || !proto.Equal(head.GetTargetRef(), targetRef) {
		t.Fatalf("voice execution lost committed connector/target: head=%v", head)
	}
	voiceRef := voiceAI.streamReq.GetSpec().GetSpeechSynthesize().GetVoiceRef()
	if voiceRef.GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET ||
		voiceRef.GetVoiceAssetId() != voiceAssetID {
		t.Fatalf("voice execution reference = %v, want voice_asset_id:%s", voiceRef, voiceAssetID)
	}
	incoming, _ := metadata.FromIncomingContext(voiceAI.streamContext)
	identity := authn.IdentityFromContext(voiceAI.streamContext)
	if got := strings.TrimSpace(firstString(incoming.Get("x-nimi-app-id"))); got != voiceDemoAppID {
		t.Fatalf("voice execution context app = %q, want %q", got, voiceDemoAppID)
	}
	if identity == nil || strings.TrimSpace(identity.SubjectUserID) != ownerUserID {
		t.Fatalf("voice execution context owner = %#v, want %q", identity, ownerUserID)
	}
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
