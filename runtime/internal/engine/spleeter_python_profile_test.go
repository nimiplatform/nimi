package engine

import (
	"strings"
	"testing"
)

func TestSpleeterProfileIsExactCPUWithoutTorch(t *testing.T) {
	id, e := ResolvePythonDependencyProfileIdentity(SpleeterConsumerID, "windows/amd64", "cpu")
	if e != nil {
		t.Fatal(e)
	}
	if id.PythonVersion != "3.12.13" || id.SourceLabel != "audio-spleeter-cpu" || id.TorchVersion != "" || id.CUDAABI != "" || id.DriverProtocol != "nimi-spleeter-tf-checkpoint/1" {
		t.Fatalf("wrong profile %+v", id)
	}
	for _, host := range []struct{ os, plane string }{{"windows/amd64", "cuda"}, {"darwin/arm64", "cpu"}} {
		if _, e := ResolvePythonDependencyProfileIdentity(SpleeterConsumerID, host.os, host.plane); e == nil {
			t.Fatal("unsupported host accepted")
		}
	}
	project, _ := pythonDependencyProfileInput(id.SourceLabel, "pyproject.toml")
	lock, _ := pythonDependencyProfileInput(id.SourceLabel, "uv.lock")
	if !strings.Contains(string(project), "tensorflow-intel==2.16.1") || !strings.Contains(string(lock), `name = "tensorflow-intel"`) {
		t.Fatal("Windows CPU runtime must be an explicit frozen dependency, not only the TensorFlow metadata wheel")
	}
	files, e := PythonDependencyProfileStaticFiles(SpleeterConsumerID, id)
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, file := range files {
		if file.RelativePath == "spleeter_driver.py" {
			found = true
		}
	}
	if !found {
		t.Fatal("driver not materialized")
	}
	if e := verifySpleeterProfileProbe(pythonDependencyProfileProbe{Device: "cpu", Allocation: 1, TensorFlowVersion: "2.16.1", InstalledDistributions: []string{"tensorflow"}}, id); e != nil {
		t.Fatal(e)
	}
	if e := verifySpleeterProfileProbe(pythonDependencyProfileProbe{Device: "cuda", Allocation: 1, TensorFlowVersion: "2.16.1"}, id); e == nil {
		t.Fatal("wrong probe accepted")
	}
}
