package engine

import (
	"strings"
	"testing"
)

func TestBasicPitchProfileIsExplicitWindowsCPUWithoutTorch(t *testing.T) {
	identity, err := ResolvePythonDependencyProfileIdentity(BasicPitchConsumerID, "windows/amd64", "cpu")
	if err != nil {
		t.Fatal(err)
	}
	if identity.PythonVersion != "3.12.13" || identity.PythonABI != "cp312" || identity.TorchVersion != "" || identity.CUDAABI != "" || identity.SourceLabel != "music-basic-pitch-cpu" {
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
	for _, host := range []struct{ platform, plane string }{{"windows/amd64", "cuda"}, {"darwin/arm64", "cpu"}} {
		if _, err := ResolvePythonDependencyProfileIdentity(BasicPitchConsumerID, host.platform, host.plane); err == nil {
			t.Fatal("unsupported profile admitted", host)
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
