package engine

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"path"
	"path/filepath"
	"strings"
)

const (
	ManagedPythonVersion        = "3.12.13"
	ManagedPythonABI            = "cp312"
	speechDriverProtocolVersion = "speech-http-v1"
	mediaDriverProtocolVersion  = "nimi-media/0.2"
)

//go:embed assets/python-profiles/*/pyproject.toml assets/python-profiles/*/uv.lock
var pythonDependencyProfileInputs embed.FS

type PythonDependencyProfileIdentity struct {
	DependencyID       string
	ProfileDigest      string
	PythonVersion      string
	PythonABI          string
	PlatformTuple      string
	AcceleratorPlane   string
	TorchVersion       string
	CUDAABI            string
	TorchWheelLockHash string
	TorchWheelIndex    string
	TorchPackageSource string
	ExactLockDigest    string
	ProjectInputDigest string
	PackageSource      string
	DriverProtocol     string
	DriverBundleDigest string
	SourceLabel        string
}

// PythonDependencyProfileStaticFile is one immutable, Runtime-owned profile
// input or Driver file. RelativePath is rooted at the promoted profile.
type PythonDependencyProfileStaticFile struct {
	RelativePath string
	Content      []byte
}

// PythonDependencyProfileStaticFiles returns the canonical embedded static
// contents for one exact dependency profile. Callers receive copies and may
// use them only to materialize or verify the already resolved profile.
func PythonDependencyProfileStaticFiles(consumer string, identity PythonDependencyProfileIdentity) ([]PythonDependencyProfileStaticFile, error) {
	expected, err := ResolvePythonDependencyProfileIdentity(consumer, identity.PlatformTuple, identity.AcceleratorPlane)
	if err != nil {
		return nil, err
	}
	if expected != identity {
		return nil, fmt.Errorf("python dependency profile identity does not match current canonical inputs")
	}
	files := make([]PythonDependencyProfileStaticFile, 0, 5)
	for _, name := range []string{"pyproject.toml", "uv.lock"} {
		content, err := pythonDependencyProfileInput(identity.SourceLabel, name)
		if err != nil {
			return nil, err
		}
		files = append(files, PythonDependencyProfileStaticFile{
			RelativePath: filepath.Join(pythonDependencyProfileInputDir, name),
			Content:      append([]byte(nil), content...),
		})
	}
	driverFiles := speechPipelineFilesForConsumer(consumer)
	if len(driverFiles) == 0 && strings.HasPrefix(strings.TrimSpace(consumer), "media.") {
		driverFiles = []struct {
			Name   string
			Script *string
		}{{Name: "media_server.py", Script: &mediaServerScript}}
	}
	if len(driverFiles) == 0 {
		return nil, fmt.Errorf("python dependency profile Driver bundle is not admitted for consumer %s", consumer)
	}
	for _, file := range driverFiles {
		files = append(files, PythonDependencyProfileStaticFile{
			RelativePath: file.Name,
			Content:      append([]byte(nil), []byte(*file.Script)...),
		})
	}
	return files, nil
}

type pythonDependencyProfileDigestInput struct {
	PythonVersion      string
	PythonABI          string
	PlatformTuple      string
	AcceleratorPlane   string
	TorchVersion       string
	CUDAABI            string
	TorchWheelLockHash string
	TorchWheelIndex    string
	TorchPackageSource string
	ExactLockDigest    string
	ProjectInputDigest string
	PackageSource      string
	DriverProtocol     string
	DriverBundleDigest string
}

