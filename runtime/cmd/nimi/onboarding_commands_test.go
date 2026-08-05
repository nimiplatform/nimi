package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/daemonctl"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

func TestRunRuntimeVersionJSON(t *testing.T) {
	output, err := captureStdoutFromRun(func() error {
		return runRuntimeVersion([]string{"--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeVersion: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal version output: %v output=%q", unmarshalErr, output)
	}
	if got := asString(payload["nimi"]); got == "" {
		t.Fatalf("expected nimi version in payload: %#v", payload)
	}
	if _, exists := payload["config"]; exists {
		t.Fatalf("version must not expose a default Runtime config path: %#v", payload)
	}
	if _, exists := payload["nonProductionPortableConfig"]; exists {
		t.Fatalf("version must not invent a portable config path: %#v", payload)
	}
}

func TestRunRuntimeInitMovedToNimiAppCreate(t *testing.T) {
	err := runRuntimeInit([]string{"--dir", t.TempDir(), "--template", "basic", "--json"})
	if err == nil {
		t.Fatalf("expected moved error")
	}
	if !strings.Contains(err.Error(), "AUTHOR_COMMAND_MOVED") {
		t.Fatalf("missing moved reason code: %v", err)
	}
	if !strings.Contains(err.Error(), "use_nimi-app_create") {
		t.Fatalf("missing nimi-app create action hint: %v", err)
	}
}

func TestRunRuntimeProviderSetListUnset(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", cmdTestPortableConfigPath(homeDir))

	setOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeProvider([]string{
			"set",
			"openai",
			"--api-key-env", "NIMI_RUNTIME_CLOUD_OPENAI_API_KEY",
			"--base-url", "https://api.openai.example/v1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeProvider set: %v", err)
	}

	var setPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(setOutput), &setPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal provider set output: %v output=%q", unmarshalErr, setOutput)
	}
	if got := asString(setPayload["provider"]); got != "openai" {
		t.Fatalf("provider mismatch: %q", got)
	}

	fileCfg, err := config.LoadFileConfig(config.RuntimeConfigPath())
	if err != nil {
		t.Fatalf("load provider config: %v", err)
	}
	target := fileCfg.Providers["openai"]
	if target.APIKeyEnv != "NIMI_RUNTIME_CLOUD_OPENAI_API_KEY" {
		t.Fatalf("apiKeyEnv mismatch: %#v", target)
	}
	listOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeProvider([]string{"list", "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeProvider list: %v", err)
	}
	var listPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(listOutput), &listPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal provider list output: %v output=%q", unmarshalErr, listOutput)
	}
	providers, ok := listPayload["providers"].([]any)
	if !ok || len(providers) != 1 {
		t.Fatalf("providers payload mismatch: %#v", listPayload["providers"])
	}
	firstProvider, ok := providers[0].(map[string]any)
	if !ok || asString(firstProvider["provider"]) != "openai" {
		t.Fatalf("provider list entry mismatch: %#v", providers[0])
	}

	if _, err := captureStdoutFromRun(func() error {
		return runRuntimeProvider([]string{"unset", "openai", "--json"})
	}); err != nil {
		t.Fatalf("runRuntimeProvider unset: %v", err)
	}
	fileCfg, err = config.LoadFileConfig(config.RuntimeConfigPath())
	if err != nil {
		t.Fatalf("reload provider config: %v", err)
	}
	if len(fileCfg.Providers) != 0 {
		t.Fatalf("providers should be empty after unset: %#v", fileCfg.Providers)
	}
}

func TestRunRuntimeProviderListPlainTextShowsNextStepWhenEmpty(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", cmdTestPortableConfigPath(homeDir))

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeProvider([]string{"list"})
	})
	if err != nil {
		t.Fatalf("runRuntimeProvider list: %v", err)
	}
	if !strings.Contains(output, "Nimi Providers") {
		t.Fatalf("missing providers header: %q", output)
	}
	if !strings.Contains(output, `configure caller-owned AIConfig, then run: nimi run "What is Nimi?"`) {
		t.Fatalf("missing next-step cloud command: %q", output)
	}
}

func TestRunRuntimeProviderTestJSON(t *testing.T) {
	service := &cmdTestOnboardingService{
		providerHealthResponse: &runtimev1.ListAIProviderHealthResponse{
			Providers: []*runtimev1.AIProviderHealthSnapshot{
				{ProviderName: "openai", State: "healthy", Reason: "configured"},
			},
		},
	}
	addr, shutdown := startCmdTestOnboardingServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeProvider([]string{"test", "openai", "--grpc-addr", addr, "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeProvider test: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal provider test output: %v output=%q", unmarshalErr, output)
	}
	if got := asString(payload["state"]); got != "healthy" {
		t.Fatalf("provider health mismatch: %q", got)
	}
}

