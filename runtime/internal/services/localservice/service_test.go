package localservice

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	return newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  true,
			detail:   "probe mocked healthy",
			probeURL: endpoint,
		}
	})
}

func newTestServiceWithProbe(t *testing.T, probe func(context.Context, string) endpointProbeResult) *Service {
	t.Helper()
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, err := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0)
	if err != nil {
		t.Fatalf("create local service: %v", err)
	}
	if err := svc.SetProductVersion("test"); err != nil {
		t.Fatalf("set test product version: %v", err)
	}
	svc.SetProductControlDataRootConfigWriter(func(string) (bool, error) { return false, nil })
	testRuntimeRoot := t.TempDir()
	svc.localModelsPath = filepath.Join(testRuntimeRoot, "models")
	svc.managedLlamaModelsConfigPath = filepath.Join(testRuntimeRoot, "runtime", "llama-models.yaml")
	if probe != nil {
		svc.endpointProbe = func(ctx context.Context, _ string, endpoint string) endpointProbeResult {
			return probe(ctx, endpoint)
		}
	}
	svc.managedPortAvailable = func(int) bool {
		return true
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		return nil
	}
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{}, nil
	}
	t.Cleanup(func() {
		svc.Close()
	})
	return svc
}

func TestNewDerivesManagedLlamaConfigFromRuntimeState(t *testing.T) {
	stateRoot := t.TempDir()
	statePath := filepath.Join(stateRoot, "local-state.json")
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", t.TempDir())
	svc, err := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0)
	if err != nil {
		t.Fatalf("create local service: %v", err)
	}
	t.Cleanup(func() { svc.Close() })
	want := filepath.Join(stateRoot, "llama-models.yaml")
	if got := svc.managedLlamaModelsConfigPath; got != want {
		t.Fatalf("managed llama config path = %q, want Runtime state path %q", got, want)
	}
}

func TestNewUsesConfiguredLocalModelsPathForUnregisteredScan(t *testing.T) {
	t.Helper()
	modelsDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(modelsDir, "custom.gguf"), []byte("gguf"), 0o644); err != nil {
		t.Fatalf("write model file: %v", err)
	}
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, err := New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0, modelsDir)
	if err != nil {
		t.Fatalf("create local service: %v", err)
	}
	t.Cleanup(func() {
		svc.Close()
	})

	resp, err := svc.ScanUnregisteredAssets(context.Background(), &runtimev1.ScanUnregisteredAssetsRequest{})
	if err != nil {
		t.Fatalf("scan unregistered assets: %v", err)
	}
	if len(resp.GetItems()) != 1 {
		t.Fatalf("expected configured models path scan to find 1 item, got %d", len(resp.GetItems()))
	}
	if got := resp.GetItems()[0].GetPath(); got != filepath.Join(modelsDir, "custom.gguf") {
		t.Fatalf("unexpected scan path: got=%q", got)
	}
}

func setLocalRuntimePlatformForTest(t *testing.T, goos string, goarch string) {
	t.Helper()
	originalGOOS := localRuntimeGOOS
	originalGOARCH := localRuntimeGOARCH
	localRuntimeGOOS = goos
	localRuntimeGOARCH = goarch
	t.Cleanup(func() {
		localRuntimeGOOS = originalGOOS
		localRuntimeGOARCH = originalGOARCH
	})
}

func setLocalRuntimeProbeHooksForTest(
	t *testing.T,
	lookPath func(string) (string, error),
	command func(context.Context, string, ...string) *exec.Cmd,
	stat func(string) (os.FileInfo, error),
) {
	t.Helper()
	originalLookPath := localRuntimeLookPath
	originalCommand := localRuntimeCommand
	originalStat := localRuntimeStat
	localRuntimeLookPath = lookPath
	localRuntimeCommand = command
	localRuntimeStat = stat
	t.Cleanup(func() {
		localRuntimeLookPath = originalLookPath
		localRuntimeCommand = originalCommand
		localRuntimeStat = originalStat
	})
}

