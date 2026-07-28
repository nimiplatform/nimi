package entrypoint

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setEntrypointTestHome(t *testing.T, homeDir string) {
	t.Helper()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)

	volume := filepath.VolumeName(homeDir)
	if volume == "" {
		volume = "C:"
	}
	homePath := strings.TrimPrefix(homeDir, volume)
	if homePath == "" {
		homePath = string(os.PathSeparator)
	}

	t.Setenv("HOMEDRIVE", volume)
	t.Setenv("HOMEPATH", homePath)
}

func TestAcquireRuntimeInstanceLock(t *testing.T) {
	homeDir := t.TempDir()
	setEntrypointTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", "")

	unlock, err := acquireRuntimeInstanceLock()
	if err != nil {
		t.Fatalf("acquire first runtime lock: %v", err)
	}
	lockPath, err := runtimeInstanceLockPath()
	if err != nil {
		t.Fatalf("resolve runtime lock path: %v", err)
	}
	if _, statErr := os.Stat(lockPath); statErr != nil {
		t.Fatalf("runtime lock file should exist: %v", statErr)
	}

	if _, err := acquireRuntimeInstanceLock(); err == nil {
		t.Fatalf("expected second runtime lock acquire to fail")
	}

	unlock()
	if _, statErr := os.Stat(lockPath); !os.IsNotExist(statErr) {
		t.Fatalf("runtime lock file should be removed after unlock")
	}

	unlockAgain, err := acquireRuntimeInstanceLock()
	if err != nil {
		t.Fatalf("acquire runtime lock after unlock: %v", err)
	}
	unlockAgain()
}

func clearRuntimeConfigEnvForStartupTest(t *testing.T) {
	t.Helper()
	keys := []string{
		"NIMI_RUNTIME_GRPC_ADDR",
		"NIMI_RUNTIME_HTTP_ADDR",
		"NIMI_RUNTIME_SHUTDOWN_TIMEOUT",
		"NIMI_RUNTIME_LOCAL_STATE_PATH",
		"NIMI_RUNTIME_AI_HTTP_TIMEOUT",
		"NIMI_RUNTIME_AI_HEALTH_INTERVAL",
		"NIMI_RUNTIME_LOCAL_AI_BASE_URL",
		"NIMI_RUNTIME_LOCAL_AI_API_KEY",
		"NIMI_RUNTIME_LOCAL_NEXA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_NEXA_API_KEY",
		"NIMI_RUNTIME_LOCAL_NIMI_MEDIA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_NIMI_MEDIA_API_KEY",
		"NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENAI_API_KEY",
		"NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY",
		"NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY",
		"NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_GEMINI_API_KEY",
		"NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL",
		"NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY",
		"NIMI_RUNTIME_CLOUD_MIMO_BASE_URL",
		"NIMI_RUNTIME_CLOUD_MIMO_API_KEY",
		"NIMI_RUNTIME_CLOUD_KIMI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_KIMI_API_KEY",
		"NIMI_RUNTIME_CLOUD_GLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_GLM_API_KEY",
		"NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL",
		"NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_API_KEY",
	}
	for _, key := range keys {
		t.Setenv(key, "")
	}
}
