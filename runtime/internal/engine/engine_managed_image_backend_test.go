package engine

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestParseOCIImageReference(t *testing.T) {
	got, err := parseOCIImageReference("registry.example.com/test/local-ai-backends:test-tag")
	if err != nil {
		t.Fatalf("parseOCIImageReference: %v", err)
	}
	if got.Registry != "registry.example.com" {
		t.Fatalf("registry mismatch: %q", got.Registry)
	}
	if got.Repository != "test/local-ai-backends" {
		t.Fatalf("repository mismatch: %q", got.Repository)
	}
	if got.Reference != "test-tag" {
		t.Fatalf("reference mismatch: %q", got.Reference)
	}
}

func TestInstallManagedImageBackendFromOCI(t *testing.T) {
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
	defer func() { server.Close() }()

	oldTransport := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	t.Cleanup(func() {
		http.DefaultTransport = oldTransport
	})

	registryHost := strings.TrimPrefix(server.URL, "https://")
	backendsPath := t.TempDir()
	err := installManagedImageBackendFromOCI(context.Background(), backendsPath, "stablediffusion-ggml", managedImageBackendPackageSpec{
		BackendName:    "stablediffusion-ggml",
		OS:             "darwin",
		Arch:           "arm64",
		GPUVendor:      "apple",
		InstallDirName: "metal-stablediffusion-ggml",
		ImageRef:       registryHost + "/test/llama-backends:test-tag",
		OCILayerDigest: layerDigest,
		Supported:      true,
	})
	if err != nil {
		t.Fatalf("installManagedImageBackendFromOCI: %v", err)
	}

	runPath := filepath.Join(backendsPath, "metal-stablediffusion-ggml", "run.sh")
	if _, err := os.Stat(runPath); err != nil {
		t.Fatalf("expected run.sh to be installed: %v", err)
	}

	metadata, err := readManagedImageBackendMetadata(filepath.Join(backendsPath, "metal-stablediffusion-ggml", "metadata.json"))
	if err != nil {
		t.Fatalf("readManagedImageBackendMetadata: %v", err)
	}
	if metadata == nil {
		t.Fatal("expected metadata.json to be installed")
	}
	if metadata.Alias != "stablediffusion-ggml" {
		t.Fatalf("backend alias mismatch: %q", metadata.Alias)
	}
}

func TestInstallManagedImageBackendFromOCIRequiresAuthorityDigest(t *testing.T) {
	tarball := makeFakeArchiveAsset(t, "backend.tar.gz", "run.sh", []byte("#!/bin/sh\n"))
	layerDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(tarball))

	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/test/llama-backends/manifests/test-tag":
			w.Header().Set("Content-Type", ociManifestMediaTypeV2)
			_, _ = w.Write([]byte(fmt.Sprintf(`{"schemaVersion":2,"mediaType":"%s","layers":[{"mediaType":"application/vnd.docker.image.rootfs.diff.tar.gzip","digest":"%s"}]}`, ociManifestMediaTypeV2, layerDigest)))
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	oldTransport := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	t.Cleanup(func() {
		http.DefaultTransport = oldTransport
	})

	registryHost := strings.TrimPrefix(server.URL, "https://")
	err := installManagedImageBackendFromOCI(context.Background(), t.TempDir(), "stablediffusion-ggml", managedImageBackendPackageSpec{
		BackendName:    "stablediffusion-ggml",
		InstallDirName: "metal-stablediffusion-ggml",
		ImageRef:       registryHost + "/test/llama-backends:test-tag",
		Supported:      true,
	})
	if err == nil {
		t.Fatal("expected OCI install without admitted digest to fail")
	}
	if !strings.Contains(err.Error(), "admitted OCI layer digest is required") {
		t.Fatalf("expected admitted digest error, got %v", err)
	}
}

