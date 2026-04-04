package engine

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
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

// --- Registry tests ---

func TestRegistryCRUD(t *testing.T) {
	dir := t.TempDir()

	reg, err := NewRegistry(dir)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	// Empty initially.
	if len(reg.List()) != 0 {
		t.Fatalf("expected empty registry, got %d entries", len(reg.List()))
	}

	// Get returns nil for missing entry.
	if got := reg.Get(EngineLlama, "b8575"); got != nil {
		t.Fatalf("expected nil for missing entry, got %+v", got)
	}

	// Put an entry.
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

	// Get the entry.
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

	// List returns the entry.
	if len(reg.List()) != 1 {
		t.Errorf("expected 1 entry, got %d", len(reg.List()))
	}

	// Remove the entry.
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

	// Load from disk in a new registry instance.
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

	// Verify no .tmp file remains.
	tmpPath := filepath.Join(dir, "registry.json.tmp")
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Errorf("expected no tmp file, but it exists")
	}

	// Verify actual file exists.
	jsonPath := filepath.Join(dir, "registry.json")
	if _, err := os.Stat(jsonPath); err != nil {
		t.Errorf("expected registry.json to exist: %v", err)
	}
}

// --- Download URL tests ---

func TestLlamaDownloadURL(t *testing.T) {
	const version = "b8575"
	assetName, err := llamaAssetName(version)
	if err != nil && LlamaSupervisedPlatformSupported() {
		t.Fatalf("llamaAssetName: %v", err)
	}
	releasePayload := fmt.Sprintf(`{"tag_name":"%s","assets":[{"name":"%s","browser_download_url":"https://github.com/ggml-org/llama.cpp/releases/download/%s/%s","digest":"sha256:%s"}]}`, version, assetName, version, assetName, strings.Repeat("a", 64))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/"+version {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(releasePayload))
	}))
	defer server.Close()
	t.Cleanup(setLlamaReleaseSourceForTest(server.URL, server.Client()))

	url, err := llamaDownloadURL(version)
	if !LlamaSupervisedPlatformSupported() {
		if err == nil {
			t.Fatalf("expected unsupported platform error on %s", PlatformString())
		}
		if !strings.Contains(err.Error(), "unsupported platform: "+PlatformString()) {
			t.Fatalf("unexpected unsupported platform error: %v", err)
		}
		return
	}
	if err != nil {
		t.Fatalf("llamaDownloadURL: %v", err)
	}
	if url == "" {
		t.Fatal("expected non-empty URL")
	}

	expectedURL := fmt.Sprintf("https://github.com/ggml-org/llama.cpp/releases/download/%s/%s", version, assetName)
	if url != expectedURL {
		t.Errorf("unexpected URL: got=%s want=%s", url, expectedURL)
	}
}

func TestLlamaAssetName(t *testing.T) {
	tests := []struct {
		goos   string
		goarch string
		want   string
	}{
		{goos: "darwin", goarch: "arm64", want: "llama-b8575-bin-macos-arm64.tar.gz"},
		{goos: "darwin", goarch: "amd64", want: "llama-b8575-bin-macos-x64.tar.gz"},
		{goos: "linux", goarch: "amd64", want: "llama-b8575-bin-ubuntu-x64.tar.gz"},
		{goos: "windows", goarch: "amd64", want: "llama-b8575-bin-win-cpu-x64.zip"},
		{goos: "windows", goarch: "arm64", want: "llama-b8575-bin-win-cpu-arm64.zip"},
	}

	for _, tt := range tests {
		t.Run(tt.goos+"-"+tt.goarch, func(t *testing.T) {
			got, err := llamaAssetNameFor("b8575", tt.goos, tt.goarch)
			if err != nil {
				t.Fatalf("llamaAssetNameFor: %v", err)
			}
			if got != tt.want {
				t.Fatalf("llamaAssetNameFor(%q,%q) = %q, want %q", tt.goos, tt.goarch, got, tt.want)
			}
		})
	}
}

func TestLlamaSupervisedPlatformSupportedFor(t *testing.T) {
	tests := []struct {
		goos   string
		goarch string
		want   bool
	}{
		{goos: "darwin", goarch: "arm64", want: true},
		{goos: "darwin", goarch: "amd64", want: true},
		{goos: "linux", goarch: "amd64", want: true},
		{goos: "linux", goarch: "arm64", want: false},
		{goos: "windows", goarch: "amd64", want: true},
		{goos: "windows", goarch: "arm64", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.goos+"-"+tt.goarch, func(t *testing.T) {
			if got := LlamaSupervisedPlatformSupportedFor(tt.goos, tt.goarch); got != tt.want {
				t.Fatalf("LlamaSupervisedPlatformSupportedFor(%q, %q) = %v, want %v", tt.goos, tt.goarch, got, tt.want)
			}
		})
	}
}

