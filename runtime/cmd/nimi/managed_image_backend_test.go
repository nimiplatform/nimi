package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

func TestRunManagedImageBackendServePassesCUDARuntimeDir(t *testing.T) {
	originalRunServer := managedImageBackendRunServer
	t.Cleanup(func() {
		managedImageBackendRunServer = originalRunServer
	})

	var captured managedimagebackend.ServerConfig
	managedImageBackendRunServer = func(_ context.Context, cfg managedimagebackend.ServerConfig) error {
		captured = cfg
		return context.Canceled
	}

	cudaRuntimeDir := filepath.Join(t.TempDir(), "nvidia-cuda-user-space-runtime")
	if err := runManagedImageBackendServe([]string{
		"--listen", "127.0.0.1:50052",
		"--driver", "stable-diffusion.cpp",
		"--backend-executable", filepath.Join(t.TempDir(), "sd.exe"),
		"--cuda-runtime-dir", cudaRuntimeDir,
	}); err != nil {
		t.Fatalf("runManagedImageBackendServe: %v", err)
	}

	if captured.CUDARuntimeDir != cudaRuntimeDir {
		t.Fatalf("CUDARuntimeDir = %q, want %q", captured.CUDARuntimeDir, cudaRuntimeDir)
	}
}
