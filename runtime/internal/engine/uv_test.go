package engine

import (
	"context"
	"strings"
	"testing"
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