func ResolvePythonDependencyProfileIdentity(consumer string, platformTuple string, acceleratorPlane string) (PythonDependencyProfileIdentity, error) {
	trimmedConsumer := strings.TrimSpace(consumer)
	trimmedPlatform := strings.ToLower(strings.TrimSpace(platformTuple))
	trimmedPlane := strings.ToLower(strings.TrimSpace(acceleratorPlane))
	if err := admitPythonDependencyProfilePlatform(trimmedPlatform, trimmedPlane); err != nil {
		return PythonDependencyProfileIdentity{}, err
	}

	sourceLabel, err := pythonDependencyProfileSourceLabel(trimmedConsumer, trimmedPlane)
	if err != nil {
		return PythonDependencyProfileIdentity{}, err
	}
	projectInput, err := pythonDependencyProfileInput(sourceLabel, "pyproject.toml")
	if err != nil {
		return PythonDependencyProfileIdentity{}, err
	}
	exactLock, err := pythonDependencyProfileInput(sourceLabel, "uv.lock")
	if err != nil {
		return PythonDependencyProfileIdentity{}, err
	}
	torchIdentity, err := ResolvePythonTorchWheelDependencyIdentity(trimmedConsumer + "." + trimmedPlane)
	if err != nil {
		return PythonDependencyProfileIdentity{}, err
	}
	driverProtocol := pythonDependencyProfileDriverProtocol(trimmedConsumer)
	driverBundleDigest, err := pythonDependencyProfileDriverBundleDigest(trimmedConsumer, driverProtocol)
	if err != nil {
		return PythonDependencyProfileIdentity{}, err
	}
	packageSource, err := pythonDependencyProfilePackageSource(trimmedConsumer, trimmedPlane)
	if err != nil {
		return PythonDependencyProfileIdentity{}, err
	}
	input := pythonDependencyProfileDigestInput{
		PythonVersion:      ManagedPythonVersion,
		PythonABI:          ManagedPythonABI,
		PlatformTuple:      trimmedPlatform,
		AcceleratorPlane:   torchIdentity.AcceleratorPlane,
		TorchVersion:       torchIdentity.TorchVersion,
		CUDAABI:            torchIdentity.CUDAABI,
		TorchWheelLockHash: torchIdentity.WheelLockHash,
		TorchWheelIndex:    torchIdentity.WheelIndex,
		TorchPackageSource: torchIdentity.PackageSource,
		ExactLockDigest:    sha256Hex(exactLock),
		ProjectInputDigest: sha256Hex(projectInput),
		PackageSource:      packageSource,
		DriverProtocol:     driverProtocol,
		DriverBundleDigest: driverBundleDigest,
	}
	digest := pythonDependencyProfileDigest(input)
	return PythonDependencyProfileIdentity{
		DependencyID:       "python-profile." + digest,
		ProfileDigest:      digest,
		PythonVersion:      input.PythonVersion,
		PythonABI:          input.PythonABI,
		PlatformTuple:      input.PlatformTuple,
		AcceleratorPlane:   input.AcceleratorPlane,
		TorchVersion:       input.TorchVersion,
		CUDAABI:            input.CUDAABI,
		TorchWheelLockHash: input.TorchWheelLockHash,
		TorchWheelIndex:    input.TorchWheelIndex,
		TorchPackageSource: input.TorchPackageSource,
		ExactLockDigest:    input.ExactLockDigest,
		ProjectInputDigest: input.ProjectInputDigest,
		PackageSource:      input.PackageSource,
		DriverProtocol:     input.DriverProtocol,
		DriverBundleDigest: input.DriverBundleDigest,
		SourceLabel:        sourceLabel,
	}, nil
}

func admitPythonDependencyProfilePlatform(platformTuple string, acceleratorPlane string) error {
	switch platformTuple {
	case "windows/amd64":
		if acceleratorPlane == "cpu" || acceleratorPlane == "cuda" {
			return nil
		}
	case "darwin/arm64":
		if acceleratorPlane == "cpu" {
			return nil
		}
	}
	return fmt.Errorf("python dependency profile is not admitted for platform %s and accelerator %s", platformTuple, acceleratorPlane)
}

func pythonDependencyProfileSourceLabel(consumer string, acceleratorPlane string) (string, error) {
	line := ""
	switch strings.TrimSpace(consumer) {
	case "speech.qwen3-tts.python":
		line = "speech-tts"
	case "speech.qwen3-asr.python":
		line = "speech-asr-package"
	case "speech.qwen3-asr-transformers.python":
		line = "speech-asr-transformers"
	case "media.diffusers.cpu", "media.diffusers.cuda",
		"media.video-python.cpu", "media.video-python.cuda":
		line = "media-pipeline"
	default:
		return "", fmt.Errorf("python dependency profile is not admitted for consumer %s", consumer)
	}
	sourceSuffix := acceleratorPlane
	if acceleratorPlane == "cuda" {
		if strings.HasPrefix(strings.TrimSpace(consumer), "media.") {
			sourceSuffix = "cu126"
		} else {
			sourceSuffix = "cu128"
		}
	}
	return line + "-" + sourceSuffix, nil
}

