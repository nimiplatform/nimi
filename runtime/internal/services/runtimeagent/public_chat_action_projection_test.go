package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type stubPublicChatActionExecutor struct {
	result  PublicChatActionExecutionResult
	err     error
	calls   int
	request PublicChatActionExecutionRequest
}

type interruptiblePublicChatActionExecutor struct {
	entered chan struct{}
}

func (e *interruptiblePublicChatActionExecutor) ExecuteImageAction(ctx context.Context, _ PublicChatActionExecutionRequest) (PublicChatActionExecutionResult, error) {
	close(e.entered)
	<-ctx.Done()
	return PublicChatActionExecutionResult{}, ctx.Err()
}

type capturePublicChatImageScenarioExecutor struct {
	submitRequest *runtimev1.SubmitScenarioJobRequest
	submitContext context.Context
}

type cancelObservedPublicChatImageScenarioExecutor struct {
	submitted     chan struct{}
	cancelRequest *runtimev1.CancelScenarioJobRequest
	cancelContext context.Context
}

func (f *capturePublicChatImageScenarioExecutor) SubmitScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	f.submitRequest = proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
	f.submitContext = ctx
	return &runtimev1.SubmitScenarioJobResponse{
		Job: &runtimev1.ScenarioJob{
			JobId:         "job-image-config-params",
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			ModelResolved: "captured-model",
		},
	}, nil
}

func (f *capturePublicChatImageScenarioExecutor) GetScenarioJob(_ context.Context, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	return &runtimev1.GetScenarioJobResponse{
		Job: &runtimev1.ScenarioJob{
			JobId:         req.GetJobId(),
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			ModelResolved: "z-image-turbo",
		},
	}, nil
}

func (f *capturePublicChatImageScenarioExecutor) GetScenarioArtifacts(_ context.Context, req *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return &runtimev1.GetScenarioArtifactsResponse{
		JobId: req.GetJobId(),
		Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "artifact-image-config-params",
			MimeType:   "image/png",
		}},
	}, nil
}

func (f *capturePublicChatImageScenarioExecutor) CancelScenarioJob(_ context.Context, req *runtimev1.CancelScenarioJobRequest) (*runtimev1.CancelScenarioJobResponse, error) {
	return &runtimev1.CancelScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  req.GetJobId(),
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
	}}, nil
}

func (f *cancelObservedPublicChatImageScenarioExecutor) SubmitScenarioJob(_ context.Context, _ *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	close(f.submitted)
	return &runtimev1.SubmitScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  "job-image-context-canceled",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
	}}, nil
}

func (f *cancelObservedPublicChatImageScenarioExecutor) GetScenarioJob(_ context.Context, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	return &runtimev1.GetScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  req.GetJobId(),
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	}}, nil
}

func (f *cancelObservedPublicChatImageScenarioExecutor) GetScenarioArtifacts(_ context.Context, _ *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return nil, fmt.Errorf("artifacts must not be read after action cancellation")
}

func (f *cancelObservedPublicChatImageScenarioExecutor) CancelScenarioJob(ctx context.Context, req *runtimev1.CancelScenarioJobRequest) (*runtimev1.CancelScenarioJobResponse, error) {
	f.cancelContext = ctx
	f.cancelRequest = proto.Clone(req).(*runtimev1.CancelScenarioJobRequest)
	return &runtimev1.CancelScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  req.GetJobId(),
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
	}}, nil
}

func (s *stubPublicChatActionExecutor) ExecuteImageAction(_ context.Context, req PublicChatActionExecutionRequest) (PublicChatActionExecutionResult, error) {
	s.calls++
	s.request = req
	if s.err != nil {
		return PublicChatActionExecutionResult{}, s.err
	}
	return s.result, nil
}

func publicChatImageActionAPML(messageID string, text string, actionID string, prompt string) string {
	return strings.Join([]string{
		fmt.Sprintf(`<message id="%s">%s</message>`, messageID, text),
		fmt.Sprintf(`<action id="%s" kind="image">`, actionID),
		fmt.Sprintf(`<prompt-payload kind="image"><prompt-text>%s</prompt-text></prompt-payload>`, prompt),
		`</action>`,
	}, "")
}