func TestLlamaImageSupervisedPlatformSupportedFor(t *testing.T) {
	tests := []struct {
		name      string
		goos      string
		goarch    string
		gpuVendor string
		gpuModel  string
		want      bool
	}{
		{name: "darwin m4 supported", goos: "darwin", goarch: "arm64", gpuVendor: "apple", gpuModel: "Apple M4 Max", want: true},
		{name: "darwin m5 supported", goos: "darwin", goarch: "arm64", gpuVendor: "apple", gpuModel: "Apple M5 Max", want: true},
		{name: "darwin a19 supported", goos: "darwin", goarch: "arm64", gpuVendor: "apple", gpuModel: "Apple A19", want: true},
		{name: "darwin unknown apple supported", goos: "darwin", goarch: "arm64", gpuVendor: "apple", gpuModel: "Apple Silicon", want: true},
		{name: "windows amd64 supported", goos: "windows", goarch: "amd64", gpuVendor: "nvidia", gpuModel: "RTX 4090", want: true},
		{name: "linux amd64 unsupported for managed image backend", goos: "linux", goarch: "amd64", gpuVendor: "", gpuModel: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := LlamaImageSupervisedPlatformSupportedFor(tt.goos, tt.goarch, tt.gpuVendor, tt.gpuModel); got != tt.want {
				t.Fatalf("LlamaImageSupervisedPlatformSupportedFor(%q, %q, %q, %q) = %v, want %v", tt.goos, tt.goarch, tt.gpuVendor, tt.gpuModel, got, tt.want)
			}
		})
	}
}

func TestMediaSupervisedPlatformSupportedFor(t *testing.T) {
	tests := []struct {
		goos   string
		goarch string
		want   bool
	}{
		{goos: "windows", goarch: "amd64", want: true},
		{goos: "windows", goarch: "arm64", want: false},
		{goos: "linux", goarch: "amd64", want: false},
		{goos: "darwin", goarch: "arm64", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.goos+"-"+tt.goarch, func(t *testing.T) {
			if got := MediaSupervisedPlatformSupportedFor(tt.goos, tt.goarch); got != tt.want {
				t.Fatalf("MediaSupervisedPlatformSupportedFor(%q, %q) = %v, want %v", tt.goos, tt.goarch, got, tt.want)
			}
		})
	}
}

func TestClassifyMediaHost(t *testing.T) {
	tests := []struct {
		name      string
		goos      string
		goarch    string
		gpuVendor string
		cudaReady bool
		want      MediaHostSupport
	}{
		{
			name:      "supported supervised",
			goos:      "windows",
			goarch:    "amd64",
			gpuVendor: "nvidia",
			cudaReady: true,
			want:      MediaHostSupportSupportedSupervised,
		},
		{
			name:      "windows non nvidia attached only",
			goos:      "windows",
			goarch:    "amd64",
			gpuVendor: "intel",
			cudaReady: false,
			want:      MediaHostSupportAttachedOnly,
		},
		{
			name:      "windows nvidia without cuda attached only",
			goos:      "windows",
			goarch:    "amd64",
			gpuVendor: "nvidia",
			cudaReady: false,
			want:      MediaHostSupportAttachedOnly,
		},
		{
			name:      "non windows attached only",
			goos:      "linux",
			goarch:    "amd64",
			gpuVendor: "nvidia",
			cudaReady: true,
			want:      MediaHostSupportAttachedOnly,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyMediaHost(tt.goos, tt.goarch, tt.gpuVendor, tt.cudaReady); got != tt.want {
				t.Fatalf("ClassifyMediaHost(%q, %q, %q, %t) = %q, want %q", tt.goos, tt.goarch, tt.gpuVendor, tt.cudaReady, got, tt.want)
			}
		})
	}
}

func TestLlamaExpectedSHA256(t *testing.T) {
	const version = "b8575"
	const expectedHash = "aac7f1248948cf2e6b2ce1c86a311601b1e37154914397f602b1f6f4bfe2de00" // pragma: allowlist secret
	asset, err := llamaAssetName(version)
	if err != nil {
		t.Fatalf("llamaAssetName: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/"+version {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(fmt.Sprintf(`{"tag_name":"%s","assets":[{"name":"%s","browser_download_url":"https://github.com/ggml-org/llama.cpp/releases/download/%s/%s","digest":"sha256:%s"}]}`, version, asset, version, asset, expectedHash)))
	}))
	defer server.Close()

	t.Cleanup(setLlamaReleaseSourceForTest(server.URL, server.Client()))

	hash, err := llamaExpectedSHA256(version, asset)
	if err != nil {
		t.Fatalf("llamaExpectedSHA256: %v", err)
	}
	if hash != expectedHash {
		t.Fatalf("checksum mismatch: got=%s want=%s", hash, expectedHash)
	}
}