func setLocalRuntimeCommandOutputForTest(
	t *testing.T,
	output func(context.Context, string, ...string) ([]byte, error),
) {
	t.Helper()
	original := localRuntimeCommandOutput
	localRuntimeCommandOutput = output
	t.Cleanup(func() {
		localRuntimeCommandOutput = original
	})
}

func setNvidiaGPUProbeForTest(t *testing.T, cudaReady bool) {
	t.Helper()
	setLocalRuntimeProbeHooksForTest(
		t,
		func(name string) (string, error) {
			switch name {
			case "nvidia-smi":
				return "/usr/bin/nvidia-smi", nil
			case "nvcc":
				if cudaReady {
					return "/usr/local/cuda/bin/nvcc", nil
				}
			}
			return "", exec.ErrNotFound
		},
		exec.CommandContext,
		func(string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	)
	setLocalRuntimeCommandOutputForTest(t, func(_ context.Context, name string, _ ...string) ([]byte, error) {
		if name == "nvidia-smi" {
			return []byte("NVIDIA RTX 4090, 24576, 20000\n"), nil
		}
		return nil, exec.ErrNotFound
	})
}

func setUnsupportedGPUProbeForTest(t *testing.T) {
	t.Helper()
	setLocalRuntimeProbeHooksForTest(
		t,
		func(string) (string, error) {
			return "", exec.ErrNotFound
		},
		exec.CommandContext,
		func(string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	)
}

func setManagedImageHostForTest(t *testing.T, chip string) {
	t.Helper()
	setLocalRuntimeProbeHooksForTest(
		t,
		func(string) (string, error) {
			return "", exec.ErrNotFound
		},
		exec.CommandContext,
		func(string) (os.FileInfo, error) {
			return nil, os.ErrNotExist
		},
	)
	setLocalRuntimeCommandOutputForTest(t, func(_ context.Context, name string, args ...string) ([]byte, error) {
		if name == "sysctl" && len(args) == 2 && args[0] == "-n" && args[1] == "machdep.cpu.brand_string" {
			return []byte(chip + "\n"), nil
		}
		return nil, exec.ErrNotFound
	})
}

func mustImportManagedImageAssetForTest(t *testing.T, svc *Service, logicalModelID string) *runtimev1.LocalAssetRecord {
	t.Helper()
	manifestPath := filepath.Join(svc.localModelsPath, "resolved", filepath.FromSlash(logicalModelID), "asset.manifest.json")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("mkdir image manifest dir: %v", err)
	}
	entryPath := filepath.Join(filepath.Dir(manifestPath), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(entryPath, validImageTestGGUF(), 0o600); err != nil {
		t.Fatalf("write image entry: %v", err)
	}
	entryHash, err := computeImportFileSHA256(entryPath)
	if err != nil {
		t.Fatalf("hash image entry: %v", err)
	}
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_image_turbo-Q4_K",
		"kind":             "image",
		"logical_model_id": logicalModelID,
		"engine":           "media",
		"capabilities":     []string{"image"},
		"entry":            "z_image_turbo-Q4_K.gguf",
		"files":            []string{"z_image_turbo-Q4_K.gguf"},
		"hashes":           map[string]string{"z_image_turbo-Q4_K.gguf": "sha256:" + entryHash},
		"engineConfig": map[string]any{
			"backend": "stablediffusion-ggml",
		},
	})
	if err != nil {
		t.Fatalf("marshal image manifest: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write image manifest: %v", err)
	}
	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err != nil {
		t.Fatalf("import image asset: %v", err)
	}
	return imported.GetAsset()
}