func TestRunRuntimeProviderTestPlainText(t *testing.T) {
	service := &cmdTestOnboardingService{
		providerHealthResponse: &runtimev1.ListAIProviderHealthResponse{
			Providers: []*runtimev1.AIProviderHealthSnapshot{
				{ProviderName: "openai", State: "healthy", Reason: "configured"},
			},
		},
	}
	addr, shutdown := startCmdTestOnboardingServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeProvider([]string{"test", "openai", "--grpc-addr", addr})
	})
	if err != nil {
		t.Fatalf("runRuntimeProvider test: %v", err)
	}
	if !strings.Contains(output, "Provider Health") || !strings.Contains(output, "provider:") || !strings.Contains(output, "openai") || !strings.Contains(output, "state:") || !strings.Contains(output, "healthy") {
		t.Fatalf("unexpected provider test output: %q", output)
	}
}

func TestRunRuntimeDoctorJSON(t *testing.T) {
	homeDir := t.TempDir()
	configPath := filepath.Join(homeDir, ".nimi", "config.json")
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	t.Setenv("NIMI_RUNTIME_CLOUD_OPENAI_API_KEY", "test-openai-key")

	if err := config.WriteFileConfig(configPath, config.FileConfig{
		SchemaVersion: config.DefaultSchemaVersion,
		Providers: map[string]config.RuntimeFileTarget{
			"openai": {
				APIKeyEnv: "NIMI_RUNTIME_CLOUD_OPENAI_API_KEY",
			},
		},
	}); err != nil {
		t.Fatalf("write runtime config: %v", err)
	}

	service := &cmdTestOnboardingService{
		runtimeHealthResponse: &runtimev1.GetRuntimeHealthResponse{
			Status: runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_READY,
			Reason: "healthy",
		},
		providerHealthResponse: &runtimev1.ListAIProviderHealthResponse{
			Providers: []*runtimev1.AIProviderHealthSnapshot{
				{ProviderName: "local", State: "healthy", Reason: "running"},
				{ProviderName: "openai", State: "healthy", Reason: "configured"},
			},
		},
		listResponse: &runtimev1.ListModelsResponse{
			Models: []*runtimev1.ModelDescriptor{
				{ModelId: "local/qwen2.5", Status: runtimev1.ModelStatus_MODEL_STATUS_INSTALLED},
			},
		},
	}
	addr, shutdown := startCmdTestOnboardingServer(t, service)
	defer shutdown()
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", addr)

	cwd := t.TempDir()
	sdkPkgDir := filepath.Join(cwd, "node_modules", "@nimiplatform", "sdk")
	if err := os.MkdirAll(sdkPkgDir, 0o755); err != nil {
		t.Fatalf("mkdir sdk package dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sdkPkgDir, "package.json"), []byte("{\"name\":\"@nimiplatform/sdk\"}\n"), 0o644); err != nil {
		t.Fatalf("write sdk package.json: %v", err)
	}
	previousCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(cwd); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousCwd)
	})

	output, err := captureStdoutFromRun(func() error {
		previousProvider := doctorStatusProvider
		doctorStatusProvider = func() (daemonctl.Status, error) {
			return daemonctl.Status{
				Mode:          daemonctl.ModeBackground,
				Process:       "running",
				PID:           42,
				GRPCAddr:      addr,
				ConfigPath:    configPath,
				LogPath:       filepath.Join(homeDir, ".nimi", "logs", "runtime.log"),
				HealthSummary: "RUNTIME_HEALTH_STATUS_READY (healthy)",
			}, nil
		}
		defer func() {
			doctorStatusProvider = previousProvider
		}()
		return runRuntimeDoctor([]string{"--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeDoctor: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal doctor output: %v output=%q", unmarshalErr, output)
	}
	items, ok := payload["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("doctor items payload mismatch: %#v", payload["items"])
	}
	assertDoctorItem(t, items, "gRPC daemon", "ok")
	assertDoctorItem(t, items, "runtime mode", "ok")
	assertDoctorItem(t, items, "cloud provider", "ok")
	assertDoctorItem(t, items, "sdk", "ok")
}

func TestRunRuntimeDoctorPlainTextShowsNextStepWhenRuntimeUnavailable(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", cmdTestPortableConfigPath(homeDir))
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:1")

	statusCalls := 0
	previousProvider := doctorStatusProvider
	doctorStatusProvider = func() (daemonctl.Status, error) {
		statusCalls++
		return daemonctl.Status{Mode: daemonctl.ModeStopped, Process: "stopped"}, nil
	}
	defer func() {
		doctorStatusProvider = previousProvider
	}()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeDoctor(nil)
	})
	if err != nil {
		t.Fatalf("runRuntimeDoctor: %v", err)
	}
	if !strings.Contains(output, "Nimi Doctor") {
		t.Fatalf("missing doctor header: %q", output)
	}
	legacyAdvice := "Run 'nimi start' for background mode, or 'nimi serve' in another terminal."
	if !strings.Contains(output, legacyAdvice) {
		t.Fatalf("missing legacy runtime advice: %q", output)
	}
	if !strings.Contains(output, "\nNext\n\n  nimi start") {
		t.Fatalf("missing next-step runtime hint: %q", output)
	}
	if statusCalls != 1 {
		t.Fatalf("doctor status provider calls = %d, want 1", statusCalls)
	}
}

