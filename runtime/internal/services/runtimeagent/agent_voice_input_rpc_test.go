package runtimeagent

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type captureAgentVoiceTranscriptionExecutor struct {
	context context.Context
	submit  *runtimev1.SubmitScenarioJobRequest
}

func (*captureAgentVoiceTranscriptionExecutor) CancelScenarioJob(
	context.Context,
	*runtimev1.CancelScenarioJobRequest,
) (*runtimev1.CancelScenarioJobResponse, error) {
	return &runtimev1.CancelScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  "voice-input-job-1",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
	}}, nil
}

func (f *captureAgentVoiceTranscriptionExecutor) SubmitScenarioJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	f.context = ctx
	f.submit = proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
	return &runtimev1.SubmitScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  "voice-input-job-1",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
	}}, nil
}

func (*captureAgentVoiceTranscriptionExecutor) GetScenarioJob(
	context.Context,
	*runtimev1.GetScenarioJobRequest,
) (*runtimev1.GetScenarioJobResponse, error) {
	return &runtimev1.GetScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:   "voice-input-job-1",
		Status:  runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		TraceId: "voice-input-trace-1",
	}}, nil
}

func (*captureAgentVoiceTranscriptionExecutor) GetScenarioArtifacts(
	context.Context,
	*runtimev1.GetScenarioArtifactsRequest,
) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return &runtimev1.GetScenarioArtifactsResponse{
		JobId:   "voice-input-job-1",
		TraceId: "voice-input-trace-1",
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_SpeechTranscribe{
			SpeechTranscribe: &runtimev1.SpeechTranscribeResult{Text: "transcribed intent"},
		}},
	}, nil
}

type cancelObservedAgentVoiceTranscriptionExecutor struct {
	published        chan struct{}
	cancelCalled     chan struct{}
	terminalObserved chan struct{}
	terminalRelease  chan struct{}
	observerWaiting  chan struct{}
	observerCanceled chan struct{}
	cancelOnce       sync.Once
	terminalOnce     sync.Once
	releaseOnce      sync.Once
	waitingOnce      sync.Once
	observerOnce     sync.Once
	mu               sync.Mutex
	getFailure       error
	cancelRequest    *runtimev1.CancelScenarioJobRequest
	cancelCtxActive  bool
	cancelDeadline   time.Time
	cancelDeadlineOK bool
	cancelPrincipal  protectedprincipal.Principal
	cancelAppID      string
	cancelIntent     executionintent.Intent
	cancelIntentOK   bool
	cancelLocalID    string
}

func newCancelObservedAgentVoiceTranscriptionExecutor() *cancelObservedAgentVoiceTranscriptionExecutor {
	return &cancelObservedAgentVoiceTranscriptionExecutor{
		published:        make(chan struct{}),
		cancelCalled:     make(chan struct{}),
		terminalObserved: make(chan struct{}),
		terminalRelease:  make(chan struct{}),
		observerWaiting:  make(chan struct{}),
		observerCanceled: make(chan struct{}),
	}
}

func (f *cancelObservedAgentVoiceTranscriptionExecutor) releaseTerminal() {
	f.releaseOnce.Do(func() { close(f.terminalRelease) })
}

func (f *cancelObservedAgentVoiceTranscriptionExecutor) SubmitScenarioJob(
	context.Context,
	*runtimev1.SubmitScenarioJobRequest,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	close(f.published)
	return &runtimev1.SubmitScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  "voice-input-job-cancel",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	}}, nil
}

