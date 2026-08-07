package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	liveLlamaJourneyGate       = "NIMI_LIVE_LLAMA_JOURNEY"
	liveLlamaJourneyModelEnv   = "NIMI_LIVE_LLAMA_MODEL_PATH"
	liveLlamaJourneyBinaryEnv  = "NIMI_LIVE_LLAMA_SERVER_PATH"
	liveLlamaJourneyVersionEnv = "NIMI_LIVE_LLAMA_VERSION"

	defaultLiveLlamaJourneyModel  = "/Users/snwozy/Nimi/models/resolved/nimi/local-import-qwen3-4b-q4-k-m-01kzd4fwjd0z5wkcdx5m9qtgsb/Qwen3-4B-Q4_K_M.gguf"
	defaultLiveLlamaJourneyBinary = "/Users/snwozy/Nimi/environments/llama/b8645/llama-server"
)

type liveLlamaJourneyHarness struct {
	ai              *Service
	local           *localservice.Service
	manager         *engine.Manager
	modelsRoot      string
	mainConfig      *runtimev1.LocalCapabilityConfiguration
	mainDisplayName string
	logs            *liveLlamaLockedBuffer
}

type liveLlamaLockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *liveLlamaLockedBuffer) Write(payload []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(payload)
}

func (b *liveLlamaLockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

type liveLlamaScenarioStream struct {
	ctx    context.Context
	onSend func(*runtimev1.StreamScenarioEvent) error

	mu     sync.Mutex
	events []*runtimev1.StreamScenarioEvent
}

func (s *liveLlamaScenarioStream) Send(event *runtimev1.StreamScenarioEvent) error {
	cloned, _ := proto.Clone(event).(*runtimev1.StreamScenarioEvent)
	s.mu.Lock()
	s.events = append(s.events, cloned)
	hook := s.onSend
	s.mu.Unlock()
	if hook != nil {
		return hook(cloned)
	}
	return nil
}

func (s *liveLlamaScenarioStream) Context() context.Context   { return s.ctx }
func (*liveLlamaScenarioStream) SetHeader(metadata.MD) error  { return nil }
func (*liveLlamaScenarioStream) SendHeader(metadata.MD) error { return nil }
func (*liveLlamaScenarioStream) SetTrailer(metadata.MD)       {}
func (*liveLlamaScenarioStream) SendMsg(any) error            { return nil }
func (*liveLlamaScenarioStream) RecvMsg(any) error            { return io.EOF }

func (s *liveLlamaScenarioStream) snapshot() []*runtimev1.StreamScenarioEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*runtimev1.StreamScenarioEvent, 0, len(s.events))
	for _, event := range s.events {
		cloned, _ := proto.Clone(event).(*runtimev1.StreamScenarioEvent)
		out = append(out, cloned)
	}
	return out
}

type liveLlamaStreamOutcome struct {
	started   *runtimev1.ScenarioStreamStarted
	completed *runtimev1.ScenarioStreamCompleted
	failed    *runtimev1.ScenarioStreamFailed
	text      string
	deltas    int
}

