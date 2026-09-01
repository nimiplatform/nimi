package localservice

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	setLocalRuntimePlatformForTest(t, "darwin", "arm64")
	setManagedImageHostForTest(t, "Apple M4 Max")
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	testRuntimeRoot := t.TempDir()
	svc, err := NewWithProductControlDataRoot(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		statePath,
		0,
		filepath.Join(testRuntimeRoot, "models"),
		testRuntimeRoot,
	)
	if err != nil {
		t.Fatalf("create local service: %v", err)
	}
	if err := svc.SetProductControlRoot(filepath.Join(t.TempDir(), ".nimi")); err != nil {
		t.Fatalf("set test Product Control root: %v", err)
	}
	if err := svc.SetProductVersion("test"); err != nil {
		t.Fatalf("set test product version: %v", err)
	}
	svc.verified = append(svc.verified,
		&runtimev1.LocalVerifiedAssetDescriptor{
			TemplateId: "test.chat.qwen2", AssetId: "test.chat.qwen2",
			Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama",
			Capabilities: []string{"text.generate"}, Entry: "model.gguf", Files: []string{"model.gguf"},
			Repo: "test/qwen2", Revision: "test", License: "test",
			Hashes: map[string]string{"model.gguf": "sha256:" + validTestGGUFHash()},
		},
		&runtimev1.LocalVerifiedAssetDescriptor{
			TemplateId: "test.embedding.qwen2", AssetId: "test.embedding.qwen2",
			Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING, Engine: "llama",
			Capabilities: []string{"text.embed"}, Entry: "model.gguf", Files: []string{"model.gguf"},
			Repo: "test/qwen2-embedding", Revision: "test", License: "test",
			Hashes: map[string]string{"model.gguf": "sha256:" + validTestGGUFHash()},
		},
		&runtimev1.LocalVerifiedAssetDescriptor{
			TemplateId: "test.chat.gemma4", AssetId: "test.chat.gemma4",
			Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT, Engine: "llama",
			Capabilities: []string{"text.generate"}, Entry: "model.gguf", Files: []string{"model.gguf"},
			Repo: "test/gemma4", Revision: "test", License: "test",
			Hashes: map[string]string{"model.gguf": "sha256:" + validGemma4TestGGUFHash()},
		},
	)
	svc.SetProductControlDataRootConfigWriter(func(string) (bool, error) { return false, nil })
	svc.managedPortAvailable = func(int) bool {
		return true
	}
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{}, nil
	}
	t.Cleanup(func() {
		svc.Close()
	})
	return svc
}

func setLocalModelsPathForTest(t *testing.T, svc *Service, modelsPath string) {
	t.Helper()
	if svc == nil {
		t.Fatal("local service is nil")
	}
	svc.mu.Lock()
	svc.localModelsPath = resolveLocalModelsPath(modelsPath)
	svc.mu.Unlock()
}

type m1LocalTransferTestStream struct {
	ctx  context.Context
	sent chan *runtimev1.LocalTransferProgressEvent
}

func (stream *m1LocalTransferTestStream) Send(event *runtimev1.LocalTransferProgressEvent) error {
	select {
	case <-stream.ctx.Done():
		return stream.ctx.Err()
	case stream.sent <- event:
		return nil
	}
}

func (*m1LocalTransferTestStream) SetHeader(metadata.MD) error  { return nil }
func (*m1LocalTransferTestStream) SendHeader(metadata.MD) error { return nil }
func (*m1LocalTransferTestStream) SetTrailer(metadata.MD)       {}
func (stream *m1LocalTransferTestStream) Context() context.Context {
	return stream.ctx
}
func (*m1LocalTransferTestStream) SendMsg(any) error { return nil }
func (*m1LocalTransferTestStream) RecvMsg(any) error { return io.EOF }