func (f *cancelObservedAgentVoiceTranscriptionExecutor) CancelScenarioJob(
	ctx context.Context,
	req *runtimev1.CancelScenarioJobRequest,
) (*runtimev1.CancelScenarioJobResponse, error) {
	f.mu.Lock()
	f.cancelRequest = proto.Clone(req).(*runtimev1.CancelScenarioJobRequest)
	f.cancelCtxActive = ctx.Err() == nil
	f.cancelDeadline, f.cancelDeadlineOK = ctx.Deadline()
	f.cancelPrincipal, _ = protectedprincipal.FromContext(ctx)
	f.cancelIntent, f.cancelIntentOK = executionintent.FromContext(ctx)
	if selected, ok := localexecution.SelectedLocalExecutionFromContext(ctx, runtimeAgentAIConfigCapabilityAudioTranscribe); ok {
		f.cancelLocalID = selected.LoadoutID
	}
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		values := md.Get("x-nimi-app-id")
		if len(values) > 0 {
			f.cancelAppID = values[0]
		}
	}
	f.mu.Unlock()
	f.cancelOnce.Do(func() { close(f.cancelCalled) })
	return &runtimev1.CancelScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  "voice-input-job-cancel",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	}}, nil
}

func (f *cancelObservedAgentVoiceTranscriptionExecutor) GetScenarioJob(
	ctx context.Context,
	_ *runtimev1.GetScenarioJobRequest,
) (*runtimev1.GetScenarioJobResponse, error) {
	select {
	case <-f.cancelCalled:
		f.waitingOnce.Do(func() { close(f.observerWaiting) })
		select {
		case <-f.terminalRelease:
			f.terminalOnce.Do(func() { close(f.terminalObserved) })
			return &runtimev1.GetScenarioJobResponse{Job: &runtimev1.ScenarioJob{
				JobId:      "voice-input-job-cancel",
				Status:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
				ReasonCode: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED,
			}}, nil
		case <-ctx.Done():
			f.observerOnce.Do(func() { close(f.observerCanceled) })
			return nil, status.FromContextError(ctx.Err()).Err()
		}
	default:
	}
	if f.getFailure != nil {
		return nil, f.getFailure
	}
	return &runtimev1.GetScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId:  "voice-input-job-cancel",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	}}, nil
}

func (*cancelObservedAgentVoiceTranscriptionExecutor) GetScenarioArtifacts(
	context.Context,
	*runtimev1.GetScenarioArtifactsRequest,
) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return nil, status.Error(codes.Internal, "artifacts must not be read after cancellation")
}

func configureLocalAgentVoiceTranscriptionBinding(t *testing.T, svc *Service) string {
	t.Helper()
	modelPath, err := filepath.Abs(filepath.Join("testdata", "qwen3-asr", "model.safetensors"))
	if err != nil {
		t.Fatal(err)
	}
	selected := &localexecution.SelectedLocalExecution{
		LoadoutID:          "lcc-asr",
		CapabilityContract: runtimeAgentAIConfigCapabilityAudioTranscribe,
		DisplayName:        "Qwen3 ASR",
		DriverIdentity: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: capabilitydriver.Qwen3ASRImplementationID,
			DriverId:         capabilitydriver.Qwen3ASRDriverID,
			DriverDialect:    capabilitydriver.Qwen3ASRDriverDialect,
		},
		Requirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.Qwen3ASRModelRequirementID,
		}},
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID:     capabilitydriver.Qwen3ASRModelRequirementID,
			ModelAssetID:      "catalog/qwen3-asr",
			AbsolutePath:      modelPath,
			VerifiedContentID: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			EntrySHA256:       "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		}},
		Configured: true,
	}
	svc.setMachineExecutionBindingResolver(machineExecutionBindingResolverFunc(func(
		_ context.Context,
		accountNamespace string,
		capabilityContracts []string,
	) (publicChatExecutionBindings, error) {
		if accountNamespace != "user-1" || len(capabilityContracts) != 1 ||
			capabilityContracts[0] != runtimeAgentAIConfigCapabilityAudioTranscribe {
			t.Fatalf("unexpected binding request account=%q capabilities=%v", accountNamespace, capabilityContracts)
		}
		return publicChatExecutionBindings{runtimeAgentAIConfigCapabilityAudioTranscribe: {
			BindingAlias:        "lcc-asr",
			ModelID:             "Qwen3 ASR",
			RoutePolicy:         runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			CapabilityContract:  runtimeAgentAIConfigCapabilityAudioTranscribe,
			LocalAIConfigIntent: true,
			ExecutionIntent: executionintent.Intent{
				CapabilityContract: runtimeAgentAIConfigCapabilityAudioTranscribe,
				Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			LocalExecution: selected,
		}}, nil
	}))
	return modelPath
}

