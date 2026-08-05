package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/metadata"
)

func scenarioJobContext(appID string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", appID))
}

func scenarioJobUserContext(appID string, subjectUserID string) context.Context {
	return authn.WithIdentity(scenarioJobContext(appID), &authn.Identity{SubjectUserID: subjectUserID})
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
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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

func TestSubmitScenarioJobWorldGenerateCompletes(t *testing.T) {
	var submitCalls, pollCalls, getWorldCalls int
	var submitPayload map[string]any
	var submitPayloadErr string
	const textPrompt = "A calm studio world with soft lighting"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := strings.TrimSpace(r.Header.Get("WLT-Api-Key")); got != "world-api-key" {
			http.Error(w, "missing api key", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/marble/v1/worlds:generate":
			submitCalls++
			body, err := io.ReadAll(r.Body)
			if err != nil {
				submitPayloadErr = err.Error()
				http.Error(w, "failed to read body", http.StatusBadRequest)
				return
			}
			if err := json.Unmarshal(body, &submitPayload); err != nil {
				submitPayloadErr = err.Error()
				http.Error(w, "failed to decode body", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"operation_id":"op-world-1","done":false}`))
		case "/marble/v1/operations/op-world-1":
			pollCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"operation_id":"op-world-1","done":true,"metadata":{"world_id":"world-123","progress":{"status":"SUCCEEDED"}}}`))
		case "/marble/v1/worlds/world-123":
			getWorldCalls++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"world":{"id":"world-123","display_name":"World Demo","world_marble_url":"https://marble.worldlabs.ai/world/world-123","assets":{"caption":"World caption","thumbnail_url":"https://example.com/thumb.jpg","splats":{"spz_urls":{"100k":"https://example.com/100k.spz","full_res":"https://example.com/full.spz"},"semantics_metadata":{"ground_plane_offset":1.5,"metric_scale_factor":3.25}},"mesh":{"collider_mesh_url":"https://example.com/collider.glb"},"imagery":{"pano_url":"https://example.com/pano.jpg"}},"model":"marble-1.1"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "worldlabs", "marble-1.1", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"worldlabs": {BaseURL: server.URL, APIKey: "world-api-key"}},
		AllowLoopbackEndpoint: true,
	})
	svc := fixture.service
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "worldlabs/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_WorldGenerate{
				WorldGenerate: &runtimev1.WorldGenerateScenarioSpec{
					DisplayName: "World Demo",
					TextPrompt:  textPrompt,
					Tags:        []string{"nimi", "desktop"},
					Seed:        17,
				},
			},
		},
	}
	submitResp, err := svc.SubmitScenarioJob(context.Background(), req)
	if err != nil {
		t.Fatalf("submit scenario job: %v", err)
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
	worldOutput := artifactsResp.GetOutput().GetWorldGenerate()
	if worldOutput == nil {
		t.Fatalf("expected world generate output")
	}
	if worldOutput.GetWorldId() != "world-123" {
		t.Fatalf("unexpected world id: %q", worldOutput.GetWorldId())
	}
	if worldOutput.GetSpzUrls()["full_res"] != "https://example.com/full.spz" {
		t.Fatalf("unexpected spz urls: %#v", worldOutput.GetSpzUrls())
	}
	if worldOutput.GetPanoUrl() != "https://example.com/pano.jpg" {
		t.Fatalf("unexpected pano url: %q", worldOutput.GetPanoUrl())
	}
	if submitPayloadErr != "" {
		t.Fatalf("unexpected submit payload decode error: %s", submitPayloadErr)
	}
	if got := nimillm.ValueAsString(submitPayload["model"]); got != "marble-1.1" {
		t.Fatalf("unexpected submitted model: %q", got)
	}
	if got := nimillm.ValueAsString(submitPayload["display_name"]); got != "World Demo" {
		t.Fatalf("unexpected submitted display name: %q", got)
	}
	if got := nimillm.ValueAsInt64(submitPayload["seed"]); got != 17 {
		t.Fatalf("unexpected submitted seed: %d", got)
	}
	tags, ok := submitPayload["tags"].([]any)
	if !ok || len(tags) != 2 || nimillm.ValueAsString(tags[0]) != "nimi" || nimillm.ValueAsString(tags[1]) != "desktop" {
		t.Fatalf("unexpected submitted tags: %#v", submitPayload["tags"])
	}
	worldPrompt, ok := submitPayload["world_prompt"].(map[string]any)
	if !ok {
		t.Fatalf("expected submitted world_prompt payload, got %#v", submitPayload["world_prompt"])
	}
	if got := nimillm.ValueAsString(worldPrompt["type"]); got != "text" {
		t.Fatalf("unexpected submitted prompt type: %q", got)
	}
	if got := nimillm.ValueAsString(worldPrompt["text_prompt"]); got != textPrompt {
		t.Fatalf("unexpected submitted text prompt: %q", got)
	}
	if submitCalls != 1 || pollCalls < 1 || getWorldCalls != 1 {
		t.Fatalf("unexpected worldlabs call counts: submit=%d poll=%d get=%d", submitCalls, pollCalls, getWorldCalls)
	}
}

func TestSubmitScenarioJobStoresScenarioNativeState(t *testing.T) {
	speechBytes := []byte("scenario-native-store")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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

func TestSubmitScenarioJobInstalledImageFailsClosedWithoutExecutionDriver(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{EnforceEndpointSecurity: true})
	localModels := &fakeLocalModelLister{
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
	svc.localModel = localModels
	resolver := &fakeLocalImageProfileResolver{
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
	svc.localImageProfile = resolver

	request := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/flux.1-schnell",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "local/flux.1-schnell", "image.generate", localModels.responses[0].Assets[0]),
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
	}
	_, localPlan, prepareErr := svc.prepareScenarioRequestWithExtensionsAndLocalPlan(
		context.Background(),
		request.GetHead(),
		request.GetScenarioType(),
		request.GetExtensions(),
	)
	if prepareErr != nil || localPlan == nil || localPlan.selectedLocalAssetID() != "local-image-installed" {
		t.Fatalf("prepare INSTALLED exact image execution plan: plan=%+v err=%v", localPlan, prepareErr)
	}
	resp, err := svc.SubmitScenarioJob(context.Background(), request)
	if resp != nil {
		t.Fatalf("unsupported Local image response = %+v", resp)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("unsupported Local image error = %v, reason=%v ok=%v", err, reason, ok)
	}
	if jobs := len(svc.scenarioJobs.jobs); jobs != 0 {
		t.Fatalf("unsupported Local image created %d jobs", jobs)
	}
	if localModels.calls != 0 || localModels.warmCalls != 0 || localModels.startCalls != 0 ||
		resolver.resolveProfileCalls != 0 || resolver.ensureLoadCalls != 0 {
		t.Fatalf("unsupported Local image touched execution substrate")
	}
}

func TestSubscribeScenarioJobEventsForMediaScenario(t *testing.T) {
	speechBytes := []byte("scenario-events-speech")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", serverURL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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
	metadata := job.GetReasonMetadata().AsMap()
	if got := metadata["action_hint"]; got != "check_provider_endpoint_or_local_runtime_health" {
		t.Fatalf("unexpected action_hint: %#v", got)
	}
	if _, exists := metadata["retryable"]; exists {
		t.Fatalf("unexpected retryable metadata: %#v", metadata)
	}
	if _, exists := metadata["provider_message"]; exists {
		t.Fatalf("provider body must not be projected into scenario job metadata: %#v", metadata)
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
		// Channel already closed; acceptable.
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