func TestLiveLlamaLocalJourney(t *testing.T) {
	if strings.TrimSpace(os.Getenv(liveLlamaJourneyGate)) != "1" {
		t.Skipf("set %s=1 to run the real GGUF/llama-server journey", liveLlamaJourneyGate)
	}

	modelPath := liveLlamaEnvOrDefault(liveLlamaJourneyModelEnv, defaultLiveLlamaJourneyModel)
	binaryPath := liveLlamaEnvOrDefault(liveLlamaJourneyBinaryEnv, defaultLiveLlamaJourneyBinary)
	harness := newLiveLlamaJourneyHarness(t, modelPath, binaryPath)

	if !t.Run("fail_closed_without_selection", func(t *testing.T) {
		startedAt := time.Now()
		stream := &liveLlamaScenarioStream{ctx: liveLlamaLocalContext(context.Background())}
		err := harness.ai.StreamScenario(liveLlamaStreamRequest("This request must not run.", 8), stream)
		assertLiveLlamaReason(t, err, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
		if events := stream.snapshot(); len(events) != 0 {
			t.Fatalf("missing-selection request emitted events: %#v", events)
		}
		t.Logf("typed no-selection rejection=%s elapsed=%s", runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND, time.Since(startedAt).Round(time.Millisecond))
	}) {
		return
	}

	if !t.Run("complete_product_chain_real_stream", func(t *testing.T) {
		selectLiveLlamaConfiguration(t, harness.local, harness.mainConfig.GetConfigurationId())
		startedAt := time.Now()
		stream := &liveLlamaScenarioStream{ctx: liveLlamaLocalContext(context.Background())}
		if err := harness.ai.StreamScenario(liveLlamaStreamRequest("Reply with one short sentence confirming that the Nimi live GGUF journey works.", 32), stream); err != nil {
			t.Fatalf("StreamScenario: %v\nengine logs:\n%s", err, tailLiveLlamaLog(harness.logs.String(), 12000))
		}
		outcome := summarizeLiveLlamaStream(stream.snapshot())
		if outcome.started == nil || outcome.started.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			t.Fatalf("stream did not start on the local route: %+v", outcome.started)
		}
		if outcome.started.GetModelResolved() != harness.mainDisplayName {
			t.Fatalf("model_resolved=%q want configuration display name %q", outcome.started.GetModelResolved(), harness.mainDisplayName)
		}
		if outcome.deltas < 1 || strings.TrimSpace(outcome.text) == "" {
			t.Fatalf("real stream had no non-empty text delta: deltas=%d text=%q", outcome.deltas, outcome.text)
		}
		if outcome.completed == nil || outcome.failed != nil {
			t.Fatalf("stream terminal state completed=%+v failed=%+v", outcome.completed, outcome.failed)
		}
		usage := outcome.completed.GetUsage()
		if usage == nil || usage.GetInputTokens() <= 0 || usage.GetOutputTokens() <= 0 {
			t.Fatalf("stream did not record real token usage: %+v", usage)
		}
		assertLiveLlamaSelection(t, harness.local, harness.mainConfig.GetConfigurationId(), harness.mainConfig.GetExactBindings())
		t.Logf("token_sample=%q deltas=%d usage={input:%d output:%d compute_ms:%d} elapsed=%s",
			liveLlamaSample(outcome.text), outcome.deltas, usage.GetInputTokens(), usage.GetOutputTokens(), usage.GetComputeMs(), time.Since(startedAt).Round(time.Millisecond))
	}) {
		return
	}

	if !t.Run("stream_cancel_keeps_resident_server", func(t *testing.T) {
		before := liveLlamaHealthyInfo(t, harness.manager)
		baseCtx, cancel := context.WithCancel(context.Background())
		defer cancel()
		var cancelOnce sync.Once
		stream := &liveLlamaScenarioStream{ctx: liveLlamaLocalContext(baseCtx)}
		stream.onSend = func(event *runtimev1.StreamScenarioEvent) error {
			if text := event.GetDelta().GetText().GetText(); strings.TrimSpace(text) != "" {
				cancelOnce.Do(cancel)
			}
			return nil
		}
		startedAt := time.Now()
		err := harness.ai.StreamScenario(liveLlamaStreamRequest("Count upward from 1 to 1000, writing every number on its own line without stopping early.", 256), stream)
		assertLiveLlamaReason(t, err, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED)
		outcome := summarizeLiveLlamaStream(stream.snapshot())
		if outcome.started == nil || outcome.deltas < 1 || strings.TrimSpace(outcome.text) == "" {
			t.Fatalf("cancel was not issued after a real delta: %+v", outcome)
		}
		after := liveLlamaHealthyInfo(t, harness.manager)
		if after.PID != before.PID {
			t.Fatalf("request cancellation replaced llama-server: before=%d after=%d", before.PID, after.PID)
		}
		response := executeLiveLlamaSync(t, harness, "Reply with the single word alive.", 12)
		if response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || strings.TrimSpace(outputText(response.GetOutput())) == "" {
			t.Fatalf("post-cancel request was not served locally: %+v", response)
		}
		t.Logf("cancel_reason=%s token_before_cancel=%q pid=%d post_cancel_sample=%q elapsed=%s",
			runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED, liveLlamaSample(outcome.text), before.PID,
			liveLlamaSample(outputText(response.GetOutput())), time.Since(startedAt).Round(time.Millisecond))
	}) {
		return
	}

	if !t.Run("immutable_stream_inputs_then_new_request_fails_closed", func(t *testing.T) {
		started := make(chan struct{})
		releaseStarted := make(chan struct{})
		var startedOnce sync.Once
		stream := &liveLlamaScenarioStream{ctx: liveLlamaLocalContext(context.Background())}
		stream.onSend = func(event *runtimev1.StreamScenarioEvent) error {
			if event.GetStarted() != nil {
				startedOnce.Do(func() { close(started) })
				<-releaseStarted
			}
			return nil
		}
		done := make(chan error, 1)
		startedAt := time.Now()
		go func() {
			done <- harness.ai.StreamScenario(liveLlamaStreamRequest("Reply with a short sentence about immutable captured inputs.", 32), stream)
		}()
		select {
		case <-started:
		case <-time.After(90 * time.Second):
			close(releaseStarted)
			t.Fatal("stream did not reach its started event")
		}
		if _, err := harness.local.ClearLocalCapabilitySelection(context.Background(), &runtimev1.ClearLocalCapabilitySelectionRequest{
			CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		}); err != nil {
			close(releaseStarted)
			t.Fatalf("ClearLocalCapabilitySelection: %v", err)
		}
		close(releaseStarted)
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("captured stream changed after selection clear: %v", err)
			}
		case <-time.After(90 * time.Second):
			t.Fatal("captured stream did not finish")
		}
		outcome := summarizeLiveLlamaStream(stream.snapshot())
		if outcome.started == nil || outcome.started.GetModelResolved() != harness.mainDisplayName || outcome.completed == nil || strings.TrimSpace(outcome.text) == "" {
			t.Fatalf("captured stream did not complete with its original configuration: %+v", outcome)
		}

		next := &liveLlamaScenarioStream{ctx: liveLlamaLocalContext(context.Background())}
		err := harness.ai.StreamScenario(liveLlamaStreamRequest("This new request must observe the cleared selection.", 8), next)
		assertLiveLlamaReason(t, err, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
		t.Logf("captured_model=%q token_sample=%q next_reason=%s elapsed=%s", outcome.started.GetModelResolved(), liveLlamaSample(outcome.text), runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND, time.Since(startedAt).Round(time.Millisecond))
	}) {
		return
	}

	if !t.Run("tampered_captured_binding_fails_content_check_and_configuration_persists", func(t *testing.T) {
		badEntryPath, badConfig := createLiveLlamaBadConfiguration(t, harness.local, harness.modelsRoot)
		selectLiveLlamaConfiguration(t, harness.local, badConfig.GetConfigurationId())
		originalBindings := cloneLiveLlamaBindings(badConfig.GetExactBindings())

		started := make(chan struct{})
		releaseStarted := make(chan struct{})
		var startedOnce sync.Once
		stream := &liveLlamaScenarioStream{ctx: liveLlamaLocalContext(context.Background())}
		stream.onSend = func(event *runtimev1.StreamScenarioEvent) error {
			if event.GetStarted() != nil {
				startedOnce.Do(func() { close(started) })
				<-releaseStarted
			}
			return nil
		}
		done := make(chan error, 1)
		startedAt := time.Now()
		go func() {
			done <- harness.ai.StreamScenario(liveLlamaStreamRequest("This malformed model must never produce output.", 8), stream)
		}()
		select {
		case <-started:
		case <-time.After(30 * time.Second):
			close(releaseStarted)
			t.Fatal("bad-binding stream did not capture its immutable inputs")
		}
		if err := os.Remove(badEntryPath); err != nil {
			close(releaseStarted)
			t.Fatalf("remove captured bad GGUF: %v", err)
		}
		close(releaseStarted)
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("content mismatch should be represented by a typed stream terminal event: %v", err)
			}
		case <-time.After(30 * time.Second):
			t.Fatal("bad-binding content check did not terminate")
		}
		outcome := summarizeLiveLlamaStream(stream.snapshot())
		if outcome.failed == nil || outcome.failed.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CONTENT_MISMATCH || outcome.completed != nil || strings.TrimSpace(outcome.text) != "" {
			t.Fatalf("bad-binding terminal outcome=%+v", outcome)
		}
		assertLiveLlamaSelection(t, harness.local, badConfig.GetConfigurationId(), originalBindings)
		t.Logf("typed_content_reason=%s action_hint=%q persisted_configuration=%s elapsed=%s",
			outcome.failed.GetReasonCode(), outcome.failed.GetActionHint(), badConfig.GetConfigurationId(), time.Since(startedAt).Round(time.Millisecond))
	}) {
		return
	}

	if !t.Run("process_crash_recovers_without_fallback", func(t *testing.T) {
		selectLiveLlamaConfiguration(t, harness.local, harness.mainConfig.GetConfigurationId())
		baseline := executeLiveLlamaSync(t, harness, "Reply with the single word ready.", 12)
		if baseline.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || baseline.GetModelResolved() != harness.mainDisplayName {
			t.Fatalf("recovery baseline did not use selected local configuration: %+v", baseline)
		}
		before := liveLlamaHealthyInfo(t, harness.manager)
		process, err := os.FindProcess(before.PID)
		if err != nil {
			t.Fatalf("find llama-server pid %d: %v", before.PID, err)
		}
		startedAt := time.Now()
		if err := process.Kill(); err != nil {
			t.Fatalf("kill llama-server pid %d: %v", before.PID, err)
		}

		first, firstErr := executeLiveLlamaSyncResult(harness, "Reply with the single word recovered.", 16)
		if firstErr != nil {
			assertLiveLlamaReason(t, firstErr, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_PROCESS_CRASHED)
			waitLiveLlamaCrashObserved(t, harness.manager, before.PID)
			first = executeLiveLlamaSync(t, harness, "Reply with the single word recovered.", 16)
		}
		if first.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || first.GetModelResolved() != harness.mainDisplayName || strings.TrimSpace(outputText(first.GetOutput())) == "" {
			t.Fatalf("post-crash request used fallback or pseudo-success: %+v", first)
		}
		after := liveLlamaHealthyInfo(t, harness.manager)
		if after.PID == before.PID {
			t.Fatalf("llama-server did not restart after crash: pid=%d", after.PID)
		}
		t.Logf("old_pid=%d new_pid=%d first_request_error=%v token_sample=%q elapsed=%s",
			before.PID, after.PID, firstErr, liveLlamaSample(outputText(first.GetOutput())), time.Since(startedAt).Round(time.Millisecond))
	}) {
		return
	}
}