func addManagedLlamaAssetForTest(
	t *testing.T,
	svc *Service,
	localAssetID string,
	assetID string,
	logicalModelID string,
	entry string,
	status runtimev1.LocalAssetStatus,
	warmState runtimev1.LocalWarmState,
) *runtimev1.LocalAssetRecord {
	t.Helper()
	manifestPath := writeManagedGGUFBundleForTest(t, svc.localModelsPath, logicalModelID, assetID, entry)
	record := &runtimev1.LocalAssetRecord{
		LocalAssetId:    localAssetID,
		AssetId:         assetID,
		Kind:            runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Capabilities:    []string{"chat"},
		Engine:          "llama",
		Entry:           entry,
		License:         "unknown",
		Source:          &runtimev1.LocalAssetSource{Repo: "file://" + filepath.ToSlash(manifestPath), Revision: "local"},
		Status:          status,
		InstalledAt:     nowISO(),
		UpdatedAt:       nowISO(),
		HealthDetail:    "",
		Endpoint:        defaultLocalEndpoint,
		LogicalModelId:  logicalModelID,
		PreferredEngine: "llama",
		BundleState:     runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_READY,
		WarmState:       warmState,
	}
	svc.mu.Lock()
	svc.assets[localAssetID] = cloneLocalAsset(record)
	svc.setModelRuntimeModeLocked(localAssetID, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED)
	svc.persistStateLocked()
	svc.mu.Unlock()
	return record
}

func recordManagedLlamaWarmKeyForTest(t *testing.T, svc *Service, model *runtimev1.LocalAssetRecord, endpoint string) {
	t.Helper()
	key := warmCacheKey(
		model,
		endpoint,
		normalizeWarmResolvedModelID(model.GetAssetId()),
		warmCapabilityForModel(model),
	)
	svc.recordWarmKey(key)
}

func mustInstallUnsupportedSafetensorsNativeImageForTest(t *testing.T, svc *Service, assetID string) *runtimev1.LocalAssetRecord {
	t.Helper()
	record, err := svc.installLocalAssetRecord(
		assetID,
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE,
		[]string{"image"},
		"media",
		"model.safetensors",
		"unknown",
		assetID,
		"local",
		nil,
		"",
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		"",
		nil,
		nil,
		"runtime_model_ready_after_install",
		"model installed",
		localAssetExistingPolicyFail,
	)
	if err != nil {
		t.Fatalf("install unsupported safetensors native image: %v", err)
	}
	return record
}

func cacheManagedImageProfileForTest(t *testing.T, svc *Service, localAssetID string) map[string]any {
	t.Helper()
	model := svc.modelByID(localAssetID)
	if model == nil {
		t.Fatalf("missing local asset %q", localAssetID)
	}
	modelPath := filepath.Join(runtimeManagedResolvedModelDir(resolveLocalModelsPath(svc.localModelsPath), model.GetLogicalModelId()), model.GetEntry())
	profile := map[string]any{
		"backend": "stablediffusion-ggml",
		"parameters": map[string]any{
			"model": modelPath,
		},
		"cfg_scale": 1,
		"options": []any{
			"diffusion_model",
			"llm_path:/tmp/qwen.gguf",
			"vae_path:/tmp/ae.safetensors",
		},
	}
	svc.cacheManagedMediaImageProfile(localAssetID, "test-managed-image-profile", profile)
	return profile
}

func containsWarning(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func almostEqualFloat32(a float32, b float32) bool {
	return math.Abs(float64(a-b)) < 0.001
}

func TestLocalImportVideoModelRejectsManagedLoopbackEndpointOnAttachedOnlyHost(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", false)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "video-model-loopback", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_video_turbo_loopback",
		"kind":             "video",
		"logical_model_id": "nimi/video-model-loopback",
		"engine":           "media",
		"capabilities":     []string{"video.generate"},
		"entry":            "z_video_turbo.bin",
		"endpoint":         defaultMediaEndpoint,
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	_, err = svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
	})
	if err == nil {
		t.Fatal("expected managed media loopback endpoint to fail-close on attached-only host")
	}
	assertGRPCCode(t, err, "ImportLocalAsset(media managed loopback attached host)", codes.InvalidArgument)
	assertGRPCReasonCode(t, err, "ImportLocalAsset(media managed loopback attached host)", runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED)
	st, _ := status.FromError(err)
	if !strings.Contains(st.Message(), "attached endpoint") {
		t.Fatalf("expected explicit attached endpoint detail, got %q", st.Message())
	}
}

