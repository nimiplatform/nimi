package localservice

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

func TestCheckLocalAssetHealthBulkDoesNotLoadManagedImage(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-health-bulk")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{})
	if err != nil {
		t.Fatalf("CheckLocalAssetHealth: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one asset, got %d", len(resp.GetAssets()))
	}
	if loadCalls != 0 {
		t.Fatalf("expected bulk health to avoid managed image load, got %d calls", loadCalls)
	}
}

func TestManagedImageExplicitHealthLoadsAndMarksActive(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	freeCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-explicit-health")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	resp, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: asset.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("CheckLocalAssetHealth(targeted): %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one health row, got %d", len(resp.GetAssets()))
	}
	if loadCalls != 1 {
		t.Fatalf("expected one managed image load, got %d", loadCalls)
	}
	if freeCalls != 0 {
		t.Fatalf("expected explicit health check to keep managed image resident during keep_alive, got %d", freeCalls)
	}
	if got := resp.GetAssets()[0].GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active image asset, got %s", got)
	}
	if detail := resp.GetAssets()[0].GetDetail(); !strings.Contains(detail, "backend load verified") {
		t.Fatalf("unexpected health detail: %q", detail)
	}
}

func TestManagedImageStartLocalAssetPreloadReusesCanonicalAliasForGenerate(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-start-preload-reuse")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: asset.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("StartLocalAsset: %v", err)
	}
	if started.GetAsset() == nil || started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected active asset after StartLocalAsset, got %#v", started.GetAsset())
	}
	if loadCalls != 1 {
		t.Fatalf("expected one preload load during StartLocalAsset, got %d", loadCalls)
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded(generate_request): %v", err)
	}
	if loadCalls != 1 {
		t.Fatalf("expected generate_request to reuse preloaded resident load, got %d loads", loadCalls)
	}
}

func TestEnsureManagedMediaImageLoadedClassifiesBackendShapeValidationAsComponentIncompatible(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		return nil, errors.New(`VAE tensor "first_stage_model.decoder.conv_in.weight" has wrong shape in model metadata: got [3,3,32,512], expected [3,3,16,512]; model metadata validation failed`)
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-load-incompatible-vae")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	_, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request")
	if err == nil {
		t.Fatal("expected managed image load validation failure")
	}
	assertGRPCReasonCode(t, err, "EnsureManagedMediaImageLoaded(incompatible backend validation)", runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE)
}

func TestStartLocalAssetProjectsBackendShapeValidationAsComponentIncompatible(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		return nil, errors.New(`VAE tensor "first_stage_model.encoder.conv_out.weight" has wrong shape in model metadata: got [3,3,512,64], expected [3,3,512,32]; model metadata validation failed`)
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-start-incompatible-vae")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: asset.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("StartLocalAsset should return unhealthy asset state, got transport error: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("asset status = %s, want unhealthy", started.GetAsset().GetStatus())
	}
	if started.GetAsset().GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE {
		t.Fatalf("asset reason = %s, want %s", started.GetAsset().GetReasonCode(), runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE)
	}
}

func TestCheckLocalAssetHealthProjectsBackendShapeValidationAsComponentIncompatible(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		return nil, errors.New(`VAE tensor "first_stage_model.decoder.conv_in.weight" has wrong shape in model metadata; model metadata validation failed`)
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-health-incompatible-vae")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	health, err := svc.CheckLocalAssetHealth(context.Background(), &runtimev1.CheckLocalAssetHealthRequest{
		LocalAssetId: asset.GetLocalAssetId(),
	})
	if err != nil {
		t.Fatalf("CheckLocalAssetHealth should return unhealthy asset state, got transport error: %v", err)
	}
	if len(health.GetAssets()) != 1 {
		t.Fatalf("health assets = %d, want 1", len(health.GetAssets()))
	}
	if health.GetAssets()[0].GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE {
		t.Fatalf("health reason = %s, want %s", health.GetAssets()[0].GetReasonCode(), runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE)
	}
}

