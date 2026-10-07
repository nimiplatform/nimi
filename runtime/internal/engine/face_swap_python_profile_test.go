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
	for _, tuple := range []struct{ platform, plane string }{{"windows/amd64", "cpu"}, {"darwin/amd64", "cpu"}, {"darwin/arm64", "cuda"}, {"linux/amd64", "cuda"}} {
		if _, err := ResolvePythonDependencyProfileIdentity(FaceSwapConsumerID, tuple.platform, tuple.plane); err == nil {
			t.Fatalf("unadmitted tuple accepted: %+v", tuple)
		}
	}
}

func TestHyperSwapMacProfileRequiresItsExactONNXCPUPlane(t *testing.T) {
	mac, err := ResolvePythonDependencyProfileIdentity(FaceSwapConsumerID, "darwin/arm64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	windows, err := ResolvePythonDependencyProfileIdentity(FaceSwapConsumerID, "windows/amd64", "cuda")
	if err != nil {
		t.Fatal(err)
	}
	if mac.SourceLabel != "face-swap-hyperswap-macos-cpu" || mac.PythonVersion != "3.12.13" || mac.TorchVersion != "" || mac.CUDAABI != "" ||
		mac.ProfileDigest == windows.ProfileDigest || mac.ExactLockDigest == windows.ExactLockDigest || mac.DriverBundleDigest != windows.DriverBundleDigest {
		t.Fatal("Mac CPU identity was conflated with the Windows CUDA environment", mac)
	}
	probe := pythonDependencyProfileProbe{ONNXRuntimeVersion: "1.28.0", Device: "cpu", Allocation: 1, InstalledDistributions: []string{"onnxruntime==1.28.0"}}
	if err := verifyFaceSwapProfileProbe(probe, mac); err != nil {
		t.Fatal(err)
	}
	if err := verifyFaceSwapProfileProbe(probe, windows); err == nil {
		t.Fatal("CPU proof accepted for a CUDA profile")
	}
	probe.Device, probe.CUDAABI = "cuda", "13"
	if err := verifyFaceSwapProfileProbe(probe, mac); err == nil {
		t.Fatal("GPU proof accepted for a CPU profile")
	}
}