func TestLocalImportManifestDuplicateCreatesDistinctAssetEndpoint(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	tmpDir := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(tmpDir, "", false)
	manifestPath := filepath.Join(tmpDir, "resolved", "nimi", "video-model-rebind", "asset.manifest.json")
	rawManifest, err := json.Marshal(map[string]any{
		"asset_id":         "local-import/z_video_turbo_rebind",
		"kind":             "video",
		"logical_model_id": "nimi/video-model-rebind",
		"engine":           "media",
		"capabilities":     []string{"video.generate"},
		"entry":            "z_video_turbo.bin",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest dir: %v", err)
	}
	if err := os.WriteFile(manifestPath, rawManifest, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	existing, err := svc.installLocalAssetRecord(
		"local-import/z_video_turbo_rebind",
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO,
		[]string{"video.generate"},
		"media",
		"z_video_turbo.bin",
		"unknown",
		"file://"+filepath.ToSlash(manifestPath),
		"local",
		map[string]string{},
		defaultMediaEndpoint,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
		"",
		nil,
		nil,
		"runtime_model_imported",
		manifestPath,
		localAssetExistingPolicyFail,
	)
	if err != nil {
		t.Fatalf("seed existing asset: %v", err)
	}
	svc.setModelHealthDetail(existing.GetLocalAssetId(), "stale bad endpoint")
	if _, err := svc.updateModelStatus(existing.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "stale bad endpoint"); err != nil {
		t.Fatalf("seed unhealthy status: %v", err)
	}

	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: manifestPath,
		Endpoint:     "http://127.0.0.1:9321/v1",
	})
	if err != nil {
		t.Fatalf("duplicate manifest import: %v", err)
	}
	if imported.GetAsset().GetLocalAssetId() == existing.GetLocalAssetId() {
		t.Fatalf("duplicate import must mint a distinct local_asset_id: %q", imported.GetAsset().GetLocalAssetId())
	}
	if imported.GetAsset().GetEndpoint() != "http://127.0.0.1:9321/v1" {
		t.Fatalf("imported endpoint mismatch: %q", imported.GetAsset().GetEndpoint())
	}
	if imported.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("imported asset should be installed, got %s", imported.GetAsset().GetStatus())
	}
	if strings.TrimSpace(imported.GetAsset().GetHealthDetail()) != "" {
		t.Fatalf("imported asset should not inherit stale health detail, got %q", imported.GetAsset().GetHealthDetail())
	}
	storedExisting := svc.modelByID(existing.GetLocalAssetId())
	if storedExisting == nil {
		t.Fatalf("expected existing asset to remain stored")
	}
	if storedExisting.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("existing asset status should remain unhealthy, got %s", storedExisting.GetStatus())
	}
	if storedExisting.GetEndpoint() == "http://127.0.0.1:9321/v1" {
		t.Fatalf("duplicate import must not rewrite existing endpoint")
	}
}

func TestStartLocalModelAttachedLoopbackConfigFailsBeforeProbe(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls += 1
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe should not run",
			probeURL: endpoint,
		}
	})
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)
	model, err := svc.installLocalAssetRecord(
		"local-import/z_video_turbo_fastfail",
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO,
		[]string{"video.generate"},
		"media",
		"z_video_turbo.bin",
		"unknown",
		"local-import/z_video_turbo_fastfail",
		"local",
		map[string]string{},
		defaultMediaEndpoint,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
		"",
		nil,
		nil,
		"runtime_model_imported",
		"seed bad media loopback asset",
		localAssetExistingPolicyFail,
	)
	if err != nil {
		t.Fatalf("seed loopback asset: %v", err)
	}
	entryPath := filepath.Join(resolveLocalModelsPath(modelsRoot), slugifyLocalModelID(model.GetAssetId()), model.GetEntry())
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create managed entry dir: %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("stub"), 0o600); err != nil {
		t.Fatalf("write managed entry file: %v", err)
	}

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("start local asset: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy fast-fail status, got %s", started.GetAsset().GetStatus())
	}
	if probeCalls != 0 {
		t.Fatalf("expected no probe for attached-loopback config error, got %d probe calls", probeCalls)
	}
	if !strings.Contains(started.GetAsset().GetHealthDetail(), "attached endpoint") {
		t.Fatalf("expected attached endpoint config detail, got %q", started.GetAsset().GetHealthDetail())
	}
}