func TestInstallManagedImageBackendFromOCIRejectsManifestDigestDrift(t *testing.T) {
	tarball := makeFakeArchiveAsset(t, "backend.tar.gz", "run.sh", []byte("#!/bin/sh\n"))
	layerDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(tarball))
	otherDigest := "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/test/llama-backends/manifests/test-tag":
			w.Header().Set("Content-Type", ociManifestMediaTypeV2)
			_, _ = w.Write([]byte(fmt.Sprintf(`{"schemaVersion":2,"mediaType":"%s","layers":[{"mediaType":"application/vnd.docker.image.rootfs.diff.tar.gzip","digest":"%s"}]}`, ociManifestMediaTypeV2, layerDigest)))
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	oldTransport := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	t.Cleanup(func() {
		http.DefaultTransport = oldTransport
	})

	registryHost := strings.TrimPrefix(server.URL, "https://")
	err := installManagedImageBackendFromOCI(context.Background(), t.TempDir(), "stablediffusion-ggml", managedImageBackendPackageSpec{
		BackendName:    "stablediffusion-ggml",
		InstallDirName: "metal-stablediffusion-ggml",
		ImageRef:       registryHost + "/test/llama-backends:test-tag",
		OCILayerDigest: otherDigest,
		Supported:      true,
	})
	if !errors.Is(err, ErrEngineBinaryHashMismatch) {
		t.Fatalf("expected digest mismatch, got %v", err)
	}
}

func TestDownloadOCIImageBlobToFileRejectsBodyDigestMismatch(t *testing.T) {
	expectedDigest := "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/test/llama-backends/blobs/"+expectedDigest {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("wrong-body"))
	}))
	defer func() { server.Close() }()

	oldTransport := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	t.Cleanup(func() {
		http.DefaultTransport = oldTransport
	})

	registryHost := strings.TrimPrefix(server.URL, "https://")
	ref, err := parseOCIImageReference(registryHost + "/test/llama-backends:test-tag")
	if err != nil {
		t.Fatalf("parseOCIImageReference: %v", err)
	}
	_, err = downloadOCIImageBlobToFile(context.Background(), ref, expectedDigest, filepath.Join(t.TempDir(), "layer.tar.gz"))
	if !errors.Is(err, ErrEngineBinaryHashMismatch) {
		t.Fatalf("expected body digest mismatch, got %v", err)
	}
}

func TestDownloadOCIImageBlobToFileReportsProgress(t *testing.T) {
	body := []byte("fake-oci-layer")
	expectedDigest := fmt.Sprintf("sha256:%x", sha256.Sum256(body))
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/test/llama-backends/blobs/"+expectedDigest {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		_, _ = w.Write(body)
	}))
	defer func() { server.Close() }()

	oldTransport := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	t.Cleanup(func() {
		http.DefaultTransport = oldTransport
	})

	registryHost := strings.TrimPrefix(server.URL, "https://")
	ref, err := parseOCIImageReference(registryHost + "/test/llama-backends:test-tag")
	if err != nil {
		t.Fatalf("parseOCIImageReference: %v", err)
	}
	progressCalls := 0
	var lastReceived int64
	var lastTotal int64
	ctx := WithDownloadProgress(context.Background(), func(bytesReceived, bytesTotal int64) {
		progressCalls++
		lastReceived = bytesReceived
		lastTotal = bytesTotal
	})

	if _, err := downloadOCIImageBlobToFile(ctx, ref, expectedDigest, filepath.Join(t.TempDir(), "layer.tar.gz")); err != nil {
		t.Fatalf("downloadOCIImageBlobToFile: %v", err)
	}
	if progressCalls == 0 || lastReceived != int64(len(body)) || lastTotal != int64(len(body)) {
		t.Fatalf("oci blob progress = calls:%d received:%d total:%d want final %d/%d", progressCalls, lastReceived, lastTotal, len(body), len(body))
	}
}

