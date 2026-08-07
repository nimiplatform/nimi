package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	_ "image/png"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	liveSDJourneyGate       = "NIMI_LIVE_SD_JOURNEY"
	liveSDBackendDirEnv     = "NIMI_LIVE_SD_BACKEND_DIR"
	liveSDMainModelEnv      = "NIMI_LIVE_SD_MAIN_MODEL_PATH"
	liveSDTextEncoderEnv    = "NIMI_LIVE_SD_TEXT_ENCODER_PATH"
	liveSDVAEEnv            = "NIMI_LIVE_SD_VAE_PATH"
	defaultLiveSDBackendDir = "/Users/snwozy/Nimi/environments/managed-image-backends/metal-stablediffusion-ggml"
	defaultLiveSDMainModel  = "/Users/snwozy/Nimi/models/resolved/nimi/local-import-z-image-turbo-q4-k-m-01kzd4jhznm7p9rpyfr7chky34/z-image-turbo-Q4_K_M.gguf"
	defaultLiveSDTextModel  = "/Users/snwozy/Nimi/models/resolved/nimi/local-import-qwen3-4b-q4-k-m-01kzd4fwjd0z5wkcdx5m9qtgsb/Qwen3-4B-Q4_K_M.gguf"
	defaultLiveSDVAE        = "/Users/snwozy/Nimi/models/resolved/local-import-ae-01kzd4gay1qvw8mc0hkmc9m65e/ae.safetensors"
)

type liveSDRegisteredAsset struct {
	asset     *runtimev1.LocalAssetRecord
	contentID string
	linked    string
	size      int64
}