func TestLlamaExpectedSHA256MissingAsset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"tag_name":"b8575","assets":[{"name":"llama-b8575-bin-macos-arm64.tar.gz","browser_download_url":"https://github.com/ggml-org/llama.cpp/releases/download/b8575/llama-b8575-bin-macos-arm64.tar.gz","digest":"sha256:aac7f1248948cf2e6b2ce1c86a311601b1e37154914397f602b1f6f4bfe2de00"}]}`))
	}))
	defer server.Close()

	t.Cleanup(setLlamaReleaseSourceForTest(server.URL, server.Client()))

	_, err := llamaExpectedSHA256("b8575", "llama-b8575-bin-ubuntu-x64.tar.gz")
	if err == nil {
		t.Fatal("expected missing checksum error")
	}
	if !errors.Is(err, ErrEngineBinaryDownloadFailed) {
		t.Fatalf("expected ErrEngineBinaryDownloadFailed, got %v", err)
	}
}

func TestPlatformString(t *testing.T) {
	ps := PlatformString()
	if ps == "" {
		t.Fatal("expected non-empty platform string")
	}
	if ps != runtime.GOOS+"/"+runtime.GOARCH {
		t.Errorf("expected %s/%s, got %s", runtime.GOOS, runtime.GOARCH, ps)
	}
}

// --- Health probe tests ---

func TestProbeHealthSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"data":[{"id":"qwen2.5"}]}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	err := ProbeHealth(context.Background(), server.URL, "/v1/models", "")
	if err != nil {
		t.Errorf("expected healthy, got error: %v", err)
	}
}

func TestProbeHealthBodyMatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("engine is running"))
	}))
	defer server.Close()

	err := ProbeHealth(context.Background(), server.URL, "/", "engine is running")
	if err != nil {
		t.Errorf("expected healthy, got error: %v", err)
	}
}

func TestProbeHealthBodyMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("something else"))
	}))
	defer server.Close()

	err := ProbeHealth(context.Background(), server.URL, "/", "engine is running")
	if err == nil {
		t.Error("expected error for body mismatch, got nil")
	}
}

func TestProbeHealthServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	err := ProbeHealth(context.Background(), server.URL, "/v1/models", "")
	if err == nil {
		t.Error("expected error for 500 status, got nil")
	}
}

func TestProbeHealthUnreachable(t *testing.T) {
	err := ProbeHealth(context.Background(), "http://127.0.0.1:59999", "/v1/models", "")
	if err == nil {
		t.Error("expected error for unreachable server, got nil")
	}
}

func TestProbeMediaHealthSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ready":true}`))
		case "/v1/catalog":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"models":[{"id":"flux.1-schnell","ready":true}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	if err := ProbeMediaHealth(context.Background(), server.URL); err != nil {
		t.Fatalf("expected media healthy, got %v", err)
	}
}

func TestProbeMediaHealthRequiresCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ready":true}`))
		case "/v1/catalog":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"models":[]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	if err := ProbeMediaHealth(context.Background(), server.URL); err == nil {
		t.Fatal("expected media health probe to fail without ready catalog models")
	}
}

func TestProbeMediaHealthProxyExecutionAllowsReadyEmptyCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ready":true,"checks":{"proxy_mode":true}}`))
		case "/v1/catalog":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ready":true,"models":[]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	if err := ProbeMediaHealth(context.Background(), server.URL); err != nil {
		t.Fatalf("expected proxy_execution media health to accept ready empty catalog, got %v", err)
	}
}

func TestProbeMediaHealthRejectsOversizedCatalogPayload(t *testing.T) {
	oversizedModelID := strings.Repeat("m", canonicalCatalogProbeBodyLimitBytes)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ready":true}`))
		case "/v1/catalog":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"models":[{"id":"` + oversizedModelID + `","ready":true}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	if err := ProbeMediaHealth(context.Background(), server.URL); err == nil {
		t.Fatal("expected media health probe to fail on oversized catalog payload")
	}
}

func TestProbeSupervisorHealthUsesSpeechProbe(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ready":true}`))
		case "/v1/catalog":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"models":[{"id":"speech-default","ready":true}]}`))
		case "/v1/models":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"detail":"generic health path should not be used for speech"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	cfg := EngineConfig{
		Kind:           EngineSpeech,
		Address:        strings.TrimPrefix(server.URL, "http://"),
		HealthPath:     "/v1/models",
		HealthInterval: 100 * time.Millisecond,
	}
	if err := probeSupervisorHealth(context.Background(), cfg); err != nil {
		t.Fatalf("probeSupervisorHealth(speech): %v", err)
	}
}

func TestProbeSupervisorHealthTCP(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen tcp: %v", err)
	}
	defer listener.Close()

	cfg := EngineConfig{
		Kind:           engineManagedImageBackend,
		HealthMode:     HealthModeTCP,
		Address:        listener.Addr().String(),
		HealthInterval: 100 * time.Millisecond,
	}
	if err := probeSupervisorHealth(context.Background(), cfg); err != nil {
		t.Fatalf("probeSupervisorHealth(tcp): %v", err)
	}
}

func TestWaitHealthySuccess(t *testing.T) {
	var callCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next := callCount.Add(1)
		if next < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":[{"id":"qwen2.5"}]}`))
	}))
	defer server.Close()

	err := WaitHealthy(context.Background(), server.URL, "/v1/models", "", 50*time.Millisecond, 5*time.Second)
	if err != nil {
		t.Errorf("expected healthy after retries, got error: %v", err)
	}
	if got := callCount.Load(); got < 3 {
		t.Errorf("expected at least 3 calls, got %d", got)
	}
}

func TestWaitHealthyTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	err := WaitHealthy(context.Background(), server.URL, "/v1/models", "", 50*time.Millisecond, 200*time.Millisecond)
	if err == nil {
		t.Error("expected timeout error, got nil")
	}
}

func TestWaitHealthyCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	err := WaitHealthy(ctx, server.URL, "/v1/models", "", 50*time.Millisecond, 5*time.Second)
	if err == nil {
		t.Error("expected cancel error, got nil")
	}
}