func newLiveLlamaJourneyHarness(t *testing.T, modelPath string, binaryPath string) *liveLlamaJourneyHarness {
	t.Helper()
	assertLiveLlamaRegularFile(t, modelPath, false)
	assertLiveLlamaRegularFile(t, binaryPath, true)

	dataRoot := t.TempDir()
	modelsRoot := filepath.Join(dataRoot, "models")
	statePath := filepath.Join(dataRoot, "state", "local-state.json")
	logs := &liveLlamaLockedBuffer{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelInfo}))
	localSvc, err := localservice.NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, dataRoot)
	if err != nil {
		t.Fatalf("create isolated local service: %v", err)
	}
	t.Cleanup(localSvc.Close)

	linkedEntry, contentSHA := registerLiveLlamaModelByReference(t, localSvc, modelsRoot, modelPath)
	contentID := "sha256:" + contentSHA
	portable, err := structpb.NewStruct(map[string]any{"contextSize": 2048, "gpuLayers": -1})
	if err != nil {
		t.Fatalf("build portable llama config: %v", err)
	}
	const displayName = "Nimi live Qwen3 GGUF"
	mainConfig := addAndBindLiveLlamaConfiguration(t, localSvc, linkedEntry.asset, contentID, portable, displayName)

	manager, err := engine.NewManager(logger, engine.ManagedRoots{
		Environments: filepath.Join(dataRoot, "environments"),
		Dependencies: filepath.Join(dataRoot, "dependencies"),
	}, nil)
	if err != nil {
		t.Fatalf("create isolated engine manager: %v", err)
	}
	t.Cleanup(manager.StopAll)
	manager.SetRuntimeWorkRoot(filepath.Join(dataRoot, "work"))

	llamaConfig := engine.DefaultLlamaConfig()
	if version := strings.TrimSpace(os.Getenv(liveLlamaJourneyVersionEnv)); version != "" {
		llamaConfig.Version = version
	}
	llamaConfig.Port = reserveLiveLlamaPort(t)
	if err := manager.Registry().Put(&engine.RegistryEntry{
		Engine:      engine.EngineLlama,
		Version:     llamaConfig.Version,
		BinaryPath:  binaryPath,
		Platform:    goruntime.GOOS + "/" + goruntime.GOARCH,
		InstalledAt: time.Now().UTC().Format(time.RFC3339Nano),
	}); err != nil {
		t.Fatalf("register live llama-server binary: %v", err)
	}
	host, err := engine.NewExecutionHostWithLlamaConfig(manager, logger, llamaConfig)
	if err != nil {
		t.Fatalf("create execution host: %v", err)
	}
	aiSvc := newTestService(logger, Config{})
	aiSvc.SetLocalExecutionResolver(localSvc)
	aiSvc.SetLocalTextExecutionHost(host)

	harness := &liveLlamaJourneyHarness{
		ai:              aiSvc,
		local:           localSvc,
		manager:         manager,
		modelsRoot:      modelsRoot,
		mainConfig:      mainConfig,
		mainDisplayName: displayName,
		logs:            logs,
	}
	t.Cleanup(func() {
		if t.Failed() {
			t.Logf("engine log tail:\n%s", tailLiveLlamaLog(logs.String(), 12000))
		}
	})
	t.Logf("registered real GGUF by hard-link reference source=%s managed_ref=%s bytes=%d sha256=%s asset=%s config=%s port=%d",
		modelPath, linkedEntry.path, linkedEntry.size, contentSHA, linkedEntry.asset.GetLocalAssetId(), mainConfig.GetConfigurationId(), llamaConfig.Port)
	return harness
}