func emitPublicChatImageActionStream(traceID string, rawAPML string) func(context.Context, *PublicChatTurnExecutionRequest, func(*runtimev1.StreamScenarioEvent) error) error {
	return func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
		if err := emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
			TraceId:   traceID,
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
			TraceId:   traceID,
			Payload: &runtimev1.StreamScenarioEvent_Delta{
				Delta: &runtimev1.ScenarioStreamDelta{
					Delta: &runtimev1.ScenarioStreamDelta_Text{
						Text: &runtimev1.TextStreamDelta{Text: rawAPML},
					},
				},
			},
		}); err != nil {
			return err
		}
		return emit(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
			TraceId:   traceID,
			Payload: &runtimev1.StreamScenarioEvent_Completed{
				Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				},
			},
		})
	}
}

func TestPublicChatImageActionSubmitRequestUsesAdmittedArtifactOwner(t *testing.T) {
	t.Parallel()
	targetRef := &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID: "connector-image", RemoteModelCatalogID: "remote-catalog-image",
		ProviderModelID: "gpt-image-1.5", Provider: "openai",
	}}

	req := buildPublicChatImageActionSubmitRequest(publicChatExecutionBinding{
		ModelID:     "gpt-image-1.5",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorID: "connector-image",
		TargetRef:   targetRef,
	}, map[string]any{
		"size":           "1024x1024",
		"responseFormat": "b64_json",
	}, "studio portrait of the current local agent", "runtime-agent-image-action:test", time.Second, "desktop.app", "user-1")

	head := req.GetHead()
	if head == nil {
		t.Fatal("expected image action submit request head")
	}
	if head.GetAppId() != "desktop.app" || head.GetSubjectUserId() != "user-1" {
		t.Fatalf("unexpected image artifact owner %q/%q", head.GetAppId(), head.GetSubjectUserId())
	}
}

func TestPublicChatImageActionUsesCommittedAIConfigSelectedParams(t *testing.T) {
	t.Parallel()
	selectedParams, err := structpb.NewStruct(map[string]any{
		"size":              "768x768",
		"responseFormat":    "base64",
		"seed":              "42",
		"timeoutMs":         "1200000",
		"steps":             "7",
		"cfgScale":          "1.5",
		"sampler":           "euler_a",
		"scheduler":         "karras",
		"profile_entries":   []any{map[string]any{"entry_id": "caller-workflow"}},
		"entry_overrides":   map[string]any{"main": "caller-asset"},
		"profile_overrides": map[string]any{"backend": "caller-backend"},
	})
	if err != nil {
		t.Fatalf("selected params: %v", err)
	}
	targetRef := publicChatTestLocalRuntimeTargetRef("profile_workflow:z-image-turbo")
	binding := publicChatExecutionBinding{
		ModelID: "z-image-turbo", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef: targetRef, SelectedParams: clonePublicChatSelectedParams(selectedParams),
	}
	selectedParams.Fields["steps"] = structpb.NewStringValue("99")

	scenario := &capturePublicChatImageScenarioExecutor{}
	executor := NewAIBackedPublicChatActionExecutor(scenario)
	_, err = executor.ExecuteImageAction(context.Background(), PublicChatActionExecutionRequest{
		Session: publicChatAnchorState{
			CallerAppID: "desktop.app",
			OwnerUserID: "user-1",
			Bindings: publicChatExecutionBindings{
				runtimeAgentAIConfigCapabilityImageGenerate: binding,
			},
		},
		Turn: publicChatTurnState{TurnID: "turn-image-config-params"},
		Action: publicChatStructuredAction{
			ActionID:  "action-image-config-params",
			Modality:  "image",
			Operation: "image.generate",
			PromptPayload: publicChatStructuredPromptPayload{
				Kind:       "image-prompt",
				PromptText: "minimal watercolor forest",
			},
		},
	})
	if err != nil {
		t.Fatalf("ExecuteImageAction: %v", err)
	}
	req := scenario.submitRequest
	if req == nil {
		t.Fatal("expected SubmitScenarioJob request")
	}
	intent, ok := executionintent.FromContext(scenario.submitContext)
	if !ok || !intent.IsLocal() {
		t.Fatalf("private Local intent missing: %+v, ok=%v", intent, ok)
	}
	incoming, _ := metadata.FromIncomingContext(scenario.submitContext)
	if got := strings.TrimSpace(firstString(incoming.Get("x-nimi-app-id"))); got != "desktop.app" {
		t.Fatalf("image execution app = %q, want desktop.app", got)
	}
	identity := authn.IdentityFromContext(scenario.submitContext)
	if identity == nil || strings.TrimSpace(identity.SubjectUserID) != "user-1" {
		t.Fatalf("image execution subject = %+v, want user-1", identity)
	}
	if head := req.GetHead(); head.GetAppId() != "desktop.app" || head.GetSubjectUserId() != "user-1" {
		t.Fatalf("image artifact owner = %q/%q, want desktop.app/user-1", head.GetAppId(), head.GetSubjectUserId())
	}
	if got := req.GetHead().GetTimeoutMs(); got != 1200000 {
		t.Fatalf("timeout_ms = %d, want 1200000", got)
	}
	spec := req.GetSpec().GetImageGenerate()
	if spec.GetSize() != "768x768" || spec.GetResponseFormat() != "b64_json" || spec.GetSeed() != 42 {
		t.Fatalf("image spec did not use committed selected params: %+v", spec)
	}
	if len(req.GetExtensions()) != 1 {
		t.Fatalf("image extensions = %d, want 1", len(req.GetExtensions()))
	}
	payload := req.GetExtensions()[0].GetPayload().AsMap()
	for key, want := range map[string]any{
		"step":      "7",
		"cfg_scale": "1.5",
		"mode":      "euler_a",
		"scheduler": "karras",
	} {
		if got := payload[key]; got != want {
			t.Fatalf("image extension %s = %#v, want %#v; payload=%#v", key, got, want, payload)
		}
	}
	for _, reservedKey := range []string{"profile_entries", "entry_overrides", "profile_overrides"} {
		if _, exists := payload[reservedKey]; exists {
			t.Fatalf("AIConfig parameters must not carry private profile composition key %q: %#v", reservedKey, payload)
		}
	}
}

