package engine

import (
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"os"
	"path/filepath"
	"testing"
)

func TestHyperSwapActualManagedProfileAdmission(t *testing.T) {
	root := os.Getenv("NIMI_HYPERSWAP_PROFILE_INPUT")
	if root == "" {
		t.Skip("explicit existing managed profile; no model execution or App acceptance")
	}
	m, e := ReadPythonDependencyProfileManifest(root)
	if e != nil {
		t.Fatal(e)
	}
	expected, e := ResolvePythonDependencyProfileIdentity(FaceSwapConsumerID, "windows/amd64", "cuda")
	if e != nil {
		t.Fatal(e)
	}
	if m.Identity != expected {
		t.Fatalf("manifest identity differs from actual source: got %+v want %+v", m.Identity, expected)
	}
	manager, e := NewManager(nil, ManagedRoots{Environments: filepath.Join(t.TempDir(), "env"), Dependencies: filepath.Join(t.TempDir(), "deps")}, nil)
	if e != nil {
		t.Fatal(e)
	}
	models := capabilitydriver.FaceSwapModelPlan{Backend: capabilitydriver.FaceSwapBackendHyperSwap, ProfileRoot: root, ProfileDigest: m.Identity.ProfileDigest, DriverBundleDigest: m.Identity.DriverBundleDigest, Bindings: make([]capabilitydriver.InvocationExactBinding, 3)}
	if e := NewFaceSwapExecutionHost(manager).admitModels(models); e != nil {
		t.Fatal(e)
	}
}