type liveLlamaRegisteredEntry struct {
	asset *runtimev1.LocalAssetRecord
	path  string
	size  int64
}

func registerLiveLlamaModelByReference(t *testing.T, localSvc *localservice.Service, modelsRoot string, sourcePath string) (liveLlamaRegisteredEntry, string) {
	t.Helper()
	const logicalModelID = "live/journey/qwen3-4b-q4-k-m"
	entryName := filepath.Base(sourcePath)
	bundleRoot := filepath.Join(modelsRoot, "resolved", filepath.FromSlash(logicalModelID))
	if err := os.MkdirAll(bundleRoot, 0o755); err != nil {
		t.Fatalf("create live model bundle root: %v", err)
	}
	entryPath := filepath.Join(bundleRoot, entryName)
	if err := os.Link(sourcePath, entryPath); err != nil {
		t.Fatalf("reference real GGUF without copying (hard link %s -> %s): %v", sourcePath, entryPath, err)
	}
	info, err := os.Stat(entryPath)
	if err != nil {
		t.Fatalf("stat linked GGUF: %v", err)
	}
	hashStartedAt := time.Now()
	contentSHA := sha256LiveLlamaFile(t, entryPath)
	t.Logf("verified real GGUF bytes=%d sha256=%s hash_elapsed=%s", info.Size(), contentSHA, time.Since(hashStartedAt).Round(time.Millisecond))

	manifestPath := filepath.Join(bundleRoot, "asset.manifest.json")
	writeLiveLlamaManifest(t, manifestPath, map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         "local-import/live-qwen3-4b-q4-k-m",
		"display_name":     "Qwen3-4B-Q4_K_M",
		"kind":             "chat",
		"logical_model_id": logicalModelID,
		"capabilities":     []string{"chat"},
		"engine":           "llama",
		"entry":            entryName,
		"files":            []string{entryName},
		"license":          "unknown",
		"artifact_roles":   []string{"llm"},
		"integrity_mode":   "local_unverified",
		"hashes":           map[string]string{entryName: "sha256:" + contentSHA},
		"source": map[string]any{
			"repo":     "file://" + filepath.ToSlash(manifestPath),
			"revision": "live-journey",
		},
	})
	importStartedAt := time.Now()
	response, err := localSvc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
	if err != nil {
		t.Fatalf("ImportLocalAsset(real GGUF): %v", err)
	}
	asset := response.GetAsset()
	if asset == nil || asset.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("real GGUF import did not produce an installed LocalAsset: %+v", asset)
	}
	if got := strings.TrimPrefix(asset.GetHashes()[asset.GetEntry()], "sha256:"); got != contentSHA {
		t.Fatalf("imported verified identity=%q want=%q", got, contentSHA)
	}
	t.Logf("ImportLocalAsset asset=%s elapsed=%s", asset.GetLocalAssetId(), time.Since(importStartedAt).Round(time.Millisecond))
	return liveLlamaRegisteredEntry{asset: asset, path: entryPath, size: info.Size()}, contentSHA
}

