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
	if got := asString(payload["config"]); got == "" {
		t.Fatalf("expected config path in payload: %#v", payload)
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
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")

	setOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeProvider([]string{
			"set",
			"openai",
			"--api-key-env", "NIMI_RUNTIME_CLOUD_OPENAI_API_KEY",
			"--base-url", "https://api.openai.example/v1",
			"--default",
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
	if target.DefaultModel != "" {
		t.Fatalf("defaultModel should stay empty when catalog default is used: %#v", target)
	}
	if fileCfg.DefaultCloudProvider != "openai" {
		t.Fatalf("defaultCloudProvider mismatch: %#v", fileCfg)
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
	if got := asString(listPayload["defaultCloudProvider"]); got != "openai" {
		t.Fatalf("defaultCloudProvider list mismatch: %q", got)
	}
	firstProvider, ok := providers[0].(map[string]any)
	if !ok || asString(firstProvider["provider"]) != "openai" || firstProvider["default"] != true {
		t.Fatalf("provider list default marker mismatch: %#v", providers[0])
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
	if fileCfg.DefaultCloudProvider != "" {
		t.Fatalf("defaultCloudProvider should be cleared after unset: %#v", fileCfg)
	}
}

func TestRunRuntimeProviderListPlainTextShowsNextStepWhenEmpty(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeProvider([]string{"list"})
	})
	if err != nil {
		t.Fatalf("runRuntimeProvider list: %v", err)
	}
	if !strings.Contains(output, "Nimi Providers") {
		t.Fatalf("missing providers header: %q", output)
	}
	if !strings.Contains(output, `nimi run "What is Nimi?" --provider gemini`) {
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
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:1")

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeDoctor(nil)
	})
	if err != nil {
		t.Fatalf("runRuntimeDoctor: %v", err)
	}
	if !strings.Contains(output, "Nimi Doctor") {
		t.Fatalf("missing doctor header: %q", output)
	}
	if !strings.Contains(output, "nimi start") {
		t.Fatalf("missing next-step runtime hint: %q", output)
	}
}

func TestRunTopLevelRunInstallsLocalModelAndStreamsJSON(t *testing.T) {
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
					Delta: &runtimev1.ScenarioStreamDelta{Text: "hello local"},
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
		return runTopLevelRun([]string{"What is Nimi?", "--yes", "--json"})
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

	if req := service.lastPullRequest(); req.GetModelRef() != "local/qwen2.5@latest" {
		t.Fatalf("pull request mismatch: %#v", req)
	}
	if req := service.lastStreamRequest(); req.GetHead().GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("stream route mismatch: %#v", req.GetHead())
	}
}

func TestRunTopLevelRunCloudInteractiveCredentialCapture(t *testing.T) {
	service := &cmdTestOnboardingService{
		listResponse: &runtimev1.ListModelsResponse{},
		streamEvents: []*runtimev1.StreamScenarioEvent{
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-cloud-run",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "gemini/gemini-2.5-flash",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
					},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{Text: "hello cloud"},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-cloud-run",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
				},
			},
		},
	}
	addr, shutdown := startCmdTestOnboardingServer(t, service)
	defer shutdown()
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", addr)

	restoreInteractive := onboardingInteractiveTerminal
	restorePrompt := onboardingSecretPrompt
	onboardingInteractiveTerminal = func() bool { return true }
	onboardingSecretPrompt = func(message string) (string, error) {
		if !strings.Contains(message, "gemini API key is not configured") {
			t.Fatalf("unexpected prompt message: %q", message)
		}
		return "gemini-inline-key", nil
	}
	defer func() {
		onboardingInteractiveTerminal = restoreInteractive
		onboardingSecretPrompt = restorePrompt
	}()

	output, err := captureStdoutFromRun(func() error {
		return runTopLevelRun([]string{"hello from cloud", "--provider", "gemini", "--model", "gemini-2.5-flash", "--json"})
	})
	if err != nil {
		t.Fatalf("runTopLevelRun cloud interactive: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal cloud output: %v output=%q", unmarshalErr, output)
	}
	if got := asString(payload["text"]); got != "hello cloud" {
		t.Fatalf("cloud text mismatch: %q", got)
	}

	fileCfg, err := config.LoadFileConfig(config.RuntimeConfigPath())
	if err != nil {
		t.Fatalf("load saved provider config: %v", err)
	}
	if got := fileCfg.Providers["gemini"].APIKey; got != "gemini-inline-key" {
		t.Fatalf("saved provider api key mismatch: %q", got)
	}
	md := service.lastStreamMetadata()
	if got := firstMD(md, "x-nimi-key-source"); got != "inline" {
		t.Fatalf("key source metadata mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-provider-type"); got != "gemini" {
		t.Fatalf("provider type metadata mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-provider-api-key"); got != "gemini-inline-key" {
		t.Fatalf("provider api key metadata mismatch: %q", got)
	}
	if req := service.lastStreamRequest(); req.GetHead().GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		t.Fatalf("stream route mismatch: %#v", req.GetHead())
	}
	if req := service.lastStreamRequest(); req.GetHead().GetModelId() != "gemini/gemini-2.5-flash" {
		t.Fatalf("stream model mismatch: %#v", req.GetHead())
	}
}

