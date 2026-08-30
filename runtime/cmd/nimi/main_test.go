package main

import (
	"bytes"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/daemonctl"
)

func TestRunServeRejectsDirectUserDaemonLaunch(t *testing.T) {
	err := runServe([]string{"--grpc-addr=127.0.0.1:59998"})
	if err == nil {
		t.Fatal("direct user daemon launch unexpectedly succeeded")
	}
	if !strings.Contains(err.Error(), "PROTECTED_LOCAL_RUNTIME_PRINCIPAL_REQUIRED") {
		t.Fatalf("direct user daemon launch error = %v", err)
	}
}

func TestReadAllBoundedRejectsOversizePayload(t *testing.T) {
	_, err := readAllBounded(bytes.NewBufferString("abcdef"), 4, "payload")
	if err == nil {
		t.Fatal("expected size limit error")
	}
	if !strings.Contains(err.Error(), "payload exceeds 4 bytes") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProjectPublicDaemonHealthRedactsPrivateDetail(t *testing.T) {
	projection := projectPublicDaemonHealth(daemonctl.Status{
		Mode:            daemonctl.ModeBackground,
		Process:         "running",
		GRPCAddr:        "127.0.0.1:46371",
		ConfigPath:      `C:\private\runtime.json`,
		HealthReachable: true,
		HealthSummary:   "RUNTIME_HEALTH_STATUS_DEGRADED (engine:llama stderr: private detail)",
		HealthError:     "dial private endpoint failed",
		Version:         "0.5.0",
	})
	if projection.Health != publicDaemonHealthReachable {
		t.Fatalf("public health mismatch: %#v", projection)
	}
	serialized := strings.Join([]string{projection.Mode, projection.Process, projection.Health, projection.Version}, "|")
	for _, privateDetail := range []string{"engine:llama", "stderr", "private detail", "46371", "runtime.json"} {
		if strings.Contains(serialized, privateDetail) {
			t.Fatalf("public health exposed private detail %q: %#v", privateDetail, projection)
		}
	}

	protected := projectPublicDaemonHealth(daemonctl.Status{Mode: daemonctl.ModeProtectedService, Process: "running", HealthReachable: true})
	if protected.Health != publicDaemonHealthServiceRunning {
		t.Fatalf("protected service health mismatch: %#v", protected)
	}
}

func TestRunRuntimeHealthUsesDaemonManagerProjection(t *testing.T) {
	previousFactory := daemonManagerFactory
	daemonManagerFactory = func() daemonManager {
		return stubDaemonManager{status: daemonctl.Status{
			Mode:            daemonctl.ModeBackground,
			Process:         "running",
			HealthReachable: true,
			HealthSummary:   "engine:qwen unhealthy (stderr: private detail)",
		}}
	}
	defer func() { daemonManagerFactory = previousFactory }()

	output, err := captureStdoutFromRun(func() error { return runRuntimeHealth([]string{"--json"}) })
	if err != nil {
		t.Fatalf("runRuntimeHealth: %v", err)
	}
	if !strings.Contains(output, `"health": "reachable"`) {
		t.Fatalf("missing sanitized health: %s", output)
	}
	for _, privateDetail := range []string{"engine:qwen", "stderr", "private detail", "healthSummary"} {
		if strings.Contains(output, privateDetail) {
			t.Fatalf("health command exposed private detail %q: %s", privateDetail, output)
		}
	}

	if err := runRuntimeHealth([]string{"--source", "grpc"}); err == nil || !strings.Contains(err.Error(), "flag provided but not defined") {
		t.Fatalf("retired direct transport flag was not rejected: %v", err)
	}
}

func TestNormalizeRootArgsStripsLeadingDoubleDash(t *testing.T) {
	input := []string{"nimi", "--", "config", "init", "--json"}
	got := normalizeRootArgs(input)
	want := []string{"nimi", "config", "init", "--json"}
	if len(got) != len(want) {
		t.Fatalf("normalized args length mismatch: got=%d want=%d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalized arg[%d] mismatch: got=%q want=%q", i, got[i], want[i])
		}
	}
}

func TestNormalizeRootArgsLeavesRegularArgsUntouched(t *testing.T) {
	input := []string{"nimi", "config", "init", "--json"}
	got := normalizeRootArgs(input)
	if len(got) != len(input) {
		t.Fatalf("args length mismatch: got=%d want=%d", len(got), len(input))
	}
	for i := range input {
		if got[i] != input[i] {
			t.Fatalf("arg[%d] mismatch: got=%q want=%q", i, got[i], input[i])
		}
	}
}

func TestNormalizeRootArgsStripsAllLeadingDoubleDashMarkers(t *testing.T) {
	input := []string{"nimi", "--", "--", "config", "init"}
	got := normalizeRootArgs(input)
	want := []string{"nimi", "config", "init"}
	if len(got) != len(want) {
		t.Fatalf("normalized args length mismatch: got=%d want=%d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalized arg[%d] mismatch: got=%q want=%q", i, got[i], want[i])
		}
	}
}

func TestStreamEventJSONDelta(t *testing.T) {
	event := &runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
		Sequence:  2,
		TraceId:   "trace-1",
		Payload: &runtimev1.StreamScenarioEvent_Delta{
			Delta: testTextStreamDelta("hello"),
		},
	}

	payload := streamEventJSON(event)
	if payload["event_type"] != runtimev1.StreamEventType_STREAM_EVENT_DELTA.String() {
		t.Fatalf("event type mismatch: %v", payload["event_type"])
	}
	delta, ok := payload["delta"].(map[string]any)
	if !ok {
		t.Fatalf("delta payload missing")
	}
	if delta["text"] != "hello" {
		t.Fatalf("delta text mismatch: %v", delta["text"])
	}
}

func testTextStreamDelta(text string) *runtimev1.ScenarioStreamDelta {
	return &runtimev1.ScenarioStreamDelta{
		Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{
			TextOutputItem: &runtimev1.TextOutputItemDelta{
				ItemIndex:     0,
				ItemCompleted: true,
				Delta: &runtimev1.TextOutputItemDelta_Text{
					Text: &runtimev1.TextOutputTextDelta{Text: text},
				},
			},
		},
	}
}

func TestMultiStringFlagValues(t *testing.T) {
	var values multiStringFlag
	if err := values.Set(" first "); err != nil {
		t.Fatalf("set first: %v", err)
	}
	if err := values.Set("second"); err != nil {
		t.Fatalf("set second: %v", err)
	}
	got := values.Values()
	if len(got) != 2 {
		t.Fatalf("values length mismatch: got=%d want=2", len(got))
	}
	if got[0] != "first" || got[1] != "second" {
		t.Fatalf("values mismatch: %#v", got)
	}
}

func TestRuntimeAICallerMetadataFromFlags(t *testing.T) {
	meta := runtimeAICallerMetadataFromFlags(" third-party-app ", " app:demo ", " screen-1 ", " trace-123 ")
	if meta == nil {
		t.Fatalf("metadata must not be nil")
	}
	if meta.CallerKind != "third-party-app" {
		t.Fatalf("caller kind mismatch: %q", meta.CallerKind)
	}
	if meta.CallerID != "app:demo" {
		t.Fatalf("caller id mismatch: %q", meta.CallerID)
	}
	if meta.SurfaceID != "screen-1" {
		t.Fatalf("surface id mismatch: %q", meta.SurfaceID)
	}
	if meta.TraceID != "trace-123" {
		t.Fatalf("trace id mismatch: %q", meta.TraceID)
	}
}