func TestCheckLocalAssetHealthAttachedLoopbackConfigFailsBeforeProbe(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls += 1
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe should not run",
			probeURL: endpoint,
		}
	})
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	modelsRoot := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)
	model, err := svc.installLocalAssetRecord(
		"local-import/z_video_turbo_health",
		runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO,
		[]string{"video.generate"},
		"media",
		"z_video_turbo.bin",
		"unknown",
		"local-import/z_video_turbo_health",
		"local",
		map[string]string{},
		defaultMediaEndpoint,
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
		"",
		nil,
		nil,
		"runtime_model_imported",
		"seed bad media loopback asset",
		localAssetExistingPolicyFail,
	)
	if err != nil {
		t.Fatalf("seed loopback asset: %v", err)
	}
	entryPath := filepath.Join(resolveLocalModelsPath(modelsRoot), slugifyLocalModelID(model.GetAssetId()), model.GetEntry())
	if err := os.MkdirAll(filepath.Dir(entryPath), 0o755); err != nil {
		t.Fatalf("create managed entry dir: %v", err)
	}
	if err := os.WriteFile(entryPath, []byte("stub"), 0o600); err != nil {
		t.Fatalf("write managed entry file: %v", err)
	}

	health, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: model.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("check health: %v", err)
	}
	if len(health.GetAssets()) != 1 {
		t.Fatalf("expected one health record, got %d", len(health.GetAssets()))
	}
	if health.GetAssets()[0].GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy fast-fail status, got %s", health.GetAssets()[0].GetStatus())
	}
	if probeCalls != 0 {
		t.Fatalf("expected no probe for attached-loopback config error, got %d probe calls", probeCalls)
	}
	if !strings.Contains(health.GetAssets()[0].GetDetail(), "attached endpoint") {
		t.Fatalf("expected attached endpoint config detail, got %q", health.GetAssets()[0].GetDetail())
	}
}

func TestLocalImportManifestRejectsSymlinkOutsideModelsRoot(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := t.TempDir()
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)

	outsideDir := t.TempDir()
	outsideManifest := filepath.Join(outsideDir, "asset.manifest.json")
	if err := os.WriteFile(outsideManifest, []byte(`{"asset_id":"local/outside","kind":"chat","engine":"llama","capabilities":["chat"]}`), 0o600); err != nil {
		t.Fatalf("write outside manifest: %v", err)
	}
	linkedManifest := filepath.Join(modelsRoot, "resolved", "nimi", "symlinked", "asset.manifest.json")
	if err := os.MkdirAll(filepath.Dir(linkedManifest), 0o755); err != nil {
		t.Fatalf("create linked manifest dir: %v", err)
	}
	if err := os.Symlink(outsideManifest, linkedManifest); err != nil {
		if strings.Contains(err.Error(), "A required privilege is not held by the client") {
			t.Skip("symlink privilege unavailable on this Windows host")
		}
		t.Fatalf("create manifest symlink: %v", err)
	}

	_, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: linkedManifest})
	if err == nil {
		t.Fatal("expected symlinked manifest outside root to be rejected")
	}
	assertGRPCReasonCode(t, err, "ImportLocalModel(symlink outside root)", runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID)
}

func TestLocalCollectDeviceProfileIncludesExtraPorts(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{
		ExtraPorts: []int32{9999, 1234, -1, 70000},
	})
	if err != nil {
		t.Fatalf("collect profile with extra ports: %v", err)
	}
	found9999 := false
	for _, item := range resp.GetProfile().GetPorts() {
		if item.GetPort() == 9999 {
			found9999 = true
			break
		}
	}
	if !found9999 {
		t.Fatalf("extra port 9999 should be included in probe result")
	}
}

func TestResolveModelInstallPlanManualAddsDeviceWarnings(t *testing.T) {
	svc := newTestService(t)
	t.Setenv("NIMI_NPU_AVAILABLE", "0")
	t.Setenv("NIMI_NPU_READY", "0")

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId:  "local/npu-model",
		Engine:   "npu-accelerated-engine",
		Endpoint: "http://127.0.0.1:1234/v1",
	})
	if err != nil {
		t.Fatalf("resolve model install plan: %v", err)
	}
	plan := resp.GetPlan()
	if !plan.GetInstallAvailable() {
		t.Fatalf("manual plan should remain installable with warnings")
	}
	if plan.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	found := false
	for _, warning := range plan.GetWarnings() {
		if warning == "WARN_NPU_REQUIRED" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected WARN_NPU_REQUIRED warning, got %#v", plan.GetWarnings())
	}
}