func TestLiveStableDiffusionLocalJourney(t *testing.T) {
	if strings.TrimSpace(os.Getenv(liveSDJourneyGate)) != "1" {
		t.Skipf("set %s=1 to run the real LocalAsset/stable-diffusion.cpp journey", liveSDJourneyGate)
	}
	backendDirectory := liveLlamaEnvOrDefault(liveSDBackendDirEnv, defaultLiveSDBackendDir)
	mainPath := liveLlamaEnvOrDefault(liveSDMainModelEnv, defaultLiveSDMainModel)
	textPath := liveLlamaEnvOrDefault(liveSDTextEncoderEnv, defaultLiveSDTextModel)
	vaePath := liveLlamaEnvOrDefault(liveSDVAEEnv, defaultLiveSDVAE)
	for _, path := range []string{mainPath, textPath, vaePath} {
		assertLiveSDRegularFile(t, path, false)
	}
	assertLiveSDRegularFile(t, filepath.Join(backendDirectory, "stablediffusion-ggml"), true)
	assertLiveSDRegularFile(t, filepath.Join(backendDirectory, "libgosd-fallback.so"), false)

	dataRoot := t.TempDir()
	modelsRoot := filepath.Join(dataRoot, "models")
	statePath := filepath.Join(dataRoot, "state", "local-state.json")
	logs := &liveLlamaLockedBuffer{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelInfo}))
	localSvc, err := localservice.NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, dataRoot)
	if err != nil {
		t.Fatalf("create isolated Local service: %v", err)
	}
	t.Cleanup(localSvc.Close)

	main := registerLiveSDAsset(t, localSvc, modelsRoot, "main", mainPath, "image", "z-image-turbo", "media", []string{"image.generate"})
	textEncoder := registerLiveSDAsset(t, localSvc, modelsRoot, "text-encoder", textPath, "chat", "", "llama", []string{"chat"})
	vae := registerLiveSDAsset(t, localSvc, modelsRoot, "vae", vaePath, "vae", "flux2-vae", "media", nil)
	configuration := addBindAndSelectLiveSDConfiguration(t, localSvc, main, textEncoder, vae)

	manager, err := engine.NewManager(logger, engine.ManagedRoots{
		Environments: filepath.Join(dataRoot, "environments"), Dependencies: filepath.Join(dataRoot, "dependencies"),
	}, nil)
	if err != nil {
		t.Fatalf("create image engine manager: %v", err)
	}
	manager.SetRuntimeWorkRoot(filepath.Join(dataRoot, "work"))
	host := engine.NewImageExecutionHost(manager, logger, engine.ImageExecutionHostConfig{
		BackendDirectory: backendDirectory,
		WorkRoot:         filepath.Join(dataRoot, "image-work"),
		StartupTimeout:   45 * time.Second,
		ShutdownTimeout:  15 * time.Second,
	})
	t.Cleanup(func() {
		if err := host.Stop(); err != nil {
			t.Logf("image Host stop: %v", err)
		}
		manager.StopAll()
	})
	aiSvc := newTestService(logger, Config{})
	aiSvc.SetLocalExecutionResolver(localSvc)
	aiSvc.SetLocalImageExecutionHost(host)
	aiSvc.SetRuntimeArtifactStore(runtimeartifact.NewMemoryStore())
	t.Cleanup(func() {
		if t.Failed() {
			t.Logf("image engine log tail:\n%s", tailLiveLlamaLog(logs.String(), 20000))
		}
	})

	if !t.Run("fails_closed_without_selection", func(t *testing.T) {
		if _, err := localSvc.ClearLocalCapabilitySelection(context.Background(), &runtimev1.ClearLocalCapabilitySelectionRequest{
			CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		}); err != nil {
			t.Fatal(err)
		}
		_, err := aiSvc.SubmitScenarioJob(liveSDLocalContext(context.Background()), liveSDJobRequest())
		assertLiveLlamaReason(t, err, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
		selectLiveSDConfiguration(t, localSvc, configuration.GetConfigurationId())
	}) {
		return
	}

	t.Run("complete_local_asset_driver_host_job_chain", func(t *testing.T) {
		startedAt := time.Now()
		submitted, err := aiSvc.SubmitScenarioJob(liveSDLocalContext(context.Background()), liveSDJobRequest())
		if err != nil {
			t.Fatalf("SubmitScenarioJob: %v", err)
		}
		jobID := submitted.GetJob().GetJobId()
		job := waitLiveSDJob(t, aiSvc, jobID, 30*time.Minute)
		if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL ||
			job.GetModelResolved() != configuration.GetDisplayName() || len(job.GetArtifacts()) != 1 {
			t.Fatalf("real image Job terminal = %+v", job)
		}
		if !liveSDJobEventsComplete(aiSvc, jobID) {
			t.Fatalf("job %s did not expose queued/running-artifact/completed events", jobID)
		}
		artifactID := job.GetArtifacts()[0].GetArtifactId()
		ownerCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.live-sd-journey"))
		transport, err := aiSvc.GetScenarioArtifacts(ownerCtx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
		if err != nil || len(transport.GetArtifacts()) != 1 || transport.GetArtifacts()[0].GetArtifactId() != artifactID ||
			len(transport.GetOutput().GetImageGenerate().GetArtifacts()) != 1 {
			t.Fatalf("GetScenarioArtifacts = %+v error=%v", transport, err)
		}
		record, ok := aiSvc.runtimeArtifacts.Get(artifactID)
		if !ok || len(record.Bytes) < 24 {
			t.Fatalf("runtime artifact %q missing or empty", artifactID)
		}
		wantHeader := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
		if string(record.Bytes[:8]) != string(wantHeader) {
			t.Fatalf("artifact header=%x want=%x", record.Bytes[:8], wantHeader)
		}
		decoded, format, err := image.DecodeConfig(bytes.NewReader(record.Bytes))
		if err != nil || format != "png" || decoded.Width != 512 || decoded.Height != 512 {
			t.Fatalf("decoded image format=%q dimensions=%dx%d error=%v", format, decoded.Width, decoded.Height, err)
		}
		info, err := manager.EngineStatus(engine.EngineKind("image-execution-host"))
		if err != nil || info.PID <= 0 || info.Status != engine.StatusHealthy || info.Endpoint == "127.0.0.1:50052" {
			t.Fatalf("attributed image process = %+v error=%v", info, err)
		}
		assertLiveSDSelection(t, localSvc, configuration)
		t.Logf("real_image artifact=%s bytes=%d mime=%s dimensions=%dx%d png_header=%x pid=%d address=%s compute_ms=%d elapsed=%s",
			artifactID, len(record.Bytes), record.MimeType, decoded.Width, decoded.Height, record.Bytes[:8], info.PID, info.Endpoint,
			job.GetUsage().GetComputeMs(), time.Since(startedAt).Round(time.Millisecond))
	})
}

func registerLiveSDAsset(t *testing.T, localSvc *localservice.Service, modelsRoot, label, sourcePath, kind, family, engineName string, capabilities []string) liveSDRegisteredAsset {
	t.Helper()
	bundleRoot := filepath.Join(modelsRoot, "resolved", "live", "sd", label)
	if err := os.MkdirAll(bundleRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	entryName := filepath.Base(sourcePath)
	entryPath := filepath.Join(bundleRoot, entryName)
	if err := os.Link(sourcePath, entryPath); err != nil {
		t.Fatalf("hard-link live SD %s (%s -> %s): %v", label, sourcePath, entryPath, err)
	}
	info, err := os.Stat(entryPath)
	if err != nil {
		t.Fatal(err)
	}
	hashStartedAt := time.Now()
	digest := sha256LiveSDFile(t, entryPath)
	manifestPath := filepath.Join(bundleRoot, "asset.manifest.json")
	manifest := map[string]any{
		"schema_version": "1.0.0", "asset_id": "local-import/live-sd-" + label,
		"display_name": "Live SD " + label, "kind": kind, "logical_model_id": "live/sd/" + label,
		"capabilities": capabilities, "engine": engineName, "entry": entryName, "files": []string{entryName},
		"license": "unknown", "integrity_mode": "local_unverified", "hashes": map[string]string{entryName: "sha256:" + digest},
		"source": map[string]any{"repo": "file://" + filepath.ToSlash(manifestPath), "revision": "live-journey"},
	}
	if family != "" {
		manifest["family"] = family
	}
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	imported, err := localSvc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
	if err != nil {
		t.Fatalf("ImportLocalAsset(%s): %v", label, err)
	}
	asset := imported.GetAsset()
	if asset == nil || asset.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED || asset.GetHashes()[asset.GetEntry()] != "sha256:"+digest {
		t.Fatalf("imported %s asset = %+v", label, asset)
	}
	t.Logf("live SD asset=%s role=%s kind=%s family=%q artifact_roles=%v bytes=%d sha256=%s hash_elapsed=%s", asset.GetLocalAssetId(), label, asset.GetKind(), asset.GetFamily(), asset.GetArtifactRoles(), info.Size(), digest, time.Since(hashStartedAt).Round(time.Millisecond))
	return liveSDRegisteredAsset{asset: asset, contentID: "sha256:" + digest, linked: entryPath, size: info.Size()}
}

func addBindAndSelectLiveSDConfiguration(t *testing.T, localSvc *localservice.Service, main, textEncoder, vae liveSDRegisteredAsset) *runtimev1.LocalCapabilityConfiguration {
	t.Helper()
	portable, err := structpb.NewStruct(map[string]any{
		"modelFamily": "z-image",
		"executionOptions": map[string]any{
			"steps": 9.0, "cfgScale": 1.0, "width": 512.0, "height": 512.0, "seed": 42.0,
			"threads": 8.0, "diffusionFlashAttention": true, "offloadParamsToCPU": false,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	added, err := localSvc.AddLocalCapabilityConfiguration(context.Background(), &runtimev1.AddLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		Implementation: (&capabilitydriver.Identity{
			ImplementationID: capabilitydriver.StableDiffusionImplementationID,
			DriverID:         capabilitydriver.StableDiffusionDriverID, DriverDialect: capabilitydriver.StableDiffusionDriverDialect,
		}).Proto(),
		PortableConfig: portable, DisplayName: "Nimi live Z-Image Turbo",
	})
	if err != nil {
		t.Fatalf("AddLocalCapabilityConfiguration(SD): %v", err)
	}
	configuration := added.GetConfiguration()
	assets := map[string]liveSDRegisteredAsset{
		capabilitydriver.StableDiffusionMainRequirementID:        main,
		capabilitydriver.StableDiffusionTextEncoderRequirementID: textEncoder,
		capabilitydriver.StableDiffusionVAERequirementID:         vae,
	}
	for _, requirement := range configuration.GetProjectedRequirements() {
		asset, ok := assets[requirement.GetRequirementId()]
		if !ok {
			t.Fatalf("unexpected projected SD requirement: %+v", requirement)
		}
		bound, err := localSvc.BindLocalCapabilityRequirement(context.Background(), &runtimev1.BindLocalCapabilityRequirementRequest{
			ConfigurationId: configuration.GetConfigurationId(), RequirementId: requirement.GetRequirementId(),
			Target: &runtimev1.LocalAssetExactBindingTarget{LocalAssetId: asset.asset.GetLocalAssetId(), ExpectedVerifiedContentId: asset.contentID},
		})
		if err != nil {
			t.Fatalf("BindLocalCapabilityRequirement(%s): %v", requirement.GetRequirementId(), err)
		}
		configuration = bound.GetConfiguration()
	}
	if configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED || len(configuration.GetExactBindings()) != 3 {
		t.Fatalf("bound SD configuration = %+v", configuration)
	}
	selectLiveSDConfiguration(t, localSvc, configuration.GetConfigurationId())
	return configuration
}

func selectLiveSDConfiguration(t *testing.T, localSvc *localservice.Service, configurationID string) {
	t.Helper()
	response, err := localSvc.SelectLocalCapabilityConfiguration(context.Background(), &runtimev1.SelectLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract, ConfigurationId: configurationID,
	})
	if err != nil || response.GetSelection().GetConfigurationId() != configurationID {
		t.Fatalf("SelectLocalCapabilityConfiguration(SD) = %+v error=%v", response, err)
	}
}

func liveSDLocalContext(parent context.Context) context.Context {
	return executionintent.WithIntent(parent, executionintent.Intent{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract, Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
}

func liveSDJobRequest() *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.live-sd-journey", TimeoutMs: 20 * 60 * 1000},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: "A small polished copper robot on a clean white studio background, product photograph", N: 1, Size: "512x512", Seed: 42,
		}}},
	}
}