func TestRunTopLevelRunCloudNonInteractiveCredentialHint(t *testing.T) {
	service := &cmdTestOnboardingService{
		listResponse: &runtimev1.ListModelsResponse{},
	}
	addr, shutdown := startCmdTestOnboardingServer(t, service)
	defer shutdown()
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", addr)

	restoreInteractive := onboardingInteractiveTerminal
	onboardingInteractiveTerminal = func() bool { return false }
	defer func() {
		onboardingInteractiveTerminal = restoreInteractive
	}()

	err := runTopLevelRun([]string{"hello from cloud", "--provider", "openai", "--model", "gpt-4o-mini"})
	if err == nil {
		t.Fatalf("expected cloud credential error")
	}
	if !strings.Contains(err.Error(), "nimi provider set openai --api-key ...") {
		t.Fatalf("unexpected cloud credential error: %v", err)
	}
}

func TestRunTopLevelRunCloudUsesDefaultProvider(t *testing.T) {
	service := &cmdTestOnboardingService{
		listResponse: &runtimev1.ListModelsResponse{},
		streamEvents: []*runtimev1.StreamScenarioEvent{
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				TraceId:   "trace-cloud-default",
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "openai/gpt-4o-mini",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
					},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{Text: "default cloud"},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				TraceId:   "trace-cloud-default",
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP},
				},
			},
		},
	}
	addr, shutdown := startCmdTestOnboardingServer(t, service)
	defer shutdown()
	homeDir := t.TempDir()
	configPath := filepath.Join(homeDir, ".nimi", "config.json")
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", addr)
	if err := config.WriteFileConfig(configPath, config.FileConfig{
		SchemaVersion:        config.DefaultSchemaVersion,
		DefaultCloudProvider: "openai",
		Providers: map[string]config.RuntimeFileTarget{
			"openai": {
				APIKey: "openai-inline-key",
			},
		},
	}); err != nil {
		t.Fatalf("write runtime config: %v", err)
	}

	output, err := captureStdoutFromRun(func() error {
		return runTopLevelRun([]string{"hello from cloud", "--cloud", "--json"})
	})
	if err != nil {
		t.Fatalf("runTopLevelRun --cloud: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal cloud default output: %v output=%q", unmarshalErr, output)
	}
	if got := asString(payload["text"]); got != "default cloud" {
		t.Fatalf("cloud default text mismatch: %q", got)
	}
	if req := service.lastStreamRequest(); req.GetHead().GetModelId() != "cloud/default" {
		t.Fatalf("default cloud model mismatch: %#v", req.GetHead())
	}
	md := service.lastStreamMetadata()
	if got := firstMD(md, "x-nimi-provider-type"); got != "openai" {
		t.Fatalf("default cloud provider metadata mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-provider-api-key"); got != "openai-inline-key" {
		t.Fatalf("default cloud api key metadata mismatch: %q", got)
	}
}

func TestRunTopLevelRunBarePromptUsesLocalDefault(t *testing.T) {
	target, err := resolveOnboardingRunTarget(config.Config{}, "hello", "", "", false, false)
	if err != nil {
		t.Fatalf("resolveOnboardingRunTarget: %v", err)
	}
	if target.ModelID != "local/qwen2.5" {
		t.Fatalf("bare run should use bundled local default: %#v", target)
	}
}

func TestRunTopLevelRunRejectsPrefixedProviderModel(t *testing.T) {
	err := runTopLevelRun([]string{"hello", "--provider", "gemini", "--model", "openai/gpt-5.2"})
	if err == nil {
		t.Fatalf("expected ambiguous model/provider error")
	}
	if !strings.Contains(err.Error(), "provider-scoped model id") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunTopLevelRunCloudRequiresDefaultProvider(t *testing.T) {
	err := runTopLevelRun([]string{"hello from cloud", "--cloud"})
	if err == nil {
		t.Fatalf("expected default cloud provider error")
	}
	if !strings.Contains(err.Error(), "default cloud target is not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunRuntimeProviderSetDefaultRequiresModelWithoutCatalogDefault(t *testing.T) {
	homeDir := t.TempDir()
	configPath := filepath.Join(homeDir, ".nimi", "config.json")
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	err := runRuntimeProvider([]string{"set", "anthropic", "--api-key", "anthropic-inline-key", "--default"})
	if err == nil {
		t.Fatalf("expected provider default-model validation error")
	}
	if !strings.Contains(err.Error(), "has no catalog default text model") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunTopLevelRunRuntimeUnavailable(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:1")

	err := runTopLevelRun([]string{"hello"})
	if err == nil {
		t.Fatalf("expected runtime unavailable error")
	}
	if !strings.Contains(err.Error(), "Run 'nimi start' for background mode, or 'nimi serve' in another terminal.") {
		t.Fatalf("unexpected runtime unavailable error: %v", err)
	}
}

func TestRunTopLevelRunRejectsCloudModelWithoutProvider(t *testing.T) {
	err := runTopLevelRun([]string{"hello", "--cloud", "--model", "gemini-2.5-pro"})
	if err == nil {
		t.Fatalf("expected --cloud --model validation error")
	}
	if !strings.Contains(err.Error(), "Use --provider <provider> --model <model>") {
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
