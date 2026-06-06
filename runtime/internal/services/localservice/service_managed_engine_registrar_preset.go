package localservice

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

func renderManagedLlamaPreset(modelsPath string, registrations []managedLlamaRegistration, primaryName string) ([]byte, error) {
	if len(registrations) == 0 {
		return nil, nil
	}
	startupName := managedLlamaStartupModelName(registrations, primaryName)
	var builder strings.Builder
	builder.WriteString("version = 1\n\n")
	for _, registration := range registrations {
		name := strings.TrimSpace(registration.ExposedModelName)
		modelPath := strings.TrimSpace(registration.AbsoluteModelPath)
		if name == "" || modelPath == "" {
			return nil, fmt.Errorf("managed llama preset requires non-empty name and model path")
		}
		builder.WriteString("[" + name + "]\n")
		builder.WriteString("model = " + modelPath + "\n")
		if strings.EqualFold(startupName, name) {
			builder.WriteString("load-on-startup = true\n")
		} else {
			builder.WriteString("load-on-startup = false\n")
		}
		if managedLlamaRegistrationIsEmbeddingOnly(registration) {
			builder.WriteString("embeddings = true\n")
		}
		if cfg := registration.LlamaEngineConfig; cfg != nil {
			if cfg.Mmproj != "" {
				builder.WriteString("mmproj = " + absoluteManagedLlamaPresetPath(cfg.Mmproj, modelsPath) + "\n")
			}
			if cfg.CtxSize > 0 {
				builder.WriteString("ctx-size = " + strconv.Itoa(cfg.CtxSize) + "\n")
			}
			if cfg.CacheTypeK != "" {
				builder.WriteString("cache-type-k = " + cfg.CacheTypeK + "\n")
			}
			if cfg.CacheTypeV != "" {
				builder.WriteString("cache-type-v = " + cfg.CacheTypeV + "\n")
			}
			if cfg.FlashAttn != "" {
				builder.WriteString("flash-attn = " + cfg.FlashAttn + "\n")
			}
			if cfg.NGPULayers != nil {
				builder.WriteString("n-gpu-layers = " + strconv.Itoa(*cfg.NGPULayers) + "\n")
			}
		}
		builder.WriteString("\n")
	}
	return []byte(builder.String()), nil
}

func managedLlamaStartupModelName(registrations []managedLlamaRegistration, primaryName string) string {
	if primaryName != "" {
		for _, registration := range registrations {
			if strings.EqualFold(strings.TrimSpace(registration.ExposedModelName), strings.TrimSpace(primaryName)) {
				return strings.TrimSpace(registration.ExposedModelName)
			}
		}
	}
	for _, registration := range registrations {
		if localAssetHasCapability(registration.Capabilities, "chat", "text.generate") {
			return strings.TrimSpace(registration.ExposedModelName)
		}
	}
	if len(registrations) == 0 {
		return ""
	}
	return strings.TrimSpace(registrations[0].ExposedModelName)
}

func managedLlamaRegistrationIsEmbeddingOnly(registration managedLlamaRegistration) bool {
	return localAssetHasCapability(registration.Capabilities, "text.embed") &&
		!localAssetHasCapability(registration.Capabilities, "chat", "text.generate")
}

func absoluteManagedLlamaPresetPath(configuredPath string, modelsPath string) string {
	trimmed := strings.TrimSpace(configuredPath)
	if trimmed == "" || filepath.IsAbs(trimmed) {
		return trimmed
	}
	modelsDir := strings.TrimSpace(modelsPath)
	if modelsDir == "" {
		return filepath.Clean(filepath.FromSlash(trimmed))
	}
	return filepath.Join(modelsDir, filepath.FromSlash(trimmed))
}

// findMmprojCandidates returns filenames from the file list that look like
// mmproj companion artifacts (contain "mmproj" and end with ".gguf").
func findMmprojCandidates(files []string) []string {
	var out []string
	for _, f := range files {
		l := strings.ToLower(strings.TrimSpace(f))
		if strings.Contains(l, "mmproj") && strings.HasSuffix(l, ".gguf") {
			out = append(out, strings.TrimSpace(f))
		}
	}
	return out
}

func defaultCapabilitiesForRegistration(runtimeCaps []string, manifestCaps []string) []string {
	if len(runtimeCaps) > 0 {
		return normalizeAssetCapabilities(runtimeCaps)
	}
	return normalizeAssetCapabilities(manifestCaps)
}

func managedLlamaBackendForCapabilities(capabilities []string) (string, error) {
	backends := make(map[string]bool, len(capabilities))
	for _, capability := range capabilities {
		normalized := normalizeLocalCapabilityToken(capability)
		if normalized == "" {
			continue
		}
		switch normalized {
		case "audio.transcribe", "stt", "transcription":
			backends["whisper-ggml"] = true
		case "chat", "text.generate", "embedding", "embed", "text.embed":
			backends["llama-cpp"] = true
		default:
			backends["llama-cpp"] = true
		}
	}
	if len(backends) == 0 {
		return "llama-cpp", nil
	}
	if len(backends) > 1 {
		keys := make([]string, 0, len(backends))
		for key := range backends {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		return "", fmt.Errorf("llama backend conflict for capabilities=%s", strings.Join(keys, ","))
	}
	for key := range backends {
		return key, nil
	}
	return "llama-cpp", nil
}

func normalizeManagedModelRegistrationModelID(modelID string) string {
	raw := strings.TrimSpace(modelID)
	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "llama/"):
		raw = strings.TrimSpace(raw[len("llama/"):])
	case strings.HasPrefix(lower, "media/"):
		raw = strings.TrimSpace(raw[len("media/"):])
	case strings.HasPrefix(lower, "local/"):
		raw = strings.TrimSpace(raw[len("local/"):])
	}
	if raw == "" {
		return "local-model"
	}
	return raw
}

func slugifyLocalModelID(input string) string {
	var builder strings.Builder
	builder.Grow(len(input))
	for _, ch := range input {
		switch {
		case ch >= 'A' && ch <= 'Z':
			builder.WriteRune(ch + ('a' - 'A'))
		case ch >= 'a' && ch <= 'z', ch >= '0' && ch <= '9':
			builder.WriteRune(ch)
		case ch == '-', ch == '_', ch == '/', ch == ':', ch == '.', ch == ' ', ch == '\t', ch == '\n', ch == '\r':
			builder.WriteByte('-')
		}
	}
	parts := strings.FieldsFunc(builder.String(), func(r rune) bool { return r == '-' })
	if len(parts) == 0 {
		return "local-model"
	}
	return strings.Join(parts, "-")
}

func writeGeneratedLlamaConfigIfChanged(path string, rendered []byte) (bool, error) {
	if len(bytes.TrimSpace(rendered)) == 0 {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return false, fmt.Errorf("remove llama config %s: %w", path, err)
		}
		return true, nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, fmt.Errorf("create llama config directory: %w", err)
	}

	current, err := os.ReadFile(path)
	if err == nil && bytes.Equal(current, rendered) {
		return false, nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("read llama config %s: %w", path, err)
	}
	if err := os.WriteFile(path, rendered, 0o600); err != nil {
		return false, fmt.Errorf("write llama config %s: %w", path, err)
	}
	return true, nil
}
