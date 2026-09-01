package engine

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func setMediaHostGPUProbeForTest(t *testing.T, vendor string, driverVisible bool) {
	t.Helper()
	previous := mediaHostGPUProbe
	mediaHostGPUProbe = func() (string, bool) { return vendor, driverVisible }
	t.Cleanup(func() { mediaHostGPUProbe = previous })
}

func TestManagerDataRootQuiesceWaitsForInFlightStartAndAbortResumesAdmission(t *testing.T) {
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := mgr.beginEngineStart(EngineMedia); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- mgr.QuiesceDataRoot(ctx) }()
	deadline := time.Now().Add(time.Second)
	for {
		mgr.mu.RLock()
		closed := mgr.dataRootAdmissionClosed
		mgr.mu.RUnlock()
		if closed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("data-root quiesce did not close start admission")
		}
		time.Sleep(time.Millisecond)
	}
	select {
	case err := <-done:
		t.Fatalf("quiesce returned before in-flight start drained: %v", err)
	default:
	}
	mgr.finishEngineStart(EngineMedia)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := mgr.beginEngineStart(EngineMedia); !errors.Is(err, ErrEngineManagerDataRootQuiesced) {
		t.Fatalf("closed data-root admission accepted start: %v", err)
	}
	mgr.ResumeDataRootAfterAbort()
	if err := mgr.beginEngineStart(EngineMedia); err != nil {
		t.Fatalf("abort did not reopen data-root admission: %v", err)
	}
	mgr.finishEngineStart(EngineMedia)
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
	defer func() { server.Close() }()
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
	supported := []struct {
		goos   string
		goarch string
		want   string
	}{
		{goos: "darwin", goarch: "arm64", want: "llama-b8575-bin-macos-arm64.tar.gz"},
		{goos: "windows", goarch: "amd64", want: "llama-b8575-bin-win-cuda-12.4-x64.zip"},
	}

	for _, tt := range supported {
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
	for _, tuple := range [][2]string{{"darwin", "amd64"}, {"linux", "amd64"}, {"windows", "arm64"}} {
		if _, err := llamaAssetNameFor("b8575", tuple[0], tuple[1]); err == nil {
			t.Fatalf("llamaAssetNameFor(%q,%q) unexpectedly admitted", tuple[0], tuple[1])
		}
	}
}

func TestLlamaAssetNameCandidatesPreferWindowsNvidiaCUDA(t *testing.T) {
	got, err := llamaAssetNameCandidates("b8712", "windows", "amd64", "nvidia")
	if err != nil {
		t.Fatalf("llamaAssetNameCandidates: %v", err)
	}
	want := []string{"llama-b8712-bin-win-cuda-12.4-x64.zip"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("llamaAssetNameCandidates = %#v, want %#v", got, want)
	}
}

func TestLlamaReleaseAssetRequiresWindowsNvidiaCUDAWithoutCPUFallback(t *testing.T) {
	if currentGOOS() != "windows" || currentGOARCH() != "amd64" {
		t.Skip("Windows NVIDIA CUDA release selection is host-gated")
	}
	setMediaHostGPUProbeForTest(t, "nvidia", true)
	const version = "b8712"
	const cudaAsset = "llama-b8712-bin-win-cuda-12.4-x64.zip"
	const cpuAsset = "llama-b8712-bin-win-cpu-x64.zip"
	const cudaHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const cpuHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/"+version {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(fmt.Sprintf(`{"tag_name":"%s","assets":[{"name":"%s","browser_download_url":"https://github.com/ggml-org/llama.cpp/releases/download/%s/%s","digest":"sha256:%s"},{"name":"%s","browser_download_url":"https://github.com/ggml-org/llama.cpp/releases/download/%s/%s","digest":"sha256:%s"}]}`, version, cpuAsset, version, cpuAsset, cpuHash, cudaAsset, version, cudaAsset, cudaHash)))
	}))
	defer func() { server.Close() }()
	t.Cleanup(setLlamaReleaseSourceForTest(server.URL, server.Client()))

	asset, err := llamaReleaseAsset(version)
	if err != nil {
		t.Fatalf("llamaReleaseAsset: %v", err)
	}
	if asset.Name != cudaAsset || asset.SHA256 != cudaHash {
		t.Fatalf("expected CUDA asset, got %#v", asset)
	}

	fallbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/"+version {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(fmt.Sprintf(`{"tag_name":"%s","assets":[{"name":"%s","browser_download_url":"https://github.com/ggml-org/llama.cpp/releases/download/%s/%s","digest":"sha256:%s"}]}`, version, cpuAsset, version, cpuAsset, cpuHash)))
	}))
	defer func() { fallbackServer.Close() }()
	t.Cleanup(setLlamaReleaseSourceForTest(fallbackServer.URL, fallbackServer.Client()))

	if _, err = llamaReleaseAsset(version); err == nil {
		t.Fatal("expected missing CUDA asset to fail without CPU fallback")
	}
}