func TestAcquireLocalAssetLeaseRejectsBackendShapeValidationAsComponentIncompatible(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		return nil, errors.New(`VAE tensor "first_stage_model.encoder.conv_out.weight" has wrong shape in model metadata; model metadata validation failed`)
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-lease-incompatible-vae")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	err := svc.AcquireLocalAssetLease(context.Background(), asset.GetLocalAssetId(), "scenario_media_request")
	if err == nil {
		t.Fatal("expected AcquireLocalAssetLease to reject incompatible managed image component")
	}
	assertGRPCReasonCode(t, err, "AcquireLocalAssetLease(incompatible backend validation)", runtimev1.ReasonCode_AI_LOCAL_COMPONENT_INCOMPATIBLE)
}

func TestEnsureManagedMediaImageLoadedUsesBoundedLoadTimeout(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-load-timeout")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	svc.managedImageLoadModel = func(ctx context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Fatal("expected managed image load context to carry a deadline")
		}
		if remaining := time.Until(deadline); remaining <= 0 || remaining > managedImageLoadTimeout {
			t.Fatalf("unexpected managed image load timeout window: %s", remaining)
		}
		return nil, nil
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded(generate_request): %v", err)
	}
}

func TestEnsureManagedMediaImageLoadedStartsColdManagedImageBackend(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	engineMgr := &mockEngineManager{}
	svc.SetEngineManager(engineMgr)

	loadCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-cold-backend")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded: %v", err)
	}
	if loadCalls != 1 {
		t.Fatalf("expected one managed image load, got %d", loadCalls)
	}
	if !containsString(engineMgr.startEngines, managedImageBackendEngineName) {
		t.Fatalf("expected cold image load to start managed image backend, got %#v", engineMgr.startEngines)
	}
	listed, err := svc.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
	if err != nil {
		t.Fatalf("ListLocalServices: %v", err)
	}
	if len(listed.GetServices()) != 1 || listed.GetServices()[0].GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
		t.Fatalf("expected active managed image backend service, got %#v", listed.GetServices())
	}
}

func TestManagedImageRecoverySweepSkipsBackgroundLoad(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-recovery-idle")
	cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	if _, err := svc.updateModelStatus(asset.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "seed unhealthy"); err != nil {
		t.Fatalf("seed unhealthy image status: %v", err)
	}

	svc.runRecoverySweep(context.Background())
	if loadCalls != 0 {
		t.Fatalf("expected recovery sweep to skip managed image load, got %d calls", loadCalls)
	}
}

func TestManagedImageLoadCacheReusesExplicitLoadUntilBackendEpochChanges(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	freeCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-cache-reuse")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("first EnsureManagedMediaImageLoaded: %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("second EnsureManagedMediaImageLoaded: %v", err)
	}
	if loadCalls != 1 {
		t.Fatalf("expected cache hit on second explicit load, got %d calls", loadCalls)
	}

	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("first ReleaseManagedMediaImage: %v", err)
	}
	if freeCalls != 0 {
		t.Fatalf("expected held model to stay resident after first release, got free_calls=%d", freeCalls)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("second ReleaseManagedMediaImage: %v", err)
	}
	if freeCalls != 0 {
		t.Fatalf("expected keep_alive release to keep managed image resident, got %d", freeCalls)
	}

	svc.SetManagedImageBackendHealth(false, "backend restarting")
	svc.SetManagedImageBackendHealth(true, "backend restarted")
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("third EnsureManagedMediaImageLoaded after backend epoch bump: %v", err)
	}
	if loadCalls != 2 {
		t.Fatalf("expected backend epoch change to invalidate cache, got %d calls", loadCalls)
	}
}

