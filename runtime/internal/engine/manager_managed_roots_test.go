package engine

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// TestNewManagerResolvesInstallRootsFromDataPlaneRoots is the regression guard
// for the engine install-root vs K-CFG-018 data-plane contract alignment. The
// engine manager must install native engine packages, the managed Python
// environment, the uv tool, and venvs under the injected data-plane roots —
// never under a home-directory ~/.nimi/engines tree. (K-CFG-018, K-LENG-004)
func TestNewManagerResolvesInstallRootsFromDataPlaneRoots(t *testing.T) {
	roots := testManagedRoots(t)
	mgr, err := NewManager(nil, roots, nil)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	if mgr.baseDir != roots.Environments {
		t.Fatalf("baseDir mismatch: got %q want %q", mgr.baseDir, roots.Environments)
	}
	if mgr.depsDir != roots.Dependencies {
		t.Fatalf("depsDir mismatch: got %q want %q", mgr.depsDir, roots.Dependencies)
	}

	// Native engine packages, the managed llama backends, and managed image
	// backends are executable environments -> environments root.
	if got, want := mgr.llamaBackendsPath, filepath.Join(roots.Environments, "llama-backends"); got != want {
		t.Fatalf("llamaBackendsPath mismatch: got %q want %q", got, want)
	}
	if got, want := mgr.managedImageBackendsPath, filepath.Join(roots.Environments, "managed-image-backends"); got != want {
		t.Fatalf("managedImageBackendsPath mismatch: got %q want %q", got, want)
	}
	// The shared accelerator/CUDA runtime is a standalone downloaded payload
	// -> dependencies root.
	if got, want := mgr.sharedAcceleratorDependenciesPath, filepath.Join(roots.Dependencies, "accelerator-dependencies"); got != want {
		t.Fatalf("sharedAcceleratorDependenciesPath mismatch: got %q want %q", got, want)
	}

	// No managed install path may resolve under a home-directory engines tree.
	for name, path := range map[string]string{
		"baseDir":                  mgr.baseDir,
		"depsDir":                  mgr.depsDir,
		"llamaBackendsPath":        mgr.llamaBackendsPath,
		"managedImageBackendsPath": mgr.managedImageBackendsPath,
		"sharedAcceleratorDeps":    mgr.sharedAcceleratorDependenciesPath,
	} {
		if strings.Contains(filepath.ToSlash(path), "/.nimi/engines") {
			t.Fatalf("%s leaked a home-directory engines path: %q", name, path)
		}
	}
}

// TestNewManagerFailsClosedWithoutDataRoot verifies the engine manager fails
// closed with a typed ErrManagedRootUnresolved error when no data-plane root is
// configured, instead of silently falling back to ~/.nimi/engines. This is the
// fail-closed guarantee that forbids a parallel install-root truth.
// (K-CFG-018, parallel_truth: forbidden)
func TestNewManagerFailsClosedWithoutDataRoot(t *testing.T) {
	cases := []struct {
		name  string
		roots ManagedRoots
	}{
		{"both empty", ManagedRoots{}},
		{"environments empty", ManagedRoots{Dependencies: t.TempDir()}},
		{"dependencies empty", ManagedRoots{Environments: t.TempDir()}},
		{"environments relative", ManagedRoots{Environments: "relative/env", Dependencies: t.TempDir()}},
		{"dependencies relative", ManagedRoots{Environments: t.TempDir(), Dependencies: "relative/deps"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mgr, err := NewManager(nil, tc.roots, nil)
			if err == nil {
				t.Fatalf("expected NewManager to fail closed, got manager %v", mgr)
			}
			if !errors.Is(err, ErrManagedRootUnresolved) {
				t.Fatalf("expected ErrManagedRootUnresolved, got %v", err)
			}
		})
	}
}

// TestSupervisorPidPathResolvesFromSupervisedRoot verifies the supervised
// engine pid file derives from the data-plane environments root stamped on the
// EngineConfig, and yields no path when the root is unset (no home fallback).
// (K-CFG-018, K-LENG-004)
func TestSupervisorPidPathResolvesFromSupervisedRoot(t *testing.T) {
	root := t.TempDir()
	sup := NewSupervisor(EngineConfig{Kind: EngineLlama, SupervisedRoot: root}, testLogger(), nil)
	got := sup.pidFilePath()
	want := filepath.Join(root, string(EngineLlama), "supervised.pid")
	if got != want {
		t.Fatalf("pidFilePath mismatch: got %q want %q", got, want)
	}

	unset := NewSupervisor(EngineConfig{Kind: EngineLlama}, testLogger(), nil)
	if path := unset.pidFilePath(); path != "" {
		t.Fatalf("expected empty pid path without SupervisedRoot, got %q", path)
	}

	relative := NewSupervisor(EngineConfig{Kind: EngineLlama, SupervisedRoot: "relative/env"}, testLogger(), nil)
	if path := relative.pidFilePath(); path != "" {
		t.Fatalf("expected empty pid path for relative SupervisedRoot, got %q", path)
	}
}
