package engine

import (
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestTextDecisionProfilesBindExactTorchPlanes(t *testing.T) {
	for _, test := range []struct {
		platform, plane, label, index, cudaABI string
	}{
		{"windows/amd64", "cuda", "text-laya-cu128", defaultSpeechTorchCUDAIndexURL, "cu128"},
		{"windows/amd64", "cpu", "text-laya-cpu", defaultMediaTorchCPUIndexURL, "none"},
		{"darwin/arm64", "cpu", "text-laya-cpu", defaultMediaTorchCPUIndexURL, "none"},
	} {
		identity, err := ResolvePythonDependencyProfileIdentity(TextDecisionConsumerID, test.platform, test.plane)
		if err != nil {
			t.Fatalf("%s/%s: %v", test.platform, test.plane, err)
		}
		if identity.SourceLabel != test.label || identity.AcceleratorPlane != test.plane || identity.TorchVersion != "2.11.0" ||
			identity.CUDAABI != test.cudaABI || identity.TorchWheelIndex != test.index || identity.DriverProtocol != capabilitydriver.LayaProtocol ||
			identity.DriverBundleDigest != textDecisionDriverBundleDigest(capabilitydriver.LayaProtocol) {
			t.Fatalf("%s/%s identity is not exact: %+v", test.platform, test.plane, identity)
		}
		for _, name := range []string{"pyproject.toml", "uv.lock"} {
			content, err := pythonDependencyProfileInput(test.label, name)
			if err != nil {
				t.Fatal(err)
			}
			text := string(content)
			for _, pin := range []string{test.index, "laya", "0.3.11", "transformers", "5.13.0", "torch", "2.11.0"} {
				if !strings.Contains(text, pin) {
					t.Fatalf("%s %s does not pin %s", test.label, name, pin)
				}
			}
		}
		files, err := PythonDependencyProfileStaticFiles(TextDecisionConsumerID, identity)
		if err != nil {
			t.Fatal(err)
		}
		names := map[string]bool{}
		for _, file := range files {
			names[file.RelativePath] = true
		}
		if !names["laya_text_decision.py"] || !names[textDecisionServerScriptName] {
			t.Fatalf("profile static files omit the Worker: %v", names)
		}
	}
	if lock, _ := pythonDependencyProfileInput("text-laya-cu128", "uv.lock"); !strings.Contains(string(lock), "sha256:1ee717dd05a742135869383af9b66b20d5c5f62e62d9e57e3fcf84203ea1e443") {
		t.Fatal("CUDA profile lock does not pin the exact laya 0.3.11 wheel")
	}
	for _, target := range [][2]string{{"darwin/arm64", "cuda"}, {"linux/amd64", "cpu"}} {
		if _, err := ResolvePythonDependencyProfileIdentity(TextDecisionConsumerID, target[0], target[1]); err == nil {
			t.Fatalf("Laya profile admitted %s/%s", target[0], target[1])
		}
	}
	cuda, _ := ResolvePythonDependencyProfileIdentity(TextDecisionConsumerID, "windows/amd64", "cuda")
	cpu, _ := ResolvePythonDependencyProfileIdentity(TextDecisionConsumerID, "windows/amd64", "cpu")
	if cuda.ProfileDigest == cpu.ProfileDigest {
		t.Fatal("CUDA and CPU Laya profiles share one identity")
	}
	probes, err := pythonDependencyProfileImportProbes(TextDecisionConsumerID, cuda)
	if err != nil {
		t.Fatal(err)
	}
	for _, module := range []string{"laya.common", "torch", "transformers", "laya_text_decision"} {
		if !containsStringValue(probes, module) {
			t.Fatalf("import probes omit %s: %v", module, probes)
		}
	}
	if scripts := pythonDependencyProfileDriverScripts("C:/profile", TextDecisionConsumerID); len(scripts) != 1 || !strings.HasSuffix(scripts[0], textDecisionServerScriptName) {
		t.Fatalf("Driver scripts: %v", scripts)
	}
}
