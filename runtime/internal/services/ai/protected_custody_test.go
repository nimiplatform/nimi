package ai

import (
	"io"
	"log/slog"
	"testing"

	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
)

func TestNewProtectedIgnoresPortableProviderCredentials(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:18080/v1")
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_API_KEY", "portable-local-secret")
	t.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL", "https://portable-env.example/v1")
	t.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_API_KEY", "portable-env-secret")

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	svc, err := NewProtected(logger, nil, nil, nil, connectorStore, runtimecfg.Config{
		LocalStatePath:                t.TempDir() + "/runtime/local-state.json",
		AllowLoopbackProviderEndpoint: true,
		Providers: map[string]runtimecfg.RuntimeFileTarget{
			"gemini": {
				BaseURL:   "https://portable-config.example/v1",
				APIKey:    "portable-config-secret",
				APIKeyEnv: "PORTABLE_CONFIG_SECRET_ENV",
			},
		},
	})
	if err != nil {
		t.Fatalf("NewProtected: %v", err)
	}
	if svc.connStore != connectorStore {
		t.Fatal("protected service must retain the Runtime-owned connector resolver")
	}
	if len(svc.config.CloudProviders) != 0 {
		t.Fatalf("protected service loaded portable cloud provider credentials: %#v", svc.config.CloudProviders)
	}
	if svc.allowLoopback {
		t.Fatal("protected service admitted portable loopback endpoint policy")
	}
}

func TestNewProtectedRequiresRuntimeOwnedConnectorResolver(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	_, err := NewProtected(logger, nil, nil, nil, nil, runtimecfg.Config{
		LocalStatePath: t.TempDir() + "/runtime/local-state.json",
	})
	if err == nil {
		t.Fatal("protected service must reject a missing Runtime-owned connector resolver")
	}
}