func TestPublicChatImageActionContextCancellationCancelsOwnedScenarioJob(t *testing.T) {
	t.Parallel()

	scenario := &cancelObservedPublicChatImageScenarioExecutor{submitted: make(chan struct{})}
	executor := NewAIBackedPublicChatActionExecutor(scenario).(*aiBackedPublicChatActionExecutor)
	executor.pollInterval = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := executor.ExecuteImageAction(ctx, PublicChatActionExecutionRequest{
			Session: publicChatAnchorState{
				CallerAppID: "desktop.app",
				OwnerUserID: "user-1",
				Bindings: publicChatExecutionBindings{
					runtimeAgentAIConfigCapabilityImageGenerate: {
						ModelID:     "z-image-turbo",
						RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
						TargetRef:   publicChatTestLocalRuntimeTargetRef("profile_workflow:z-image-turbo"),
					},
				},
			},
			Turn: publicChatTurnState{TurnID: "turn-image-context-canceled"},
			Action: publicChatStructuredAction{
				ActionID:  "action-image-context-canceled",
				Modality:  "image",
				Operation: "image.generate",
				PromptPayload: publicChatStructuredPromptPayload{
					Kind:       "image-prompt",
					PromptText: "a quiet library",
				},
			},
		})
		done <- err
	}()

	select {
	case <-scenario.submitted:
	case <-time.After(time.Second):
		t.Fatal("image action was not submitted")
	}
	cancel()

	select {
	case err := <-done:
		if got, ok := grpcerr.ExtractReasonCode(err); !ok || got != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED {
			t.Fatalf("reason = %s, ok=%v, want %s; err=%v", got, ok, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED, err)
		}
	case <-time.After(time.Second):
		t.Fatal("image action did not return after context cancellation")
	}

	if scenario.cancelRequest == nil {
		t.Fatal("expected the submitted Scenario job to be canceled")
	}
	if got := scenario.cancelRequest.GetJobId(); got != "job-image-context-canceled" {
		t.Fatalf("canceled job = %q, want job-image-context-canceled", got)
	}
	if strings.TrimSpace(scenario.cancelRequest.GetReason()) == "" {
		t.Fatal("expected a cancellation reason")
	}
	incoming, _ := metadata.FromIncomingContext(scenario.cancelContext)
	if got := strings.TrimSpace(firstString(incoming.Get("x-nimi-app-id"))); got != "desktop.app" {
		t.Fatalf("cancel app = %q, want desktop.app", got)
	}
	identity := authn.IdentityFromContext(scenario.cancelContext)
	if identity == nil || strings.TrimSpace(identity.SubjectUserID) != "user-1" {
		t.Fatalf("cancel subject = %+v, want user-1", identity)
	}
}