func TestRunTopLevelRunStreamsUsingCallerAIConfig(t *testing.T) {
	service := &cmdTestOnboardingService{
		listResponse: &runtimev1.ListModelsResponse{},
		healthResponse: &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			ActionHint: "pull model",
		},
		pullResponse: &runtimev1.PullModelResponse{
			TaskId:     "pull-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		streamEvents: []*runtimev1.StreamScenarioEvent{
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-local-run",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "local/qwen2.5",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: testTextStreamDelta("hello local"),
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_USAGE,
				Payload: &runtimev1.StreamScenarioEvent_Usage{
					Usage: &runtimev1.UsageStats{InputTokens: 2, OutputTokens: 3, ComputeMs: 4},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-local-run",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
				},
			},
		},
	}
	addr, shutdown := startCmdTestOnboardingServer(t, service)
	defer shutdown()
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", addr)

	output, err := captureStdoutFromRun(func() error {
		return runTopLevelRun([]string{"What is Nimi?", "--json"})
	})
	if err != nil {
		t.Fatalf("runTopLevelRun local: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal top-level run output: %v output=%q", unmarshalErr, output)
	}
	if got := asString(payload["text"]); got != "hello local" {
		t.Fatalf("text mismatch: %q", got)
	}
	if got := asString(payload["routeDecision"]); got != "local" {
		t.Fatalf("route decision mismatch: %q", got)
	}

	if req := service.lastStreamRequest(); req.GetHead().GetAppId() != onboardingAppID {
		t.Fatalf("stream app mismatch: %#v", req.GetHead())
	}
}

func TestRunRuntimeProviderSetRejectsRemovedDefaultRoutingFlag(t *testing.T) {
	homeDir := t.TempDir()
	configPath := filepath.Join(homeDir, ".nimi", "config.json")
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	err := runRuntimeProvider([]string{"set", "stability", "--api-key", "stability-inline-key", "--default"})
	if err == nil {
		t.Fatalf("expected removed provider default routing flag error")
	}
	if !strings.Contains(err.Error(), "flag provided but not defined") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func assertDoctorItem(t *testing.T, items []any, name string, status string) {
	t.Helper()
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if asString(item["name"]) != name {
			continue
		}
		if got := asString(item["status"]); got != status {
			t.Fatalf("doctor item %s status mismatch: got=%q want=%q item=%#v", name, got, status, item)
		}
		return
	}
	t.Fatalf("doctor item %s not found in %#v", name, items)
}

func startCmdTestOnboardingServer(t *testing.T, service *cmdTestOnboardingService) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeModelServiceServer(server, service)
	runtimev1.RegisterRuntimeAiServiceServer(server, service)
	runtimev1.RegisterRuntimeAuditServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type cmdTestOnboardingService struct {
	runtimev1.UnimplementedRuntimeModelServiceServer
	runtimev1.UnimplementedRuntimeAiServiceServer
	runtimev1.UnimplementedRuntimeAuditServiceServer

	mu sync.Mutex

	pullReq   *runtimev1.PullModelRequest
	healthReq *runtimev1.CheckModelHealthRequest
	streamReq *runtimev1.StreamScenarioRequest

	listResponse           *runtimev1.ListModelsResponse
	pullResponse           *runtimev1.PullModelResponse
	healthResponse         *runtimev1.CheckModelHealthResponse
	streamEvents           []*runtimev1.StreamScenarioEvent
	runtimeHealthResponse  *runtimev1.GetRuntimeHealthResponse
	providerHealthResponse *runtimev1.ListAIProviderHealthResponse

	streamMD metadata.MD
}

