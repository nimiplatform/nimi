package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSpeechCommandEnvIncludesDriverConfiguration(t *testing.T) {
	modelsRoot := filepath.Join(t.TempDir(), "models")
	t.Setenv("NIMI_RUNTIME_LOCAL_MODELS_PATH", modelsRoot)
	t.Setenv("NIMI_RUNTIME_SPEECH_KOKORO_CMD", "python3 /tmp/kokoro_driver.py")
	t.Setenv("NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD", "python3 /tmp/whisper_driver.py")
	t.Setenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS", "45000")

	env := speechCommandEnv()

	if got := env["PYTHONUNBUFFERED"]; got != "1" {
		t.Fatalf("PYTHONUNBUFFERED = %q", got)
	}
	if got := env["NIMI_RUNTIME_LOCAL_MODELS_PATH"]; got != modelsRoot {
		t.Fatalf("NIMI_RUNTIME_LOCAL_MODELS_PATH = %q, want %q", got, modelsRoot)
	}
	if got := env["NIMI_RUNTIME_SPEECH_KOKORO_CMD"]; got != "python3 /tmp/kokoro_driver.py" {
		t.Fatalf("NIMI_RUNTIME_SPEECH_KOKORO_CMD = %q", got)
	}
	if got := env["NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD"]; got != "python3 /tmp/whisper_driver.py" {
		t.Fatalf("NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD = %q", got)
	}
	if got := env["NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"]; got != "45000" {
		t.Fatalf("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS = %q", got)
	}
}

func TestSpeechCommandEnvFallsBackToDefaultModelsRoot(t *testing.T) {
	originalValue, hadOriginal := os.LookupEnv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
	originalTTS, hadTTS := os.LookupEnv("NIMI_RUNTIME_SPEECH_KOKORO_CMD")
	originalSTT, hadSTT := os.LookupEnv("NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD")
	originalTimeout, hadTimeout := os.LookupEnv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")
	t.Cleanup(func() {
		if hadOriginal {
			_ = os.Setenv("NIMI_RUNTIME_LOCAL_MODELS_PATH", originalValue)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
		}
		if hadTTS {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_KOKORO_CMD", originalTTS)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_KOKORO_CMD")
		}
		if hadSTT {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD", originalSTT)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD")
		}
		if hadTimeout {
			_ = os.Setenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS", originalTimeout)
		} else {
			_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")
		}
	})
	_ = os.Unsetenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_KOKORO_CMD")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD")
	_ = os.Unsetenv("NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS")

	env := speechCommandEnv()

	if got := env["PYTHONUNBUFFERED"]; got != "1" {
		t.Fatalf("PYTHONUNBUFFERED = %q", got)
	}
	if got := env["NIMI_RUNTIME_LOCAL_MODELS_PATH"]; got == "" {
		t.Fatal("expected default models root to be populated")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_KOKORO_CMD"]; ok {
		t.Fatal("unexpected kokoro driver when env is unset")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD"]; ok {
		t.Fatal("unexpected whispercpp driver when env is unset")
	}
	if _, ok := env["NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"]; ok {
		t.Fatal("unexpected speech driver timeout when env is unset")
	}
}
