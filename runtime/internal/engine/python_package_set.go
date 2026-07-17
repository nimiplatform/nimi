package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type pythonPackageSetManifest struct {
	ID           string
	Packages     []string
	ImportProbes []string
	ExtraArgs    []string
}

func resolvePythonPackageSetManifest(consumer string) (pythonPackageSetManifest, error) {
	trimmed := strings.TrimSpace(consumer)
	switch {
	case strings.HasPrefix(trimmed, "stable-diffusion.cpp."):
		return pythonPackageSetManifest{
			ID:           "media-proxy-execution-core",
			Packages:     nil,
			ImportProbes: []string{"json"},
		}, nil
	case strings.HasPrefix(trimmed, "media."):
		return pythonPackageSetManifest{
			ID:           "media-python-pipeline-core",
			Packages:     append([]string{}, mediaPythonPipelinePackages...),
			ImportProbes: []string{"diffusers", "transformers", "accelerate", "safetensors", "PIL", "imageio"},
		}, nil
	case trimmed == "speech.qwen3-tts.python":
		return pythonPackageSetManifest{
			ID:           "speech-qwen3-tts-python-core",
			Packages:     append([]string{}, nimiSpeechQwen3TTSPackages...),
			ImportProbes: []string{"fastapi", "uvicorn", "multipart", "huggingface_hub", "qwen_tts", "soundfile"},
		}, nil
	case trimmed == "speech.qwen3-asr.python":
		return pythonPackageSetManifest{
			ID:           "speech-qwen3-asr-python-core",
			Packages:     append([]string{}, nimiSpeechQwen3ASRPackages...),
			ImportProbes: []string{"qwen_asr"},
		}, nil
	default:
		return pythonPackageSetManifest{}, fmt.Errorf("python package set dependency is not admitted for consumer %s", consumer)
	}
}

func pythonPackageSetLockHash(manifest pythonPackageSetManifest) string {
	lines := []string{"package_set_id=" + strings.TrimSpace(manifest.ID)}
	for _, pkg := range manifest.Packages {
		lines = append(lines, "package="+strings.TrimSpace(pkg))
	}
	for _, probe := range manifest.ImportProbes {
		lines = append(lines, "import_probe="+strings.TrimSpace(probe))
	}
	sort.Strings(lines[1:])
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n") + "\n"))
	return hex.EncodeToString(sum[:])
}

func verifyPythonImportProbe(ctx context.Context, venvRoot string, interpreterPath string, probe string) error {
	module := strings.TrimSpace(probe)
	if module == "" {
		return fmt.Errorf("python import probe module is required")
	}
	trimmedVenvRoot := strings.TrimSpace(venvRoot)
	if trimmedVenvRoot == "" {
		return fmt.Errorf("python import probe managed venv root is required")
	}
	_, err := runCommandOutput(
		ctx,
		trimmedVenvRoot,
		managedPythonRuntimeEnv(trimmedVenvRoot),
		managedCommandPreferredPath(interpreterPath),
		"-c", "import "+module,
	)
	if err != nil {
		return fmt.Errorf("verify python import probe %s: %w", module, err)
	}
	return nil
}

func (m *Manager) EnsurePythonPackageSetDependency(ctx context.Context, uvPath string, venvRoot string, consumer string) (PythonPackageSetDependencyStatus, error) {
	// Package sets use one Runtime-managed uv cache beneath the shared engine
	// family root. Serialize build/install/verification so two consumers cannot
	// mutate the same source-build workspace concurrently.
	m.pythonPackageSetMu.Lock()
	defer m.pythonPackageSetMu.Unlock()

	manifest, err := resolvePythonPackageSetManifest(consumer)
	if err != nil {
		return PythonPackageSetDependencyStatus{}, err
	}
	trimmedVenvRoot := strings.TrimSpace(venvRoot)
	if trimmedVenvRoot == "" {
		return PythonPackageSetDependencyStatus{}, fmt.Errorf("python package set venv root is required")
	}
	interpreterPath := managedPythonPath(trimmedVenvRoot)
	lockHash := pythonPackageSetLockHash(manifest)
	distributions := []string(nil)
	if pythonPackageSetHasPackages(manifest.Packages) {
		args := append([]string{}, manifest.ExtraArgs...)
		if err := uvPipInstall(ctx, uvPath, trimmedVenvRoot, interpreterPath, manifest.Packages, args...); err != nil {
			return PythonPackageSetDependencyStatus{}, err
		}
		freezeOutput, err := runCommandOutput(
			ctx,
			trimmedVenvRoot,
			managedPythonRuntimeEnv(trimmedVenvRoot),
			strings.TrimSpace(uvPath),
			"pip", "freeze", "--python", interpreterPath,
		)
		if err != nil {
			return PythonPackageSetDependencyStatus{}, fmt.Errorf("verify python package set distributions: %w", err)
		}
		distributions = normalizePackageFreezeLines(freezeOutput)
		if len(distributions) == 0 {
			return PythonPackageSetDependencyStatus{}, fmt.Errorf("verify python package set distributions: empty installed distribution set")
		}
	}
	for _, probe := range manifest.ImportProbes {
		if err := verifyPythonImportProbe(ctx, trimmedVenvRoot, interpreterPath, probe); err != nil {
			return PythonPackageSetDependencyStatus{}, err
		}
	}
	if err := materializePythonPipelineServerScript(trimmedVenvRoot, consumer); err != nil {
		return PythonPackageSetDependencyStatus{}, err
	}
	driverCommands := speechDriverCommandsForConsumer(trimmedVenvRoot, consumer)
	driverScripts := speechDriverScriptsForConsumer(trimmedVenvRoot, consumer)
	return PythonPackageSetDependencyStatus{
		PackageSetID:           manifest.ID,
		LockHash:               lockHash,
		VenvRoot:               trimmedVenvRoot,
		InterpreterPath:        interpreterPath,
		UVExecutable:           strings.TrimSpace(uvPath),
		Packages:               append([]string{}, manifest.Packages...),
		InstalledDistributions: distributions,
		ImportProbes:           append([]string{}, manifest.ImportProbes...),
		DriverCommands:         driverCommands,
		DriverScripts:          driverScripts,
		Detail:                 "Runtime-managed Python package set verified from declared lock manifest",
	}, nil
}