func TestPublicChatImageActionUsesRouteAppropriateDefaultTimeout(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		binding     publicChatExecutionBinding
		wantTimeout time.Duration
	}{
		{
			name: "local",
			binding: publicChatExecutionBinding{
				ModelID:     "z-image-turbo",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				TargetRef:   publicChatTestLocalRuntimeTargetRef("profile_workflow:z-image-turbo"),
			},
			wantTimeout: defaultLocalImageActionWait,
		},
		{
			name: "cloud",
			binding: publicChatExecutionBinding{
				ModelID:     "gpt-image-1.5",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorID: "connector-image",
				TargetRef: &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
					ConnectorID:          "connector-image",
					RemoteModelCatalogID: "remote-catalog-image",
					ProviderModelID:      "gpt-image-1.5",
					Provider:             "openai",
				}},
			},
			wantTimeout: defaultCloudImageActionWait,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			scenario := &capturePublicChatImageScenarioExecutor{}
			executor := NewAIBackedPublicChatActionExecutor(scenario)
			_, err := executor.ExecuteImageAction(context.Background(), PublicChatActionExecutionRequest{
				Session: publicChatAnchorState{
					CallerAppID: "desktop.app",
					OwnerUserID: "user-1",
					Bindings: publicChatExecutionBindings{
						runtimeAgentAIConfigCapabilityImageGenerate: test.binding,
					},
				},
				Turn: publicChatTurnState{TurnID: "turn-image-default-timeout-" + test.name},
				Action: publicChatStructuredAction{
					ActionID:  "action-image-default-timeout-" + test.name,
					Modality:  "image",
					Operation: "image.generate",
					PromptPayload: publicChatStructuredPromptPayload{
						Kind:       "image-prompt",
						PromptText: "a quiet library",
					},
				},
			})
			if err != nil {
				t.Fatalf("ExecuteImageAction: %v", err)
			}
			if got := time.Duration(scenario.submitRequest.GetHead().GetTimeoutMs()) * time.Millisecond; got != test.wantTimeout {
				t.Fatalf("timeout = %s, want %s", got, test.wantTimeout)
			}
		})
	}
}

func TestImageActionJobTerminalErrorPreservesReasonAndRetryContract(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		status        runtimev1.ScenarioJobStatus
		reason        runtimev1.ReasonCode
		wantReason    runtimev1.ReasonCode
		wantRetryable string
	}{
		{
			name:          "unsupported option",
			status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			reason:        runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
			wantReason:    runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
			wantRetryable: "false",
		},
		{
			name:          "canceled",
			status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			wantReason:    runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED,
			wantRetryable: "true",
		},
		{
			name:          "timeout",
			status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT,
			wantReason:    runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			wantRetryable: "true",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := imageActionJobTerminalError(&runtimev1.ScenarioJob{
				JobId:      "job-terminal-" + test.name,
				Status:     test.status,
				ReasonCode: test.reason,
			})
			if got, ok := grpcerr.ExtractReasonCode(err); !ok || got != test.wantReason {
				t.Fatalf("reason = %s, ok=%v, want %s", got, ok, test.wantReason)
			}
			metadata, ok := grpcerr.ExtractReasonMetadata(err)
			if !ok {
				t.Fatal("expected terminal error metadata")
			}
			if got := metadata["retryable"]; got != test.wantRetryable {
				t.Fatalf("retryable = %q, want %q", got, test.wantRetryable)
			}
			if got := metadata["job_status"]; got != test.status.String() {
				t.Fatalf("job_status = %q, want %q", got, test.status.String())
			}
		})
	}
}

func TestPublicChatImageActionLeavesExecutionMaterializationRuntimePrivate(t *testing.T) {
	t.Parallel()
	req := buildPublicChatImageActionSubmitRequest(publicChatExecutionBinding{
		ModelID:     "local-z-image",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	}, nil, "studio portrait of the current local agent", "runtime-agent-image-action:local", time.Second, "desktop.app", "user-1")

	if len(req.GetExtensions()) != 0 {
		t.Fatalf("Agent Chat must not fabricate private profile_entries: %+v", req.GetExtensions())
	}
}