func addAndBindLiveLlamaConfiguration(
	t *testing.T,
	localSvc *localservice.Service,
	asset *runtimev1.LocalAssetRecord,
	contentID string,
	portable *structpb.Struct,
	displayName string,
) *runtimev1.LocalCapabilityConfiguration {
	t.Helper()
	addStartedAt := time.Now()
	added, err := localSvc.AddLocalCapabilityConfiguration(context.Background(), &runtimev1.AddLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		Implementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: capabilitydriver.LlamaImplementationID,
			DriverId:         capabilitydriver.LlamaDriverID,
			DriverDialect:    capabilitydriver.LlamaDriverDialect,
		},
		PortableConfig: portable,
		DisplayName:    displayName,
	})
	if err != nil {
		t.Fatalf("AddLocalCapabilityConfiguration: %v", err)
	}
	configuration := added.GetConfiguration()
	if configuration == nil || len(configuration.GetProjectedRequirements()) != 1 || len(configuration.GetExactBindings()) != 0 {
		t.Fatalf("Add did not project one unbound text-only requirement: %+v", configuration)
	}
	requirementID := configuration.GetProjectedRequirements()[0].GetRequirementId()
	if requirementID != capabilitydriver.MainGGUFRequirementID {
		t.Fatalf("projected requirement=%q want=%q", requirementID, capabilitydriver.MainGGUFRequirementID)
	}
	bound, err := localSvc.BindLocalCapabilityRequirement(context.Background(), &runtimev1.BindLocalCapabilityRequirementRequest{
		ConfigurationId: configuration.GetConfigurationId(),
		RequirementId:   requirementID,
		Target: &runtimev1.LocalAssetExactBindingTarget{
			LocalAssetId:              asset.GetLocalAssetId(),
			ExpectedVerifiedContentId: contentID,
		},
	})
	if err != nil {
		t.Fatalf("BindLocalCapabilityRequirement: %v", err)
	}
	configuration = bound.GetConfiguration()
	if configuration == nil || configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED || len(configuration.GetExactBindings()) != 1 {
		t.Fatalf("exact bind did not configure text execution: %+v", configuration)
	}
	binding := configuration.GetExactBindings()[0]
	if binding.GetLocalAssetId() != asset.GetLocalAssetId() || binding.GetVerifiedContentId() != contentID || binding.GetEntrySha256() != strings.TrimPrefix(contentID, "sha256:") {
		t.Fatalf("exact binding mismatch: %+v", binding)
	}
	t.Logf("Add+Bind configuration=%s asset=%s elapsed=%s", configuration.GetConfigurationId(), asset.GetLocalAssetId(), time.Since(addStartedAt).Round(time.Millisecond))
	return configuration
}

