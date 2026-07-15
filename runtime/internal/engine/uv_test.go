package engine

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEnsureUVMissingReportsRuntimeManagedDependency(t *testing.T) {
	t.Setenv("PATH", "")
	_, err := ensureUV(context.Background(), t.TempDir())
	if err == nil {
		t.Fatal("expected missing uv error")
	}
	message := err.Error()
	if !strings.Contains(message, "python.tool.uv local environment dependency is not ready") {
		t.Fatalf("expected Runtime-managed dependency message, got %q", message)
	}
	for _, prohibited := range []string{"package manager", "PATH"} {
		if strings.Contains(message, prohibited) {
			t.Fatalf("missing uv message must not direct user-managed installation via %q: %q", prohibited, message)
		}
	}
}

func TestEnsureUVToolDependencySerializesSharedExecutableMaterialization(t *testing.T) {
	root := t.TempDir()
	manager, err := NewManager(slog.Default(), ManagedRoots{
		Environments: filepath.Join(root, "environments"),
		Dependencies: filepath.Join(root, "dependencies"),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	spec, ok := managedUVArchiveSpecForCurrentHost()
	if !ok {
		t.Skip("current host has no managed uv archive spec")
	}
	uvRoot := filepath.Join(manager.depsDir, "uv")
	if err := os.MkdirAll(uvRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(managedUVPath(uvRoot), []byte("verified test uv"), 0o755); err != nil {
		t.Fatal(err)
	}

	manager.uvToolMu.Lock()
	locked := true
	defer func() {
		if locked {
			manager.uvToolMu.Unlock()
		}
	}()
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		_, ensureErr := manager.EnsureUVToolDependency(context.Background())
		done <- ensureErr
	}()
	<-started
	select {
	case ensureErr := <-done:
		t.Fatalf("shared uv verification bypassed materialization lock: %v", ensureErr)
	case <-time.After(50 * time.Millisecond):
	}
	manager.uvToolMu.Unlock()
	locked = false
	select {
	case ensureErr := <-done:
		if ensureErr != nil {
			t.Fatalf("verified uv dependency failed after lock release: %v", ensureErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shared uv verification did not resume after materialization lock release")
	}
	if _, ok := verifiedManagedUVToolStatus(uvRoot, spec); !ok {
		t.Fatal("verified uv payload was replaced while another consumer held materialization ownership")
	}
}

func TestManagedUVArchiveSpecPinsOfficialWindowsX64Hash(t *testing.T) {
	spec, ok := managedUVArchiveSpecForCurrentHost()
	if !ok {
		t.Skip("current host has no managed uv archive spec")
	}
	if spec.OS == "windows" && spec.Arch == "amd64" {
		if spec.ArchiveName != "uv-x86_64-pc-windows-msvc.zip" {
			t.Fatalf("archive name = %q, want x64 Windows uv archive", spec.ArchiveName)
		}
		if spec.SHA256 != "c84629a56e0706b69a47ea35862208af827cb6fbfa1d0ca763c52c67594637e8" {
			t.Fatalf("sha256 = %q, want pinned uv 0.11.8 Windows x64 archive hash", spec.SHA256)
		}
	}
	if !strings.Contains(managedUVArchiveURL(spec), "/0.11.8/") {
		t.Fatalf("archive URL must include pinned uv version, got %q", managedUVArchiveURL(spec))
	}
}
