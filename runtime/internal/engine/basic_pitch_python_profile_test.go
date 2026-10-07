package engine

import (
	"strings"
	"testing"
)

func TestBasicPitchProfilesAreExplicitCPUWithoutTorch(t *testing.T) {
	identities := map[string]PythonDependencyProfileIdentity{}
	for platform, label := range map[string]string{"windows/amd64": "music-basic-pitch-cpu", "darwin/arm64": "music-basic-pitch-macos-cpu"} {
		identity, err := ResolvePythonDependencyProfileIdentity(BasicPitchConsumerID, platform, "cpu")
		if err != nil {
			t.Fatal(err)
		}
		identities[platform] = identity
		if identity.PythonVersion != "3.12.13" || identity.PythonABI != "cp312" || identity.TorchVersion != "" || identity.CUDAABI != "" || identity.SourceLabel != label {
			t.Fatal("profile selected a different substrate", identity)
		}
		probes, err := pythonDependencyProfileImportProbes(BasicPitchConsumerID, identity)
		if err != nil {
			t.Fatal(err)
		}
		for _, probe := range probes {
			if probe == "torch" || strings.Contains(probe, "tensorflow") {
				t.Fatal("unadmitted backend import", probe)
			}
		}
		files, err := PythonDependencyProfileStaticFiles(BasicPitchConsumerID, identity)
		if err != nil {
			t.Fatal(err)
		}
		found := map[string]bool{}
		for _, file := range files {
			found[file.RelativePath] = true
		}
		if !found["basic_pitch_driver.py"] || !found["basic_pitch_decoder.py"] || !found["basic_pitch_LICENSE"] || !found["basic_pitch_NOTICE"] {
			t.Fatal("driver source/attribution incomplete")
		}
	}
	windows, mac := identities["windows/amd64"], identities["darwin/arm64"]
	if windows.ProfileDigest == mac.ProfileDigest || windows.ExactLockDigest == mac.ExactLockDigest || windows.DriverBundleDigest != mac.DriverBundleDigest {
		t.Fatal("platforms must bind separate exact environments to the same Driver")
	}
	for _, host := range []struct{ platform, plane string }{{"windows/amd64", "cuda"}, {"darwin/arm64", "cuda"}, {"darwin/arm64", "mps"}, {"darwin/amd64", "cpu"}, {"linux/arm64", "cpu"}} {
		if _, err := ResolvePythonDependencyProfileIdentity(BasicPitchConsumerID, host.platform, host.plane); err == nil {
			t.Fatal("unsupported profile admitted", host)
		}
	}
}

func TestBasicPitchMacProfileProbeRejectsDifferentBackend(t *testing.T) {
	identity, err := ResolvePythonDependencyProfileIdentity(BasicPitchConsumerID, "darwin/arm64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	probe := pythonDependencyProfileProbe{Device: "cpu", Allocation: 1, ONNXRuntimeVersion: "1.20.1", InstalledDistributions: []string{"onnxruntime"}}
	if err := verifyBasicPitchProfileProbe(probe, identity); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*pythonDependencyProfileProbe){
		"different ORT": func(p *pythonDependencyProfileProbe) { p.ONNXRuntimeVersion = "1.21.0" },
		"GPU":           func(p *pythonDependencyProfileProbe) { p.Device = "mps" },
		"Torch":         func(p *pythonDependencyProfileProbe) { p.TorchVersion = "2.8.0" },
		"CUDA":          func(p *pythonDependencyProfileProbe) { p.CUDAABI = "12.8" },
		"no allocation": func(p *pythonDependencyProfileProbe) { p.Allocation = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			bad := probe
			mutate(&bad)
			if err := verifyBasicPitchProfileProbe(bad, identity); err == nil {
				t.Fatal("different composition accepted")
			}
		})
	}
}