func waitLiveSDJob(t *testing.T, svc *Service, jobID string, timeout time.Duration) *runtimev1.ScenarioJob {
	t.Helper()
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.live-sd-journey"))
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		response, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if err != nil {
			t.Fatalf("GetScenarioJob: %v", err)
		}
		job := response.GetJob()
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("real image Job failed status=%s reason=%s detail=%q metadata=%+v", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail(), job.GetReasonMetadata())
			}
			return job
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Fatalf("real image Job %s did not complete within %s", jobID, timeout)
	return nil
}

func liveSDJobEventsComplete(svc *Service, jobID string) bool {
	svc.scenarioJobs.mu.RLock()
	defer svc.scenarioJobs.mu.RUnlock()
	record := svc.scenarioJobs.jobs[jobID]
	if record == nil {
		return false
	}
	var queued, runningArtifact, completed bool
	for _, event := range record.events {
		switch event.GetEventType() {
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED:
			queued = true
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING:
			runningArtifact = runningArtifact || len(event.GetJob().GetArtifacts()) == 1
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED:
			completed = true
		}
	}
	return queued && runningArtifact && completed
}

func assertLiveSDSelection(t *testing.T, localSvc *localservice.Service, configuration *runtimev1.LocalCapabilityConfiguration) {
	t.Helper()
	resolved, err := localSvc.ResolveSelectedLocalExecution(capabilitydriver.StableDiffusionCapabilityContract)
	if err != nil {
		t.Fatalf("ResolveSelectedLocalExecution(SD): %v", err)
	}
	if resolved.ConfigurationID != configuration.GetConfigurationId() || len(resolved.ExactBindings) != 3 {
		t.Fatalf("selected SD execution changed: %+v", resolved)
	}
}

func sha256LiveSDFile(t *testing.T, path string) string {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	hasher := sha256.New()
	if _, err := io.CopyBuffer(hasher, file, make([]byte, 4*1024*1024)); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func assertLiveSDRegularFile(t *testing.T, path string, executable bool) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		t.Fatalf("required live SD file %s: info=%v error=%v", path, info, err)
	}
	if executable && info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("required live SD executable lacks execute mode: %s", path)
	}
}
