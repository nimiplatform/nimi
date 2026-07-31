package localservice

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/grpc/codes"
)

func TestCheckManagedSupervisedLlamaHealthProjectsUnloadedModelCold(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"beta-model"},
		}
	})
	alpha := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
	)
	_ = addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_beta",
		"local/beta-model",
		"nimi/beta-model",
		"beta.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
	)
	svc.setCurrentManagedLlamaLoadedLocalAssetID("asset_beta")

	health, err := svc.checkManagedSupervisedLlamaHealth(context.Background(), alpha)
	if err != nil {
		t.Fatalf("checkManagedSupervisedLlamaHealth: %v", err)
	}
	if got := health.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("health status = %v, want ACTIVE", got)
	}
	stored := svc.modelByID(alpha.GetLocalAssetId())
	if stored == nil {
		t.Fatal("expected stored asset")
	}
	if got := stored.GetWarmState(); got != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("warm_state = %v, want COLD", got)
	}
	if got := stored.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("stored status = %v, want ACTIVE", got)
	}
}

func TestCheckManagedSupervisedLlamaHealthProjectsStoppedWorkerCold(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    "probe request failed: connection refused",
			probeURL:  endpoint,
		}
	})
	svc.SetEngineManager(&mockEngineManager{statusErr: fmt.Errorf("engine llama not started")})
	model := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
	)

	health, err := svc.checkManagedSupervisedLlamaHealth(context.Background(), model)
	if err != nil {
		t.Fatalf("checkManagedSupervisedLlamaHealth: %v", err)
	}
	if probeCalls != 0 {
		t.Fatalf("stopped worker health should project cold without probing, got %d probe calls", probeCalls)
	}
	if got := health.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("health status = %v, want ACTIVE", got)
	}
	stored := svc.modelByID(model.GetLocalAssetId())
	if stored == nil {
		t.Fatal("expected stored asset")
	}
	if got := stored.GetWarmState(); got != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("warm_state = %v, want COLD", got)
	}
	if got := stored.GetHealthDetail(); got != managedLocalModelColdDetail() {
		t.Fatalf("health detail = %q, want cold detail", got)
	}
}

func TestCheckManagedSupervisedLlamaHealthFailClosesWhenEndpointDoesNotRespond(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    "probe request failed: context deadline exceeded",
			probeURL:  endpoint,
		}
	})
	svc.SetEngineManager(&mockEngineManager{})
	model := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
	)
	svc.setCurrentManagedLlamaLoadedLocalAssetID(model.GetLocalAssetId())

	health, err := svc.checkManagedSupervisedLlamaHealth(context.Background(), model)
	if err != nil {
		t.Fatalf("checkManagedSupervisedLlamaHealth: %v", err)
	}
	if got := health.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("health status = %v, want UNHEALTHY", got)
	}
	stored := svc.modelByID(model.GetLocalAssetId())
	if stored == nil {
		t.Fatal("expected stored asset")
	}
	if got := stored.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("stored status = %v, want UNHEALTHY", got)
	}
	if got := stored.GetWarmState(); got != runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED {
		t.Fatalf("stored warm_state = %v, want FAILED", got)
	}
	if !strings.Contains(stored.GetHealthDetail(), "consecutive_failures=1") {
		t.Fatalf("stored detail = %q, want recovery failure count", stored.GetHealthDetail())
	}
	if got := svc.currentManagedLlamaLoadedLocalAssetID(); got != "" {
		t.Fatalf("current loaded llama id = %q, want cleared", got)
	}
}

func TestRecoverySweepSkipsFailedManagedLlamaBeforeProbeInterval(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{
			healthy:   false,
			responded: false,
			detail:    "probe request failed: context deadline exceeded",
			probeURL:  endpoint,
		}
	})
	model := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
	)
	svc.setCurrentManagedLlamaLoadedLocalAssetID(model.GetLocalAssetId())

	svc.runRecoverySweep(context.Background())
	if probeCalls != 1 {
		t.Fatalf("first recovery sweep probe calls = %d, want 1", probeCalls)
	}
	current := svc.modelByID(model.GetLocalAssetId())
	if current == nil {
		t.Fatal("expected stored asset")
	}
	if current.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("status after failed sweep = %s, want UNHEALTHY", current.GetStatus())
	}

	svc.runRecoverySweep(context.Background())
	if probeCalls != 1 {
		t.Fatalf("second recovery sweep before interval should not reprobe, got %d calls", probeCalls)
	}
}