func TestTranscribeAgentVoiceInputUsesSharedLocalAgentExecutionSnapshot(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "nimi.desktop", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	modelPath := configureLocalAgentVoiceTranscriptionBinding(t, svc)
	executor := &captureAgentVoiceTranscriptionExecutor{}
	svc.SetAgentVoiceTranscriptionScenarioExecutor(executor)
	audioBytes := make([]byte, maxRuntimeAgentVoiceInputBytes)
	audioBytes[0] = 1
	audioBytes[len(audioBytes)-1] = 4

	response, err := svc.TranscribeAgentVoiceInput(
		desktopAccountProductTestPrincipalContext("user-1", make(chan struct{})),
		&runtimev1.TranscribeAgentVoiceInputRequest{
			Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
			AgentId:              localAgentRef,
			ConversationAnchorId: anchorID,
			AudioBytes:           audioBytes,
			MimeType:             "audio/webm;codecs=opus",
			RequestId:            "voice-input-request-1",
		},
	)
	if err != nil {
		t.Fatalf("TranscribeAgentVoiceInput: %v", err)
	}
	if response.GetText() != "transcribed intent" || response.GetJobId() != "voice-input-job-1" || response.GetTraceId() != "voice-input-trace-1" {
		t.Fatalf("unexpected transcription response: %+v", response)
	}
	if executor.submit.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE ||
		executor.submit.GetSpec().GetSpeechTranscribe().GetMimeType() != "audio/webm;codecs=opus" ||
		len(executor.submit.GetSpec().GetSpeechTranscribe().GetAudioSource().GetAudioBytes()) != maxRuntimeAgentVoiceInputBytes ||
		executor.submit.GetSpec().GetSpeechTranscribe().GetAudioSource().GetAudioBytes()[0] != 1 ||
		executor.submit.GetSpec().GetSpeechTranscribe().GetAudioSource().GetAudioBytes()[maxRuntimeAgentVoiceInputBytes-1] != 4 {
		t.Fatalf("unexpected transcription Job type=%s mime=%q audio_bytes=%d",
			executor.submit.GetScenarioType(),
			executor.submit.GetSpec().GetSpeechTranscribe().GetMimeType(),
			len(executor.submit.GetSpec().GetSpeechTranscribe().GetAudioSource().GetAudioBytes()),
		)
	}
	if got := executor.submit.GetHead().GetTimeoutMs(); got != int32((15*time.Minute)/time.Millisecond) {
		t.Fatalf("Local transcription Job timeout=%d, want 15 minutes", got)
	}
	intent, ok := executionintent.FromContext(executor.context)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != runtimeAgentAIConfigCapabilityAudioTranscribe {
		t.Fatalf("transcription execution intent=%+v ok=%v", intent, ok)
	}
	captured, ok := localexecution.SelectedLocalExecutionFromContext(executor.context, runtimeAgentAIConfigCapabilityAudioTranscribe)
	if !ok || captured.LoadoutID != "lcc-asr" || captured.ExactBindings[0].AbsolutePath != modelPath {
		t.Fatalf("transcription Local execution=%+v ok=%v", captured, ok)
	}
}

