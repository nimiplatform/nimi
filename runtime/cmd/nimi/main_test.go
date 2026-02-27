package main

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestExtractProviders(t *testing.T) {
	payload := map[string]any{
		"ai_providers": []any{
			map[string]any{
				"name":                 "cloud-alibaba",
				"state":                "unhealthy",
				"reason":               "timeout",
				"consecutive_failures": float64(2),
				"last_changed_at":      "2026-02-24T12:00:00Z",
				"last_checked_at":      "2026-02-24T12:00:01Z",
			},
			map[string]any{
				"name":                 "cloud-nimillm",
				"state":                "healthy",
				"reason":               "",
				"consecutive_failures": float64(0),
				"last_changed_at":      "2026-02-24T12:00:00Z",
				"last_checked_at":      "2026-02-24T12:00:02Z",
			},
		},
	}

	providers := extractProviders(payload)
	if len(providers) != 2 {
		t.Fatalf("providers count mismatch: got=%d want=2", len(providers))
	}
	if providers[0].Name != "cloud-alibaba" {
		t.Fatalf("provider 0 name mismatch: %s", providers[0].Name)
	}
	if providers[0].ConsecutiveFailures != 2 {
		t.Fatalf("provider 0 failures mismatch: %d", providers[0].ConsecutiveFailures)
	}
	if providers[1].State != "healthy" {
		t.Fatalf("provider 1 state mismatch: %s", providers[1].State)
	}
}

func TestProvidersSignatureIgnoresTimestamps(t *testing.T) {
	first := []providerSnapshot{
		{
			Name:                "cloud-nimillm",
			State:               "healthy",
			Reason:              "",
			ConsecutiveFailures: 0,
			LastChangedAt:       "2026-02-24T12:00:00Z",
			LastCheckedAt:       "2026-02-24T12:00:01Z",
		},
	}
	second := []providerSnapshot{
		{
			Name:                "cloud-nimillm",
			State:               "healthy",
			Reason:              "",
			ConsecutiveFailures: 0,
			LastChangedAt:       "2026-02-24T12:00:00Z",
			LastCheckedAt:       "2026-02-24T12:00:09Z",
		},
	}

	left := providersSignature(first)
	right := providersSignature(second)
	if left != right {
		t.Fatalf("signature should ignore timestamps: left=%q right=%q", left, right)
	}
}