func TestWaitMediaHealthySuccess(t *testing.T) {
	var callCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			next := callCount.Add(1)
			if next < 2 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ready":true}`))
		case "/v1/catalog":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"models":[{"id":"flux.1-schnell","ready":true}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	if err := WaitMediaHealthy(context.Background(), server.URL, 50*time.Millisecond, 5*time.Second); err != nil {
		t.Fatalf("expected media healthy after retries, got %v", err)
	}
}

// --- Port resolution tests ---

func TestPortAvailable(t *testing.T) {
	// Port 0 should find an available port.
	if !portAvailable(0) {
		t.Skip("port 0 not available (unusual system)")
	}
}

// --- Manager tests ---

func TestNewManager(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// ListEngines should include known engines even when not running.
	engines := mgr.ListEngines()
	if len(engines) != 3 {
		t.Fatalf("expected 3 known engines (llama+media+speech), got %d", len(engines))
	}
	seen := map[EngineKind]bool{}
	for _, info := range engines {
		seen[info.Kind] = true
		if info.Status != StatusStopped {
			t.Fatalf("expected stopped status for non-running engine %s, got %s", info.Kind, info.Status)
		}
	}
	if !seen[EngineLlama] || !seen[EngineMedia] || !seen[EngineSpeech] {
		t.Fatalf("expected list to include llama, media, and speech, got %+v", engines)
	}
	if mgr.logger == nil {
		t.Fatal("expected NewManager to install a default logger when nil is provided")
	}
}

func TestManagerStopAllEmpty(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	// StopAll on empty manager should not panic.
	mgr.StopAll()
}

func TestManagerBeginEngineStartGuardsConcurrentStarts(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	if err := mgr.beginEngineStart(EngineLlama); err != nil {
		t.Fatalf("first beginEngineStart: %v", err)
	}
	if err := mgr.beginEngineStart(EngineLlama); err == nil {
		t.Fatal("expected concurrent start guard to reject second begin")
	}

	mgr.finishEngineStart(EngineLlama)
	if err := mgr.beginEngineStart(EngineLlama); err != nil {
		t.Fatalf("beginEngineStart after finish: %v", err)
	}
	mgr.finishEngineStart(EngineLlama)
}

func TestManagerStopAllRemovesStoppedSupervisors(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	mgr.supervisors[EngineMedia] = NewSupervisor(EngineConfig{Kind: EngineMedia, ShutdownTimeout: time.Second}, nil, nil)
	mgr.supervisors[engineManagedImageBackend] = NewSupervisor(EngineConfig{Kind: engineManagedImageBackend, ShutdownTimeout: time.Second}, nil, nil)

	mgr.StopAll()

	if len(mgr.supervisors) != 0 {
		t.Fatalf("expected StopAll to clear stopped supervisors, got %d entries", len(mgr.supervisors))
	}
}

func TestManagerStopEngineRemovesSupervisor(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	sup := NewSupervisor(EngineConfig{Kind: EngineMedia, ShutdownTimeout: time.Second}, nil, nil)
	mgr.supervisors[EngineMedia] = sup

	if err := mgr.StopEngine(EngineMedia); err != nil {
		t.Fatalf("StopEngine: %v", err)
	}
	if _, exists := mgr.supervisors[EngineMedia]; exists {
		t.Fatal("expected stopped supervisor to be removed from manager map")
	}
}

func TestManagerStopEngineLlamaRemovesImageBackendSupervisor(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	mgr.supervisors[EngineLlama] = NewSupervisor(EngineConfig{Kind: EngineLlama, ShutdownTimeout: time.Second}, nil, nil)
	mgr.supervisors[engineManagedImageBackend] = NewSupervisor(EngineConfig{Kind: engineManagedImageBackend, ShutdownTimeout: time.Second}, nil, nil)

	if err := mgr.StopEngine(EngineLlama); err != nil {
		t.Fatalf("StopEngine llama: %v", err)
	}
	if _, exists := mgr.supervisors[EngineLlama]; exists {
		t.Fatal("expected llama supervisor to be removed from manager map")
	}
	if _, exists := mgr.supervisors[engineManagedImageBackend]; !exists {
		t.Fatal("expected managed image backend supervisor to remain managed independently from llama")
	}
}

func TestManagerEngineEndpointNotStarted(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	_, err = mgr.EngineEndpoint(EngineLlama)
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestManagerEngineStatusNotStarted(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	_, err = mgr.EngineStatus(EngineLlama)
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

// --- Supervisor tests ---

func TestSupervisorInitialStatus(t *testing.T) {
	cfg := DefaultLlamaConfig()
	sup := NewSupervisor(cfg, nil, nil)

	if sup.Status() != StatusStopped {
		t.Errorf("expected initial status %s, got %s", StatusStopped, sup.Status())
	}
}

func TestSupervisorInfo(t *testing.T) {
	cfg := DefaultLlamaConfig()
	cfg.Port = 9999
	sup := NewSupervisor(cfg, nil, nil)

	info := sup.Info()
	if info.Kind != EngineLlama {
		t.Errorf("expected kind %s, got %s", EngineLlama, info.Kind)
	}
	if info.Port != 9999 {
		t.Errorf("expected port 9999, got %d", info.Port)
	}
	if info.Status != StatusStopped {
		t.Errorf("expected status %s, got %s", StatusStopped, info.Status)
	}
}

// --- ServiceAdapter tests ---

func TestServiceAdapterListEnginesEmpty(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	adapter := NewServiceAdapter(mgr)
	engines := adapter.ListEngines()
	if len(engines) != 3 {
		t.Fatalf("expected 3 known engines, got %d", len(engines))
	}
	seen := map[string]bool{}
	for _, info := range engines {
		seen[info.Engine] = true
		if info.Status != string(StatusStopped) {
			t.Fatalf("expected stopped status for non-running engine %s, got %s", info.Engine, info.Status)
		}
	}
	if !seen[string(EngineLlama)] || !seen[string(EngineMedia)] || !seen[string(EngineSpeech)] {
		t.Fatalf("expected adapter list to include llama, media, and speech, got %+v", engines)
	}
}

func TestServiceAdapterEngineStatusNotFound(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	adapter := NewServiceAdapter(mgr)
	_, err = adapter.EngineStatus("llama")
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestServiceAdapterStopEngineNotFound(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	adapter := NewServiceAdapter(mgr)
	err = adapter.StopEngine("llama")
	if err == nil {
		t.Error("expected error for engine not started, got nil")
	}
}

func TestManagerApplyLlamaPaths(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(nil, dir, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	configPath := filepath.Join(t.TempDir(), "llama-models.yaml")
	if err := os.WriteFile(configPath, []byte(`
- name: model-a
  backend: llama-cpp
  parameters:
    model: model-a.gguf
- name: model-b
  backend: whisper-ggml
  parameters:
    model: model-b.bin
`), 0o644); err != nil {
		t.Fatalf("write llama models config: %v", err)
	}

	mgr.SetLlamaPaths("/data/models", configPath)
	cfg := mgr.applyLlamaPaths(DefaultLlamaConfig())
	if cfg.ModelsPath != "/data/models" {
		t.Fatalf("models path mismatch: %q", cfg.ModelsPath)
	}
	if cfg.ModelsConfigPath != configPath {
		t.Fatalf("models config path mismatch: %q", cfg.ModelsConfigPath)
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("resolve home dir: %v", err)
	}
	if got, want := cfg.BackendsPath, filepath.Join(homeDir, ".nimi", "runtime", "llama-backends"); got != want {
		t.Fatalf("backends path mismatch: got=%q want=%q", got, want)
	}
	if got, want := strings.Join(cfg.ExternalBackends, ","), "llama-cpp,whisper-ggml"; got != want {
		t.Fatalf("external backends mismatch: got=%q want=%q", got, want)
	}
}

func TestParseEngineKind(t *testing.T) {
	tests := []struct {
		input string
		want  EngineKind
		err   bool
	}{
		{"llama", EngineLlama, false},
		{"media", EngineMedia, false},
		{"speech", EngineSpeech, false},
		{"media.diffusers", "", true},
		{"sidecar", EngineKind("sidecar"), false},
		{"unknown", "", true},
		{"", "", true},
	}
	for _, tt := range tests {
		got, err := parseEngineKind(tt.input)
		if (err != nil) != tt.err {
			t.Errorf("parseEngineKind(%q): err=%v, wantErr=%v", tt.input, err, tt.err)
		}
		if got != tt.want {
			t.Errorf("parseEngineKind(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestRestartJitterCap(t *testing.T) {
	tests := []struct {
		name  string
		delay time.Duration
		want  time.Duration
	}{
		{name: "zero", delay: 0, want: 0},
		{name: "short delay stays bounded", delay: 10 * time.Millisecond, want: 10 * time.Millisecond},
		{name: "sub-second delay stays bounded", delay: 500 * time.Millisecond, want: 500 * time.Millisecond},
		{name: "long delay caps at one second", delay: 3 * time.Second, want: time.Second},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := restartJitterCap(tt.delay); got != tt.want {
				t.Fatalf("restartJitterCap(%s) = %s, want %s", tt.delay, got, tt.want)
			}
		})
	}
}

// --- Command construction tests ---

func TestLlamaCommandArgs(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "llama-models.yaml")
	if err := os.WriteFile(configPath, []byte(`
- name: managed-qwen
  backend: llama-cpp
  parameters:
    model: qwen/qwen3.gguf
`), 0o644); err != nil {
		t.Fatalf("write llama config: %v", err)
	}

	cfg := EngineConfig{
		Kind:             EngineLlama,
		BinaryPath:       "/usr/local/bin/llama-server",
		Port:             5555,
		ModelsPath:       "/data/models",
		ModelsConfigPath: configPath,
	}
	cmd, err := llamaCommand(cfg)
	if err != nil {
		t.Fatalf("llamaCommand: %v", err)
	}
	args := strings.Join(cmd.Args[1:], " ")

	for _, want := range []string{"--host", "127.0.0.1", "--port", "5555", "--model", filepath.Join("/data/models", "qwen/qwen3.gguf"), "--alias", "managed-qwen"} {
		if !strings.Contains(args, want) {
			t.Errorf("expected args to contain %q, got: %s", want, args)
		}
	}
	if strings.Contains(args, "--models-config-file") {
		t.Error("expected no --models-config-file for llama-server")
	}
	if strings.Contains(args, "--backends-path") {
		t.Error("expected no --backends-path for llama-server")
	}
	if strings.Contains(args, "--external-backends") {
		t.Error("expected no --external-backends for llama-server")
	}
}

func TestDetectLlamaExternalBackends(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "llama-models.yaml")
	if err := os.WriteFile(configPath, []byte(`
- name: model-a
  backend: llama-cpp
- name: model-b
  backend: whisper-ggml
- name: model-c
  backend: llama-cpp
- name: model-d
  backend: ""
`), 0o644); err != nil {
		t.Fatalf("write llama models config: %v", err)
	}

	if got, want := strings.Join(detectLlamaExternalBackends(configPath), ","), "llama-cpp,whisper-ggml"; got != want {
		t.Fatalf("detectLlamaExternalBackends mismatch: got=%q want=%q", got, want)
	}
}

func TestDetectLlamaExternalBackendsReturnsNilOnInvalidYaml(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "llama-models-invalid.yaml")
	if err := os.WriteFile(configPath, []byte(":\n- not-valid"), 0o644); err != nil {
		t.Fatalf("write invalid llama models config: %v", err)
	}

	if got := detectLlamaExternalBackends(configPath); got != nil {
		t.Fatalf("expected nil external backends for invalid yaml, got %v", got)
	}
}

func TestDiscoverInstalledLlamaBackendRunPathPrefersAlias(t *testing.T) {
	backendsPath := t.TempDir()
	backendDir := filepath.Join(backendsPath, "metal-stablediffusion-ggml")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	runPath := filepath.Join(backendDir, "run.sh")
	if err := os.WriteFile(runPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write run.sh: %v", err)
	}
	if err := os.WriteFile(filepath.Join(backendDir, "metadata.json"), []byte(`{"name":"metal-stablediffusion-ggml","alias":"stablediffusion-ggml"}`), 0o644); err != nil {
		t.Fatalf("write metadata.json: %v", err)
	}

	discovered, err := discoverInstalledLlamaBackendRunPath(backendsPath, "stablediffusion-ggml")
	if err != nil {
		t.Fatalf("discoverInstalledLlamaBackendRunPath: %v", err)
	}
	if discovered != runPath {
		t.Fatalf("run path mismatch: got=%q want=%q", discovered, runPath)
	}
}

func TestDiscoverInstalledLlamaBackendRunPathRejectsMetaBackendTraversal(t *testing.T) {
	backendsPath := t.TempDir()
	backendDir := filepath.Join(backendsPath, "meta-stablediffusion-ggml")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	runPath := filepath.Join(backendDir, "run.sh")
	if err := os.WriteFile(runPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write run.sh: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(backendDir, "metadata.json"),
		[]byte(`{"name":"meta-stablediffusion-ggml","alias":"stablediffusion-ggml","meta_backend_for":"../escape"}`),
		0o644,
	); err != nil {
		t.Fatalf("write metadata.json: %v", err)
	}
	escapeDir := filepath.Join(backendsPath, "..", "escape")
	if err := os.MkdirAll(escapeDir, 0o755); err != nil {
		t.Fatalf("mkdir escape dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(escapeDir, "run.sh"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("write escape run.sh: %v", err)
	}

	_, err := discoverInstalledLlamaBackendRunPath(backendsPath, "stablediffusion-ggml")
	if err == nil {
		t.Fatal("expected meta_backend_for traversal to be rejected")
	}
}

func TestParseOCIImageReference(t *testing.T) {
	got, err := parseOCIImageReference("quay.io/go-skynet/local-ai-backends:latest-metal-darwin-arm64-stablediffusion-ggml")
	if err != nil {
		t.Fatalf("parseOCIImageReference: %v", err)
	}
	if got.Registry != "quay.io" {
		t.Fatalf("registry mismatch: %q", got.Registry)
	}
	if got.Repository != "go-skynet/local-ai-backends" {
		t.Fatalf("repository mismatch: %q", got.Repository)
	}
	if got.Reference != "latest-metal-darwin-arm64-stablediffusion-ggml" {
		t.Fatalf("reference mismatch: %q", got.Reference)
	}
}

func TestInstallLlamaBackendFromOCI(t *testing.T) {
	tarball := makeFakeArchiveAsset(t, "backend.tar.gz", "run.sh", []byte("#!/bin/sh\n"))
	layerDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(tarball))

	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/test/llama-backends/manifests/test-tag":
			w.Header().Set("Content-Type", ociManifestMediaTypeV2)
			_, _ = w.Write([]byte(fmt.Sprintf(`{"schemaVersion":2,"mediaType":"%s","layers":[{"mediaType":"application/vnd.docker.image.rootfs.diff.tar.gzip","digest":"%s"}]}`, ociManifestMediaTypeV2, layerDigest)))
		case "/v2/test/llama-backends/blobs/" + layerDigest:
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(tarball)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	oldTransport := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	t.Cleanup(func() {
		http.DefaultTransport = oldTransport
	})

	registryHost := strings.TrimPrefix(server.URL, "https://")
	backendsPath := t.TempDir()
	err := installLlamaBackendFromOCI(context.Background(), backendsPath, "stablediffusion-ggml", managedImageBackendPackageSpec{
		BackendName:    "stablediffusion-ggml",
		OS:             "darwin",
		Arch:           "arm64",
		GPUVendor:      "apple",
		InstallDirName: "metal-stablediffusion-ggml",
		ImageRef:       registryHost + "/test/llama-backends:test-tag",
		Supported:      true,
	})
	if err != nil {
		t.Fatalf("installLlamaBackendFromOCI: %v", err)
	}

	runPath := filepath.Join(backendsPath, "metal-stablediffusion-ggml", "run.sh")
	if _, err := os.Stat(runPath); err != nil {
		t.Fatalf("expected run.sh to be installed: %v", err)
	}

	metadata, err := readLlamaBackendMetadata(filepath.Join(backendsPath, "metal-stablediffusion-ggml", "metadata.json"))
	if err != nil {
		t.Fatalf("readLlamaBackendMetadata: %v", err)
	}
	if metadata == nil {
		t.Fatal("expected metadata.json to be installed")
	}
	if metadata.Alias != "stablediffusion-ggml" {
		t.Fatalf("backend alias mismatch: %q", metadata.Alias)
	}
}

func TestInstallManagedImageBackendFromDirectArchive(t *testing.T) {
	archive := makeFakeArchiveAsset(t, "payload.zip", "sd.exe", []byte("fake-windows-backend"))
	supplementalArchive := makeFakeArchiveAsset(t, "payload.zip", "cudart64_12.dll", []byte("fake-cudart"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sd.zip":
			_, _ = w.Write(archive)
		case "/cudart.zip":
			_, _ = w.Write(supplementalArchive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	backendsPath := t.TempDir()
	spec := managedImageBackendPackageSpec{
		BackendName:    "stablediffusion-ggml",
		InstallDirName: "sd-win-cuda12-x64-stablediffusion-ggml",
		PackageFormat:  managedImageBackendPackageFormatDirectArchive,
		ArchiveURL:     server.URL + "/sd.zip",
		ArchiveSHA256:  fmt.Sprintf("%x", sha256.Sum256(archive)),
		SupplementalArchives: []managedImageBackendArchiveSource{{
			URL:    server.URL + "/cudart.zip",
			SHA256: fmt.Sprintf("%x", sha256.Sum256(supplementalArchive)),
		}},
		ExecutableCandidates: []string{"sd.exe"},
		Supported:            true,
	}
	if err := installManagedImageBackendFromDirectArchive(context.Background(), backendsPath, "stablediffusion-ggml", spec); err != nil {
		t.Fatalf("installManagedImageBackendFromDirectArchive: %v", err)
	}
	executablePath := filepath.Join(backendsPath, spec.InstallDirName, "sd.exe")
	if _, err := os.Stat(executablePath); err != nil {
		t.Fatalf("expected Windows backend executable to be installed: %v", err)
	}
	cudartPath := filepath.Join(backendsPath, spec.InstallDirName, "cudart64_12.dll")
	if _, err := os.Stat(cudartPath); err != nil {
		t.Fatalf("expected supplemental CUDA runtime DLL to be installed: %v", err)
	}
	metadata, err := readLlamaBackendMetadata(filepath.Join(backendsPath, spec.InstallDirName, "metadata.json"))
	if err != nil {
		t.Fatalf("readLlamaBackendMetadata: %v", err)
	}
	if metadata == nil || metadata.Alias != "stablediffusion-ggml" {
		t.Fatalf("unexpected installed metadata: %#v", metadata)
	}
}

func TestDiscoverInstalledManagedImageBackendLaunchConfigRuntimeWrapper(t *testing.T) {
	backendsPath := t.TempDir()
	backendDir := filepath.Join(backendsPath, "sd-win-cuda12-x64-stablediffusion-ggml")
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(backendDir, "sd.exe"), []byte("fake-windows-backend"), 0o755); err != nil {
		t.Fatalf("write sd.exe: %v", err)
	}
	if err := os.WriteFile(filepath.Join(backendDir, "metadata.json"), []byte(`{"name":"sd-win-cuda12-x64-stablediffusion-ggml","alias":"stablediffusion-ggml"}`), 0o644); err != nil {
		t.Fatalf("write metadata.json: %v", err)
	}

	originalExecutable := managedImageBackendCurrentExecutable
	managedImageBackendCurrentExecutable = func() (string, error) {
		return filepath.Join(t.TempDir(), "nimi.exe"), nil
	}
	t.Cleanup(func() {
		managedImageBackendCurrentExecutable = originalExecutable
	})

	launchCfg, err := discoverInstalledManagedImageBackendLaunchConfig(backendsPath, "stablediffusion-ggml", managedImageBackendPackageSpec{
		BackendName:          "stablediffusion-ggml",
		InstallDirName:       "sd-win-cuda12-x64-stablediffusion-ggml",
		LaunchMode:           managedImageBackendLaunchModeRuntimeWrapper,
		WrapperDriver:        "stable-diffusion.cpp",
		ExecutableCandidates: []string{"sd.exe"},
	}, "127.0.0.1:50052")
	if err != nil {
		t.Fatalf("discoverInstalledManagedImageBackendLaunchConfig: %v", err)
	}
	if got := filepath.Base(launchCfg.Command); got != "nimi.exe" {
		t.Fatalf("unexpected wrapper command: %q", launchCfg.Command)
	}
	if got, want := strings.Join(launchCfg.Args, " "), "managed-image-backend serve --listen 127.0.0.1:50052 --driver stable-diffusion.cpp --backend-executable "+filepath.Join(backendDir, "sd.exe"); got != want {
		t.Fatalf("unexpected wrapper args: got=%q want=%q", got, want)
	}
	if launchCfg.WorkingDir != backendDir {
		t.Fatalf("unexpected wrapper working dir: %q", launchCfg.WorkingDir)
	}
}

func TestResolveManagedImageBackendPackageSpecForHostWindowsNvidiaCUDA(t *testing.T) {
	spec, ok := resolveManagedImageBackendPackageSpecForHost(
		"stablediffusion-ggml",
		"windows",
		"amd64",
		"nvidia",
		true,
	)
	if !ok {
		t.Fatal("expected Windows nvidia/cuda host to resolve a managed image backend package")
	}
	if !spec.Supported {
		t.Fatalf("expected Windows managed image backend package to be supported, got %#v", spec)
	}
	if spec.PackageFormat != managedImageBackendPackageFormatDirectArchive {
		t.Fatalf("expected direct archive package format, got %q", spec.PackageFormat)
	}
	if spec.LaunchMode != managedImageBackendLaunchModeRuntimeWrapper {
		t.Fatalf("expected runtime wrapper launch mode, got %q", spec.LaunchMode)
	}
	if got := strings.TrimSpace(spec.WrapperDriver); got != "stable-diffusion.cpp" {
		t.Fatalf("unexpected wrapper driver: %q", got)
	}
	if got := strings.TrimSpace(spec.ArchiveURL); got == "" {
		t.Fatal("expected archive URL for Windows managed image backend package")
	}
}

// --- Adapter/DTO conversion tests ---

func TestResolveEngineConfigOverrides(t *testing.T) {
	// Default values.
	cfg, err := resolveEngineConfig("llama", "", 0)
	if err != nil {
		t.Fatalf("resolveEngineConfig: %v", err)
	}
	if cfg.Version != defaultLlamaVersion {
		t.Errorf("expected default version %s, got %s", defaultLlamaVersion, cfg.Version)
	}
	if cfg.Port != 1234 {
		t.Errorf("expected default port 1234, got %d", cfg.Port)
	}

	// Override version and port.
	cfg2, err := resolveEngineConfig("llama", "2.0", 9999)
	if err != nil {
		t.Fatalf("resolveEngineConfig: %v", err)
	}
	if cfg2.Version != "2.0" {
		t.Errorf("expected overridden version 2.0, got %s", cfg2.Version)
	}
	if cfg2.Port != 9999 {
		t.Errorf("expected overridden port 9999, got %d", cfg2.Port)
	}
}

func TestSupervisorInfoToDTOTimeFormat(t *testing.T) {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	info := SupervisorInfo{
		Kind:      EngineLlama,
		Version:   "b8575",
		Port:      1234,
		Status:    StatusHealthy,
		StartedAt: now,
	}
	dto := supervisorInfoToDTO(info)

	if dto.StartedAt != "2026-03-01T12:00:00Z" {
		t.Errorf("expected RFC3339 StartedAt, got %s", dto.StartedAt)
	}
	if dto.LastHealthyAt != "" {
		t.Errorf("expected empty LastHealthyAt for zero time, got %s", dto.LastHealthyAt)
	}

	// With LastHealthyAt set.
	info.LastHealthyAt = now.Add(5 * time.Minute)
	dto2 := supervisorInfoToDTO(info)
	if dto2.LastHealthyAt != "2026-03-01T12:05:00Z" {
		t.Errorf("expected RFC3339 LastHealthyAt, got %s", dto2.LastHealthyAt)
	}

	// BinarySizeBytes pass-through.
	info.BinarySizeBytes = 12345
	dto3 := supervisorInfoToDTO(info)
	if dto3.BinarySizeBytes != 12345 {
		t.Errorf("expected BinarySizeBytes 12345, got %d", dto3.BinarySizeBytes)
	}
}

func TestSupervisorInfoBinarySizeBytes(t *testing.T) {
	dir := t.TempDir()
	binaryPath := filepath.Join(dir, "fake-binary")
	content := []byte("0123456789")
	if err := os.WriteFile(binaryPath, content, 0o755); err != nil {
		t.Fatalf("write fake binary: %v", err)
	}

	cfg := DefaultLlamaConfig()
	cfg.BinaryPath = binaryPath
	sup := NewSupervisor(cfg, nil, nil)

	info := sup.Info()
	if info.BinarySizeBytes != int64(len(content)) {
		t.Errorf("expected BinarySizeBytes %d, got %d", len(content), info.BinarySizeBytes)
	}

	// Non-existent path → 0.
	cfg2 := DefaultLlamaConfig()
	cfg2.BinaryPath = filepath.Join(dir, "nonexistent")
	sup2 := NewSupervisor(cfg2, nil, nil)
	info2 := sup2.Info()
	if info2.BinarySizeBytes != 0 {
		t.Errorf("expected BinarySizeBytes 0 for missing path, got %d", info2.BinarySizeBytes)
	}
}

// --- Port conflict resolution test ---

// --- State change callback test ---