func TestRecoverySweepDoesNotHashColdManagedLlama(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			probeURL:  endpoint,
		}
	})
	model := addManagedLlamaAssetForTest(
		t,
		svc,
		"asset_alpha",
		"local/alpha-model",
		"nimi/alpha-model",
		"alpha.gguf",
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
	)

	svc.mu.Lock()
	svc.assets[model.GetLocalAssetId()].Hashes = map[string]string{
		model.GetEntry(): "sha256:" + strings.Repeat("0", 64),
	}
	svc.entryHashCache = make(map[string]entryHashCacheState)
	svc.mu.Unlock()

	svc.runRecoverySweep(context.Background())

	current := svc.modelByID(model.GetLocalAssetId())
	if current == nil {
		t.Fatal("expected stored asset")
	}
	if current.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("status after cold recovery sweep = %s, want ACTIVE", current.GetStatus())
	}
	if current.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("warm state after cold recovery sweep = %s, want COLD", current.GetWarmState())
	}
	if probeCalls != 0 {
		t.Fatalf("cold managed llama recovery must not probe, got %d calls", probeCalls)
	}
	svc.mu.RLock()
	hashCacheEntries := len(svc.entryHashCache)
	auditEntries := len(svc.audits)
	updatedAt := svc.assets[model.GetLocalAssetId()].GetUpdatedAt()
	svc.mu.RUnlock()
	if hashCacheEntries != 0 {
		t.Fatalf("cold managed llama recovery must not hash model entries, got %d cache entries", hashCacheEntries)
	}
	recoveryTargets, _ := svc.collectUnhealthyRecoveryTargets()
	if len(recoveryTargets) != 0 {
		t.Fatalf("settled cold managed llama must not remain in recurring recovery targets, got %d", len(recoveryTargets))
	}

	svc.runRecoverySweep(context.Background())

	current = svc.modelByID(model.GetLocalAssetId())
	if current.GetUpdatedAt() != updatedAt {
		t.Fatalf("unchanged cold recovery updated timestamp: first=%q second=%q", updatedAt, current.GetUpdatedAt())
	}
	svc.mu.RLock()
	secondAuditEntries := len(svc.audits)
	svc.mu.RUnlock()
	if secondAuditEntries != auditEntries {
		t.Fatalf("unchanged cold recovery appended audit entries: first=%d second=%d", auditEntries, secondAuditEntries)
	}
}

func TestAcquireLocalAssetLeaseStartsExplicitManagedLlamaTarget(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"beta-model"},
		}
	})
	mgr := &mockEngineManager{
		statusErr: fmt.Errorf("engine llama not started"),
	}
	svc.SetEngineManager(mgr)
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, true)
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
	recordManagedLlamaWarmKeyForTest(t, svc, beta, defaultLocalEndpoint)
	if err := os.Remove(svc.managedLlamaModelsConfigPath); err != nil && !os.IsNotExist(err) {
		t.Fatalf("remove generated llama models config: %v", err)
	}

	if err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "text_generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if _, err := os.Stat(svc.managedLlamaModelsConfigPath); err != nil {
		t.Fatalf("expected lease to regenerate llama models config: %v", err)
	}
	if mgr.startConfigCalls != 1 {
		t.Fatalf("startConfigCalls = %d, want 1", mgr.startConfigCalls)
	}
	if mgr.lastStartConfig.ManagedLlamaTarget == nil {
		t.Fatal("expected explicit managed llama target")
	}
	if got := mgr.lastStartConfig.ManagedLlamaTarget.ModelAlias; got != "beta-model" {
		t.Fatalf("model alias = %q, want beta-model", got)
	}
	if !strings.HasSuffix(mgr.lastStartConfig.ManagedLlamaTarget.ModelPath, "beta.gguf") {
		t.Fatalf("model path = %q, want suffix beta.gguf", mgr.lastStartConfig.ManagedLlamaTarget.ModelPath)
	}
	if got := svc.currentManagedLlamaLoadedLocalAssetID(); got != beta.GetLocalAssetId() {
		t.Fatalf("loaded local asset id = %q, want %q", got, beta.GetLocalAssetId())
	}
}

func TestAcquireLocalAssetLeaseActivatesRegistrationForPostStartupManagedLlama(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe mocked healthy",
			probeURL:  endpoint,
			models:    []string{"beta-model"},
		}
	})
	mgr := &mockEngineManager{statusErr: fmt.Errorf("engine llama not started")}
	svc.SetEngineManager(mgr)
	// A fresh acceptance round starts without inherited model registry state,
	// so daemon bootstrap has no managed llama asset to enable yet.
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, false)
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
	recordManagedLlamaWarmKeyForTest(t, svc, beta, defaultLocalEndpoint)

	if err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "text_generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if !svc.managedLlamaEnabled {
		t.Fatal("post-startup supervised llama admission must enable managed registration")
	}
	if mgr.startConfigCalls != 1 || mgr.lastStartConfig.ManagedLlamaTarget == nil {
		t.Fatalf("expected one explicit managed llama start, calls=%d config=%+v", mgr.startConfigCalls, mgr.lastStartConfig)
	}
	if got := mgr.lastStartConfig.ManagedLlamaTarget.ModelPath; !strings.HasSuffix(got, "beta.gguf") {
		t.Fatalf("managed target path = %q, want beta.gguf suffix", got)
	}
}

