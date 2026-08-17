package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/daemonctl"
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

func TestRunRuntimeDoctorJSON(t *testing.T) {
	homeDir := t.TempDir()
	configPath := filepath.Join(homeDir, ".nimi", "config.json")
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)

	if err := config.WriteFileConfig(configPath, config.FileConfig{
		SchemaVersion: config.DefaultSchemaVersion,
	}); err != nil {
		t.Fatalf("write runtime config: %v", err)
	}

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

	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{status: daemonctl.Status{
			Mode:            daemonctl.ModeBackground,
			Process:         "running",
			PID:             42,
			HealthReachable: true,
			HealthSummary:   "RUNTIME_HEALTH_STATUS_DEGRADED (engine:llama unhealthy (stderr: secret internal detail))",
			ConfigPath:      configPath,
			LogPath:         filepath.Join(homeDir, ".nimi", "logs", "runtime.log"),
		}}
	}
	defer func() { daemonManagerFactory = previousFactory }()
	output, err := captureStdoutFromRun(func() error {
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
	assertDoctorItem(t, items, "daemon", "ok")
	assertDoctorItem(t, items, "runtime mode", "ok")
	assertDoctorItem(t, items, "sdk", "ok")
	for _, secret := range []string{"engine:llama", "stderr", "secret internal detail"} {
		if strings.Contains(strings.ToLower(output), strings.ToLower(secret)) {
			t.Fatalf("doctor exposed private Runtime health detail %q: %s", secret, output)
		}
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := strings.ToLower(asString(item["name"]))
		for _, protectedFact := range []string{"model", "loadout", "connector", "provider", "execution host", "executionhost"} {
			if strings.Contains(name, protectedFact) {
				t.Fatalf("doctor must not expose protected product fact %q: %#v", protectedFact, item)
			}
		}
	}
}

func TestRunRuntimeDoctorPlainTextShowsNextStepWhenRuntimeUnavailable(t *testing.T) {
	homeDir := t.TempDir()
	setCmdTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", cmdTestPortableConfigPath(homeDir))
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:1")

	statusCalls := 0
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		statusCalls++
		return stubDaemonManager{status: daemonctl.Status{Mode: daemonctl.ModeStopped, Process: "stopped"}}
	}
	defer func() {
		daemonManagerFactory = previousFactory
	}()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeDoctor(nil)
	})
	var exitErr cliExitError
	if !errors.As(err, &exitErr) || exitErr.ExitCode() != 1 {
		t.Fatalf("runRuntimeDoctor error = %v, want exit code 1", err)
	}
	if !strings.Contains(output, "Nimi Doctor") {
		t.Fatalf("missing doctor header: %q", output)
	}
	if !strings.Contains(output, "\nNext\n\n  nimi start") {
		t.Fatalf("missing next-step runtime hint: %q", output)
	}
	if strings.Count(output, "nimi start") != 1 || strings.Contains(output, "nimi serve") {
		t.Fatalf("doctor must emit exactly one executable next-step hint: %q", output)
	}
	if statusCalls != 1 {
		t.Fatalf("doctor status provider calls = %d, want 1", statusCalls)
	}
}

func TestRunRuntimeDoctorJSONReturnsStoppedExitCodeAfterOutput(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{status: daemonctl.Status{Mode: daemonctl.ModeStopped, Process: "stopped"}}
	}
	defer func() { daemonManagerFactory = previousFactory }()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeDoctor([]string{"--json"})
	})
	var exitErr cliExitError
	if !errors.As(err, &exitErr) || exitErr.ExitCode() != 1 {
		t.Fatalf("runRuntimeDoctor error = %v, want exit code 1", err)
	}
	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal doctor output: %v output=%q", unmarshalErr, output)
	}
	items, ok := payload["items"].([]any)
	if !ok {
		t.Fatalf("doctor items payload mismatch: %#v", payload["items"])
	}
	assertDoctorItem(t, items, "daemon", "warn")
	if got := asString(payload["nextStep"]); got != "nimi start" {
		t.Fatalf("doctor nextStep = %q, want nimi start: %#v", got, payload)
	}
	if strings.Count(output, "nimi start") != 1 || strings.Contains(output, "nimi serve") {
		t.Fatalf("doctor JSON must emit exactly one executable next-step hint: %q", output)
	}
}

func TestRunRuntimeDoctorJSONReturnsUnreachableExitCodeAfterOutput(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{status: daemonctl.Status{
			Mode:            daemonctl.ModeBackground,
			Process:         "running",
			HealthReachable: false,
		}}
	}
	defer func() { daemonManagerFactory = previousFactory }()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeDoctor([]string{"--json"})
	})
	var exitErr cliExitError
	if !errors.As(err, &exitErr) || exitErr.ExitCode() != 2 {
		t.Fatalf("runRuntimeDoctor error = %v, want exit code 2", err)
	}
	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal doctor output: %v output=%q", unmarshalErr, output)
	}
	items, ok := payload["items"].([]any)
	if !ok {
		t.Fatalf("doctor items payload mismatch: %#v", payload["items"])
	}
	assertDoctorItem(t, items, "daemon", "warn")
	if got := asString(payload["nextStep"]); got != "nimi logs -f" {
		t.Fatalf("doctor nextStep = %q, want nimi logs -f: %#v", got, payload)
	}
	for _, wrongStep := range []string{"nimi start", "nimi serve"} {
		if strings.Contains(output, wrongStep) {
			t.Fatalf("doctor JSON emitted incorrect next-step %q: %q", wrongStep, output)
		}
	}
}

func TestRunRuntimeDoctorPlainTextShowsSingleNextStepWhenRuntimeUnreachable(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{status: daemonctl.Status{
			Mode:            daemonctl.ModeBackground,
			Process:         "running",
			HealthReachable: false,
		}}
	}
	defer func() { daemonManagerFactory = previousFactory }()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeDoctor(nil)
	})
	var exitErr cliExitError
	if !errors.As(err, &exitErr) || exitErr.ExitCode() != 2 {
		t.Fatalf("runRuntimeDoctor error = %v, want exit code 2", err)
	}
	if !strings.Contains(output, "\nNext\n\n  nimi logs -f") || strings.Count(output, "nimi logs -f") != 1 {
		t.Fatalf("doctor must emit one unreachable next-step hint: %q", output)
	}
	for _, wrongStep := range []string{"nimi start", "nimi serve"} {
		if strings.Contains(output, wrongStep) {
			t.Fatalf("doctor emitted incorrect next-step %q: %q", wrongStep, output)
		}
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