func TestM1LocalProductPostconditionMatrix(t *testing.T) {
	svc := newTestService(t)

	t.Run("ListVerifiedAssets", func(t *testing.T) {
		response, err := svc.ListVerifiedAssets(context.Background(), &runtimev1.ListVerifiedAssetsRequest{PageSize: 200})
		if err != nil {
			t.Fatalf("ListVerifiedAssets: %v", err)
		}
		if len(response.GetAssets()) == 0 {
			t.Fatal("verified catalog unexpectedly empty")
		}
		for _, asset := range response.GetAssets() {
			if strings.TrimSpace(asset.GetTemplateId()) == "" || strings.TrimSpace(asset.GetAssetId()) == "" ||
				strings.TrimSpace(asset.GetRepo()) == "" || strings.TrimSpace(asset.GetRevision()) == "" || len(asset.GetHashes()) == 0 {
				t.Fatalf("incomplete verified catalog row escaped initialization: %+v", asset)
			}
		}
	})

	newTransfer := func(state string) *runtimev1.LocalTransferSessionSummary {
		return svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
			ModelID: "model-m1", Phase: "download", State: state, BytesTotal: 1024,
		})
	}

	t.Run("PauseLocalTransfer", func(t *testing.T) {
		transfer := newTransfer(localTransferStateRunning)
		response, err := svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()})
		if err != nil || response.GetTransfer().GetState() != localTransferStatePaused {
			t.Fatalf("pause response=%+v err=%v", response, err)
		}
		terminal := newTransfer(localTransferStateCompleted)
		response, err = svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{InstallSessionId: terminal.GetInstallSessionId()})
		if err != nil || response.GetTransfer().GetState() != localTransferStateCompleted {
			t.Fatalf("terminal pause response=%+v err=%v", response, err)
		}
	})

	t.Run("ResumeLocalTransfer", func(t *testing.T) {
		transfer := newTransfer(localTransferStateRunning)
		paused, err := svc.PauseLocalTransfer(context.Background(), &runtimev1.PauseLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()})
		if err != nil || paused.GetTransfer().GetState() != localTransferStatePaused {
			t.Fatalf("prepare paused transfer=%+v err=%v", paused, err)
		}
		response, err := svc.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()})
		if err != nil || response.GetTransfer().GetState() != localTransferStateRunning {
			t.Fatalf("resume response=%+v err=%v", response, err)
		}
	})

	t.Run("CancelLocalTransfer", func(t *testing.T) {
		transfer := newTransfer(localTransferStateRunning)
		response, err := svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()})
		if err != nil || response.GetTransfer().GetState() != localTransferStateCancelled || response.GetTransfer().GetReasonCode() != "LOCAL_TRANSFER_CANCELLED" {
			t.Fatalf("cancel response=%+v err=%v", response, err)
		}
		repeated, err := svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()})
		if err != nil || repeated.GetTransfer().GetState() != localTransferStateCancelled || repeated.GetTransfer().GetReasonCode() != "LOCAL_TRANSFER_CANCELLED" {
			t.Fatalf("idempotent cancel response=%+v err=%v", repeated, err)
		}
		failed := newTransfer(localTransferStateFailed)
		response, err = svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: failed.GetInstallSessionId()})
		if err != nil || response.GetTransfer().GetState() != localTransferStateCancelled || response.GetTransfer().GetReasonCode() != "LOCAL_TRANSFER_CANCELLED" {
			t.Fatalf("failed transfer cancel response=%+v err=%v", response, err)
		}
	})

	t.Run("WatchLocalTransfers", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		stream := &m1LocalTransferTestStream{ctx: ctx, sent: make(chan *runtimev1.LocalTransferProgressEvent, 64)}
		done := make(chan error, 1)
		go func() { done <- svc.WatchLocalTransfers(&runtimev1.WatchLocalTransfersRequest{}, stream) }()
		deadline := time.Now().Add(2 * time.Second)
		for {
			svc.mu.RLock()
			subscribers := len(svc.transferSubscribers)
			svc.mu.RUnlock()
			if subscribers > 0 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("WatchLocalTransfers did not register subscriber")
			}
			time.Sleep(time.Millisecond)
		}
		transfer := newTransfer(localTransferStateRunning)
		for {
			select {
			case event := <-stream.sent:
				if event.GetInstallSessionId() == transfer.GetInstallSessionId() && event.GetState() == localTransferStateRunning {
					cancel()
					goto cancelled
				}
			case <-time.After(2 * time.Second):
				t.Fatal("WatchLocalTransfers did not deliver committed event")
			}
		}
	cancelled:
		select {
		case err := <-done:
			if err != nil && status.Code(err) != codes.Canceled {
				t.Fatalf("watch cancellation error=%v", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("WatchLocalTransfers did not stop after cancellation")
		}
		newTransfer(localTransferStateRunning)
		select {
		case event := <-stream.sent:
			t.Fatalf("post-cancel event delivered: %+v", event)
		case <-time.After(25 * time.Millisecond):
		}
	})
}

