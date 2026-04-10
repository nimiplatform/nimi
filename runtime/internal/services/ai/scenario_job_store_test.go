package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

func scenarioJobContext(appID string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", appID))
}

func TestInheritAsyncJobContextPreservesMetadata(t *testing.T) {
	parent := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-trace-id", "trace-123",
	))
	parent = metadata.NewOutgoingContext(parent, metadata.Pairs(
		"x-nimi-trace-id", "trace-123",
		"x-nimi-participant-id", "nimi.desktop.test",
	))

	child := inheritAsyncJobContext(parent)

	incoming, ok := metadata.FromIncomingContext(child)
	if !ok {
		t.Fatal("expected incoming metadata on child context")
	}
	if got := incoming.Get("x-nimi-trace-id"); len(got) != 1 || got[0] != "trace-123" {
		t.Fatalf("incoming trace metadata mismatch: %v", got)
	}
	if got := incoming.Get("x-nimi-app-id"); len(got) != 1 || got[0] != "nimi.desktop" {
		t.Fatalf("incoming app metadata mismatch: %v", got)
	}

	outgoing, ok := metadata.FromOutgoingContext(child)
	if !ok {
		t.Fatal("expected outgoing metadata on child context")
	}
	if got := outgoing.Get("x-nimi-trace-id"); len(got) != 1 || got[0] != "trace-123" {
		t.Fatalf("outgoing trace metadata mismatch: %v", got)
	}
	if got := outgoing.Get("x-nimi-participant-id"); len(got) != 1 || got[0] != "nimi.desktop.test" {
		t.Fatalf("outgoing participant metadata mismatch: %v", got)
	}
}

func TestSubmitScenarioJobSpeechSynthesizeCompletes(t *testing.T) {
	speechBytes := []byte("scenario-job-speech")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "hello scenario job",
				},
			},
		},
	}
	submitResp, err := svc.SubmitScenarioJob(context.Background(), req)
	if err != nil {
		t.Fatalf("submit scenario job: %v", err)
	}
	if submitResp.GetJob() == nil || submitResp.GetJob().GetJobId() == "" {
		t.Fatalf("submit scenario job should return job")
	}
	if submitResp.GetJob().GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		t.Fatalf("scenario type mismatch: %v", submitResp.GetJob().GetScenarioType())
	}

	job := waitScenarioJobTerminal(t, svc, submitResp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("expected completed, got=%v reason=%v detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	artifactsResp, err := svc.GetScenarioArtifacts(scenarioJobContext("nimi.desktop"), &runtimev1.GetScenarioArtifactsRequest{
		JobId: job.GetJobId(),
	})
	if err != nil {
		t.Fatalf("get scenario artifacts: %v", err)
	}
	if len(artifactsResp.GetArtifacts()) == 0 {
		t.Fatalf("expected at least one artifact")
	}
	if artifactsResp.GetArtifacts()[0].GetMimeType() == "" {
		t.Fatalf("artifact mime type should be set")
	}
}

func TestSubmitScenarioJobStoresScenarioNativeState(t *testing.T) {
	speechBytes := []byte("scenario-native-store")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "scenario native store",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit scenario job: %v", err)
	}
	jobID := submitResp.GetJob().GetJobId()
	if _, ok := svc.scenarioJobs.get(jobID); !ok {
		t.Fatalf("scenario job should be tracked in scenario job store")
	}
}

func TestSubmitScenarioJobLocalImageStartFailureFailsBeforeAsyncJobCreation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{EnforceEndpointSecurity: true})
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-image-installed",
			AssetId:              "flux.1-schnell",
			Engine:               "media",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"image.generate"},
			Endpoint:             "http://127.0.0.1:8321/v1",
		}},
	}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId:         "local-image-installed",
				AssetId:              "flux.1-schnell",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             "http://127.0.0.1:8321/v1",
				HealthDetail:         "probe request failed: dial tcp 127.0.0.1:8321: connect: connection refused",
			},
		},
	}

	resp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/flux.1-schnell",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: "orange cat",
					N:      1,
					Size:   "1024x1024",
				},
			},
		},
	})
	if resp != nil {
		t.Fatalf("expected submit to fail before job creation, got response=%v", resp)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected AI_LOCAL_MODEL_UNAVAILABLE, got err=%v reason=%v", err, reason)
	}
	if err == nil || err.Error() == "" || !strings.Contains(err.Error(), "connection refused") {
		t.Fatalf("expected startup failure detail to be preserved, got %v", err)
	}
	if jobs := len(svc.scenarioJobs.jobs); jobs != 0 {
		t.Fatalf("expected no async job to be created on local image activation failure, got %d", jobs)
	}
}