func TestResolveModelInstallPlanSidecarEndpointRequired(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId:      "local/stable-audio-open-sidecar",
		Engine:       "sidecar",
		Capabilities: []string{"music"},
	})
	if err != nil {
		t.Fatalf("resolve model install plan: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetInstallAvailable() {
		t.Fatalf("sidecar attached-endpoint plan without endpoint must be unavailable")
	}
	if plan.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String() {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if strings.TrimSpace(plan.GetEndpoint()) != "" {
		t.Fatalf("sidecar endpoint should remain empty when not provided, got %q", plan.GetEndpoint())
	}
}

func TestInstallModelFromPlanRegistersAttachedEndpoint(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{
		Plan: &runtimev1.LocalInstallPlanDescriptor{
			ModelId:          "local/test-attached",
			Repo:             "test/repo",
			Revision:         "main",
			Capabilities:     []string{"chat"},
			Engine:           "llama",
			InstallAvailable: true,
			Endpoint:         "http://127.0.0.1:1234/v1",
			Entry:            "model.gguf",
			License:          "test",
		},
	})
	if err != nil {
		t.Fatalf("install model from plan: %v", err)
	}
	asset := resp.GetAsset()
	if asset.GetAssetId() != "local/test-attached" {
		t.Fatalf("unexpected asset id: %q", asset.GetAssetId())
	}
	if asset.GetEndpoint() != "http://127.0.0.1:1234/v1" {
		t.Fatalf("unexpected endpoint: %q", asset.GetEndpoint())
	}
}

func TestInstallModelFromPlanRejectsUnavailablePlan(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{
		Plan: &runtimev1.LocalInstallPlanDescriptor{
			ModelId:      "local/unavailable",
			ReasonCode:   runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String(),
			Capabilities: []string{"music"},
			Engine:       "sidecar",
		},
	})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected reason code %s, got=%v ok=%v err=%v", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, reason, ok, err)
	}
}

func TestInstallLocalModelSidecarRequiresEndpoint(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/stable-audio-open-sidecar",
		engine:       "sidecar",
		capabilities: []string{"music"},
	})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED {
		t.Fatalf("expected reason code %s, got=%v ok=%v err=%v", runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, reason, ok, err)
	}
}

func TestLocalNodeCatalogSidecarMusicAdapter(t *testing.T) {
	svc := newTestService(t)

	modelResp, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/stable-audio-open-sidecar",
		capabilities: []string{"music"},
		engine:       "sidecar",
		endpoint:     "http://127.0.0.1:19191",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-sidecar-music",
		Title:        "Sidecar Music Service",
		Engine:       "sidecar",
		Capabilities: []string{"music"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-sidecar-music",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Provider:   "sidecar",
		Capability: "music",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) != 1 {
		t.Fatalf("node count mismatch: got=%d want=1", len(nodesResp.GetNodes()))
	}
	node := nodesResp.GetNodes()[0]
	if node.GetAdapter() != "sidecar_music_adapter" {
		t.Fatalf("sidecar music adapter mismatch: %s", node.GetAdapter())
	}
	if node.GetApiPath() != "/v1/music/generate" {
		t.Fatalf("sidecar music api path mismatch: %s", node.GetApiPath())
	}
	if node.GetBackend() != "sidecar" || node.GetProvider() != "sidecar" {
		t.Fatalf("sidecar node backend/provider mismatch: backend=%s provider=%s", node.GetBackend(), node.GetProvider())
	}
	if node.GetProviderHints() == nil {
		t.Fatalf("sidecar music node must include provider hints")
	}
	if got, want := node.GetProviderHints().GetExtra()["endpoint"], "http://127.0.0.1:19191"; got != want {
		t.Fatalf("sidecar music endpoint mismatch: got=%q want=%q", got, want)
	}
}