func pythonPackageSetHasPackages(packages []string) bool {
	for _, pkg := range packages {
		if strings.TrimSpace(pkg) != "" {
			return true
		}
	}
	return false
}

// speechServerScriptFiles enumerates every Python file the speech engine venv
// must contain to start. `speech_server.py` imports the sibling module
// `speech_server_runtime`, so both files are deployed into the venv root and
// verified by ensureSpeech. This slice is the single source of truth for both
// the materializer and the startup precondition check.
var speechServerScriptFiles = []struct {
	Name   string
	Script *string
}{
	{Name: "speech_server.py", Script: &speechServerScript},
	{Name: "speech_server_runtime.py", Script: &speechServerRuntimeScript},
}

var speechQwen3TTSDriverScriptFile = struct {
	Name   string
	Script *string
}{Name: "qwen3_tts_driver.py", Script: &speechQwen3TTSDriverScript}

var speechQwen3ASRDriverScriptFile = struct {
	Name   string
	Script *string
}{Name: "qwen3_asr_driver.py", Script: &speechQwen3ASRDriverScript}

func speechPipelineFilesForConsumer(consumer string) []struct {
	Name   string
	Script *string
} {
	switch strings.TrimSpace(consumer) {
	case "speech.qwen3-tts.python":
		files := append([]struct {
			Name   string
			Script *string
		}{}, speechServerScriptFiles...)
		files = append(files, speechQwen3TTSDriverScriptFile)
		return files
	case "speech.qwen3-asr.python":
		return []struct {
			Name   string
			Script *string
		}{speechQwen3ASRDriverScriptFile}
	default:
		return nil
	}
}

func SpeechQwen3TTSDriverPath(root string) string {
	return filepath.Join(strings.TrimSpace(root), "qwen3_tts_driver.py")
}

func SpeechQwen3ASRDriverPath(root string) string {
	return filepath.Join(strings.TrimSpace(root), "qwen3_asr_driver.py")
}

func speechDriverCommandsForConsumer(root string, consumer string) map[string]string {
	trimmedRoot := strings.TrimSpace(root)
	if trimmedRoot == "" {
		return nil
	}
	switch strings.TrimSpace(consumer) {
	case "speech.qwen3-tts.python":
		return map[string]string{
			"NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD": speechDriverCommand(trimmedRoot, SpeechQwen3TTSDriverPath),
		}
	case "speech.qwen3-asr.python":
		return map[string]string{
			"NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD": speechDriverCommand(trimmedRoot, SpeechQwen3ASRDriverPath),
		}
	default:
		return nil
	}
}

func speechDriverScriptsForConsumer(root string, consumer string) []string {
	trimmedRoot := strings.TrimSpace(root)
	if trimmedRoot == "" {
		return nil
	}
	switch strings.TrimSpace(consumer) {
	case "speech.qwen3-tts.python":
		return []string{SpeechQwen3TTSDriverPath(trimmedRoot)}
	case "speech.qwen3-asr.python":
		return []string{SpeechQwen3ASRDriverPath(trimmedRoot)}
	default:
		return nil
	}
}

func materializePythonPipelineServerScript(root string, consumer string) error {
	trimmedRoot := strings.TrimSpace(root)
	if trimmedRoot == "" {
		return fmt.Errorf("python pipeline script root is required")
	}
	switch {
	case strings.HasPrefix(strings.TrimSpace(consumer), "stable-diffusion.cpp."):
		return os.WriteFile(filepath.Join(trimmedRoot, "media_server.py"), []byte(mediaServerScript), 0o755)
	case strings.HasPrefix(strings.TrimSpace(consumer), "media."):
		return os.WriteFile(filepath.Join(trimmedRoot, "media_server.py"), []byte(mediaServerScript), 0o755)
	case strings.HasPrefix(strings.TrimSpace(consumer), "speech."):
		files := speechPipelineFilesForConsumer(consumer)
		if len(files) == 0 {
			return fmt.Errorf("speech pipeline script is not admitted for consumer %s", consumer)
		}
		for _, file := range files {
			if err := os.WriteFile(filepath.Join(trimmedRoot, file.Name), []byte(*file.Script), 0o755); err != nil {
				return fmt.Errorf("materialize speech pipeline script %s: %w", file.Name, err)
			}
		}
		return nil
	default:
		return fmt.Errorf("python pipeline server script is not admitted for consumer %s", consumer)
	}
}

func normalizePackageFreezeLines(output string) []string {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		result = append(result, filepath.ToSlash(trimmed))
	}
	sort.Strings(result)
	return result
}