func pythonDependencyProfileInput(sourceLabel string, name string) ([]byte, error) {
	inputPath := path.Join("assets/python-profiles", strings.TrimSpace(sourceLabel), strings.TrimSpace(name))
	content, err := pythonDependencyProfileInputs.ReadFile(inputPath)
	if err != nil {
		return nil, fmt.Errorf("read embedded python dependency profile input %s: %w", inputPath, err)
	}
	if len(content) == 0 {
		return nil, fmt.Errorf("embedded python dependency profile input is empty: %s", inputPath)
	}
	return content, nil
}

func pythonDependencyProfilePackageSource(consumer string, acceleratorPlane string) (string, error) {
	manifest, err := resolvePythonTorchWheelManifest(strings.TrimSpace(consumer) + "." + strings.TrimSpace(acceleratorPlane))
	if err != nil {
		return "", err
	}
	return "pypi=https://pypi.org/simple;pytorch=" + strings.TrimSpace(manifest.WheelIndex), nil
}

func pythonDependencyProfileDriverProtocol(consumer string) string {
	if strings.HasPrefix(strings.TrimSpace(consumer), "media.") {
		return mediaDriverProtocolVersion
	}
	return speechDriverProtocolVersion
}

func speechDriverBundleDigest(consumer string) (string, error) {
	return pythonDependencyProfileDriverBundleDigest(consumer, speechDriverProtocolVersion)
}

func pythonDependencyProfileDriverBundleDigest(consumer string, driverProtocol string) (string, error) {
	files := speechPipelineFilesForConsumer(consumer)
	if len(files) == 0 && (strings.HasPrefix(strings.TrimSpace(consumer), "media.") || strings.HasPrefix(strings.TrimSpace(consumer), "stable-diffusion.cpp.")) {
		files = []struct {
			Name   string
			Script *string
		}{{Name: "media_server.py", Script: &mediaServerScript}}
	}
	if len(files) == 0 {
		return "", fmt.Errorf("Python dependency profile Driver bundle is not admitted for consumer %s", consumer)
	}
	if strings.TrimSpace(driverProtocol) == "" {
		return "", fmt.Errorf("python dependency profile Driver protocol is required for consumer %s", consumer)
	}
	lines := []string{"driver_protocol=" + strings.TrimSpace(driverProtocol)}
	if strings.HasPrefix(strings.TrimSpace(consumer), "media.") {
		lines = append(lines, "image_driver=flux", "video_driver=wan")
	}
	for _, file := range files {
		lines = append(lines, "file="+file.Name, *file.Script)
	}
	return sha256Hex([]byte(strings.Join(lines, "\n") + "\n")), nil
}

func pythonDependencyProfileDigest(input pythonDependencyProfileDigestInput) string {
	lines := []string{
		"python_version=" + strings.TrimSpace(input.PythonVersion),
		"python_abi=" + strings.TrimSpace(input.PythonABI),
		"platform=" + strings.ToLower(strings.TrimSpace(input.PlatformTuple)),
		"accelerator=" + strings.ToLower(strings.TrimSpace(input.AcceleratorPlane)),
		"torch_version=" + strings.TrimSpace(input.TorchVersion),
		"cuda_abi=" + strings.ToLower(strings.TrimSpace(input.CUDAABI)),
		"torch_wheel_lock_sha256=" + strings.ToLower(strings.TrimSpace(input.TorchWheelLockHash)),
		"torch_wheel_index=" + strings.TrimSpace(input.TorchWheelIndex),
		"torch_package_source=" + strings.TrimSpace(input.TorchPackageSource),
		"exact_lock_sha256=" + strings.ToLower(strings.TrimSpace(input.ExactLockDigest)),
		"project_input_sha256=" + strings.ToLower(strings.TrimSpace(input.ProjectInputDigest)),
		"package_source=" + strings.TrimSpace(input.PackageSource),
		"driver_protocol=" + strings.TrimSpace(input.DriverProtocol),
		"driver_bundle_sha256=" + strings.ToLower(strings.TrimSpace(input.DriverBundleDigest)),
	}
	return sha256Hex([]byte(strings.Join(lines, "\n") + "\n"))
}

func sha256Hex(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}