func TestManagedImageLoadCacheReloadsWhenRequestOverridesChange(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	var loadRequests []managedimagebackend.LoadModelRequest
	svc.managedImageLoadModel = func(_ context.Context, req managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadRequests = append(loadRequests, cloneManagedImageLoadRequest(req))
		return nil, nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-cache-overrides")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())
	profile["options"] = []any{
		"diffusion_model",
		"sampler:heun",
		"llm_path:/tmp/qwen.gguf",
	}

	overrideA := map[string]any{
		"cfg_scale": "7.5",
		"mode":      "euler",
	}
	overrideB := map[string]any{
		"cfg_scale": float64(9),
		"method":    "dpm++2m",
		"scheduler": "karras",
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideA, "generate_request"); err != nil {
		t.Fatalf("first EnsureManagedMediaImageLoaded: %v", err)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideA, "generate_request_cleanup"); err != nil {
		t.Fatalf("first ReleaseManagedMediaImage: %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideA, "generate_request"); err != nil {
		t.Fatalf("second EnsureManagedMediaImageLoaded with same override: %v", err)
	}
	if len(loadRequests) != 1 {
		t.Fatalf("expected identical override to hit cache, got %d loads", len(loadRequests))
	}
	if !strings.Contains(strings.Join(loadRequests[0].Options, ","), "sampler:euler") {
		t.Fatalf("first load options = %v, want sampler:euler", loadRequests[0].Options)
	}
	if !containsString(loadRequests[0].Options, "scheduler:discrete") {
		t.Fatalf("first load options = %v, want scheduler:discrete", loadRequests[0].Options)
	}
	if !containsString(loadRequests[0].Options, "diffusion_model") {
		t.Fatalf("first load options = %v, want diffusion_model retained", loadRequests[0].Options)
	}
	if !almostEqualFloat32(loadRequests[0].CFGScale, 7.5) {
		t.Fatalf("first load CFGScale = %f, want 7.5", loadRequests[0].CFGScale)
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideB, "generate_request"); err != nil {
		t.Fatalf("third EnsureManagedMediaImageLoaded with different override: %v", err)
	}
	if len(loadRequests) != 2 {
		t.Fatalf("expected different override to trigger reload, got %d loads", len(loadRequests))
	}
	if !containsString(loadRequests[1].Options, "sampler:dpmpp2m") {
		t.Fatalf("second load options = %v, want sampler:dpmpp2m", loadRequests[1].Options)
	}
	if !containsString(loadRequests[1].Options, "scheduler:karras") {
		t.Fatalf("second load options = %v, want scheduler:karras", loadRequests[1].Options)
	}
	for _, option := range loadRequests[1].Options {
		if option == "sampler:heun" || option == "scheduler:discrete" {
			t.Fatalf("second load options = %v, stale sampler/scheduler must be replaced", loadRequests[1].Options)
		}
	}
	if !almostEqualFloat32(loadRequests[1].CFGScale, 9) {
		t.Fatalf("second load CFGScale = %f, want 9", loadRequests[1].CFGScale)
	}

	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, overrideB, "generate_request"); err != nil {
		t.Fatalf("fourth EnsureManagedMediaImageLoaded with same override: %v", err)
	}
	if len(loadRequests) != 2 {
		t.Fatalf("expected second identical override to hit cache, got %d loads", len(loadRequests))
	}
}

func TestManagedImageIdleSweepFreesBackendAndStopsIdleEngines(t *testing.T) {
	svc := newTestService(t)
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.localModelKeepAlive = 0
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	loadCalls := 0
	freeCalls := 0
	engineMgr := &mockEngineManager{}
	svc.SetEngineManager(engineMgr)
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		loadCalls++
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}

	asset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-idle-sweep")
	profile := cacheManagedImageProfileForTest(t, svc, asset.GetLocalAssetId())

	if err := svc.AcquireLocalAssetLease(context.Background(), asset.GetLocalAssetId(), "generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded: %v", err)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+asset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("ReleaseManagedMediaImage: %v", err)
	}
	if err := svc.ReleaseLocalAssetLease(context.Background(), asset.GetLocalAssetId(), "generate_request_cleanup"); err != nil {
		t.Fatalf("ReleaseLocalAssetLease: %v", err)
	}

	if loadCalls != 1 {
		t.Fatalf("expected one managed image load, got %d", loadCalls)
	}
	if freeCalls != 1 {
		t.Fatalf("expected idle sweep to free managed image once, got %d", freeCalls)
	}
	if !containsString(engineMgr.stopEngines, "media") {
		t.Fatalf("expected media engine idle-stop, got %#v", engineMgr.stopEngines)
	}
	if !containsString(engineMgr.stopEngines, managedImageBackendEngineName) {
		t.Fatalf("expected managed image backend idle-stop, got %#v", engineMgr.stopEngines)
	}
	updated := svc.modelByID(asset.GetLocalAssetId())
	if updated == nil || updated.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("expected managed image to return to installed after idle sweep, got %#v", updated)
	}
}

