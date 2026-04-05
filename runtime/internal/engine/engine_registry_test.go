package engine

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func makeFakeArchiveAsset(t *testing.T, assetName string, binaryName string, binaryContents []byte) []byte {
	t.Helper()

	switch {
	case strings.HasSuffix(assetName, ".tar.gz"), strings.HasSuffix(assetName, ".tgz"):
		var buffer bytes.Buffer
		gzipWriter := gzip.NewWriter(&buffer)
		tarWriter := tar.NewWriter(gzipWriter)
		header := &tar.Header{
			Name: "bin/" + binaryName,
			Mode: 0o755,
			Size: int64(len(binaryContents)),
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			t.Fatalf("write tar header: %v", err)
		}
		if _, err := tarWriter.Write(binaryContents); err != nil {
			t.Fatalf("write tar contents: %v", err)
		}
		if err := tarWriter.Close(); err != nil {
			t.Fatalf("close tar writer: %v", err)
		}
		if err := gzipWriter.Close(); err != nil {
			t.Fatalf("close gzip writer: %v", err)
		}
		return buffer.Bytes()
	case strings.HasSuffix(assetName, ".zip"):
		var buffer bytes.Buffer
		zipWriter := zip.NewWriter(&buffer)
		entry, err := zipWriter.Create("bin/" + binaryName)
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := entry.Write(binaryContents); err != nil {
			t.Fatalf("write zip contents: %v", err)
		}
		if err := zipWriter.Close(); err != nil {
			t.Fatalf("close zip writer: %v", err)
		}
		return buffer.Bytes()
	default:
		return binaryContents
	}
}

func makeFakeArchiveAssetWithRuntimeFiles(t *testing.T, assetName string, binaryName string, binaryContents []byte) []byte {
	t.Helper()

	const archiveRoot = "llama-b8575"
	const dylibName = "libmtmd.0.0.8575.dylib"
	const dylibLink = "libmtmd.0.dylib"
	dylibContents := []byte("fake-dylib")

	switch {
	case strings.HasSuffix(assetName, ".tar.gz"), strings.HasSuffix(assetName, ".tgz"):
		var buffer bytes.Buffer
		gzipWriter := gzip.NewWriter(&buffer)
		tarWriter := tar.NewWriter(gzipWriter)

		writeHeader := func(header *tar.Header, content []byte) {
			t.Helper()
			if err := tarWriter.WriteHeader(header); err != nil {
				t.Fatalf("write tar header %s: %v", header.Name, err)
			}
			if len(content) == 0 {
				return
			}
			if _, err := tarWriter.Write(content); err != nil {
				t.Fatalf("write tar contents %s: %v", header.Name, err)
			}
		}

		writeHeader(&tar.Header{
			Name: archiveRoot + "/" + binaryName,
			Mode: 0o755,
			Size: int64(len(binaryContents)),
		}, binaryContents)
		writeHeader(&tar.Header{
			Name: archiveRoot + "/" + dylibName,
			Mode: 0o755,
			Size: int64(len(dylibContents)),
		}, dylibContents)
		writeHeader(&tar.Header{
			Name:     archiveRoot + "/" + dylibLink,
			Mode:     0o777,
			Typeflag: tar.TypeSymlink,
			Linkname: dylibName,
		}, nil)

		if err := tarWriter.Close(); err != nil {
			t.Fatalf("close tar writer: %v", err)
		}
		if err := gzipWriter.Close(); err != nil {
			t.Fatalf("close gzip writer: %v", err)
		}
		return buffer.Bytes()
	default:
		t.Fatalf("runtime file archive helper only supports tar.gz assets, got %s", assetName)
		return nil
	}
}

func TestRegistryCRUD(t *testing.T) {
	dir := t.TempDir()

	reg, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	if len(reg.List()) != 0 {
		t.Fatalf("expected empty registry, got %d entries", len(reg.List()))
	}
	if got := reg.Get(EngineLlama, "b8575"); got != nil {
		t.Fatalf("expected nil for missing entry, got %+v", got)
	}

	entry := &RegistryEntry{
		Engine:      EngineLlama,
		Version:     "b8575",
		BinaryPath:  "/tmp/llama-server",
		SHA256:      "abc123",
		Platform:    "darwin/arm64",
		InstalledAt: "2026-01-01T00:00:00Z",
	}
	if err := reg.Put(entry); err != nil {
		t.Fatalf("Put: %v", err)
	}

	got := reg.Get(EngineLlama, "b8575")
	if got == nil {
		t.Fatal("expected entry, got nil")
	}
	if got.BinaryPath != "/tmp/llama-server" {
		t.Errorf("expected binary path /tmp/llama-server, got %s", got.BinaryPath)
	}
	if got.SHA256 != "abc123" {
		t.Errorf("expected sha256 abc123, got %s", got.SHA256)
	}
	if len(reg.List()) != 1 {
		t.Errorf("expected 1 entry, got %d", len(reg.List()))
	}

	if err := reg.Remove(EngineLlama, "b8575"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if got := reg.Get(EngineLlama, "b8575"); got != nil {
		t.Errorf("expected nil after remove, got %+v", got)
	}
}

func TestRegistryPersistence(t *testing.T) {
	dir := t.TempDir()

	reg1, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	if err := reg1.Put(&RegistryEntry{
		Engine:     EngineLlama,
		Version:    "1.0.0",
		BinaryPath: "/tmp/test",
		Platform:   "linux/amd64",
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	reg2, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry reload: %v", err)
	}

	got := reg2.Get(EngineLlama, "1.0.0")
	if got == nil {
		t.Fatal("expected persisted entry, got nil")
	}
	if got.BinaryPath != "/tmp/test" {
		t.Errorf("expected binary path /tmp/test, got %s", got.BinaryPath)
	}
}

func TestRegistryListReturnsCopies(t *testing.T) {
	dir := t.TempDir()
	reg, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	if err := reg.Put(&RegistryEntry{
		Engine:     EngineLlama,
		Version:    "1.0.0",
		BinaryPath: "/tmp/test",
		Platform:   "linux/amd64",
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	entries := reg.List()
	if len(entries) != 1 {
		t.Fatalf("expected one entry, got %d", len(entries))
	}
	entries[0].BinaryPath = "/tmp/mutated"

	got := reg.Get(EngineLlama, "1.0.0")
	if got == nil {
		t.Fatal("expected stored entry")
	}
	if got.BinaryPath != "/tmp/test" {
		t.Fatalf("registry entry was mutated through List(): %q", got.BinaryPath)
	}
}

func TestRegistryAtomicWrite(t *testing.T) {
	dir := t.TempDir()

	reg, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	if err := reg.Put(&RegistryEntry{
		Engine:  EngineMedia,
		Version: "sys",
	}); err != nil {
		t.Fatalf("Put: %v", err)
	}

	tmpPath := filepath.Join(dir, "registry.json.tmp")
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Errorf("expected no tmp file, but it exists")
	}

	jsonPath := filepath.Join(dir, "registry.json")
	if _, err := os.Stat(jsonPath); err != nil {
		t.Errorf("expected registry.json to exist: %v", err)
	}
}
