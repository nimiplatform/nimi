package engine

import (
	"context"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWhisperDiarizationActualManagedProfile(t *testing.T) {
	root := os.Getenv("NIMI_TEST_DIARIZATION_LIVE_ROOT")
	if root == "" {
		t.Skip("isolated live root not supplied")
	}
	if !filepath.IsAbs(root) {
		t.Fatal("live root must be absolute")
	}
	manager, err := NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), ManagedRoots{Environments: filepath.Join(root, "environments"), Dependencies: filepath.Join(root, "dependencies")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	manager.SetRuntimeWorkRoot(filepath.Join(root, "work"))
	defer manager.StopAll(context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	uv, err := manager.EnsureUVToolDependency(ctx)
	if err != nil {
		t.Fatal(err)
	}
	python, err := manager.EnsurePythonRuntimeDependency(ctx, uv.ExecutablePath, "python", ManagedPythonVersion, ManagedPythonVersion)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := manager.EnsurePythonDependencyProfile(ctx, uv.ExecutablePath, python.InterpreterPath, capabilitydriver.WhisperDiarizationConsumerID, "windows/amd64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPythonDependencyProfileStaticContent(profile.ProfileRoot, capabilitydriver.WhisperDiarizationConsumerID, profile.Identity); err != nil {
		t.Fatal(err)
	}
	t.Logf("actual managed CPU diarization profile=%s", profile.ProfileRoot)
}