func TestInstallManagedImageBackendFromDirectArchive(t *testing.T) {
	archive := makeFakeArchiveAsset(t, "payload.zip", "sd.exe", []byte("fake-windows-backend"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sd.zip":
			w.Header().Set("Content-Length", strconv.Itoa(len(archive)))
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	backendsPath := t.TempDir()
	spec := managedImageBackendPackageSpec{
		BackendName:          "stablediffusion-ggml",
		InstallDirName:       "sd-win-cuda12-x64-stablediffusion-ggml",
		PackageFormat:        managedImageBackendPackageFormatDirectArchive,
		ArchiveURL:           server.URL + "/sd.zip",
		ArchiveSHA256:        fmt.Sprintf("%x", sha256.Sum256(archive)),
		ExecutableCandidates: []string{"sd.exe"},
		Supported:            true,
	}
	progressCalls := 0
	var lastReceived int64
	var lastTotal int64
	progress := func(bytesReceived, bytesTotal int64) {
		progressCalls++
		lastReceived = bytesReceived
		lastTotal = bytesTotal
	}
	if err := installManagedImageBackendFromDirectArchive(context.Background(), backendsPath, "stablediffusion-ggml", spec, progress); err != nil {
		t.Fatalf("installManagedImageBackendFromDirectArchive: %v", err)
	}
	if progressCalls == 0 || lastReceived != int64(len(archive)) || lastTotal != int64(len(archive)) {
		t.Fatalf("managed image direct archive progress = calls:%d received:%d total:%d want final %d/%d", progressCalls, lastReceived, lastTotal, len(archive), len(archive))
	}
	executablePath := filepath.Join(backendsPath, spec.InstallDirName, "sd.exe")
	if _, err := os.Stat(executablePath); err != nil {
		t.Fatalf("expected Windows backend executable to be installed: %v", err)
	}
	metadata, err := readManagedImageBackendMetadata(filepath.Join(backendsPath, spec.InstallDirName, "metadata.json"))
	if err != nil {
		t.Fatalf("readManagedImageBackendMetadata: %v", err)
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

	launchCfg, err := discoverInstalledManagedImageBackendLaunchConfig(backendsPath, t.TempDir(), "stablediffusion-ggml", managedImageBackendPackageSpec{
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

func TestManagedImageBackendDependencyStatusUsesResolvedWrapperExecutableOnly(t *testing.T) {
	backendDir := filepath.Join(t.TempDir(), "sd-win-cuda12-x64-stablediffusion-ggml")
	resolvedBackendExecutable := filepath.Join(backendDir, "sd-cli.exe")
	wrapperExecutable := filepath.Join(t.TempDir(), "nimi.exe")

	status := managedImageBackendDependencyStatusFromConfig(&ManagedImageBackendConfig{
		BackendName: "stablediffusion-ggml",
		Command:     wrapperExecutable,
		Args: []string{
			"managed-image-backend",
			"serve",
			"--listen", "127.0.0.1:50052",
			"--driver", "stable-diffusion.cpp",
			"--backend-executable", resolvedBackendExecutable,
		},
		WorkingDir: backendDir,
	}, managedImageBackendPackageSpec{
		BackendName:            "stablediffusion-ggml",
		InstallDirName:         "sd-win-cuda12-x64-stablediffusion-ggml",
		PackageSource:          managedImageBackendPackageSourceCanonicalRuntimeWrapper,
		PackageFormat:          managedImageBackendPackageFormatDirectArchive,
		LaunchMode:             managedImageBackendLaunchModeRuntimeWrapper,
		WrapperDriver:          "stable-diffusion.cpp",
		ExecutableCandidates:   []string{"sd.exe", "sd-cli.exe"},
		SupportedModelFamilies: []string{"flux", "ideogram4", "sdxl", "z-image"},
		Supported:              true,
	})

	if got := status.CanonicalRoot; got != backendDir {
		t.Fatalf("canonical root = %q, want %q", got, backendDir)
	}
	if !managedImageBackendArtifactListContains(status.VerifiedArtifacts, resolvedBackendExecutable) {
		t.Fatalf("verified artifacts = %v, want resolved backend executable %q", status.VerifiedArtifacts, resolvedBackendExecutable)
	}
	for _, artifact := range status.VerifiedArtifacts {
		if strings.EqualFold(filepath.Base(artifact), "sd.exe") {
			t.Fatalf("verified artifacts must not include unresolved executable candidate sd.exe: %v", status.VerifiedArtifacts)
		}
	}
	if !managedImageBackendStringSliceContains(status.SupportedModelFamilies, "ideogram4") {
		t.Fatalf("dependency status must carry supported model families, got %v", status.SupportedModelFamilies)
	}
	if !managedImageBackendStringSliceContains(status.SupportedModelFamilies, "z-image") ||
		managedImageBackendStringSliceContains(status.SupportedModelFamilies, "z-image-turbo") {
		t.Fatalf("dependency status must carry only the canonical z-image family, got %v", status.SupportedModelFamilies)
	}
}

func TestDiscoverInstalledManagedImageBackendRejectsAliasOnlyStaleRuntimeWrapperPackage(t *testing.T) {
	backendsPath := t.TempDir()
	staleBackendDir := filepath.Join(backendsPath, "sd-win-cuda12-x64-stablediffusion-ggml")
	if err := os.MkdirAll(staleBackendDir, 0o755); err != nil {
		t.Fatalf("mkdir stale backend dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(staleBackendDir, "sd.exe"), []byte("fake-stale-backend"), 0o755); err != nil {
		t.Fatalf("write stale sd.exe: %v", err)
	}
	if err := os.WriteFile(filepath.Join(staleBackendDir, "metadata.json"), []byte(`{"name":"sd-win-cuda12-x64-stablediffusion-ggml","alias":"stablediffusion-ggml"}`), 0o644); err != nil {
		t.Fatalf("write stale metadata.json: %v", err)
	}

	_, _, err := discoverInstalledManagedImageBackendExecutablePath(backendsPath, "stablediffusion-ggml", managedImageBackendPackageSpec{
		BackendName:          "stablediffusion-ggml",
		InstallDirName:       "sd-win-cuda12-x64-stablediffusion-ggml-8caa3f9",
		LaunchMode:           managedImageBackendLaunchModeRuntimeWrapper,
		WrapperDriver:        "stable-diffusion.cpp",
		ExecutableCandidates: []string{"sd.exe"},
	})
	if err == nil {
		t.Fatal("expected stale alias-only runtime wrapper package to be rejected")
	}
	if !strings.Contains(err.Error(), `managed image backend "stablediffusion-ggml" not installed`) {
		t.Fatalf("unexpected stale package error: %v", err)
	}
}

func managedImageBackendArtifactListContains(artifacts []string, want string) bool {
	for _, artifact := range artifacts {
		if artifact == want {
			return true
		}
	}
	return false
}

func managedImageBackendStringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestDiscoverInstalledManagedImageBackendLaunchConfigInjectsManagedCUDAPathProcessOnly(t *testing.T) {
	if currentGOOS() != "windows" {
		t.Skip("Windows-only process PATH injection")
	}
	backendsPath := t.TempDir()
	dependenciesPath := t.TempDir()
	backendDir := filepath.Join(backendsPath, "sd-win-cuda12-x64-stablediffusion-ggml")
	dependencyDir := filepath.Join(dependenciesPath, NVIDIACUDAUserSpaceRuntimeDependencyID)
	if err := os.MkdirAll(backendDir, 0o755); err != nil {
		t.Fatalf("mkdir backend dir: %v", err)
	}
	if err := os.MkdirAll(dependencyDir, 0o755); err != nil {
		t.Fatalf("mkdir dependency dir: %v", err)
	}
	for name, contents := range map[string][]byte{
		"sd.exe":        []byte("fake-windows-backend"),
		"metadata.json": []byte(`{"name":"sd-win-cuda12-x64-stablediffusion-ggml","alias":"stablediffusion-ggml"}`),
	} {
		if err := os.WriteFile(filepath.Join(backendDir, name), contents, 0o755); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	for _, artifact := range nvidiaCUDAUserSpaceRuntimeRequiredArtifacts {
		if err := os.WriteFile(filepath.Join(dependencyDir, artifact), []byte("fake-"+artifact), 0o755); err != nil {
			t.Fatalf("write %s: %v", artifact, err)
		}
	}

	originalExecutable := managedImageBackendCurrentExecutable
	managedImageBackendCurrentExecutable = func() (string, error) {
		return filepath.Join(t.TempDir(), "nimi.exe"), nil
	}
	t.Cleanup(func() {
		managedImageBackendCurrentExecutable = originalExecutable
	})
	t.Setenv("PATH", `C:\Windows\System32`)

	launchCfg, err := discoverInstalledManagedImageBackendLaunchConfig(backendsPath, dependenciesPath, "stablediffusion-ggml", managedImageBackendPackageSpec{
		BackendName:          "stablediffusion-ggml",
		InstallDirName:       "sd-win-cuda12-x64-stablediffusion-ggml",
		PackageSource:        managedImageBackendPackageSourceCanonicalRuntimeWrapper,
		LaunchMode:           managedImageBackendLaunchModeRuntimeWrapper,
		WrapperDriver:        "stable-diffusion.cpp",
		ExecutableCandidates: []string{"sd.exe"},
	}, "127.0.0.1:50052")
	if err != nil {
		t.Fatalf("discoverInstalledManagedImageBackendLaunchConfig: %v", err)
	}
	if got := launchCfg.Env["PATH"]; !strings.HasPrefix(got, dependencyDir+string(os.PathListSeparator)) {
		t.Fatalf("expected process PATH to prepend managed CUDA dependency dir, got %q", got)
	}
	if got := strings.Join(launchCfg.Args, " "); !strings.Contains(got, "--cuda-runtime-dir "+dependencyDir) {
		t.Fatalf("expected wrapper args to carry CUDA runtime dir, got %q", got)
	}
	if got := os.Getenv("PATH"); got != `C:\Windows\System32` {
		t.Fatalf("host PATH must not be mutated, got %q", got)
	}
}

func TestResolveInstalledManagedImageBackendRequiresMaterializerWithoutCreatingRoot(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	spec, ok := resolveManagedImageBackendPackageSpecForCurrentHostWithSource("stablediffusion-ggml", "")
	if !ok || !spec.Supported {
		t.Skip("current host has no supported managed image backend package spec")
	}
	backendsPath := filepath.Join(t.TempDir(), "managed-image-backends")
	_, err := resolveInstalledManagedImageBackendConfig(backendsPath, t.TempDir(), &ManagedImageBackendConfig{
		Mode:        ManagedImageBackendOfficial,
		BackendName: "stablediffusion-ggml",
		Address:     "127.0.0.1:50052",
	})
	if !errors.Is(err, ErrManagedImageBackendMaterializationRequired) {
		t.Fatalf("expected materialization-required error, got %v", err)
	}
	if _, statErr := os.Stat(backendsPath); !os.IsNotExist(statErr) {
		t.Fatalf("installed-only resolution must not create backend root, stat err=%v", statErr)
	}
}

func TestEnsureManagedImageBackendRequiresMaterializerWithoutInstalling(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "nvidia")
	spec, ok := resolveManagedImageBackendPackageSpecForCurrentHostWithSource("stablediffusion-ggml", "")
	if !ok || !spec.Supported {
		t.Skip("current host has no supported managed image backend package spec")
	}
	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	backendsPath := filepath.Join(t.TempDir(), "managed-image-backends")
	mgr.managedImageBackendsPath = backendsPath
	mgr.sharedAcceleratorDependenciesPath = t.TempDir()

	err = mgr.EnsureManagedImageBackend(context.Background(), &ManagedImageBackendConfig{
		Mode:        ManagedImageBackendOfficial,
		BackendName: "stablediffusion-ggml",
		Address:     "127.0.0.1:50052",
	})
	if currentGOOS() == "windows" && strings.EqualFold(detectLocalGPUVendor(), "nvidia") {
		if err == nil || !strings.Contains(err.Error(), "shared accelerator dependency") {
			t.Fatalf("expected shared accelerator dependency gate, got %v", err)
		}
	} else if !errors.Is(err, ErrManagedImageBackendMaterializationRequired) {
		t.Fatalf("expected materialization-required error, got %v", err)
	}
	if _, statErr := os.Stat(backendsPath); !os.IsNotExist(statErr) {
		t.Fatalf("startup path must not install or create backend root, stat err=%v", statErr)
	}
}

func TestEnsureManagedImageBackendDependencyStopsRunningBackendBeforeInstall(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GPU_VENDOR", "test")
	archive := makeFakeArchiveAsset(t, "payload.zip", "sd.exe", []byte("fake-windows-backend"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sd.zip":
			w.Header().Set("Content-Length", strconv.Itoa(len(archive)))
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer func() { server.Close() }()

	originalAuthorityYAML := managedImageBackendPackagesAuthorityYAML
	originalAuthority := managedImageBackendPackageAuthority
	managedImageBackendPackagesAuthorityYAML = []byte(fmt.Sprintf(`
entries:
  - host_match:
      os: %s
      arch: %s
      gpu_vendor: ""
    backend_family: stablediffusion-ggml
    package_source: canonical_runtime_wrapper
    package_format: direct_archive
    install_dir_name: sd-test-runtime-wrapper
    archive_url: %s
    archive_sha256: %x
    executable_candidates: [sd.exe]
    supported_model_families: [ideogram4]
    launch_mode: runtime_wrapper
    wrapper_driver: stable-diffusion.cpp
    product_state: supported
`, currentGOOS(), currentGOARCH(), server.URL+"/sd.zip", sha256.Sum256(archive)))
	managedImageBackendPackageAuthority = sync.OnceValues(loadManagedImageBackendPackageSpecsFromAuthority)
	t.Cleanup(func() {
		managedImageBackendPackagesAuthorityYAML = originalAuthorityYAML
		managedImageBackendPackageAuthority = originalAuthority
	})

	mgr, err := NewManager(nil, testManagedRoots(t), nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	mgr.managedImageBackendsPath = filepath.Join(t.TempDir(), "managed-image-backends")
	mgr.sharedAcceleratorDependenciesPath = t.TempDir()
	cudaRuntimeDir := filepath.Join(mgr.sharedAcceleratorDependenciesPath, NVIDIACUDAUserSpaceRuntimeDependencyID)
	if err := os.MkdirAll(cudaRuntimeDir, 0o755); err != nil {
		t.Fatalf("create fake CUDA runtime dir: %v", err)
	}
	for _, artifact := range nvidiaCUDAUserSpaceRuntimeRequiredArtifacts {
		if err := os.WriteFile(filepath.Join(cudaRuntimeDir, artifact), []byte("dll"), 0o600); err != nil {
			t.Fatalf("write fake CUDA artifact %s: %v", artifact, err)
		}
	}
	running := NewSupervisor(EngineConfig{Kind: engineManagedImageBackend, ShutdownTimeout: 10}, nil, nil)
	running.SetStateForTesting(StatusHealthy, time.Now())
	mgr.SetSupervisorForTesting(engineManagedImageBackend, running)

	status, err := mgr.EnsureManagedImageBackendDependency(context.Background(), &ManagedImageBackendConfig{
		Mode:          ManagedImageBackendOfficial,
		BackendName:   "stablediffusion-ggml",
		PackageSource: string(managedImageBackendPackageSourceCanonicalRuntimeWrapper),
		Address:       "127.0.0.1:50052",
	})
	if err != nil {
		t.Fatalf("EnsureManagedImageBackendDependency: %v", err)
	}
	if status.CanonicalRoot == "" {
		t.Fatalf("expected materialized backend status, got %#v", status)
	}
	if _, ok := mgr.supervisors[engineManagedImageBackend]; ok {
		t.Fatal("expected managed image backend supervisor to be stopped before package install")
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
	if !managedImageBackendStringSliceContains(spec.SupportedModelFamilies, "ideogram4") {
		t.Fatalf("expected Windows managed image backend package to declare ideogram4 support, got %v", spec.SupportedModelFamilies)
	}
	if !managedImageBackendStringSliceContains(spec.SupportedModelFamilies, "z-image") ||
		managedImageBackendStringSliceContains(spec.SupportedModelFamilies, "z-image-turbo") {
		t.Fatalf("expected Windows managed image backend package to declare only the canonical z-image family, got %v", spec.SupportedModelFamilies)
	}
	if !strings.Contains(spec.InstallDirName, "bfbef5b") {
		t.Fatalf("expected release-qualified Windows install dir, got %q", spec.InstallDirName)
	}
}

func TestResolveManagedImageBackendPackageSpecForHostWindowsNvidiaWithoutCUDA(t *testing.T) {
	spec, ok := resolveManagedImageBackendPackageSpecForHost(
		"stablediffusion-ggml",
		"windows",
		"amd64",
		"nvidia",
		false,
	)
	if !ok {
		t.Fatal("expected Windows nvidia host without global CUDA to resolve a managed image backend package")
	}
	if !spec.Supported {
		t.Fatalf("expected Windows managed image backend package to be supported, got %#v", spec)
	}
	if len(spec.ExecutableCandidates) == 0 {
		t.Fatal("expected Windows package to declare executable candidates")
	}
}

func TestResolveManagedImageBackendPackageSpecForHostDarwinApple(t *testing.T) {
	spec, ok := resolveManagedImageBackendPackageSpecForHost(
		"stablediffusion-ggml",
		"darwin",
		"arm64",
		"apple",
		false,
	)
	if !ok {
		t.Fatal("expected darwin apple host to resolve a managed image backend package")
	}
	if !spec.Supported {
		t.Fatalf("expected darwin managed image backend package to be supported, got %#v", spec)
	}
	if spec.PackageSource != managedImageBackendPackageSourceCanonicalLocalAIDerived {
		t.Fatalf("expected canonical LocalAI-derived package source, got %q", spec.PackageSource)
	}
	if spec.PackageFormat != managedImageBackendPackageFormatOCIPayload {
		t.Fatalf("expected OCI payload package format, got %q", spec.PackageFormat)
	}
	if spec.LaunchMode != managedImageBackendLaunchModePackageEntrypoint {
		t.Fatalf("expected package entrypoint launch mode, got %q", spec.LaunchMode)
	}
	if len(spec.ExecutableCandidates) == 0 {
		t.Fatal("expected darwin package to declare executable candidates")
	}
	if strings.TrimSpace(spec.WrapperDriver) == "" {
		t.Fatal("expected darwin package to declare wrapper driver authority")
	}
	if got := strings.TrimSpace(spec.ImageRef); got == "" {
		t.Fatal("expected OCI image ref for darwin managed image backend package")
	}
	if got := strings.TrimSpace(spec.OCILayerDigest); got == "" {
		t.Fatal("expected OCI layer digest for darwin managed image backend package")
	}
	if strings.TrimSpace(spec.ArchiveURL) != "" {
		t.Fatalf("expected no archive URL for canonical darwin package, got %q", spec.ArchiveURL)
	}
}

func TestValidateManagedImageBackendPackageSpecRejectsIncompleteSupportedPackage(t *testing.T) {
	err := validateManagedImageBackendPackageSpec(managedImageBackendPackageSpec{
		BackendName:    "stablediffusion-ggml",
		PackageSource:  managedImageBackendPackageSourceCanonicalLocalAIDerived,
		PackageFormat:  managedImageBackendPackageFormatOCIPayload,
		InstallDirName: "metal-stablediffusion-ggml",
		ImageRef:       "quay.io/example/backend:latest",
		OCILayerDigest: "sha256:abc",
		LaunchMode:     managedImageBackendLaunchModePackageEntrypoint,
		Supported:      true,
	})
	if err == nil {
		t.Fatal("expected incomplete supported package to be rejected")
	}
}

func TestResolveManagedImageBackendPackageSpecForHostDarwinAppleExperimentalOfficialSourceIsNotSupported(t *testing.T) {
	spec, ok := resolveManagedImageBackendPackageSpecForHostWithSource(
		"stablediffusion-ggml",
		string(managedImageBackendPackageSourceExperimentalOfficialSDCPP),
		"darwin",
		"arm64",
		"apple",
		false,
	)
	if !ok {
		t.Fatal("expected darwin apple host to resolve the experimental official managed image backend package")
	}
	if spec.Supported {
		t.Fatalf("expected experimental darwin managed image backend package to remain non-supported, got %#v", spec)
	}
	if spec.PackageSource != managedImageBackendPackageSourceExperimentalOfficialSDCPP {
		t.Fatalf("expected experimental official package source, got %q", spec.PackageSource)
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
		t.Fatal("expected archive URL for experimental darwin managed image backend package")
	}
	if got := strings.TrimSpace(spec.ArchiveSHA256); got == "" {
		t.Fatal("expected archive SHA256 for experimental darwin managed image backend package")
	}
	if len(spec.ExecutableCandidates) != 1 || spec.ExecutableCandidates[0] != "sd-cli" {
		t.Fatalf("unexpected darwin executable candidates: %#v", spec.ExecutableCandidates)
	}
	if !strings.Contains(spec.Detail, "not admitted") {
		t.Fatalf("expected non-admitted detail for experimental package source, got %q", spec.Detail)
	}
}

func TestResolveManagedImageBackendPackageSpecForHostUnknownSourceFailsClosed(t *testing.T) {
	if spec, ok := resolveManagedImageBackendPackageSpecForHostWithSource(
		"stablediffusion-ggml",
		"unknown_source",
		"darwin",
		"arm64",
		"apple",
		false,
	); ok {
		t.Fatalf("expected unknown package source to fail closed, got %#v", spec)
	}
}