func TestResolveModelInstallPlanCatalogSupervisedRequiresEngineManager(t *testing.T) {
	svc := newTestService(t)
	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId:            "catalog.supervised.model",
		Source:            "verified",
		Title:             "Supervised Model",
		ModelId:           "local/supervised-model",
		Engine:            "llama",
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		InstallKind:       "download",
		Capabilities:      []string{"chat"},
	})
	svc.mu.Unlock()

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.supervised.model",
	})
	if err != nil {
		t.Fatalf("resolve supervised plan: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetInstallAvailable() {
		t.Fatalf("supervised plan without engine manager must be unavailable")
	}
	if plan.GetReasonCode() != "LOCAL_ENGINE_MANAGER_UNAVAILABLE" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
}

func TestResolveModelInstallPlanCatalogSupervisedWithManagerAvailable(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId:            "catalog.supervised.model.available",
		Source:            "verified",
		Title:             "Supervised Model Available",
		ModelId:           "local/supervised-model-available",
		Engine:            "llama",
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		InstallKind:       "download",
		Capabilities:      []string{"chat"},
	})
	svc.mu.Unlock()

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.supervised.model.available",
	})
	if err != nil {
		t.Fatalf("resolve supervised plan with manager: %v", err)
	}
	plan := resp.GetPlan()
	if !plan.GetInstallAvailable() {
		t.Fatalf("supervised plan should be available when engine manager can resolve status")
	}
	if plan.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
}

func TestLocalApplyExecutionPlanRejectsUnsupportedKindInPreflight(t *testing.T) {
	svc := newTestService(t)
	result := svc.applyExecutionPlanStrict(context.Background(), &runtimev1.LocalExecutionPlan{
		PlanId:   "dep-plan-unsupported-kind",
		TargetId: "world.nimi.unsupported-kind",
		Entries: []*runtimev1.LocalExecutionEntryDescriptor{
			{
				EntryId:  "dep.unsupported.kind",
				Kind:     runtimev1.LocalExecutionEntryKind(99),
				Selected: true,
				Required: true,
			},
		},
		DeviceProfile: &runtimev1.LocalDeviceProfile{
			Os:   "darwin",
			Arch: "arm64",
			Python: &runtimev1.LocalPythonProfile{
				Available: true,
			},
		},
	})
	if result.GetReasonCode() != "LOCAL_EXECUTION_ENTRY_KIND_UNSUPPORTED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if result.GetRollbackApplied() {
		t.Fatalf("preflight rejection must not apply rollback")
	}
}

func TestLocalRollbackApplyCombinesReasonCodesOnRollbackFailure(t *testing.T) {
	svc := newTestService(t)
	result := &runtimev1.LocalExecutionApplyResult{
		ReasonCode: "LOCAL_DEPENDENCY_MODEL_HEALTH_FAILED",
	}

	svc.rollbackApply(context.Background(), []string{"local-model-missing"}, []string{"local-service-missing"}, result)

	if !result.GetRollbackApplied() {
		t.Fatalf("rollback_applied must be true when rollback is attempted")
	}
	if !strings.Contains(result.GetReasonCode(), "LOCAL_DEPENDENCY_MODEL_HEALTH_FAILED") {
		t.Fatalf("result reason code must retain original failure, got %s", result.GetReasonCode())
	}
	if !strings.Contains(result.GetReasonCode(), runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE.String()) {
		t.Fatalf("result reason code must include rollback failure reason, got %s", result.GetReasonCode())
	}
	if len(result.GetStageResults()) != 1 {
		t.Fatalf("expected exactly one rollback stage result, got %d", len(result.GetStageResults()))
	}
	stage := result.GetStageResults()[0]
	if stage.GetStage() != applyStageRollback {
		t.Fatalf("expected rollback stage name, got %s", stage.GetStage())
	}
	if stage.GetOk() {
		t.Fatalf("rollback stage must fail when rollback remove operations fail")
	}
	if stage.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE.String() {
		t.Fatalf("unexpected rollback reason code: %s", stage.GetReasonCode())
	}
	if len(result.GetWarnings()) < 2 {
		t.Fatalf("expected rollback warnings for failed remove operations")
	}
}