func TestLlamaRegistryEntryRequiresReplacementForLegacyCPUOnNvidiaHost(t *testing.T) {
	entry := &RegistryEntry{
		Engine:     EngineLlama,
		Version:    "b8712",
		BinaryPath: filepath.Join(t.TempDir(), llamaBinaryName()),
		AssetName:  "llama-b8712-bin-win-cpu-x64.zip",
	}
	if !llamaRegistryEntryRequiresReplacement(entry, "llama-b8712-bin-win-cuda-12.4-x64.zip") {
		t.Fatal("expected CPU registry entry to require replacement by preferred CUDA asset")
	}
	if llamaRegistryEntryRequiresReplacement(entry, "llama-b8712-bin-win-cpu-x64.zip") {
		t.Fatal("expected matching CPU registry entry to be reusable")
	}
}

func TestLlamaSupervisedPlatformSupportedFor(t *testing.T) {
	tests := []struct {
		goos   string
		goarch string
		want   bool
	}{
		{goos: "darwin", goarch: "arm64", want: true},
		{goos: "darwin", goarch: "amd64", want: false},
		{goos: "linux", goarch: "amd64", want: false},
		{goos: "linux", goarch: "arm64", want: false},
		{goos: "windows", goarch: "amd64", want: true},
		{goos: "windows", goarch: "arm64", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.goos+"-"+tt.goarch, func(t *testing.T) {
			if got := LlamaSupervisedPlatformSupportedFor(tt.goos, tt.goarch); got != tt.want {
				t.Fatalf("LlamaSupervisedPlatformSupportedFor(%q, %q) = %v, want %v", tt.goos, tt.goarch, got, tt.want)
			}
		})
	}
}

