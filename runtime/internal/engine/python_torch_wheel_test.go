package engine

import (
	"reflect"
	"testing"
)

func TestResolvePythonTorchWheelManifestAdmitsExactSpeechAcceleratorPlane(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		consumer     string
		wantPackages []string
		wantProbes   []string
		wantPlane    string
		wantABI      string
		wantIndex    string
	}{
		{
			name:         "tts cuda",
			consumer:     "speech.qwen3-tts.python.cuda",
			wantPackages: []string{"torch==2.11.0", "torchaudio==2.11.0"},
			wantProbes:   []string{"torch", "torchaudio"},
			wantPlane:    "cuda",
			wantABI:      "cu128",
			wantIndex:    "https://download.pytorch.org/whl/cu128",
		},
		{
			name:         "tts cpu",
			consumer:     "speech.qwen3-tts.python.cpu",
			wantPackages: []string{"torch==2.11.0", "torchaudio==2.11.0"},
			wantProbes:   []string{"torch", "torchaudio"},
			wantPlane:    "cpu",
			wantABI:      "none",
			wantIndex:    "https://download.pytorch.org/whl/cpu",
		},
		{
			name:         "asr cuda",
			consumer:     "speech.qwen3-asr.python.cuda",
			wantPackages: []string{"torch==2.11.0"},
			wantProbes:   []string{"torch"},
			wantPlane:    "cuda",
			wantABI:      "cu128",
			wantIndex:    "https://download.pytorch.org/whl/cu128",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			manifest, err := resolvePythonTorchWheelManifest(test.consumer)
			if err != nil {
				t.Fatalf("resolvePythonTorchWheelManifest(%q): %v", test.consumer, err)
			}
			if !reflect.DeepEqual(manifest.Packages, test.wantPackages) {
				t.Fatalf("packages = %v, want %v", manifest.Packages, test.wantPackages)
			}
			if !reflect.DeepEqual(manifest.ImportProbes, test.wantProbes) {
				t.Fatalf("import probes = %v, want %v", manifest.ImportProbes, test.wantProbes)
			}
			if manifest.AcceleratorPlane != test.wantPlane || manifest.CUDAABI != test.wantABI || manifest.WheelIndex != test.wantIndex {
				t.Fatalf("manifest accelerator = %q/%q %q, want %q/%q %q", manifest.AcceleratorPlane, manifest.CUDAABI, manifest.WheelIndex, test.wantPlane, test.wantABI, test.wantIndex)
			}
		})
	}
}

func TestResolvePythonTorchWheelManifestRejectsSpeechWithoutExactAcceleratorPlane(t *testing.T) {
	t.Parallel()
	if _, err := resolvePythonTorchWheelManifest("speech.qwen3-tts.python"); err == nil {
		t.Fatal("expected speech Torch wheel consumer without accelerator plane to fail closed")
	}
}

func TestResolvePythonTorchWheelDependencyIdentityCarriesVersionPlaneABIAndLock(t *testing.T) {
	t.Parallel()
	identity, err := ResolvePythonTorchWheelDependencyIdentity("speech.qwen3-tts.python.cuda")
	if err != nil {
		t.Fatalf("ResolvePythonTorchWheelDependencyIdentity: %v", err)
	}
	if identity.TorchVersion != "2.11.0" || identity.AcceleratorPlane != "cuda" || identity.CUDAABI != "cu128" || identity.WheelLockHash == "" {
		t.Fatalf("unexpected Torch wheel identity: %+v", identity)
	}
}

func TestPythonTorchWheelPackageSpecReflectsExactManifest(t *testing.T) {
	t.Parallel()
	speech, err := resolvePythonTorchWheelManifest("speech.qwen3-tts.python.cuda")
	if err != nil {
		t.Fatalf("resolve speech manifest: %v", err)
	}
	media, err := resolvePythonTorchWheelManifest("media.diffusers.cuda")
	if err != nil {
		t.Fatalf("resolve media manifest: %v", err)
	}
	if got := pythonTorchWheelPackageSpec(speech, "torchvision"); got != "" {
		t.Fatalf("speech torchvision spec = %q, want absent", got)
	}
	if got := pythonTorchWheelPackageSpec(media, "torchvision"); got != "torchvision==0.22.1" {
		t.Fatalf("media torchvision spec = %q", got)
	}
}
