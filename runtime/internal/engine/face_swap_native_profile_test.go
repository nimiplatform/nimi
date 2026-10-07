package engine

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestHyperSwapMacHostRejectsBackendAndPlatformSubstitution(t *testing.T) {
	if currentGOOS()+"/"+currentGOARCH() != "darwin/arm64" {
		t.Skip("native Mac Host boundary")
	}
	identity, err := ResolvePythonDependencyProfileIdentity(FaceSwapConsumerID, "darwin/arm64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), identity.ProfileDigest)
	files, err := PythonDependencyProfileStaticFiles(FaceSwapConsumerID, identity)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		path := filepath.Join(root, file.RelativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, file.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writePythonDependencyProfileManifest(root, FaceSwapConsumerID, identity); err != nil {
		t.Fatal(err)
	}
	host := &FaceSwapExecutionHost{manager: &Manager{}}
	plan := capabilitydriver.FaceSwapModelPlan{Backend: capabilitydriver.FaceSwapBackendHyperSwap, ProfileRoot: root,
		ProfileDigest: identity.ProfileDigest, DriverBundleDigest: identity.DriverBundleDigest, Bindings: make([]capabilitydriver.InvocationExactBinding, 3)}
	if err := host.admitModels(plan); err != nil {
		t.Fatal("Mac exact CPU profile unavailable to HyperSwap", err)
	}
	wrong := plan
	wrong.Backend = capabilitydriver.FaceSwapBackendInsightFace
	if err := host.admitModels(wrong); err == nil {
		t.Fatal("INSwapper silently inherited Mac support")
	}
	wrong = plan
	wrong.ProfileDigest = "different-profile"
	if err := host.admitModels(wrong); err == nil {
		t.Fatal("captured profile substitution accepted")
	}
	windows, err := ResolvePythonDependencyProfileIdentity(FaceSwapConsumerID, "windows/amd64", "cuda")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, PythonDependencyProfileManifestFileName)); err != nil {
		t.Fatal(err)
	}
	if err := writePythonDependencyProfileManifest(root, FaceSwapConsumerID, windows); err != nil {
		t.Fatal(err)
	}
	if err := host.admitModels(plan); err == nil {
		t.Fatal("Windows CUDA manifest accepted by the Mac Host")
	}
}
