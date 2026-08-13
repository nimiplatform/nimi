package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type pythonPackageSetManifest struct {
	ID           string
	ImportProbes []string
}

func resolvePythonPackageSetManifest(consumer string) (pythonPackageSetManifest, error) {
	trimmed := strings.TrimSpace(consumer)
	switch {
	case strings.HasPrefix(trimmed, "stable-diffusion.cpp."):
		return pythonPackageSetManifest{
			ID:           "media-proxy-execution-core",
			ImportProbes: []string{"json"},
		}, nil
	case strings.HasPrefix(trimmed, "media."):
		return pythonPackageSetManifest{
			ID:           "media-python-pipeline-core",
			ImportProbes: []string{"diffusers", "transformers", "accelerate", "safetensors", "PIL", "imageio"},
		}, nil
	case trimmed == "speech.qwen3-tts.python":
		return pythonPackageSetManifest{
			ID:           "speech-qwen3-tts-python-core",
			ImportProbes: []string{"fastapi", "uvicorn", "multipart", "huggingface_hub", "qwen_tts", "soundfile"},
		}, nil
	case trimmed == "speech.qwen3-asr.python":
		return pythonPackageSetManifest{
			ID:           "speech-qwen3-asr-python-core",
			ImportProbes: []string{"fastapi", "uvicorn", "multipart", "qwen_asr"},
		}, nil
	case trimmed == "speech.qwen3-asr-transformers.python":
		return pythonPackageSetManifest{
			ID:           "speech-qwen3-asr-transformers-python-core",
			ImportProbes: []string{"fastapi", "uvicorn", "multipart", "torch", "transformers", "accelerate", "librosa", "soundfile"},
		}, nil
	case trimmed == "speech.voxcpm.python":
		return pythonPackageSetManifest{
			ID:           "speech-voxcpm-python-core",
			ImportProbes: []string{"fastapi", "uvicorn", "multipart", "soundfile"},
		}, nil
	default:
		return pythonPackageSetManifest{}, fmt.Errorf("python package set dependency is not admitted for consumer %s", consumer)
	}
}
func verifyPythonImportProbe(ctx context.Context, profileRoot string, interpreterPath string, probe string) error {
	module := strings.TrimSpace(probe)
	if module == "" {
		return fmt.Errorf("python import probe module is required")
	}
	trimmedProfileRoot := strings.TrimSpace(profileRoot)
	if trimmedProfileRoot == "" {
		return fmt.Errorf("python import probe dependency profile root is required")
	}
	_, err := runCommandOutput(
		ctx,
		trimmedProfileRoot,
		managedPythonRuntimeEnv(trimmedProfileRoot),
		managedCommandPreferredPath(interpreterPath),
		"-c", "import "+module,
	)
	if err != nil {
		return fmt.Errorf("verify python import probe %s: %w", module, err)
	}
	return nil
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

var speechQwen3ASRTransformersDriverScriptFile = struct {
	Name   string
	Script *string
}{Name: "qwen3_asr_transformers_driver.py", Script: &speechQwen3ASRTransformersDriverScript}

var speechVoxCPMDriverScriptFiles = []struct {
	Name   string
	Script *string
}{
	{Name: "voxcpm_driver.py", Script: &speechVoxCPMDriverScript},
	{Name: "voxcpm_mlx_driver.py", Script: &speechVoxCPMMLXDriverScript},
}

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
		files := append([]struct {
			Name   string
			Script *string
		}{}, speechServerScriptFiles...)
		files = append(files, speechQwen3ASRDriverScriptFile)
		return files
	case "speech.qwen3-asr-transformers.python":
		files := append([]struct {
			Name   string
			Script *string
		}{}, speechServerScriptFiles...)
		files = append(files, speechQwen3ASRTransformersDriverScriptFile)
		return files
	case "speech.voxcpm.python":
		files := append([]struct {
			Name   string
			Script *string
		}{}, speechServerScriptFiles...)
		files = append(files, speechVoxCPMDriverScriptFiles...)
		return files
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

func SpeechQwen3ASRTransformersDriverPath(root string) string {
	return filepath.Join(strings.TrimSpace(root), "qwen3_asr_transformers_driver.py")
}

func SpeechVoxCPMDriverPath(root string) string {
	return filepath.Join(strings.TrimSpace(root), "voxcpm_driver.py")
}

func SpeechVoxCPMMLXDriverPath(root string) string {
	return filepath.Join(strings.TrimSpace(root), "voxcpm_mlx_driver.py")
}

func SpeechVoxCPMBackendForPlatform(platformTuple string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(platformTuple)) {
	case "windows/amd64":
		return "standard", nil
	case "darwin/arm64":
		return "mlx", nil
	default:
		return "", fmt.Errorf("VoxCPM backend is not admitted for platform %s", platformTuple)
	}
}

func SpeechVoxCPMDriverPathForBackend(root string, backend string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(backend)) {
	case "standard":
		return SpeechVoxCPMDriverPath(root), nil
	case "mlx":
		return SpeechVoxCPMMLXDriverPath(root), nil
	default:
		return "", fmt.Errorf("VoxCPM backend is not admitted: %s", backend)
	}
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
	case "speech.qwen3-asr-transformers.python":
		return map[string]string{
			"NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD": speechDriverCommand(trimmedRoot, SpeechQwen3ASRTransformersDriverPath),
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
	case "speech.qwen3-asr-transformers.python":
		return []string{SpeechQwen3ASRTransformersDriverPath(trimmedRoot)}
	case "speech.voxcpm.python":
		return []string{SpeechVoxCPMDriverPath(trimmedRoot), SpeechVoxCPMMLXDriverPath(trimmedRoot)}
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
