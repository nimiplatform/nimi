package engine

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSpeechCommandEnvIncludesDriverConfiguration(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", "python3 /tmp/qwen3_tts_driver.py")
	t.Setenv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", "python3 /tmp/qwen3_asr_driver.py")
	t.Setenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS", "45000")

	env := speechCommandEnv()

	if got := env["PYTHONUNBUFFERED"]; got != "1" {
		t.Fatalf("PYTHONUNBUFFERED = %q", got)
	}
	if _, ok := env["NIMI_RUNTIME_LOCAL_MODELS_PATH"]; ok {
		t.Fatal("speech env must not synthesize local model root")
	}
	if got := env["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"]; got != "python3 /tmp/qwen3_tts_driver.py" {
		t.Fatalf("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD = %q", got)
	}
	if got := env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"]; got != "python3 /tmp/qwen3_asr_driver.py" {
		t.Fatalf("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD = %q", got)
	}
	if got := env["NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"]; got != "45000" {
		t.Fatalf("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS = %q", got)
	}
}

func TestEnsureSpeechDoesNotMaterializeHiddenDependencies(t *testing.T) {
	baseDir := t.TempDir()
	_, err := ensureSpeech(context.Background(), baseDir, DefaultSpeechConfig())
	if err == nil {
		t.Fatal("expected speech startup to fail closed without selected sources")
	}
	if strings.Contains(err.Error(), "ensure uv") || strings.Contains(err.Error(), "install speech dependencies") {
		t.Fatalf("speech startup attempted hidden materialization: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(baseDir, "uv")); !os.IsNotExist(statErr) {
		t.Fatalf("speech startup created uv root or unexpected stat error: %v", statErr)
	}
}

func TestSpeechCommandEnvDoesNotFallbackToDefaultModelsRoot(t *testing.T) {
	originalValue, hadOriginal := os.LookupEnv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
	originalTTS, hadTTS := os.LookupEnv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD")
	originalSTT, hadSTT := os.LookupEnv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD")
	originalTimeout, hadTimeout := os.LookupEnv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")
	t.Cleanup(func() {
		if hadOriginal {
			_ = os.Setenv("NIMI_RUNTIME_LOCAL_MODELS_PATH", originalValue)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
		}
		if hadTTS {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", originalTTS)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD")
		}
		if hadSTT {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", originalSTT)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD")
		}
		if hadTimeout {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS", originalTimeout)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")
		}
	})
	_ = os.Unsetenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")

	env := speechCommandEnv()

	if got := env["PYTHONUNBUFFERED"]; got != "1" {
		t.Fatalf("PYTHONUNBUFFERED = %q", got)
	}
	if _, ok := env["NIMI_RUNTIME_LOCAL_MODELS_PATH"]; ok {
		t.Fatal("unexpected default models root")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"]; ok {
		t.Fatal("unexpected qwen3_tts driver when env is unset")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"]; ok {
		t.Fatal("unexpected qwen3_asr driver when env is unset")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"]; ok {
		t.Fatal("unexpected speech driver timeout when env is unset")
	}
}
