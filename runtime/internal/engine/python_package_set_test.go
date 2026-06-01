package engine

import (
	"context"
	"strings"
	"testing"
)

func TestStableDiffusionCPPPackageSetDeclaresNoExternalPackages(t *testing.T) {
	manifest, err := resolvePythonPackageSetManifest("stable-diffusion.cpp.cuda")
	if err != nil {
		t.Fatalf("resolvePythonPackageSetManifest: %v", err)
	}
	if manifest.ID != "media-proxy-execution-core" {
		t.Fatalf("manifest id = %q, want media-proxy-execution-core", manifest.ID)
	}
	if pythonPackageSetHasPackages(manifest.Packages) {
		t.Fatalf("stable-diffusion.cpp package set must not declare uv-managed packages: %v", manifest.Packages)
	}
	if len(manifest.ImportProbes) != 1 || manifest.ImportProbes[0] != "json" {
		t.Fatalf("import probes = %v, want json probe", manifest.ImportProbes)
	}
}

func TestUVPipInstallRejectsEmptyPackageList(t *testing.T) {
	err := uvPipInstall(context.Background(), "uv", "python", nil)
	if err == nil {
		t.Fatal("uvPipInstall accepted an empty package list")
	}
	if !strings.Contains(err.Error(), "requires at least one declared package") {
		t.Fatalf("error = %q, want declared package guard", err.Error())
	}
}