func createLiveLlamaBadConfiguration(t *testing.T, localSvc *localservice.Service, modelsRoot string) (string, *runtimev1.LocalCapabilityConfiguration) {
	t.Helper()
	badLogicalID := "live/journey/tampered-gguf"
	bundleRoot := filepath.Join(modelsRoot, "resolved", filepath.FromSlash(badLogicalID))
	if err := os.MkdirAll(bundleRoot, 0o755); err != nil {
		t.Fatalf("create bad GGUF bundle: %v", err)
	}
	entryName := "tampered.gguf"
	entryPath := filepath.Join(bundleRoot, entryName)
	payload := bytes.Repeat([]byte{0x7f}, 4*1024)
	copy(payload, []byte("GGUF"))
	if err := os.WriteFile(entryPath, payload, 0o600); err != nil {
		t.Fatalf("write bad GGUF: %v", err)
	}
	sum := sha256.Sum256(payload)
	entrySHA := hex.EncodeToString(sum[:])
	manifestPath := filepath.Join(bundleRoot, "asset.manifest.json")
	writeLiveLlamaManifest(t, manifestPath, map[string]any{
		"schema_version":   "1.0.0",
		"asset_id":         "local-import/live-tampered-gguf",
		"display_name":     "Tampered live GGUF",
		"kind":             "chat",
		"logical_model_id": badLogicalID,
		"capabilities":     []string{"chat"},
		"engine":           "llama",
		"entry":            entryName,
		"files":            []string{entryName},
		"license":          "unknown",
		"artifact_roles":   []string{"llm"},
		"integrity_mode":   "local_unverified",
		"hashes":           map[string]string{entryName: "sha256:" + entrySHA},
		"source": map[string]any{
			"repo":     "file://" + filepath.ToSlash(manifestPath),
			"revision": "live-journey-tampered",
		},
	})
	imported, err := localSvc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{ManifestPath: manifestPath})
	if err != nil {
		t.Fatalf("ImportLocalAsset(bad GGUF): %v", err)
	}
	configuration := addAndBindLiveLlamaConfiguration(t, localSvc, imported.GetAsset(), "sha256:"+entrySHA, nil, "Nimi live tampered GGUF")
	return entryPath, configuration
}