func TestAcquireLocalAssetLeaseKeepsIdleManagedImageResidentWhenCurrentTextWorkerIsHealthy(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"beta-model"},
		}
	})
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	freeCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}
	svc.SetEngineManager(&mockEngineManager{
		status: &EngineInfo{
			Engine:   "llama",
			Version:  engine.DefaultLlamaConfig().Version,
			Status:   "healthy",
			Port:     1234,
			Endpoint: defaultLocalEndpoint,
		},
	})
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, true)

	imageAsset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-before-text")
	profile := cacheManagedImageProfileForTest(t, svc, imageAsset.GetLocalAssetId())
	if err := svc.AcquireLocalAssetLease(context.Background(), imageAsset.GetLocalAssetId(), "scenario_media_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease(image): %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+imageAsset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded: %v", err)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+imageAsset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("ReleaseManagedMediaImage: %v", err)
	}
	if err := svc.ReleaseLocalAssetLease(context.Background(), imageAsset.GetLocalAssetId(), "scenario_media_request_cleanup"); err != nil {
		t.Fatalf("ReleaseLocalAssetLease(image): %v", err)
	}
	if err := svc.UpdateManagedMediaImageExecutionStatus(context.Background(), "media/"+imageAsset.GetAssetId(), true, ""); err != nil {
		t.Fatalf("UpdateManagedMediaImageExecutionStatus: %v", err)
	}

	beta := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_beta",
		"local/beta-model",
		"nimi/beta-model",
		"beta.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
	)
	svc.setCurrentManagedLlamaLoadedLocalAssetID(beta.GetLocalAssetId())
	recordManagedLlamaWarmKeyForTest(t, svc, beta, defaultLocalEndpoint)

	if err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "stream_text_generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if freeCalls != 0 {
		t.Fatalf("expected healthy text lease to keep idle managed image resident, got %d", freeCalls)
	}
	engineMgr := svc.engineManagerOrNil()
	if engineMgr == nil {
		t.Fatal("expected engine manager")
	}
	mockMgr, ok := engineMgr.(*mockEngineManager)
	if !ok {
		t.Fatalf("expected mock engine manager, got %T", engineMgr)
	}
	if containsString(mockMgr.stopEngines, "media") {
		t.Fatalf("expected healthy text lease to avoid stopping media engine, got %#v", mockMgr.stopEngines)
	}
	if containsString(mockMgr.stopEngines, managedImageBackendEngineName) {
		t.Fatalf("managed image backend should remain running while current text worker stays healthy, got %#v", mockMgr.stopEngines)
	}
	updatedImage := svc.modelByID(imageAsset.GetLocalAssetId())
	if updatedImage == nil {
		t.Fatal("expected managed image asset")
	}
	if got := updatedImage.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("managed image status = %v, want ACTIVE", got)
	}
	if got := updatedImage.GetHealthDetail(); strings.Contains(got, "resident released for text generation") {
		t.Fatalf("managed image health detail = %q, did not expect text generation reclaim detail", got)
	}
}

