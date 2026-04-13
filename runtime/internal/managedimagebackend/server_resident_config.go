package managedimagebackend

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type stableDiffusionCPPResidentConfig struct {
	ModelPath          string `json:"model_path"`
	VAEPath            string `json:"vae_path,omitempty"`
	LLMPath            string `json:"llm_path,omitempty"`
	ClipLPath          string `json:"clip_l_path,omitempty"`
	T5XXLPath          string `json:"t5xxl_path,omitempty"`
	DiffusionFA        bool   `json:"diffusion_fa,omitempty"`
	OffloadParamsToCPU bool   `json:"offload_params_to_cpu,omitempty"`
	Threads            int32  `json:"threads,omitempty"`
}

func validateManagedImageLoadState(state loadModelState) error {
	if strings.TrimSpace(state.ModelPath) == "" {
		return fmt.Errorf("managed image model path is required")
	}
	if _, err := os.Stat(strings.TrimSpace(state.ModelPath)); err != nil {
		return fmt.Errorf("managed image model path unavailable: %w", err)
	}
	for _, path := range []string{
		state.Options.VAEPath,
		state.Options.LLMPath,
		state.Options.ClipLPath,
		state.Options.T5XXLPath,
	} {
		if strings.TrimSpace(path) == "" {
			continue
		}
		if _, err := os.Stat(strings.TrimSpace(path)); err != nil {
			return fmt.Errorf("managed image option path unavailable: %w", err)
		}
	}
	return nil
}

func stableDiffusionCPPResidentConfigFromLoad(state loadModelState) stableDiffusionCPPResidentConfig {
	return stableDiffusionCPPResidentConfig{
		ModelPath:          strings.TrimSpace(state.ModelPath),
		VAEPath:            strings.TrimSpace(state.Options.VAEPath),
		LLMPath:            strings.TrimSpace(state.Options.LLMPath),
		ClipLPath:          strings.TrimSpace(state.Options.ClipLPath),
		T5XXLPath:          strings.TrimSpace(state.Options.T5XXLPath),
		DiffusionFA:        state.Options.DiffusionFA != nil && *state.Options.DiffusionFA,
		OffloadParamsToCPU: state.Options.OffloadParamsToCPU != nil && *state.Options.OffloadParamsToCPU,
		Threads:            state.Threads,
	}
}

func stableDiffusionCPPResidentFingerprint(config stableDiffusionCPPResidentConfig) (string, error) {
	raw, err := json.Marshal(config)
	if err != nil {
		return "", fmt.Errorf("marshal managed image resident config: %w", err)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func stableDiffusionCPPResidentStartupArgs(config stableDiffusionCPPResidentConfig, port int) []string {
	args := []string{
		"--listen-ip", "127.0.0.1",
		"--listen-port", strconv.Itoa(port),
		"--diffusion-model", config.ModelPath,
	}
	if config.Threads != 0 {
		args = append(args, "--threads", strconv.Itoa(int(config.Threads)))
	}
	if config.DiffusionFA {
		args = append(args, "--diffusion-fa")
	}
	if config.OffloadParamsToCPU {
		args = append(args, "--offload-to-cpu")
	}
	if config.VAEPath != "" {
		args = append(args, "--vae", config.VAEPath)
	}
	if config.LLMPath != "" {
		args = append(args, "--llm", config.LLMPath)
	}
	if config.ClipLPath != "" {
		args = append(args, "--clip_l", config.ClipLPath)
	}
	if config.T5XXLPath != "" {
		args = append(args, "--t5xxl", config.T5XXLPath)
	}
	return args
}

func stableDiffusionCPPResidentStartupSummary(config stableDiffusionCPPResidentConfig) string {
	return fmt.Sprintf("threads=%d diffusion_fa=%t offload_to_cpu=%t has_vae=%t has_llm=%t has_clip_l=%t has_t5xxl=%t",
		config.Threads,
		config.DiffusionFA,
		config.OffloadParamsToCPU,
		config.VAEPath != "",
		config.LLMPath != "",
		config.ClipLPath != "",
		config.T5XXLPath != "",
	)
}

func resolveStableDiffusionCPPServerExecutable(executablePath string) (string, error) {
	trimmed := strings.TrimSpace(executablePath)
	if trimmed == "" {
		return "", fmt.Errorf("managed image backend executable is required")
	}
	dir := filepath.Dir(trimmed)
	candidates := []string{"sd-server", "sd-server.exe"}
	base := strings.ToLower(filepath.Base(trimmed))
	if base == "sd-server" || base == "sd-server.exe" {
		return trimmed, nil
	}
	for _, candidate := range candidates {
		resolved := filepath.Join(dir, candidate)
		if _, err := os.Stat(resolved); err == nil {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("managed image resident executable not found next to %s", trimmed)
}