func TestTranscribeAgentVoiceInputCancelsPublishedJobAndObservesTerminalState(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "nimi.desktop", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	configureLocalAgentVoiceTranscriptionBinding(t, svc)
	executor := newCancelObservedAgentVoiceTranscriptionExecutor()
	defer executor.releaseTerminal()
	svc.SetAgentVoiceTranscriptionScenarioExecutor(executor)

	ownerCtx := desktopAccountProductTestPrincipalContext("user-1", make(chan struct{}))
	ownerCtx = metadata.NewIncomingContext(ownerCtx, metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	callCtx, cancelCall := context.WithCancel(ownerCtx)
	result := make(chan error, 1)
	go func() {
		_, err := svc.TranscribeAgentVoiceInput(callCtx, &runtimev1.TranscribeAgentVoiceInputRequest{
			Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
			AgentId:              localAgentRef,
			ConversationAnchorId: anchorID,
			AudioBytes:           []byte{1, 2, 3, 4},
			MimeType:             "audio/webm;codecs=opus",
			RequestId:            "voice-input-request-cancel",
		})
		result <- err
	}()

	select {
	case <-executor.published:
	case <-time.After(2 * time.Second):
		t.Fatal("voice transcription Job was not published")
	}
	cancelCall()
	select {
	case <-executor.cancelCalled:
	case <-time.After(2 * time.Second):
		executor.releaseTerminal()
		t.Fatal("published ScenarioJob was not canceled")
	}

	select {
	case err := <-result:
		if status.Code(err) != codes.Canceled {
			t.Fatalf("status code=%s, want Canceled: %v", status.Code(err), err)
		}
	case <-time.After(200 * time.Millisecond):
		executor.releaseTerminal()
		<-result
		t.Fatal("TranscribeAgentVoiceInput synchronously waited for terminal cleanup")
	}
	select {
	case <-executor.terminalObserved:
		t.Fatal("cleanup reached terminal before the test released the observer")
	default:
	}
	executor.releaseTerminal()
	select {
	case <-executor.terminalObserved:
	case <-time.After(2 * time.Second):
		t.Fatal("canceled ScenarioJob terminal state was not observed asynchronously")
	}
	executor.mu.Lock()
	cancelRequest := executor.cancelRequest
	cancelCtxActive := executor.cancelCtxActive
	cancelPrincipal := executor.cancelPrincipal
	cancelAppID := executor.cancelAppID
	cancelIntent := executor.cancelIntent
	cancelIntentOK := executor.cancelIntentOK
	cancelLocalID := executor.cancelLocalID
	executor.mu.Unlock()
	if cancelRequest.GetJobId() != "voice-input-job-cancel" || cancelRequest.GetReason() != "runtime_agent_voice_input_canceled" {
		t.Fatalf("unexpected cancellation request: %+v", cancelRequest)
	}
	if !cancelCtxActive || cancelPrincipal.AccountID != "user-1" || !cancelPrincipal.IsDesktopAccountProduct() || cancelAppID != "nimi.desktop" {
		t.Fatalf("cancellation lost owner scope active=%v app_id=%q principal=%+v", cancelCtxActive, cancelAppID, cancelPrincipal)
	}
	if !cancelIntentOK || !cancelIntent.IsLocal() || cancelIntent.CapabilityContract != runtimeAgentAIConfigCapabilityAudioTranscribe || cancelLocalID != "lcc-asr" {
		t.Fatalf("cancellation lost execution intent ok=%v intent=%+v local_configuration_id=%q", cancelIntentOK, cancelIntent, cancelLocalID)
	}
}

func TestTranscribeAgentVoiceInputCancelsPublishedJobAfterCallerDeadline(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "nimi.desktop", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	configureLocalAgentVoiceTranscriptionBinding(t, svc)
	executor := newCancelObservedAgentVoiceTranscriptionExecutor()
	defer executor.releaseTerminal()
	svc.SetAgentVoiceTranscriptionScenarioExecutor(executor)

	ownerCtx := desktopAccountProductTestPrincipalContext("user-1", make(chan struct{}))
	ownerCtx = metadata.NewIncomingContext(ownerCtx, metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	callCtx, cancelCall := context.WithTimeout(ownerCtx, 25*time.Millisecond)
	defer cancelCall()
	_, err := svc.TranscribeAgentVoiceInput(callCtx, &runtimev1.TranscribeAgentVoiceInputRequest{
		Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
		AgentId:              localAgentRef,
		ConversationAnchorId: anchorID,
		AudioBytes:           []byte{1, 2, 3, 4},
		MimeType:             "audio/webm;codecs=opus",
		RequestId:            "voice-input-request-deadline",
	})
	if status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("status code=%s, want DeadlineExceeded: %v", status.Code(err), err)
	}
	select {
	case <-executor.cancelCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("published ScenarioJob was not canceled after caller deadline")
	}
	executor.releaseTerminal()
}

func TestTranscribeAgentVoiceInputCancelsPublishedJobAfterGetFailure(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "nimi.desktop", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	configureLocalAgentVoiceTranscriptionBinding(t, svc)
	executor := newCancelObservedAgentVoiceTranscriptionExecutor()
	executor.getFailure = status.Error(codes.Unavailable, "GetScenarioJob failed")
	defer executor.releaseTerminal()
	svc.SetAgentVoiceTranscriptionScenarioExecutor(executor)

	ownerCtx := desktopAccountProductTestPrincipalContext("user-1", make(chan struct{}))
	ownerCtx = metadata.NewIncomingContext(ownerCtx, metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	_, err := svc.TranscribeAgentVoiceInput(ownerCtx, &runtimev1.TranscribeAgentVoiceInputRequest{
		Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
		AgentId:              localAgentRef,
		ConversationAnchorId: anchorID,
		AudioBytes:           []byte{1, 2, 3, 4},
		MimeType:             "audio/webm;codecs=opus",
		RequestId:            "voice-input-request-get-failure",
	})
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("status code=%s, want Unavailable: %v", status.Code(err), err)
	}
	select {
	case <-executor.cancelCalled:
	case <-time.After(2 * time.Second):
		t.Fatal("published ScenarioJob was not canceled after GetScenarioJob failure")
	}
	executor.releaseTerminal()
}

func TestRuntimeAgentCloseCancelsVoiceCleanupObserverWithoutWaitingForOperationDeadline(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "nimi.desktop", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	configureLocalAgentVoiceTranscriptionBinding(t, svc)
	executor := newCancelObservedAgentVoiceTranscriptionExecutor()
	svc.SetAgentVoiceTranscriptionScenarioExecutor(executor)

	ownerCtx := desktopAccountProductTestPrincipalContext("user-1", make(chan struct{}))
	ownerCtx = metadata.NewIncomingContext(ownerCtx, metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
	callCtx, cancelCall := context.WithCancel(ownerCtx)
	result := make(chan error, 1)
	go func() {
		_, err := svc.TranscribeAgentVoiceInput(callCtx, &runtimev1.TranscribeAgentVoiceInputRequest{
			Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
			AgentId:              localAgentRef,
			ConversationAnchorId: anchorID,
			AudioBytes:           []byte{1, 2, 3, 4},
			MimeType:             "audio/webm;codecs=opus",
			RequestId:            "voice-input-request-service-close",
		})
		result <- err
	}()
	select {
	case <-executor.published:
	case <-time.After(2 * time.Second):
		t.Fatal("voice transcription Job was not published")
	}
	cancelCall()
	select {
	case err := <-result:
		if status.Code(err) != codes.Canceled {
			t.Fatalf("status code=%s, want Canceled: %v", status.Code(err), err)
		}
	case <-time.After(2 * time.Second):
		executor.releaseTerminal()
		t.Fatal("TranscribeAgentVoiceInput did not return after scheduling cleanup")
	}
	select {
	case <-executor.observerWaiting:
	case <-time.After(2 * time.Second):
		executor.releaseTerminal()
		t.Fatal("voice cleanup observer did not begin terminal observation")
	}
	executor.mu.Lock()
	cancelDeadline := executor.cancelDeadline
	cancelDeadlineOK := executor.cancelDeadlineOK
	executor.mu.Unlock()
	remaining := time.Until(cancelDeadline)
	if !cancelDeadlineOK || remaining < 14*time.Minute || remaining > 15*time.Minute {
		executor.releaseTerminal()
		t.Fatalf("cleanup deadline ok=%v remaining=%s, want original Local operation deadline", cancelDeadlineOK, remaining)
	}

	closeDone := make(chan struct{})
	go func() {
		svc.Close()
		close(closeDone)
	}()
	select {
	case <-closeDone:
	case <-time.After(2 * time.Second):
		executor.releaseTerminal()
		<-closeDone
		t.Fatal("RuntimeAgent Service.Close waited for the 15-minute voice cleanup deadline")
	}
	select {
	case <-executor.observerCanceled:
	default:
		t.Fatal("Service shutdown did not cancel the voice cleanup observer")
	}
}

func TestTranscribeAgentVoiceInputRejectsOversizedAudioBeforeAuthorizationOrExecution(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	executor := &captureAgentVoiceTranscriptionExecutor{}
	svc.SetAgentVoiceTranscriptionScenarioExecutor(executor)

	_, err := svc.TranscribeAgentVoiceInput(context.Background(), &runtimev1.TranscribeAgentVoiceInputRequest{
		Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
		AgentId:              testRuntimeAgentLocalRef("agent-alpha"),
		ConversationAnchorId: "anchor",
		AudioBytes:           make([]byte, maxRuntimeAgentVoiceInputBytes+1),
		MimeType:             "audio/webm;codecs=opus",
		RequestId:            "voice-input-request-too-large",
	})
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("status code=%s, want ResourceExhausted: %v", status.Code(err), err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason.String() != "AI_AUDIO_INPUT_TOO_LARGE" {
		t.Fatalf("reason=%s ok=%v, want AI_AUDIO_INPUT_TOO_LARGE: %v", reason, ok, err)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || metadata["action_hint"] != "record_shorter_audio_input" || metadata["retryable"] != "false" {
		t.Fatalf("unexpected typed metadata ok=%v metadata=%#v", ok, metadata)
	}
	message, ok := grpcerr.ExtractPublicMessage(err)
	if !ok || message != "Recorded audio exceeds the 5-minute or 6 MiB voice-input limit." {
		t.Fatalf("unexpected public message ok=%v message=%q", ok, message)
	}
	if executor.submit != nil {
		t.Fatalf("oversized audio reached Scenario execution: %+v", executor.submit)
	}
}

func TestAgentVoiceTranscriptionWaitFollowsResolvedRoute(t *testing.T) {
	tests := []struct {
		name  string
		route runtimev1.RoutePolicy
		want  time.Duration
	}{
		{name: "local", route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, want: 15 * time.Minute},
		{name: "cloud", route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, want: 90 * time.Second},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := agentVoiceTranscriptionWait(test.route); got != test.want {
				t.Fatalf("agentVoiceTranscriptionWait(%s)=%s, want %s", test.route, got, test.want)
			}
		})
	}
}

func TestTranscribeAgentVoiceInputReturnsTypedCapabilityMismatchWhenSharedAIConfigOmitsTranscription(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "nimi.desktop", "user-1")
	localAgentRef := testRuntimeAgentLocalRef("agent-alpha")
	svc.setMachineExecutionBindingResolver(machineExecutionBindingResolverFunc(func(
		_ context.Context,
		accountNamespace string,
		capabilityContracts []string,
	) (publicChatExecutionBindings, error) {
		if accountNamespace != "user-1" || len(capabilityContracts) != 1 ||
			capabilityContracts[0] != runtimeAgentAIConfigCapabilityAudioTranscribe {
			t.Fatalf("unexpected binding request account=%q capabilities=%v", accountNamespace, capabilityContracts)
		}
		return publicChatExecutionBindings{}, nil
	}))
	svc.SetAgentVoiceTranscriptionScenarioExecutor(&captureAgentVoiceTranscriptionExecutor{})

	_, err := svc.TranscribeAgentVoiceInput(
		desktopAccountProductTestPrincipalContext("user-1", make(chan struct{})),
		&runtimev1.TranscribeAgentVoiceInputRequest{
			Context:              &runtimev1.AgentRequestContext{AppId: "nimi.desktop"},
			AgentId:              localAgentRef,
			ConversationAnchorId: anchorID,
			AudioBytes:           []byte{1, 2, 3, 4},
			MimeType:             "audio/webm;codecs=opus",
			RequestId:            "voice-input-request-missing-capability",
		},
	)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("status code=%s, want FailedPrecondition: %v", status.Code(err), err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH {
		t.Fatalf("reason=%s ok=%v, want AGENT_AI_CONFIG_CAPABILITY_MISMATCH: %v", reason, ok, err)
	}
}