func publicChatImageActionTurnPayload(t *testing.T, anchorID string) *structpb.Struct {
	t.Helper()
	return publicChatStructPayload(t, map[string]any{
		"local_agent_ref":        testRuntimeAgentLocalRef("agent-alpha"),
		"owner_user_id":          "user-1",
		"runtime_source_ref":     testRuntimeAgentSourceRef("agent-alpha"),
		"conversation_anchor_id": anchorID,
		"request_id":             "image-action-turn",
		"messages": []any{
			map[string]any{"role": "user", "content": "draw a studio portrait"},
		},
	})
}

// submitPublicChatImageActionTurn commits the requested Runtime Agent AI Config
// image state (K-AGCORE-147) and submits a turn that plans an image action.
func submitPublicChatImageActionTurn(t *testing.T, svc *Service, anchorID string, includeImageBinding bool) {
	t.Helper()
	if includeImageBinding {
		selected := machineLocalExecutionProjectionForTest(
			"lcc-image",
			runtimeAgentAIConfigCapabilityImageGenerate,
			"local/image",
			nil,
		)
		upsertPublicChatTestAgentAIConfig(t, svc, publicChatExecutionBinding{
			BindingAlias: "lcc-image", ModelID: "local/image", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			CapabilityContract: runtimeAgentAIConfigCapabilityImageGenerate,
			ExecutionIntent: executionintent.Intent{
				CapabilityContract: runtimeAgentAIConfigCapabilityImageGenerate,
				Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			LocalAIConfigIntent: true,
			LocalExecution:      selected,
		})
	}
	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnRequestType,
		Payload:       publicChatImageActionTurnPayload(t, anchorID),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(image action request): %v", err)
	}
}

func assertPublicChatActionFailurePreservesCommittedTurn(t *testing.T, svc *Service, capture *publicChatEmitCapture, anchorID string, messageFragment string) {
	t.Helper()
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatTurnFailedType || messageType == publicChatTurnInterruptedType {
			t.Fatalf("post-commit action failure must not emit %s: %v", messageType, capture.messageTypes())
		}
	}
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-action-failure")
	lastTurn := publicChatLastTurnSnapshot(t, snapshot)
	if got := lastTurn["status"]; got != publicChatTurnStatusCompleted {
		t.Fatalf("post-commit action failure changed committed turn truth: %v", lastTurn)
	}
	if !strings.Contains(fmt.Sprint(lastTurn["message"]), messageFragment) {
		t.Fatalf("completed turn must retain bounded action diagnostic %q: %v", messageFragment, lastTurn)
	}
	if got := publicChatSessionSnapshotDetail(t, snapshot)["transcript_message_count"]; got != float64(2) {
		t.Fatalf("post-commit action failure erased transcript: %v", publicChatSessionSnapshotDetail(t, snapshot))
	}
}