func TestAcquireLocalAssetLeaseReclaimsIdleManagedImageResidentBeforeTextWorkerSwitch(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"alpha-model", "beta-model"},
		}
	})
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
	svc.SetManagedImageBackendHealth(true, "image backend active")

	freeCalls := 0
	svc.managedImageLoadModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) (*managedimagebackend.LoadModelDiagnostics, error) {
		return nil, nil
	}
	svc.managedImageFreeModel = func(_ context.Context, _ managedimagebackend.LoadModelRequest) error {
		freeCalls++
		return nil
	}
	svc.SetEngineManager(&mockEngineManager{
		status: &EngineInfo{
			Engine:   "llama",
			Version:  engine.DefaultLlamaConfig().Version,
			Status:   "healthy",
			Port:     1234,
			Endpoint: defaultLocalEndpoint,
		},
	})
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, true)

	imageAsset := mustImportManagedImageAssetForTest(t, svc, "nimi/image-before-switch")
	profile := cacheManagedImageProfileForTest(t, svc, imageAsset.GetLocalAssetId())
	if err := svc.AcquireLocalAssetLease(context.Background(), imageAsset.GetLocalAssetId(), "scenario_media_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease(image): %v", err)
	}
	if _, err := svc.EnsureManagedMediaImageLoaded(context.Background(), "media/"+imageAsset.GetAssetId(), "", profile, nil, "generate_request"); err != nil {
		t.Fatalf("EnsureManagedMediaImageLoaded: %v", err)
	}
	if err := svc.ReleaseManagedMediaImage(context.Background(), "media/"+imageAsset.GetAssetId(), "", profile, nil, "generate_request_cleanup"); err != nil {
		t.Fatalf("ReleaseManagedMediaImage: %v", err)
	}
	if err := svc.ReleaseLocalAssetLease(context.Background(), imageAsset.GetLocalAssetId(), "scenario_media_request_cleanup"); err != nil {
		t.Fatalf("ReleaseLocalAssetLease(image): %v", err)
	}
	if err := svc.UpdateManagedMediaImageExecutionStatus(context.Background(), "media/"+imageAsset.GetAssetId(), true, ""); err != nil {
		t.Fatalf("UpdateManagedMediaImageExecutionStatus: %v", err)
	}

	alpha := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
	)
	beta := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_beta",
		"local/beta-model",
		"nimi/beta-model",
		"beta.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD,
	)
	svc.setCurrentManagedLlamaLoadedLocalAssetID(alpha.GetLocalAssetId())
	recordManagedLlamaWarmKeyForTest(t, svc, beta, defaultLocalEndpoint)

	if err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "stream_text_generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if freeCalls != 1 {
		t.Fatalf("expected text worker switch to reclaim idle managed image resident once, got %d", freeCalls)
	}
	engineMgr := svc.engineManagerOrNil()
	if engineMgr == nil {
		t.Fatal("expected engine manager")
	}
	mockMgr, ok := engineMgr.(*mockEngineManager)
	if !ok {
		t.Fatalf("expected mock engine manager, got %T", engineMgr)
	}
	if !containsString(mockMgr.stopEngines, "media") {
		t.Fatalf("expected text worker switch to stop media engine, got %#v", mockMgr.stopEngines)
	}
	if !containsString(mockMgr.stopEngines, managedImageBackendEngineName) {
		t.Fatalf("expected text worker switch to stop managed image backend, got %#v", mockMgr.stopEngines)
	}
	updatedImage := svc.modelByID(imageAsset.GetLocalAssetId())
	if updatedImage == nil {
		t.Fatal("expected managed image asset")
	}
	if got := updatedImage.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("managed image status = %v, want INSTALLED", got)
	}
	if got := updatedImage.GetHealthDetail(); !strings.Contains(got, "resident released for text generation") {
		t.Fatalf("managed image health detail = %q, want text generation reclaim detail", got)
	}
}