func TestSubmitScenarioJobInstalledImagePrimesManagedProfileExtensionsBeforeStart(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{EnforceEndpointSecurity: true})
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId:         "local-image-installed",
				AssetId:              "flux.1-schnell",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             "http://127.0.0.1:8321/v1",
			}},
		}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId:         "local-image-installed",
				AssetId:              "flux.1-schnell",
				Engine:               "media",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"image.generate"},
				Endpoint:             "http://127.0.0.1:8321/v1",
			},
		},
	}
	svc.localImageProfile = &fakeLocalImageProfileResolver{
		alias: "managed-image-alias",
		profile: map[string]any{
			"backend": "stablediffusion-ggml",
			"parameters": map[string]any{
				"model": "resolved/example/model.gguf",
			},
		},
		selection: engine.ImageSupervisedMatrixSelection{
			Matched:        true,
			EntryID:        "macos-apple-silicon-gguf",
			ProductState:   engine.ImageProductStateSupported,
			BackendClass:   engine.ImageBackendClassNativeBinary,
			BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
			ControlPlane:   engine.ImageControlPlaneRuntime,
			ExecutionPlane: engine.EngineMedia,
			Entry: &engine.ImageSupervisedMatrixEntry{
				EntryID:        "macos-apple-silicon-gguf",
				ProductState:   engine.ImageProductStateSupported,
				BackendClass:   engine.ImageBackendClassNativeBinary,
				BackendFamily:  engine.ImageBackendFamilyStableDiffusionGGML,
				ControlPlane:   engine.ImageControlPlaneRuntime,
				ExecutionPlane: engine.EngineMedia,
			},
		},
	}

	payload, err := structpb.NewStruct(map[string]any{
		"profile_entries": []any{
			map[string]any{
				"entryId":    "main",
				"kind":       "asset",
				"capability": "image",
				"assetId":    "flux.1-schnell",
				"assetKind":  "image",
			},
		},
	})
	if err != nil {
		t.Fatalf("build scenario extension payload: %v", err)
	}

	resp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/flux.1-schnell",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt: "orange cat",
					N:      1,
					Size:   "1024x1024",
				},
			},
		},
		Extensions: []*runtimev1.ScenarioExtension{{
			Namespace: "nimi.scenario.image.request",
			Payload:   payload,
		}},
	})
	resolver, _ := svc.localImageProfile.(*fakeLocalImageProfileResolver)
	if resolver == nil || resolver.resolveProfileCalls < 1 {
		t.Fatalf("expected managed image profile to be resolved during submit, got resolver=%#v", resolver)
	}
	if resolver.lastExtensions == nil || resolver.lastExtensions["profile_entries"] == nil {
		t.Fatalf("expected submit path to forward scenario extensions, got %#v", resolver.lastExtensions)
	}
	if svc.localModel.(*fakeLocalModelLister).startCalls != 1 {
		t.Fatalf("expected submit path to start installed image asset once, got %d", svc.localModel.(*fakeLocalModelLister).startCalls)
	}
	if err != nil && strings.Contains(err.Error(), "supply_profile_entries") {
		t.Fatalf("submit path should not drop image profile extensions, got %v", err)
	}
	if err == nil && (resp == nil || resp.GetJob() == nil || strings.TrimSpace(resp.GetJob().GetJobId()) == "") {
		t.Fatalf("expected submit response with job, got %#v", resp)
	}
}