func TestPublicChatImageActionExecutesAndEmitsArtifactLifecycle(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I will create that image.", "action-image-1", "studio portrait of the agent")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-success", rawAPML),
	})
	if err := svc.runtimeArtifacts.Put("artifact-image-1", runtimeartifact.ArtifactRecord{
		Bytes:     []byte("image-bytes"),
		MimeType:  "image/png",
		SizeBytes: int64(len("image-bytes")),
	}); err != nil {
		t.Fatalf("store artifact: %v", err)
	}
	actionExecutor := &stubPublicChatActionExecutor{
		result: PublicChatActionExecutionResult{
			ActionID:            "action-image-1",
			ProjectionMessageID: "agent-turn:image:1",
			ArtifactID:          "artifact-image-1",
			MimeType:            "image/jpeg",
			JobID:               "job-image-1",
			ModelResolved:       "local/image",
		},
	}
	svc.SetPublicChatActionExecutor(actionExecutor)

	submitPublicChatImageActionTurn(t, svc, anchorID, true)

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	planned := capture.waitForMessageType(t, publicChatTurnActionPlannedType)
	started := capture.waitForMessageType(t, publicChatTurnActionStartedType)
	artifactReady := capture.waitForMessageType(t, publicChatTurnArtifactReadyType)
	completedAction := capture.waitForMessageType(t, publicChatTurnActionCompletedType)
	_ = capture.waitForMessageType(t, publicChatTurnPostTurnType)
	_ = capture.waitForMessageType(t, publicChatTurnCompletedType)

	if actionExecutor.calls != 1 {
		t.Fatalf("expected one image action execution, got %d", actionExecutor.calls)
	}
	if got := actionExecutor.request.Action.PromptPayload.PromptText; got != "studio portrait of the agent" {
		t.Fatalf("expected APML prompt to drive image action, got %q", got)
	}
	for _, req := range []*runtimev1.SendAppMessageRequest{planned, started, artifactReady, completedAction} {
		detail := publicChatTurnDetail(t, req)
		if got := detail["action_id"]; got != "action-image-1" {
			t.Fatalf("expected action_id action-image-1 for %s, got=%v", req.GetMessageType(), detail)
		}
	}
	artifactDetail := publicChatTurnDetail(t, artifactReady)
	if got := artifactDetail["artifact_id"]; got != "artifact-image-1" {
		t.Fatalf("expected artifact_ready artifact id, got=%v", artifactDetail)
	}
	if got := artifactDetail["mime_type"]; got != "image/png" {
		t.Fatalf("expected artifact_ready store-trusted mime image/png, got=%v", artifactDetail)
	}
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")
	snapshot := requestPublicChatSessionSnapshot(t, svc, capture, anchorID, "snapshot-action-success")
	detail := publicChatSessionSnapshotDetail(t, snapshot)
	if got := detail["transcript_message_count"]; got != float64(3) {
		t.Fatalf("successful image action must persist a replayable assistant image, got=%v", detail)
	}
	transcript, ok := detail["transcript"].([]any)
	if !ok || len(transcript) != 3 {
		t.Fatalf("successful image action transcript malformed: %T %v", detail["transcript"], detail["transcript"])
	}
	image, ok := transcript[2].(map[string]any)
	if !ok {
		t.Fatalf("assistant image replay envelope malformed: %T %v", transcript[2], transcript[2])
	}
	if image["role"] != "assistant" || image["kind"] != "image" ||
		image["artifact_id"] != "artifact-image-1" || image["media_mime_type"] != "image/png" {
		t.Fatalf("assistant image replay envelope lost canonical artifact reference: %v", image)
	}
	if image["parent_message_id"] != publicChatTranscriptMessageID(anchorID, 0) {
		t.Fatalf("assistant image must remain parented to the originating user message: %v", image)
	}
}

func TestPublicChatImageActionInterruptTerminalizesActionBeforeParentTurn(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image-interrupt", "I will create that image.", "action-image-interrupt", "studio portrait")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-interrupt", rawAPML),
	})
	actionExecutor := &interruptiblePublicChatActionExecutor{entered: make(chan struct{})}
	svc.SetPublicChatActionExecutor(actionExecutor)

	submitPublicChatImageActionTurn(t, svc, anchorID, true)

	accepted := capture.waitForMessageType(t, publicChatTurnAcceptedType)
	turnID := publicChatPayloadMap(t, accepted)["turn_id"].(string)
	_ = capture.waitForMessageType(t, publicChatTurnActionStartedType)
	select {
	case <-actionExecutor.entered:
	case <-time.After(time.Second):
		t.Fatal("image action executor was not entered")
	}

	err := svc.ConsumePublicChatAppMessage(context.Background(), &runtimev1.AppMessageEvent{
		ToAppId:       publicChatRuntimeAppID,
		FromAppId:     "desktop.app",
		SubjectUserId: "user-1",
		MessageType:   publicChatTurnInterruptType,
		Payload: publicChatStructPayload(t, map[string]any{
			"conversation_anchor_id": anchorID,
			"turn_id":                turnID,
			"reason":                 "user_cancel",
		}),
	})
	if err != nil {
		t.Fatalf("ConsumePublicChatAppMessage(interrupt): %v", err)
	}
	_ = capture.waitForMessageType(t, publicChatTurnActionFailedType)
	_ = capture.waitForMessageType(t, publicChatTurnInterruptedType)
	waitForPublicChatAgentIdle(t, svc, "agent-alpha")

	messageTypes := capture.messageTypes()
	actionFailedIndex := -1
	turnInterruptedIndex := -1
	for index, messageType := range messageTypes {
		switch messageType {
		case publicChatTurnActionFailedType:
			actionFailedIndex = index
		case publicChatTurnInterruptedType:
			turnInterruptedIndex = index
		case publicChatTurnArtifactReadyType, publicChatTurnActionCompletedType, publicChatTurnCompletedType:
			t.Fatalf("interrupted image action published forbidden success terminal %s: %v", messageType, messageTypes)
		}
	}
	if actionFailedIndex < 0 || turnInterruptedIndex <= actionFailedIndex {
		t.Fatalf("expected action_failed before turn_interrupted, got %v", messageTypes)
	}
}