func (s *cmdTestOnboardingService) ListModels(context.Context, *runtimev1.ListModelsRequest) (*runtimev1.ListModelsResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listResponse != nil {
		return s.listResponse, nil
	}
	return &runtimev1.ListModelsResponse{}, nil
}

func (s *cmdTestOnboardingService) PullModel(ctx context.Context, req *runtimev1.PullModelRequest) (*runtimev1.PullModelResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pullReq = clonePullModelRequest(req)
	if s.pullResponse != nil {
		return s.pullResponse, nil
	}
	return nil, errors.New("pull response not configured")
}

func (s *cmdTestOnboardingService) CheckModelHealth(ctx context.Context, req *runtimev1.CheckModelHealthRequest) (*runtimev1.CheckModelHealthResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.healthReq = cloneCheckModelHealthRequest(req)
	if s.healthResponse != nil {
		return s.healthResponse, nil
	}
	return &runtimev1.CheckModelHealthResponse{Healthy: true}, nil
}

func (s *cmdTestOnboardingService) StreamScenario(req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	s.mu.Lock()
	s.streamReq = cloneStreamScenarioRequest(req)
	s.streamMD = cloneIncomingMetadata(stream.Context())
	events := cloneStreamScenarioEvents(s.streamEvents)
	s.mu.Unlock()

	for _, event := range events {
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	return nil
}

func (s *cmdTestOnboardingService) GetRuntimeHealth(context.Context, *runtimev1.GetRuntimeHealthRequest) (*runtimev1.GetRuntimeHealthResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.runtimeHealthResponse != nil {
		return s.runtimeHealthResponse, nil
	}
	return &runtimev1.GetRuntimeHealthResponse{
		Status: runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_READY,
		Reason: "healthy",
	}, nil
}

func (s *cmdTestOnboardingService) ListAIProviderHealth(context.Context, *runtimev1.ListAIProviderHealthRequest) (*runtimev1.ListAIProviderHealthResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.providerHealthResponse != nil {
		return s.providerHealthResponse, nil
	}
	return &runtimev1.ListAIProviderHealthResponse{}, nil
}

func (s *cmdTestOnboardingService) lastPullRequest() *runtimev1.PullModelRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pullReq == nil {
		return &runtimev1.PullModelRequest{}
	}
	return s.pullReq
}

func (s *cmdTestOnboardingService) lastStreamRequest() *runtimev1.StreamScenarioRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.streamReq == nil {
		return &runtimev1.StreamScenarioRequest{}
	}
	return s.streamReq
}

func (s *cmdTestOnboardingService) lastStreamMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streamMD.Copy()
}

func clonePullModelRequest(input *runtimev1.PullModelRequest) *runtimev1.PullModelRequest {
	if input == nil {
		return nil
	}
	cloned, ok := proto.Clone(input).(*runtimev1.PullModelRequest)
	if !ok {
		return nil
	}
	return cloned
}

func cloneCheckModelHealthRequest(input *runtimev1.CheckModelHealthRequest) *runtimev1.CheckModelHealthRequest {
	if input == nil {
		return nil
	}
	cloned, ok := proto.Clone(input).(*runtimev1.CheckModelHealthRequest)
	if !ok {
		return nil
	}
	return cloned
}

func cloneStreamScenarioRequest(input *runtimev1.StreamScenarioRequest) *runtimev1.StreamScenarioRequest {
	if input == nil {
		return nil
	}
	cloned, ok := proto.Clone(input).(*runtimev1.StreamScenarioRequest)
	if !ok {
		return nil
	}
	return cloned
}

func cloneStreamScenarioEvents(input []*runtimev1.StreamScenarioEvent) []*runtimev1.StreamScenarioEvent {
	if len(input) == 0 {
		return nil
	}
	out := make([]*runtimev1.StreamScenarioEvent, 0, len(input))
	for _, item := range input {
		if item == nil {
			continue
		}
		cloned, ok := proto.Clone(item).(*runtimev1.StreamScenarioEvent)
		if !ok {
			continue
		}
		out = append(out, cloned)
	}
	return out
}
