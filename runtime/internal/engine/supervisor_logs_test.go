package engine

import (
	"log/slog"
	"testing"
)

func TestClassifyLlamaProcessLogSuppressesMetadataNoise(t *testing.T) {
	record := classifyEngineProcessLog(EngineLlama, "stdout", "[52972] llama_model_loader: - kv   0: general.architecture str = qwen3", slog.LevelInfo)

	if record.level != slog.LevelDebug {
		t.Fatalf("level = %s, want DEBUG", record.level)
	}
	if record.event != "engine.llama.detail" {
		t.Fatalf("event = %q, want engine.llama.detail", record.event)
	}
	if record.line != "llama_model_loader: - kv   0: general.architecture str = qwen3" {
		t.Fatalf("line = %q", record.line)
	}
}

func TestClassifyLlamaProcessLogPromotesReadySignals(t *testing.T) {
	record := classifyEngineProcessLog(EngineLlama, "stdout", "[52972] main: server is listening on http://127.0.0.1:51068", slog.LevelInfo)

	if record.level != slog.LevelInfo {
		t.Fatalf("level = %s, want INFO", record.level)
	}
	if record.event != "engine.llama.endpoint_listening" {
		t.Fatalf("event = %q, want endpoint listening", record.event)
	}
	if record.phase != "ready" {
		t.Fatalf("phase = %q, want ready", record.phase)
	}
	if !recordAttrsContain(record.attrs, "endpoint", "http://127.0.0.1:51068") {
		t.Fatalf("attrs missing endpoint: %#v", record.attrs)
	}
}

func TestClassifyManagedImageBackendShellTraceIsDebugNoise(t *testing.T) {
	record := classifyEngineProcessLog(engineManagedImageBackend, "stderr", "+ export SD_LIBRARY=/tmp/libgosd-fallback.so", slog.LevelWarn)

	if record.level != slog.LevelDebug {
		t.Fatalf("level = %s, want DEBUG", record.level)
	}
	if record.event != "engine.managed_image.shell_trace" {
		t.Fatalf("event = %q, want shell trace", record.event)
	}
	if record.includeInStderrTail {
		t.Fatal("shell trace should not be retained in stderr tail")
	}
}

func TestClassifyProcessLogErrorRemainsWarn(t *testing.T) {
	record := classifyEngineProcessLog(engineManagedImageBackend, "stderr", "failed to bind 127.0.0.1:50052", slog.LevelWarn)

	if record.level != slog.LevelWarn {
		t.Fatalf("level = %s, want WARN", record.level)
	}
	if record.event != "engine.process.warning" {
		t.Fatalf("event = %q, want warning", record.event)
	}
	if !record.includeInStderrTail {
		t.Fatal("warning should be retained in stderr tail")
	}
}

func recordAttrsContain(attrs []any, key string, value any) bool {
	for i := 0; i+1 < len(attrs); i += 2 {
		if attrs[i] == key && attrs[i+1] == value {
			return true
		}
	}
	return false
}
