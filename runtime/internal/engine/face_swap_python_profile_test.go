package engine

import (
	"testing"
)

func TestFaceSwapProfileUsesONNXWithoutTorchOrCPUFallback(t *testing.T) {
	identity, err := ResolvePythonDependencyProfileIdentity(FaceSwapConsumerID, "windows/amd64", "cuda")
	if err != nil {
		t.Fatal(err)
	}
	if identity.TorchVersion != "" || identity.TorchWheelLockHash != "" || identity.CUDAABI != "cu13" {
		t.Fatalf("incorrect inference supply: %+v", identity)
	}
	probes, err := pythonDependencyProfileImportProbes(FaceSwapConsumerID, identity)
	if err != nil {
		t.Fatal(err)
	}
	for _, probe := range probes {
		if probe == "torch" || probe == "diffusers" {
			t.Fatalf("unrelated media dependency %q", probe)
		}
	}
	files, err := PythonDependencyProfileStaticFiles(FaceSwapConsumerID, identity)
	if err != nil {
		t.Fatal(err)
	}
	server := false
	for _, file := range files {
		if file.RelativePath == "face_swap_server.py" {
			server = true
		}
	}
	if !server {
		t.Fatal("profile omitted the actual face replacement Worker")
	}
	for _, tuple := range []struct{ platform, plane string }{{"windows/amd64", "cpu"}, {"darwin/arm64", "cpu"}, {"linux/amd64", "cuda"}} {
		if _, err := ResolvePythonDependencyProfileIdentity(FaceSwapConsumerID, tuple.platform, tuple.plane); err == nil {
			t.Fatalf("unadmitted tuple accepted: %+v", tuple)
		}
	}
}
