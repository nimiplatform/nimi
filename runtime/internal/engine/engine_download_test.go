package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestDownloadFromURLSuccessDownloadHelpers(t *testing.T) {
	fakeBinary := []byte("#!/bin/sh\necho hello\n")
	hasher := sha256.New()
	hasher.Write(fakeBinary)
	expectedHash := hex.EncodeToString(hasher.Sum(nil))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(fakeBinary)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(fakeBinary)
	}))
	defer server.Close()

	destDir := filepath.Join(t.TempDir(), "engines", "test")
	binaryPath, hash, err := downloadFromURLWithExpectedSHA256(server.URL+"/fake-binary", destDir, "test-binary", "")
	if err != nil {
		t.Fatalf("downloadFromURLWithExpectedSHA256: %v", err)
	}

	if hash != expectedHash {
		t.Errorf("SHA256 mismatch: got %s, want %s", hash, expectedHash)
	}

	if filepath.Base(binaryPath) != "test-binary" {
		t.Errorf("unexpected binary name: %s", filepath.Base(binaryPath))
	}

	info, err := os.Stat(binaryPath)
	if err != nil {
		t.Fatalf("stat binary: %v", err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o755 != 0o755 {
		t.Errorf("expected 0755 permissions, got %o", info.Mode().Perm())
	}
	if info.Size() != int64(len(fakeBinary)) {
		t.Errorf("expected size %d, got %d", len(fakeBinary), info.Size())
	}

	// No .download residue.
	tmpPath := binaryPath + ".download"
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Errorf("expected no .download tmp file, but it exists")
	}
}

func TestDownloadFromURLHTTPErrorDownloadHelpers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	destDir := filepath.Join(t.TempDir(), "engines", "test")
	_, _, err := downloadFromURLWithExpectedSHA256(server.URL+"/missing", destDir, "test-binary", "")
	if err == nil {
		t.Fatal("expected error for HTTP 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("expected error to mention 404, got: %v", err)
	}

	// No residual files.
	entries, _ := os.ReadDir(destDir)
	for _, e := range entries {
		t.Errorf("unexpected residual file: %s", e.Name())
	}
}

func TestDownloadFromURLHashMismatchDownloadHelpers(t *testing.T) {
	fakeBinary := []byte("#!/bin/sh\necho hello\n")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(fakeBinary)
	}))
	defer server.Close()

	destDir := filepath.Join(t.TempDir(), "engines", "test")
	_, _, err := downloadFromURLWithExpectedSHA256(server.URL+"/fake-binary", destDir, "test-binary", strings.Repeat("0", 64))
	if err == nil {
		t.Fatal("expected hash mismatch error")
	}
	if !errors.Is(err, ErrEngineBinaryHashMismatch) {
		t.Fatalf("expected ErrEngineBinaryHashMismatch, got %v", err)
	}
}

func TestManagerEnsureLlamaFailsWhenRegistryPersistFailsDownloadHelpers(t *testing.T) {
	if !LlamaSupervisedPlatformSupported() {
		t.Skipf("unsupported platform: %s", PlatformString())
	}

	const version = "b8575"
	asset, err := llamaAssetName(version)
	if err != nil {
		t.Fatalf("llamaAssetName: %v", err)
	}
	fakeBinary := []byte("#!/bin/sh\necho hello\n")
	fakeArchive := makeFakeArchiveAsset(t, asset, llamaBinaryName(), fakeBinary)
	sum := sha256.Sum256(fakeArchive)
	expectedHash := hex.EncodeToString(sum[:])
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/" + version:
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(fmt.Sprintf(`{"tag_name":"%s","assets":[{"name":"%s","browser_download_url":"%s/%s/download","digest":"sha256:%s"}]}`, version, asset, serverURL, version, expectedHash)))
		case "/" + version + "/download":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(fakeArchive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	serverURL = server.URL
	t.Cleanup(setLlamaReleaseSourceForTest(server.URL, server.Client()))

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	mgr, err := NewManager(logger, t.TempDir(), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	blocker := filepath.Join(t.TempDir(), "registry-parent")
	if err := os.WriteFile(blocker, []byte("file"), 0o644); err != nil {
		t.Fatalf("write blocker: %v", err)
	}
	mgr.registry.path = filepath.Join(blocker, "registry.json")

	_, err = mgr.ensureLlama(context.Background(), DefaultLlamaConfig())
	if err == nil {
		t.Fatal("expected ensureLlama to fail when registry persist fails")
	}
	if !strings.Contains(err.Error(), "persist llama registry entry") {
		t.Fatalf("unexpected ensureLlama error: %v", err)
	}
}

func TestStageManagedBinaryPayloadPreservesRuntimeDependenciesDownloadHelpers(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink preservation test requires unix-like symlink support")
	}

	const assetName = "llama-b8575-bin-macos-arm64.tar.gz"
	const binaryName = "llama-server"

	archivePath := filepath.Join(t.TempDir(), assetName)
	archive := makeFakeArchiveAssetWithRuntimeFiles(t, assetName, binaryName, []byte("#!/bin/sh\necho hello\n"))
	if err := os.WriteFile(archivePath, archive, 0o644); err != nil {
		t.Fatalf("write archive: %v", err)
	}

	stagedDir := filepath.Join(t.TempDir(), "payload")
	binaryPath, err := stageManagedBinaryPayload(archivePath, stagedDir, binaryName)
	if err != nil {
		t.Fatalf("stageManagedBinaryPayload: %v", err)
	}
	if binaryPath != filepath.Join(stagedDir, binaryName) {
		t.Fatalf("unexpected staged binary path: %s", binaryPath)
	}
	if _, err := os.Stat(binaryPath); err != nil {
		t.Fatalf("staged binary missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(stagedDir, "libmtmd.0.0.8575.dylib")); err != nil {
		t.Fatalf("staged dylib missing: %v", err)
	}
	linkPath := filepath.Join(stagedDir, "libmtmd.0.dylib")
	target, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatalf("read staged dylib symlink: %v", err)
	}
	if target != "libmtmd.0.0.8575.dylib" {
		t.Fatalf("unexpected staged symlink target: %s", target)
	}

	installDir := filepath.Join(t.TempDir(), "install")
	if err := installManagedBinaryPayload(installDir, stagedDir); err != nil {
		t.Fatalf("installManagedBinaryPayload: %v", err)
	}
	if _, err := os.Stat(filepath.Join(installDir, binaryName)); err != nil {
		t.Fatalf("installed binary missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(installDir, "libmtmd.0.0.8575.dylib")); err != nil {
		t.Fatalf("installed dylib missing: %v", err)
	}
	installedTarget, err := os.Readlink(filepath.Join(installDir, "libmtmd.0.dylib"))
	if err != nil {
		t.Fatalf("read installed dylib symlink: %v", err)
	}
	if installedTarget != "libmtmd.0.0.8575.dylib" {
		t.Fatalf("unexpected installed symlink target: %s", installedTarget)
	}
}