func TestFetchProviderSnapshotsInvalidSource(t *testing.T) {
	_, _, err := fetchProviderSnapshots("unknown", "127.0.0.1:1", "127.0.0.1:2", 2000000000)
	if err == nil {
		t.Fatalf("expected invalid source error")
	}
	if !strings.Contains(err.Error(), "expected http|grpc") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProvidersSignatureAndDiffIgnoresTimestamps(t *testing.T) {
	previous := []providerSnapshot{
		{
			Name:                "cloud-nimillm",
			State:               "healthy",
			Reason:              "",
			ConsecutiveFailures: 0,
			LastChangedAt:       "2026-02-24T12:00:00Z",
			LastCheckedAt:       "2026-02-24T12:00:01Z",
		},
	}
	current := []providerSnapshot{
		{
			Name:                "cloud-nimillm",
			State:               "healthy",
			Reason:              "",
			ConsecutiveFailures: 0,
			LastChangedAt:       "2026-02-24T12:00:00Z",
			LastCheckedAt:       "2026-02-24T12:00:09Z",
		},
	}

	if providersSignature(previous) != providersSignature(current) {
		t.Fatalf("signature should ignore timestamps")
	}
	changes := buildProviderDiff(previous, current)
	if len(changes) != 0 {
		t.Fatalf("diff should ignore timestamps, got=%d", len(changes))
	}
}

func TestBuildProviderDiff(t *testing.T) {
	previous := []providerSnapshot{
		{
			Name:                "cloud-alibaba",
			State:               "healthy",
			Reason:              "",
			ConsecutiveFailures: 0,
		},
		{
			Name:                "cloud-nimillm",
			State:               "healthy",
			Reason:              "",
			ConsecutiveFailures: 0,
		},
	}
	current := []providerSnapshot{
		{
			Name:                "cloud-alibaba",
			State:               "unhealthy",
			Reason:              "timeout",
			ConsecutiveFailures: 2,
		},
		{
			Name:                "cloud-bytedance",
			State:               "healthy",
			Reason:              "",
			ConsecutiveFailures: 0,
		},
	}

	changes := buildProviderDiff(previous, current)
	if len(changes) != 3 {
		t.Fatalf("changes count mismatch: got=%d want=3", len(changes))
	}
	if changes[0].Name != "cloud-alibaba" || changes[0].Type != "updated" {
		t.Fatalf("first change mismatch: %#v", changes[0])
	}
	if changes[1].Name != "cloud-bytedance" || changes[1].Type != "added" {
		t.Fatalf("second change mismatch: %#v", changes[1])
	}
	if changes[2].Name != "cloud-nimillm" || changes[2].Type != "removed" {
		t.Fatalf("third change mismatch: %#v", changes[2])
	}
}

func TestExtractRuntimeHealthSnapshot(t *testing.T) {
	payload := map[string]any{
		"status":                "RUNTIME_HEALTH_STATUS_READY",
		"status_code":           float64(3),
		"reason":                "ready",
		"queue_depth":           float64(2),
		"active_workflows":      float64(1),
		"active_inference_jobs": float64(4),
		"cpu_milli":             float64(100),
		"memory_bytes":          float64(2048),
		"vram_bytes":            float64(4096),
		"sampled_at":            "2026-02-24T12:00:00Z",
	}

	snapshot := extractRuntimeHealthSnapshot(payload)
	if snapshot.Status != "RUNTIME_HEALTH_STATUS_READY" {
		t.Fatalf("status mismatch: %s", snapshot.Status)
	}
	if snapshot.StatusCode != 3 {
		t.Fatalf("status code mismatch: %d", snapshot.StatusCode)
	}
	if snapshot.ActiveInferenceJobs != 4 {
		t.Fatalf("active inference mismatch: %d", snapshot.ActiveInferenceJobs)
	}
	if snapshot.SampledAt == "" {
		t.Fatalf("sampled_at must be set")
	}
}

func TestRuntimeHealthSignatureIgnoresSampledAt(t *testing.T) {
	first := runtimeHealthSnapshot{
		Status:              "RUNTIME_HEALTH_STATUS_READY",
		StatusCode:          3,
		Reason:              "ready",
		QueueDepth:          1,
		ActiveWorkflows:     2,
		ActiveInferenceJobs: 3,
		CPUMilli:            100,
		MemoryBytes:         200,
		VRAMBytes:           300,
		SampledAt:           "2026-02-24T12:00:00Z",
	}
	second := first
	second.SampledAt = "2026-02-24T12:00:01Z"

	if runtimeHealthSignature(first) != runtimeHealthSignature(second) {
		t.Fatalf("runtime health signature should ignore sampled_at")
	}
}

func TestBuildRuntimeHealthChanges(t *testing.T) {
	before := runtimeHealthSnapshot{
		Status:              "RUNTIME_HEALTH_STATUS_READY",
		StatusCode:          3,
		Reason:              "ready",
		QueueDepth:          1,
		ActiveWorkflows:     1,
		ActiveInferenceJobs: 2,
		CPUMilli:            100,
		MemoryBytes:         200,
		VRAMBytes:           300,
	}
	after := before
	after.Status = "RUNTIME_HEALTH_STATUS_DEGRADED"
	after.StatusCode = 4
	after.Reason = "provider unavailable"
	after.ActiveInferenceJobs = 0

	changes := buildRuntimeHealthChanges(before, after)
	if len(changes) != 4 {
		t.Fatalf("runtime health changes mismatch: got=%d want=4", len(changes))
	}
	if changes[0].Field != "status" {
		t.Fatalf("first field mismatch: %s", changes[0].Field)
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

func TestParseRoutePolicy(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    runtimev1.RoutePolicy
		wantErr bool
	}{
		{name: "local", input: "local", want: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME},
		{name: "cloud", input: "cloud", want: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API},
		{name: "token-api", input: "token-api", want: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API},
		{name: "invalid", input: "unknown", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseRoutePolicy(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("route mismatch: got=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestParseFallbackPolicy(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    runtimev1.FallbackPolicy
		wantErr bool
	}{
		{name: "deny", input: "deny", want: runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY},
		{name: "allow", input: "allow", want: runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW},
		{name: "invalid", input: "maybe", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseFallbackPolicy(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("fallback mismatch: got=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestStreamEventJSONDelta(t *testing.T) {
	event := &runtimev1.StreamGenerateEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
		Sequence:  2,
		TraceId:   "trace-1",
		Payload: &runtimev1.StreamGenerateEvent_Delta{
			Delta: &runtimev1.StreamDelta{Text: "hello"},
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

func TestDefaultRuntimeAIArtifactTimeoutMs(t *testing.T) {
	if got := defaultRuntimeAIArtifactTimeoutMs(runtimeAIArtifactModeImage); got != 120000 {
		t.Fatalf("image timeout ms mismatch: %d", got)
	}
	if got := defaultRuntimeAIArtifactTimeoutMs(runtimeAIArtifactModeVideo); got != 300000 {
		t.Fatalf("video timeout ms mismatch: %d", got)
	}
	if got := defaultRuntimeAIArtifactTimeoutMs(runtimeAIArtifactModeTTS); got != 45000 {
		t.Fatalf("tts timeout ms mismatch: %d", got)
	}
}

func TestDefaultRuntimeAIArtifactModel(t *testing.T) {
	if got := defaultRuntimeAIArtifactModel(runtimeAIArtifactModeImage); got != "local/sd3" {
		t.Fatalf("image model mismatch: %s", got)
	}
	if got := defaultRuntimeAIArtifactModel(runtimeAIArtifactModeVideo); got != "local/video-default" {
		t.Fatalf("video model mismatch: %s", got)
	}
	if got := defaultRuntimeAIArtifactModel(runtimeAIArtifactModeTTS); got != "local/tts-default" {
		t.Fatalf("tts model mismatch: %s", got)
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