func writeLiveLlamaManifest(t *testing.T, path string, manifest map[string]any) {
	t.Helper()
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatalf("encode live asset manifest: %v", err)
	}
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write live asset manifest: %v", err)
	}
}

func sha256LiveLlamaFile(t *testing.T, path string) string {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatalf("open GGUF for hashing: %v", err)
	}
	defer func() { _ = file.Close() }()
	hasher := sha256.New()
	if _, err := io.CopyBuffer(hasher, file, make([]byte, 4*1024*1024)); err != nil {
		t.Fatalf("hash GGUF: %v", err)
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func assertLiveLlamaRegularFile(t *testing.T, path string, executable bool) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("required live asset %s: %v", path, err)
	}
	if !info.Mode().IsRegular() {
		t.Fatalf("required live asset is not a regular file: %s", path)
	}
	if executable && info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("required llama-server is not executable: %s", path)
	}
}

func reserveLiveLlamaPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve random llama port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release random llama port %d: %v", port, err)
	}
	return port
}

func liveLlamaEnvOrDefault(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func liveLlamaLocalContext(parent context.Context) context.Context {
	return executionintent.WithIntent(parent, executionintent.Intent{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
}

func liveLlamaStreamRequest(prompt string, maxTokens int32) *runtimev1.StreamScenarioRequest {
	return &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.live-llama-journey",
			SubjectUserId: "live-local-user",
			TimeoutMs:     120_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input:       []*runtimev1.ChatMessage{{Role: "user", Content: prompt}},
			MaxTokens:   maxTokens,
			Temperature: 0.1,
		}}},
	}
}

func liveLlamaSyncRequest(prompt string, maxTokens int32) *runtimev1.ExecuteScenarioRequest {
	stream := liveLlamaStreamRequest(prompt, maxTokens)
	return &runtimev1.ExecuteScenarioRequest{
		Head:          stream.GetHead(),
		ScenarioType:  stream.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec:          stream.GetSpec(),
	}
}

func executeLiveLlamaSync(t *testing.T, harness *liveLlamaJourneyHarness, prompt string, maxTokens int32) *runtimev1.ExecuteScenarioResponse {
	t.Helper()
	response, err := executeLiveLlamaSyncResult(harness, prompt, maxTokens)
	if err != nil {
		t.Fatalf("ExecuteScenario(local): %v\nengine logs:\n%s", err, tailLiveLlamaLog(harness.logs.String(), 12000))
	}
	return response
}

func executeLiveLlamaSyncResult(harness *liveLlamaJourneyHarness, prompt string, maxTokens int32) (*runtimev1.ExecuteScenarioResponse, error) {
	ctx, cancel := context.WithTimeout(liveLlamaLocalContext(context.Background()), 2*time.Minute)
	defer cancel()
	return harness.ai.ExecuteScenario(ctx, liveLlamaSyncRequest(prompt, maxTokens))
}

func selectLiveLlamaConfiguration(t *testing.T, localSvc *localservice.Service, configurationID string) {
	t.Helper()
	response, err := localSvc.SelectLocalCapabilityConfiguration(context.Background(), &runtimev1.SelectLocalCapabilityConfigurationRequest{
		CapabilityContract: capabilitydriver.LlamaCapabilityContract,
		ConfigurationId:    configurationID,
	})
	if err != nil {
		t.Fatalf("SelectLocalCapabilityConfiguration(%s): %v", configurationID, err)
	}
	if response.GetSelection().GetConfigurationId() != configurationID {
		t.Fatalf("selected configuration=%q want=%q", response.GetSelection().GetConfigurationId(), configurationID)
	}
}