func TestAcquireLocalAssetLeaseFailsClosedWhenLlamaPackageMissing(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe should not run before llama package readiness",
			probeURL:  endpoint,
			models:    []string{"beta-model"},
		}
	})
	roots := engine.ManagedRoots{
		Environments: t.TempDir(),
		Dependencies: t.TempDir(),
	}
	mgr, err := engine.NewManager(nil, roots, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	svc.SetEngineManager(engine.NewServiceAdapter(mgr))
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, true)
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
	recordManagedLlamaWarmKeyForTest(t, svc, beta, defaultLocalEndpoint)

	err = svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "text_generate_request")
	assertGRPCCode(t, err, "AcquireLocalAssetLease(missing_llama_package)", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "AcquireLocalAssetLease(missing_llama_package)", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	if !strings.Contains(err.Error(), "local environment dependency") {
		t.Fatalf("expected local environment dependency detail, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(roots.Environments, "llama")); !os.IsNotExist(statErr) {
		t.Fatalf("AcquireLocalAssetLease created llama package directory or unexpected stat error: %v", statErr)
	}
}

func TestAcquireLocalAssetLeaseWarmsResidentManagedLlamaBeforeTextExecution(t *testing.T) {
	chatCompletions := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"beta-model"}]}`)
		case "/v1/chat/completions":
			chatCompletions++
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"ready"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	svc := newTestServiceWithProbe(t, nil)
	svc.SetEngineManager(&mockEngineManager{
		status: &EngineInfo{
			Engine:   "llama",
			Version:  engine.DefaultLlamaConfig().Version,
			Status:   "healthy",
			Port:     1234,
			Endpoint: server.URL,
		},
	})
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, true)
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

	if err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "stream_text_generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease: %v", err)
	}
	if chatCompletions != 1 {
		t.Fatalf("expected text lease to prove execution readiness once, got %d", chatCompletions)
	}

	if err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "stream_text_generate_request"); err != nil {
		t.Fatalf("AcquireLocalAssetLease cached: %v", err)
	}
	if chatCompletions != 1 {
		t.Fatalf("expected cached text lease readiness proof, got %d calls", chatCompletions)
	}
}

func TestAcquireLocalAssetLeaseFailsCloseOnManagedLlamaSwitchConflict(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{
		status: &EngineInfo{
			Engine:   "llama",
			Version:  engine.DefaultLlamaConfig().Version,
			Status:   "healthy",
			Port:     1234,
			Endpoint: defaultLocalEndpoint,
		},
	}
	svc.SetEngineManager(mgr)
	svc.SetManagedLlamaRegistrationConfig(svc.localModelsPath, svc.managedLlamaModelsConfigPath, true)
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
	svc.mu.Lock()
	svc.assetResidency[alpha.GetLocalAssetId()] = localAssetResidencyState{HoldCount: 1}
	svc.mu.Unlock()

	err := svc.AcquireLocalAssetLease(context.Background(), beta.GetLocalAssetId(), "text_generate_request")
	if err == nil {
		t.Fatal("expected AcquireLocalAssetLease to fail")
	}
	assertGRPCCode(t, err, "AcquireLocalAssetLease", codes.FailedPrecondition)
	assertGRPCReasonCode(t, err, "AcquireLocalAssetLease", runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	if mgr.startConfigCalls != 0 {
		t.Fatalf("startConfigCalls = %d, want 0", mgr.startConfigCalls)
	}
}

func TestManagedEngineIdleSweepStopsBootstrapTouchedEngineWithoutAsset(t *testing.T) {
	svc := newTestService(t)
	svc.localModelKeepAlive = 0
	engineMgr := &mockEngineManager{}
	svc.SetEngineManager(engineMgr)

	svc.MarkManagedEngineUsed("media", "engine_bootstrap")
	svc.runResidencySweep(context.Background())

	if !containsString(engineMgr.stopEngines, "media") {
		t.Fatalf("expected bootstrap-touched media engine to idle-stop, got %#v", engineMgr.stopEngines)
	}
}

func TestManagedEngineIdleSweepTreatsMissingLlamaSupervisorAsIdle(t *testing.T) {
	var logs bytes.Buffer
	svc := newTestService(t)
	svc.logger = slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	svc.localModelKeepAlive = 0
	engineMgr := &mockEngineManager{stopErr: fmt.Errorf("engine llama not found")}
	svc.SetEngineManager(engineMgr)

	svc.MarkManagedEngineUsed("llama", "runtime_startup")
	svc.runResidencySweep(context.Background())

	if !containsString(engineMgr.stopEngines, "llama") {
		t.Fatalf("expected idle sweep to attempt llama stop, got %#v", engineMgr.stopEngines)
	}
	if output := logs.String(); strings.Contains(output, "idle engine stop failed") {
		t.Fatalf("missing llama supervisor should be treated as already idle, got logs:\n%s", output)
	}
}
