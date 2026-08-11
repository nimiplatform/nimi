package engine

import (
	"strings"
	"testing"
)

func TestResolvePythonDependencyProfileIdentityUsesCompleteInputs(t *testing.T) {
	ttsCPU, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-tts.python", "darwin/arm64", "cpu")
	if err != nil {
		t.Fatalf("resolve TTS CPU profile identity: %v", err)
	}
	ttsCPUAgain, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-tts.python", "darwin/arm64", "cpu")
	if err != nil {
		t.Fatalf("resolve repeated TTS CPU profile identity: %v", err)
	}
	if ttsCPU.ProfileDigest != ttsCPUAgain.ProfileDigest || ttsCPU.DependencyID != ttsCPUAgain.DependencyID {
		t.Fatalf("equal profile inputs produced different identities: first=%+v second=%+v", ttsCPU, ttsCPUAgain)
	}
	for _, forbidden := range []string{"qwen3-tts", "speech.qwen3-tts.python", ttsCPU.SourceLabel} {
		if strings.Contains(ttsCPU.DependencyID, forbidden) {
			t.Fatalf("profile dependency id %q contains selector-only identity %q", ttsCPU.DependencyID, forbidden)
		}
	}
	if ttsCPU.PythonVersion != ManagedPythonVersion || ttsCPU.PythonABI != ManagedPythonABI || ttsCPU.AcceleratorPlane != "cpu" || ttsCPU.CUDAABI != "none" {
		t.Fatalf("TTS CPU identity is incomplete: %+v", ttsCPU)
	}
	if ttsCPU.TorchWheelLockHash == "" || ttsCPU.TorchWheelIndex == "" || ttsCPU.TorchPackageSource == "" {
		t.Fatalf("TTS CPU wheel/source identity is incomplete: %+v", ttsCPU)
	}
	if len(ttsCPU.ProfileDigest) != 64 || ttsCPU.DependencyID != "python-profile."+ttsCPU.ProfileDigest {
		t.Fatalf("profile digest/id is not canonical: %+v", ttsCPU)
	}

	identities := []PythonDependencyProfileIdentity{ttsCPU}
	for _, request := range []struct {
		consumer string
		platform string
		plane    string
	}{
		{consumer: "speech.qwen3-tts.python", platform: "windows/amd64", plane: "cuda"},
		{consumer: "speech.qwen3-asr.python", platform: "darwin/arm64", plane: "cpu"},
		{consumer: "speech.qwen3-asr-transformers.python", platform: "darwin/arm64", plane: "cpu"},
	} {
		identity, resolveErr := ResolvePythonDependencyProfileIdentity(request.consumer, request.platform, request.plane)
		if resolveErr != nil {
			t.Fatalf("resolve profile identity %+v: %v", request, resolveErr)
		}
		for _, existing := range identities {
			if identity.ProfileDigest == existing.ProfileDigest {
				t.Fatalf("different complete profile inputs collided: existing=%+v current=%+v", existing, identity)
			}
		}
		identities = append(identities, identity)
	}
}

func TestResolvePythonDependencyProfileIdentityReusesCompleteMediaFingerprintAcrossConsumers(t *testing.T) {
	image, err := ResolvePythonDependencyProfileIdentity("media.diffusers.cuda", "windows/amd64", "cuda")
	if err != nil {
		t.Fatalf("resolve image dependency profile: %v", err)
	}
	video, err := ResolvePythonDependencyProfileIdentity("media.video-python.cuda", "windows/amd64", "cuda")
	if err != nil {
		t.Fatalf("resolve video dependency profile: %v", err)
	}
	if image.DependencyID != video.DependencyID || image.ProfileDigest != video.ProfileDigest {
		t.Fatalf("equal media dependency/Driver inputs did not reuse one profile: image=%+v video=%+v", image, video)
	}
	if image.TorchVersion != "2.7.1" || image.CUDAABI != "cu126" || image.DriverProtocol != mediaDriverProtocolVersion || !strings.Contains(image.PackageSource, "/cu126") {
		t.Fatalf("media profile identity is incomplete: %+v", image)
	}
}

func TestResolvePythonDependencyProfileIdentityDoesNotExpandLinuxAdmission(t *testing.T) {
	for _, plane := range []string{"cpu", "cuda"} {
		if _, err := ResolvePythonDependencyProfileIdentity("speech.qwen3-tts.python", "linux/amd64", plane); err == nil {
			t.Fatalf("Linux %s dependency profile was admitted during the Windows/macOS bounded rollout", plane)
		}
	}
}