func TestPublicChatImageActionEmissionFailureTerminalizesChildBeforeParent(t *testing.T) {
	for _, failedType := range []string{publicChatTurnActionPlannedType, publicChatTurnActionStartedType} {
		t.Run(failedType, func(t *testing.T) {
			svc := newRuntimeAgentServiceForPublicChatTest(t)
			anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
			capture := newPublicChatEmitCapture()
			failedOnce := false
			svc.SetPublicChatAppEmitter(func(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
				if req.GetMessageType() == failedType && !failedOnce {
					failedOnce = true
					return nil, fmt.Errorf("injected %s delivery failure", failedType)
				}
				return capture.emit(ctx, req)
			})
			rawAPML := publicChatImageActionAPML("message-image-emission", "I will create that image.", "action-image-emission", "studio portrait")
			svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
				stream: emitPublicChatImageActionStream("trace-image-action-emission", rawAPML),
			})
			actionExecutor := &stubPublicChatActionExecutor{}
			svc.SetPublicChatActionExecutor(actionExecutor)
			submitPublicChatImageActionTurn(t, svc, anchorID, true)

			_ = capture.waitForMessageType(t, publicChatTurnActionFailedType)
			_ = capture.waitForMessageType(t, publicChatTurnCompletedType)
			waitForPublicChatAgentIdle(t, svc, "agent-alpha")
			if actionExecutor.calls != 0 {
				t.Fatalf("image executor ran after %s delivery failure", failedType)
			}

			snapshotDecision := localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x72, "user-1")
			handle := mintLocalAppAgentHandle(snapshotDecision, testRuntimeAgentLocalRef("agent-alpha"))
			response, err := svc.GetLocalAppConversationSnapshot(
				accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
				&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
			)
			if err != nil {
				t.Fatal(err)
			}
			snapshot := response.GetSnapshot()
			if len(snapshot.GetActions()) != 1 || snapshot.GetActions()[0].GetStatus() != runtimev1.LocalAppConversationActionStatus_LOCAL_APP_CONVERSATION_ACTION_STATUS_FAILED {
				t.Fatalf("emission failure action closure = %+v", snapshot.GetActions())
			}
			if len(snapshot.GetTurns()) != 1 || snapshot.GetTurns()[0].GetStatus() != runtimev1.LocalAppConversationTurnStatus_LOCAL_APP_CONVERSATION_TURN_STATUS_COMPLETED {
				t.Fatalf("emission failure parent closure = %+v", snapshot.GetTurns())
			}
		})
	}
}

func TestPublicChatImageActionFailsClosedWithoutImageBinding(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I need an image route.", "action-image-1", "studio portrait")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-no-binding", rawAPML),
	})
	actionExecutor := &stubPublicChatActionExecutor{}
	svc.SetPublicChatActionExecutor(actionExecutor)

	submitPublicChatImageActionTurn(t, svc, anchorID, false)

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionPlannedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionStartedType)
	actionFailed := capture.waitForMessageType(t, publicChatTurnActionFailedType)

	if actionExecutor.calls != 0 {
		t.Fatalf("image action executor must not run without a committed image.generate binding")
	}
	actionFailedDetail := publicChatTurnDetail(t, actionFailed)
	if got := actionFailedDetail["reason"]; got != publicChatActionFailedReasonImageBindingMissing {
		t.Fatalf("expected action_failed.detail.reason=image_binding_missing, got=%v", actionFailedDetail)
	}
	if !strings.Contains(fmt.Sprint(actionFailedDetail["message"]), "no committed image.generate Runtime Agent AI Config binding") {
		t.Fatalf("expected missing image binding failure, got=%v", actionFailedDetail)
	}
	assertPublicChatActionFailurePreservesCommittedTurn(t, svc, capture, anchorID, "no committed image.generate Runtime Agent AI Config binding")
}

