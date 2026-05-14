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
	"strings"
	"testing"
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

func TestInstallManagedImageBackendFromDirectArchive(t *testing.T) {
	archive := makeFakeArchiveAsset(t, "payload.zip", "sd.exe", []byte("fake-windows-backend"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/sd.zip":
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
	if err := installManagedImageBackendFromDirectArchive(context.Background(), backendsPath, "stablediffusion-ggml", spec); err != nil {
		t.Fatalf("installManagedImageBackendFromDirectArchive: %v", err)
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
	mgr, err := NewManager(nil, t.TempDir(), nil)
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
	if !errors.Is(err, ErrManagedImageBackendMaterializationRequired) {
		t.Fatalf("expected materialization-required error, got %v", err)
	}
	if _, statErr := os.Stat(backendsPath); !os.IsNotExist(statErr) {
		t.Fatalf("startup path must not install or create backend root, stat err=%v", statErr)
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