func TestSubscribeScenarioJobEventsForMediaScenario(t *testing.T) {
	speechBytes := []byte("scenario-events-speech")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "subscribe scenario events",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit scenario job: %v", err)
	}

	collector := &scenarioJobEventCollector{ctx: scenarioJobContext("nimi.desktop")}
	if err := svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{
		JobId: submitResp.GetJob().GetJobId(),
	}, collector); err != nil {
		t.Fatalf("subscribe scenario job events: %v", err)
	}
	if len(collector.events) == 0 {
		t.Fatalf("expected scenario job events")
	}

	var hasTerminal bool
	for _, event := range collector.events {
		if event.GetJob() == nil {
			t.Fatalf("event job should be populated")
		}
		if event.GetJob().GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
			t.Fatalf("event scenario type mismatch: %v", event.GetJob().GetScenarioType())
		}
		if isTerminalScenarioJobEvent(event.GetEventType()) {
			hasTerminal = true
		}
	}
	if !hasTerminal {
		t.Fatalf("expected at least one terminal event")
	}
}

func TestSubmitScenarioJobFailurePersistsStructuredReasonMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			t.Fatalf("response writer does not support hijack")
		}
		conn, _, err := hijacker.Hijack()
		if err != nil {
			t.Fatalf("hijack response: %v", err)
		}
		_ = conn.Close()
	}))
	serverURL := server.URL
	server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: serverURL}},
	})
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "trigger provider failure",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit scenario job: %v", err)
	}

	job := waitScenarioJobTerminal(t, svc, submitResp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("expected failed, got=%v reason=%v detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("expected AI_PROVIDER_UNAVAILABLE, got %v", job.GetReasonCode())
	}
	if job.GetReasonMetadata() == nil {
		t.Fatal("expected structured reason metadata on failed scenario job")
	}
	providerMessage, _ := job.GetReasonMetadata().AsMap()["provider_message"].(string)
	if providerMessage == "" {
		t.Fatalf("expected provider_message in reason metadata, got %v", job.GetReasonMetadata().AsMap())
	}
	if !strings.Contains(providerMessage, "EOF") && !strings.Contains(providerMessage, "connection") {
		t.Fatalf("expected transport failure detail in provider_message, got %q", providerMessage)
	}
}

func waitScenarioJobTerminal(t *testing.T, svc *Service, jobID string, timeout time.Duration) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := svc.GetScenarioJob(scenarioJobContext("nimi.desktop"), &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if err != nil {
			t.Fatalf("get scenario job: %v", err)
		}
		switch resp.GetJob().GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
			return resp.GetJob()
		}
		time.Sleep(20 * time.Millisecond)
	}
	resp, err := svc.GetScenarioJob(scenarioJobContext("nimi.desktop"), &runtimev1.GetScenarioJobRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get scenario job: %v", err)
	}
	t.Fatalf("scenario job timeout: id=%s status=%s", jobID, resp.GetJob().GetStatus().String())
	return nil
}

type scenarioJobEventCollector struct {
	ctx    context.Context
	events []*runtimev1.ScenarioJobEvent
}

func (s *scenarioJobEventCollector) Send(event *runtimev1.ScenarioJobEvent) error {
	s.events = append(s.events, event)
	return nil
}

func (s *scenarioJobEventCollector) SetHeader(_ metadata.MD) error  { return nil }
func (s *scenarioJobEventCollector) SendHeader(_ metadata.MD) error { return nil }
func (s *scenarioJobEventCollector) SetTrailer(_ metadata.MD)       {}
func (s *scenarioJobEventCollector) Context() context.Context       { return s.ctx }
func (s *scenarioJobEventCollector) SendMsg(any) error              { return nil }
func (s *scenarioJobEventCollector) RecvMsg(any) error              { return nil }