func TestPythonDependencyProfileDigestChangesForEveryCanonicalFactor(t *testing.T) {
	base := pythonDependencyProfileDigestInput{
		PythonVersion:      "3.12.13",
		PythonABI:          "cp312",
		PlatformTuple:      "windows/amd64",
		AcceleratorPlane:   "cuda",
		TorchVersion:       "2.11.0",
		CUDAABI:            "cu128",
		TorchWheelLockHash: strings.Repeat("0", 64),
		TorchWheelIndex:    "https://download.pytorch.org/whl/cu128",
		TorchPackageSource: "pytorch-official-wheel-index",
		ExactLockDigest:    strings.Repeat("1", 64),
		ProjectInputDigest: strings.Repeat("2", 64),
		PackageSource:      "pypi=https://pypi.org/simple;pytorch=https://download.pytorch.org/whl/cu128",
		DriverProtocol:     "speech-http-v1",
		DriverBundleDigest: strings.Repeat("3", 64),
	}
	baseDigest := pythonDependencyProfileDigest(base)
	tests := map[string]func(*pythonDependencyProfileDigestInput){
		"python version": func(input *pythonDependencyProfileDigestInput) { input.PythonVersion = "3.12.14" },
		"python ABI":     func(input *pythonDependencyProfileDigestInput) { input.PythonABI = "cp313" },
		"platform":       func(input *pythonDependencyProfileDigestInput) { input.PlatformTuple = "darwin/arm64" },
		"accelerator":    func(input *pythonDependencyProfileDigestInput) { input.AcceleratorPlane = "cpu" },
		"Torch":          func(input *pythonDependencyProfileDigestInput) { input.TorchVersion = "2.12.0" },
		"CUDA ABI":       func(input *pythonDependencyProfileDigestInput) { input.CUDAABI = "cu130" },
		"Torch wheel lock": func(input *pythonDependencyProfileDigestInput) {
			input.TorchWheelLockHash = strings.Repeat("7", 64)
		},
		"Torch wheel index": func(input *pythonDependencyProfileDigestInput) {
			input.TorchWheelIndex += "/changed"
		},
		"Torch package source": func(input *pythonDependencyProfileDigestInput) {
			input.TorchPackageSource += "-changed"
		},
		"exact lock":     func(input *pythonDependencyProfileDigestInput) { input.ExactLockDigest = strings.Repeat("4", 64) },
		"project input":  func(input *pythonDependencyProfileDigestInput) { input.ProjectInputDigest = strings.Repeat("5", 64) },
		"package source": func(input *pythonDependencyProfileDigestInput) { input.PackageSource += "/changed" },
		"Driver protocol": func(input *pythonDependencyProfileDigestInput) {
			input.DriverProtocol = "speech-http-v2"
		},
		"Driver bundle": func(input *pythonDependencyProfileDigestInput) { input.DriverBundleDigest = strings.Repeat("6", 64) },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			changed := base
			mutate(&changed)
			if got := pythonDependencyProfileDigest(changed); got == baseDigest {
				t.Fatalf("changing %s did not change profile digest %s", name, got)
			}
		})
	}
}

func TestPythonDependencyProfileLocksBindTorchToDeclaredIndex(t *testing.T) {
	for _, test := range []struct {
		label          string
		index          string
		companionWheel string
	}{
		{label: "speech-tts-cu128", index: defaultSpeechTorchCUDAIndexURL, companionWheel: "torchaudio"},
		{label: "speech-tts-cpu", index: defaultMediaTorchCPUIndexURL, companionWheel: "torchaudio"},
		{label: "media-pipeline-cu126", index: defaultMediaTorchIndexURL, companionWheel: "torchvision"},
		{label: "media-pipeline-cpu", index: defaultMediaTorchCPUIndexURL, companionWheel: "torchvision"},
	} {
		project, err := pythonDependencyProfileInput(test.label, "pyproject.toml")
		if err != nil {
			t.Fatalf("read %s project input: %v", test.label, err)
		}
		lock, err := pythonDependencyProfileInput(test.label, "uv.lock")
		if err != nil {
			t.Fatalf("read %s exact lock: %v", test.label, err)
		}
		for _, content := range [][]byte{project, lock} {
			text := string(content)
			if !strings.Contains(text, test.index) || !strings.Contains(text, "torch") || !strings.Contains(text, test.companionWheel) {
				t.Fatalf("%s input does not bind Torch/%s to %s", test.label, test.companionWheel, test.index)
			}
		}
	}
}