func assertLiveLlamaSelection(t *testing.T, localSvc *localservice.Service, configurationID string, bindings []*runtimev1.LocalAssetExactBinding) {
	t.Helper()
	response, err := localSvc.GetMachineLocalAIConfiguration(context.Background(), &runtimev1.GetMachineLocalAIConfigurationRequest{})
	if err != nil {
		t.Fatalf("GetMachineLocalAIConfiguration: %v", err)
	}
	aggregate := response.GetAggregate()
	var selected bool
	for _, selection := range aggregate.GetSelections() {
		if selection.GetCapabilityContract() == capabilitydriver.LlamaCapabilityContract && selection.GetConfigurationId() == configurationID {
			selected = true
		}
	}
	if !selected {
		t.Fatalf("selection for configuration %s was not preserved: %+v", configurationID, aggregate.GetSelections())
	}
	for _, configuration := range aggregate.GetConfigurations() {
		if configuration.GetConfigurationId() != configurationID {
			continue
		}
		if len(configuration.GetExactBindings()) != len(bindings) {
			t.Fatalf("configuration %s bindings changed: got=%+v want=%+v", configurationID, configuration.GetExactBindings(), bindings)
		}
		for index := range bindings {
			if !proto.Equal(configuration.GetExactBindings()[index], bindings[index]) {
				t.Fatalf("configuration %s binding[%d] changed: got=%+v want=%+v", configurationID, index, configuration.GetExactBindings()[index], bindings[index])
			}
		}
		return
	}
	t.Fatalf("configuration %s disappeared", configurationID)
}

func cloneLiveLlamaBindings(bindings []*runtimev1.LocalAssetExactBinding) []*runtimev1.LocalAssetExactBinding {
	out := make([]*runtimev1.LocalAssetExactBinding, 0, len(bindings))
	for _, binding := range bindings {
		cloned, _ := proto.Clone(binding).(*runtimev1.LocalAssetExactBinding)
		out = append(out, cloned)
	}
	return out
}

func summarizeLiveLlamaStream(events []*runtimev1.StreamScenarioEvent) liveLlamaStreamOutcome {
	var outcome liveLlamaStreamOutcome
	var text strings.Builder
	for _, event := range events {
		if event == nil {
			continue
		}
		if event.GetStarted() != nil {
			outcome.started = event.GetStarted()
		}
		if delta := event.GetDelta().GetText(); delta != nil && strings.TrimSpace(delta.GetText()) != "" {
			outcome.deltas++
			text.WriteString(delta.GetText())
		}
		if event.GetCompleted() != nil {
			outcome.completed = event.GetCompleted()
		}
		if event.GetFailed() != nil {
			outcome.failed = event.GetFailed()
		}
	}
	outcome.text = text.String()
	return outcome
}

func assertLiveLlamaReason(t *testing.T, err error, wanted runtimev1.ReasonCode) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected typed reason %s, got nil error", wanted)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != wanted {
		t.Fatalf("typed reason=%s ok=%t want=%s error=%v", reason, ok, wanted, err)
	}
}

func liveLlamaHealthyInfo(t *testing.T, manager *engine.Manager) engine.SupervisorInfo {
	t.Helper()
	info, err := manager.EngineStatus(engine.EngineLlama)
	if err != nil {
		t.Fatalf("EngineStatus(llama): %v", err)
	}
	if info.Status != engine.StatusHealthy || info.PID <= 0 {
		t.Fatalf("llama-server is not healthy: %+v", info)
	}
	return info
}

func waitLiveLlamaCrashObserved(t *testing.T, manager *engine.Manager, oldPID int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		info, err := manager.EngineStatus(engine.EngineLlama)
		if err != nil || info.Status != engine.StatusHealthy || info.PID != oldPID {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("engine manager did not observe killed llama-server pid %d", oldPID)
}

func liveLlamaSample(text string) string {
	text = strings.Join(strings.Fields(strings.TrimSpace(text)), " ")
	const max = 160
	if len(text) <= max {
		return text
	}
	return text[:max] + "…"
}

func tailLiveLlamaLog(value string, maxBytes int) string {
	if maxBytes <= 0 || len(value) <= maxBytes {
		return value
	}
	return fmt.Sprintf("…(%d bytes omitted)…\n%s", len(value)-maxBytes, value[len(value)-maxBytes:])
}