// TestSubscribeJobEventsTerminalThenClose (K-STREAM-005) verifies that when a
// scenario job reaches a terminal state, subscribers receive the terminal event
// and that subscribing to an already-terminal job returns the full backlog with
// terminal=true.
func TestSubscribeJobEventsTerminalThenClose(t *testing.T) {
	store := newScenarioJobStore()

	// Create a SUBMITTED job.
	job := &runtimev1.ScenarioJob{
		JobId:        "stream-edge-001",
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-stream-001",
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	snapshot := store.create(job, cancel)
	if snapshot == nil {
		t.Fatalf("store.create returned nil")
	}

	// Subscribe before any transitions beyond SUBMITTED.
	subID, ch, backlog, terminal, ok := store.subscribe("stream-edge-001", 32)
	if !ok {
		t.Fatalf("subscribe should succeed for existing job")
	}
	if terminal {
		t.Fatalf("terminal should be false for a SUBMITTED job")
	}
	// Backlog should contain the SUBMITTED event emitted by create.
	if len(backlog) == 0 {
		t.Fatalf("backlog should contain the SUBMITTED event")
	}
	if backlog[0].GetEventType() != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED {
		t.Fatalf("first backlog event should be SUBMITTED, got %v", backlog[0].GetEventType())
	}

	// Transition to RUNNING.
	if _, ok := store.transition(
		"stream-edge-001",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING,
		nil,
	); !ok {
		t.Fatalf("transition to RUNNING failed")
	}
	if _, ok := store.updateProgress("stream-edge-001", 4, 8, 50); !ok {
		t.Fatalf("updateProgress failed")
	}

	// Transition to COMPLETED (terminal).
	if _, ok := store.transition(
		"stream-edge-001",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(j *runtimev1.ScenarioJob) {
			j.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		},
	); !ok {
		t.Fatalf("transition to COMPLETED failed")
	}

	// Drain events from the channel; expect RUNNING then COMPLETED.
	var received []*runtimev1.ScenarioJobEvent
	timeout := time.After(2 * time.Second)
	for {
		select {
		case event, open := <-ch:
			if !open {
				// Channel was closed by unsubscribe; stop draining.
				goto drained
			}
			received = append(received, event)
			if isTerminalScenarioJobEvent(event.GetEventType()) {
				goto drained
			}
		case <-timeout:
			t.Fatalf("timed out waiting for events on subscriber channel")
		}
	}
drained:
	if len(received) < 2 {
		t.Fatalf("expected at least 2 events (RUNNING + COMPLETED), got %d", len(received))
	}

	var gotRunning, gotCompleted, gotProgress bool
	for _, event := range received {
		switch event.GetEventType() {
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING:
			gotRunning = true
			if event.GetJob().GetProgressPercent() == 50 && event.GetJob().GetProgressCurrentStep() == 4 && event.GetJob().GetProgressTotalSteps() == 8 {
				gotProgress = true
			}
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED:
			gotCompleted = true
		}
	}
	if !gotRunning {
		t.Fatalf("expected RUNNING event on subscriber channel")
	}
	if !gotCompleted {
		t.Fatalf("expected COMPLETED (terminal) event on subscriber channel")
	}
	if !gotProgress {
		t.Fatalf("expected RUNNING event carrying progress snapshot")
	}

	// Unsubscribe closes the channel.
	store.unsubscribe("stream-edge-001", subID)
	select {
	case _, open := <-ch:
		if open {
			t.Fatalf("channel should be closed after unsubscribe")
		}
	default:
		// Channel already closed — acceptable.
	}
	_ = ctx // keep linter happy

	// --- Late subscriber: subscribe to an already-terminal job ---
	lateSubID, lateCh, lateBacklog, lateTerminal, lateOK := store.subscribe("stream-edge-001", 32)
	if !lateOK {
		t.Fatalf("late subscribe should succeed for existing terminal job")
	}
	if !lateTerminal {
		t.Fatalf("late subscriber should see terminal=true")
	}
	// Backlog should contain all events: SUBMITTED, RUNNING, COMPLETED.
	if len(lateBacklog) < 3 {
		t.Fatalf("late backlog should have at least 3 events (SUBMITTED+RUNNING+COMPLETED), got %d", len(lateBacklog))
	}
	var lateHasSubmitted, lateHasRunning, lateHasCompleted bool
	for _, event := range lateBacklog {
		switch event.GetEventType() {
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED:
			lateHasSubmitted = true
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING:
			lateHasRunning = true
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED:
			lateHasCompleted = true
		}
	}
	if !lateHasSubmitted {
		t.Fatalf("late backlog missing SUBMITTED event")
	}
	if !lateHasRunning {
		t.Fatalf("late backlog missing RUNNING event")
	}
	if !lateHasCompleted {
		t.Fatalf("late backlog missing COMPLETED event")
	}

	// Clean up late subscriber.
	store.unsubscribe("stream-edge-001", lateSubID)
	select {
	case _, open := <-lateCh:
		if open {
			t.Fatalf("late channel should be closed after unsubscribe")
		}
	default:
	}
}