func TestLlamaSupervisedHostSupportedForExactBackend(t *testing.T) {
	tests := []struct {
		name      string
		goos      string
		goarch    string
		vendor    string
		cudaReady bool
		want      bool
	}{
		{name: "windows cuda", goos: "windows", goarch: "amd64", vendor: "nvidia", cudaReady: true, want: true},
		{name: "windows nvidia missing cuda", goos: "windows", goarch: "amd64", vendor: "nvidia", want: false},
		{name: "windows cpu fallback forbidden", goos: "windows", goarch: "amd64", vendor: "intel", want: false},
		{name: "macos metal target", goos: "darwin", goarch: "arm64", vendor: "apple", want: true},
		{name: "linux not in first release", goos: "linux", goarch: "amd64", vendor: "nvidia", cudaReady: true, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := LlamaSupervisedHostSupportedFor(test.goos, test.goarch, test.vendor, test.cudaReady); got != test.want {
				t.Fatalf("LlamaSupervisedHostSupportedFor() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestManagedImageSupervisedPlatformSupportedFor(t *testing.T) {
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
			if got := ManagedImageSupervisedPlatformSupportedFor(tt.goos, tt.goarch, tt.gpuVendor, tt.gpuModel); got != tt.want {
				t.Fatalf("ManagedImageSupervisedPlatformSupportedFor(%q, %q, %q, %q) = %v, want %v", tt.goos, tt.goarch, tt.gpuVendor, tt.gpuModel, got, tt.want)
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
		{goos: "darwin", goarch: "arm64", want: true},
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
			name:      "windows non nvidia unsupported",
			goos:      "windows",
			goarch:    "amd64",
			gpuVendor: "intel",
			cudaReady: false,
			want:      MediaHostSupportUnsupported,
		},
		{
			name:      "windows nvidia without cuda unsupported",
			goos:      "windows",
			goarch:    "amd64",
			gpuVendor: "nvidia",
			cudaReady: false,
			want:      MediaHostSupportUnsupported,
		},
		{
			name:      "macOS Apple Metal supported without CUDA",
			goos:      "darwin",
			goarch:    "arm64",
			gpuVendor: "apple",
			cudaReady: false,
			want:      MediaHostSupportSupportedSupervised,
		},
		{
			name:      "non windows unsupported",
			goos:      "linux",
			goarch:    "amd64",
			gpuVendor: "nvidia",
			cudaReady: true,
			want:      MediaHostSupportUnsupported,
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
	asset, err := llamaAssetNameFor(version, "darwin", "arm64")
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
	defer func() { server.Close() }()

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
	defer func() { server.Close() }()

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
	defer func() { server.Close() }()

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
	defer func() { server.Close() }()

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
	defer func() { server.Close() }()

	err := ProbeHealth(context.Background(), server.URL, "/", "engine is running")
	if err == nil {
		t.Error("expected error for body mismatch, got nil")
	}
}

func TestProbeHealthServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer func() { server.Close() }()

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
			_, _ = w.Write([]byte(`{"ready":true,"models":[{"id":"flux.1-schnell","ready":true}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer func() { server.Close() }()

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
			_, _ = w.Write([]byte(`{"ready":true,"models":[]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer func() { server.Close() }()

	if err := ProbeMediaHealth(context.Background(), server.URL); err == nil {
		t.Fatal("expected media health probe to fail without ready catalog models")
	}
}

func TestProbeMediaHealthProxyExecutionRequiresExecutionReadyCatalog(t *testing.T) {
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
	defer func() { server.Close() }()

	if err := ProbeMediaHealth(context.Background(), server.URL); err == nil {
		t.Fatal("expected proxy_execution media health to fail without ready catalog models")
	}
}

func TestProbeMediaHealthRejectsImageDriverPartialHealth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"ready":false,"image_driver":"stablediffusion-ggml"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer func() { server.Close() }()

	if err := ProbeMediaHealth(context.Background(), server.URL); err == nil {
		t.Fatal("expected media health to fail when healthz is not execution-ready")
	}
}

func TestProbeSpeechHealthRequiresCatalogReadyTrue(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","ready":true}`))
		case "/v1/catalog":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ready":false,"detail":"speech placeholder","models":[{"id":"speech-default","ready":true}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer func() { server.Close() }()

	if err := ProbeSpeechHealth(context.Background(), server.URL); err == nil {
		t.Fatal("expected speech health probe to fail when catalog reports ready=false")
	}
}

func TestWaitSpeechHealthAcceptsRequiredReadyDriverWithoutDiscoveredModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"not_ready","ready":false,"detail":"speech drivers configured but no managed speech bundles discovered","checks":{"voxcpm_driver":true,"voxcpm_driver_ready":true,"models_ready":0}}`))
		case "/v1/catalog":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"not_ready","ready":false,"models":[]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	cfg := EngineConfig{
		Kind:                       EngineSpeech,
		Address:                    strings.TrimPrefix(server.URL, "http://"),
		SpeechHostPackageSetRoot:   "voxcpm-exact",
		SpeechRequiredDriver:       SpeechDriverVoxCPM,
		SpeechVoxCPMPackageSetRoot: "voxcpm-exact",
		StartupTimeout:             time.Second,
	}
	if err := waitSupervisorHealthy(context.Background(), cfg, 10*time.Millisecond); err != nil {
		t.Fatalf("expected required ready speech driver to satisfy startup health without discovered models, got %v", err)
	}
}

func TestProbeSpeechHealthRejectsWrongReadyDriverForExactHost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","ready":true,"checks":{"qwen3_tts_driver_ready":true,"voxcpm_driver_ready":false,"voxcpm_driver_detail":"voxcpm preflight failed"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	cfg := EngineConfig{
		Kind:                       EngineSpeech,
		Address:                    strings.TrimPrefix(server.URL, "http://"),
		SpeechHostPackageSetRoot:   "voxcpm-exact",
		SpeechRequiredDriver:       SpeechDriverVoxCPM,
		SpeechVoxCPMPackageSetRoot: "voxcpm-exact",
	}
	err := probeSupervisorHealth(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "required driver voxcpm reported ready=false") {
		t.Fatalf("expected exact VoxCPM readiness failure, got %v", err)
	}
}

func TestProbeSpeechHealthPreservesBoundedOwnerDetail(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ready":false,"detail":"managed bundles are not ready","checks":{"qwen3_tts_driver_detail":"qwen3_tts driver preflight failed: access denied","qwen3_asr_driver_detail":"qwen3_asr driver ready"}}`))
	}))
	defer server.Close()

	err := ProbeSpeechHealth(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "qwen3_tts driver preflight failed: access denied") {
		t.Fatalf("expected speech owner detail, got %v", err)
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
			_, _ = w.Write([]byte(`{"ready":true,"models":[{"id":"` + oversizedModelID + `","ready":true}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer func() { server.Close() }()

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
			_, _ = w.Write([]byte(`{"ready":true,"models":[{"id":"speech-default","ready":true}]}`))
		case "/v1/models":
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"detail":"generic health path should not be used for speech"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer func() { server.Close() }()

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
	defer func() { _ = listener.Close() }()

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
	defer func() { server.Close() }()

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
	defer func() { server.Close() }()

	err := WaitHealthy(context.Background(), server.URL, "/v1/models", "", 50*time.Millisecond, 200*time.Millisecond)
	if err == nil {
		t.Error("expected timeout error, got nil")
	}
}

func TestWaitHealthyCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer func() { server.Close() }()

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
			_, _ = w.Write([]byte(`{"ready":true,"models":[{"id":"flux.1-schnell","ready":true}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer func() { server.Close() }()

	if err := WaitMediaHealthy(context.Background(), server.URL, 50*time.Millisecond, 5*time.Second); err != nil {
		t.Fatalf("expected media healthy after retries, got %v", err)
	}
}

// --- Port resolution tests ---
