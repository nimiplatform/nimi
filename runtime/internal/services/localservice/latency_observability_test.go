package localservice

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestLocalServiceObservationsAreHiddenAtInfoLevel(t *testing.T) {
	var logs bytes.Buffer
	svc := &Service{
		logger: slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelInfo})),
	}

	svc.observeCounter("runtime_local_assets_health_probe_total", 1, "local_asset_id", "asset-info")
	svc.observeLatency("runtime.local_assets.health_probe_ms", time.Now().Add(-time.Millisecond), "local_asset_id", "asset-info")

	output := logs.String()
	if strings.Contains(output, "runtime counter observation") {
		t.Fatalf("info logger must suppress localservice counter observations, got logs:\n%s", output)
	}
	if strings.Contains(output, "runtime latency observation") {
		t.Fatalf("info logger must suppress localservice latency observations, got logs:\n%s", output)
	}
}

func TestLocalServiceObservationsAreVisibleAtDebugLevel(t *testing.T) {
	var logs bytes.Buffer
	svc := &Service{
		logger: slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	}

	svc.observeCounter("runtime_local_assets_health_probe_total", 1, "local_asset_id", "asset-debug")
	svc.observeLatency("runtime.local_assets.health_probe_ms", time.Now().Add(-time.Millisecond), "local_asset_id", "asset-debug")

	output := logs.String()
	for _, expected := range []string{
		"runtime counter observation",
		"runtime latency observation",
		"runtime_local_assets_health_probe_total",
		"runtime.local_assets.health_probe_ms",
		"local_asset_id=asset-debug",
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("debug logger must include %q, got logs:\n%s", expected, output)
		}
	}
}