func TestPublicChatImageActionFailsClosedWhenExecutorFails(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I will create that image.", "action-image-1", "studio portrait")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-job-failed", rawAPML),
	})
	svc.SetPublicChatActionExecutor(&stubPublicChatActionExecutor{err: fmt.Errorf("image job failed")})

	submitPublicChatImageActionTurn(t, svc, anchorID, true)

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionPlannedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionStartedType)
	actionFailed := capture.waitForMessageType(t, publicChatTurnActionFailedType)

	if !strings.Contains(fmt.Sprint(publicChatTurnDetail(t, actionFailed)["message"]), "image job failed") {
		t.Fatalf("expected action_failed to preserve executor error, got=%v", publicChatTurnDetail(t, actionFailed))
	}
	if got := publicChatTurnDetail(t, actionFailed)["reason"]; got != publicChatActionFailedReasonImageExecutionFailed {
		t.Fatalf("expected action_failed.detail.reason=image_execution_failed, got=%v", publicChatTurnDetail(t, actionFailed))
	}
	assertPublicChatActionFailurePreservesCommittedTurn(t, svc, capture, anchorID, "image job failed")
}

func TestPublicChatImageActionFailsClosedWhenArtifactMissing(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I will create that image.", "action-image-1", "studio portrait")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-artifact-missing", rawAPML),
	})
	svc.SetPublicChatActionExecutor(&stubPublicChatActionExecutor{
		result: PublicChatActionExecutionResult{
			ActionID:            "action-image-1",
			ProjectionMessageID: "agent-turn:image:1",
			ArtifactID:          "missing-image-artifact",
			MimeType:            "image/png",
			JobID:               "job-image-1",
		},
	})

	submitPublicChatImageActionTurn(t, svc, anchorID, true)

	_ = capture.waitForMessageType(t, publicChatTurnAcceptedType)
	_ = capture.waitForMessageType(t, publicChatTurnStartedType)
	_ = capture.waitForMessageType(t, publicChatTurnStructuredType)
	_ = capture.waitForMessageType(t, publicChatTurnMessageCommittedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionPlannedType)
	_ = capture.waitForMessageType(t, publicChatTurnActionStartedType)
	actionFailed := capture.waitForMessageType(t, publicChatTurnActionFailedType)

	if !strings.Contains(fmt.Sprint(publicChatTurnDetail(t, actionFailed)["message"]), "was not stored") {
		t.Fatalf("expected artifact storage failure, got=%v", publicChatTurnDetail(t, actionFailed))
	}
	assertPublicChatActionFailurePreservesCommittedTurn(t, svc, capture, anchorID, "was not stored")
}

func TestPublicChatImageActionRejectsOversizedArtifactBeforeReady(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	rawAPML := publicChatImageActionAPML("message-image", "I will create that image.", "action-image-oversized", "studio portrait")
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: emitPublicChatImageActionStream("trace-image-action-oversized", rawAPML),
	})
	payload := make([]byte, runtimeartifact.MaxInlineBytes+1)
	if err := svc.runtimeArtifacts.Put("artifact-image-oversized", runtimeartifact.ArtifactRecord{
		Bytes: payload, MimeType: "image/png", SizeBytes: int64(len(payload)),
	}); err != nil {
		t.Fatalf("store oversized artifact: %v", err)
	}
	svc.SetPublicChatActionExecutor(&stubPublicChatActionExecutor{
		result: PublicChatActionExecutionResult{
			ActionID: "action-image-oversized", ProjectionMessageID: "agent-turn:image:oversized",
			ArtifactID: "artifact-image-oversized", MimeType: "image/png", JobID: "job-image-oversized",
		},
	})

	submitPublicChatImageActionTurn(t, svc, anchorID, true)

	_ = capture.waitForMessageType(t, publicChatTurnActionStartedType)
	actionFailed := capture.waitForMessageType(t, publicChatTurnActionFailedType)
	detail := publicChatTurnDetail(t, actionFailed)
	if detail["reason_code"] != runtimev1.ReasonCode_AI_OUTPUT_INVALID.String() {
		t.Fatalf("oversized action failure reason = %#v", detail)
	}
	for _, messageType := range capture.messageTypes() {
		if messageType == publicChatTurnArtifactReadyType || messageType == publicChatTurnActionCompletedType {
			t.Fatalf("oversized image action published ready success: %v", capture.messageTypes())
		}
	}
	assertPublicChatActionFailurePreservesCommittedTurn(t, svc, capture, anchorID, "exceeds the readable Conversation output bound")
}
