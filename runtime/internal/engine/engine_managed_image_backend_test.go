package engine

import (
	"context"
	"crypto/sha256"
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
	defer server.Close()

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
	if strings.TrimSpace(spec.ArchiveURL) != "" {
		t.Fatalf("expected no archive URL for canonical darwin package, got %q", spec.ArchiveURL)
	}
}

func TestResolveManagedImageBackendPackageSpecForHostDarwinAppleExperimentalOfficialSource(t *testing.T) {
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
	if !spec.Supported {
		t.Fatalf("expected experimental darwin managed image backend package to be supported, got %#v", spec)
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