func TestWatchLocalTransfersBoundsInitialReplay(t *testing.T) {
	svc := newTestService(t)
	for index := 0; index < localTransferStreamBudget+8; index++ {
		svc.newLocalTransfer(localTransferKindDownload, localTransferMutation{
			ModelID:    "model-replay",
			Phase:      "download",
			State:      localTransferStateCompleted,
			BytesTotal: int64(index + 1),
		})
	}

	ctx, cancel := context.WithCancel(context.Background())
	stream := &m1LocalTransferTestStream{
		ctx:  ctx,
		sent: make(chan *runtimev1.LocalTransferProgressEvent, localTransferStreamBudget+1),
	}
	done := make(chan error, 1)
	go func() {
		done <- svc.WatchLocalTransfers(&runtimev1.WatchLocalTransfersRequest{}, stream)
	}()

	for index := 0; index < localTransferStreamBudget; index++ {
		select {
		case <-stream.sent:
		case err := <-done:
			t.Fatalf("watch stopped during bounded replay: %v", err)
		case <-time.After(2 * time.Second):
			t.Fatalf("bounded replay stopped after %d events", index)
		}
	}
	select {
	case event := <-stream.sent:
		t.Fatalf("replay exceeded stream budget: %+v", event)
	case err := <-done:
		t.Fatalf("watch stopped after bounded replay: %v", err)
	case <-time.After(25 * time.Millisecond):
	}

	cancel()
	select {
	case err := <-done:
		if err != nil && status.Code(err) != codes.Canceled {
			t.Fatalf("watch cancellation error=%v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("watch did not stop after cancellation")
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

func TestResolveModelInstallPlanRejectsCallerReconstructedTopology(t *testing.T) {
	svc := newTestService(t)
	before := len(svc.heldModelInstallPlans)
	_, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ModelId:  "local/npu-model",
		Engine:   "npu-accelerated-engine",
		Endpoint: "http://127.0.0.1:1234/v1",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("caller-reconstructed install plan error = %v", err)
	}
	if len(svc.heldModelInstallPlans) != before {
		t.Fatal("rejected caller topology created a server-held plan")
	}
}

func TestResolveModelInstallPlanHFCatalogSourceIsEngineNeutral(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(context.Context, hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{{
			ItemId: "hf_example_model", Source: "huggingface", ModelId: "example/model", Repo: "example/model",
			Revision: "commit-1", Capabilities: []string{"text.generate"}, Engine: "llama",
		}}, nil
	}
	svc.hfCatalogVariants = func(context.Context, string) ([]*runtimev1.LocalCatalogVariantDescriptor, error) {
		return []*runtimev1.LocalCatalogVariantDescriptor{{Filename: "model.gguf", Entry: "model.gguf", Files: []string{"model.gguf"}, Sha256: strings.Repeat("a", 64)}}, nil
	}
	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		Source: "huggingface", Repo: "example/model", Revision: "main", ModelId: "caller-value",
		Capabilities: []string{"text.generate"}, Engine: "caller-engine", Endpoint: "http://127.0.0.1:9999",
		Entry: "model.gguf", Files: []string{"model.gguf"}, Hashes: map[string]string{"model.gguf": strings.Repeat("a", 64)},
	})
	if err != nil {
		t.Fatalf("resolve HF catalog plan: %v", err)
	}
	plan := resp.GetPlan()
	if !plan.GetInstallAvailable() {
		t.Fatalf("catalog-backed source plan unavailable: %+v", plan)
	}
	if plan.GetEngine() != "" || plan.GetEndpoint() != "" || plan.GetEngineRuntimeMode() != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED {
		t.Fatalf("ModelAsset acquisition retained caller topology: %+v", plan)
	}
	if plan.GetModelId() != "example/model" || plan.GetHashes()["model.gguf"] != strings.Repeat("a", 64) {
		t.Fatalf("plan did not use catalog identity: %+v", plan)
	}
}

func TestInstallModelFromPlanRejectsPlanWithoutModelAssetPayload(t *testing.T) {
	svc := newTestService(t)
	modelAssetsBefore := len(svc.modelAssets)
	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId: "catalog.payload-free", Source: "verified", ModelId: "local/test-attached", Repo: "test/repo",
		Revision: "main", Capabilities: []string{"text.generate"},
	})
	svc.mu.Unlock()
	resolved, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.payload-free",
	})
	if err != nil {
		t.Fatalf("resolve model install plan: %v", err)
	}
	_, err = svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{PlanId: resolved.GetPlan().GetPlanId()})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("install model without payload error = %v", err)
	}
	if len(svc.modelAssets) != modelAssetsBefore {
		t.Fatal("payload-free install mutated inventory")
	}
}

func TestInstallModelFromPlanRejectsUnavailablePlan(t *testing.T) {
	svc := newTestService(t)
	svc.mu.Lock()
	svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
		ItemId: "catalog.unavailable", Source: "verified", ModelId: "local/unavailable", Repo: "test/repo",
		Revision: "main", Capabilities: []string{"text.generate"}, Files: []string{"model.gguf"},
	})
	svc.mu.Unlock()
	resolved, resolveErr := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.unavailable",
	})
	if resolveErr != nil {
		t.Fatalf("resolve unavailable plan: %v", resolveErr)
	}
	_, err := svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{PlanId: resolved.GetPlan().GetPlanId()})
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected reason code %s, got=%v ok=%v err=%v", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, reason, ok, err)
	}
}

func TestResolveModelInstallPlanCatalogSupervisedDoesNotRequireMaterializedEngine(t *testing.T) {
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
		Capabilities:      []string{"text.generate"},
		Repo:              "example/supervised",
		Entry:             "model.gguf",
		Files:             []string{"model.gguf"},
		Hashes:            map[string]string{"model.gguf": strings.Repeat("a", 64)},
	})
	svc.mu.Unlock()

	resp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.supervised.model",
	})
	if err != nil {
		t.Fatalf("resolve supervised plan: %v", err)
	}
	plan := resp.GetPlan()
	if !plan.GetInstallAvailable() {
		t.Fatalf("ModelAsset acquisition must not require a materialized engine: %+v", plan)
	}
	if plan.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if plan.GetEngine() != "" || plan.GetEngineRuntimeMode() != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED {
		t.Fatalf("ModelAsset plan retained execution topology: %+v", plan)
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
		Capabilities:      []string{"text.generate"},
		Repo:              "example/supervised-available",
		Entry:             "model.gguf",
		Files:             []string{"model.gguf"},
		Hashes:            map[string]string{"model.gguf": strings.Repeat("b", 64)},
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
