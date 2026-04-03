package engine

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"google.golang.org/protobuf/types/known/structpb"
	"gopkg.in/yaml.v3"
)

type llamaModelsConfigEntry struct {
	Name       string                     `yaml:"name"`
	Backend    string                     `yaml:"backend"`
	Parameters llamaModelsConfigParameter `yaml:"parameters"`
}

type llamaModelsConfigParameter struct {
	Model      string `yaml:"model"`
	Mmproj     string `yaml:"mmproj,omitempty"`
	CtxSize    int    `yaml:"ctx_size,omitempty"`
	CacheTypeK string `yaml:"cache_type_k,omitempty"`
	CacheTypeV string `yaml:"cache_type_v,omitempty"`
	FlashAttn  string `yaml:"flash_attn,omitempty"`
	NGPULayers *int   `yaml:"n_gpu_layers,omitempty"`
}

// --- Llama engine config validation ---

// allowedLlamaCacheTypes is the set of valid KV cache quantization types
// supported by llama-server b8645. Based on upstream llama.cpp server README.
var allowedLlamaCacheTypes = map[string]bool{
	"f32": true, "f16": true, "bf16": true,
	"q8_0": true, "q4_0": true, "q4_1": true,
	"iq4_nl": true, "q5_0": true, "q5_1": true,
}

func isAllowedLlamaCacheType(v string) bool {
	return allowedLlamaCacheTypes[strings.TrimSpace(v)]
}

var allowedLlamaFlashAttn = map[string]bool{"on": true, "off": true, "auto": true}

func isAllowedLlamaFlashAttn(v string) bool {
	return allowedLlamaFlashAttn[strings.ToLower(strings.TrimSpace(v))]
}

// --- Typed extraction from protobuf Struct ---

// ManagedLlamaEngineConfig holds validated engine_config.llama.* parameters
// extracted from a protobuf Struct. See K-LENG-018.
type ManagedLlamaEngineConfig struct {
	CtxSize    int
	CacheTypeK string
	CacheTypeV string
	FlashAttn  string
	Mmproj     string
	NGPULayers *int
}

// ExtractManagedLlamaEngineConfig extracts and validates llama-specific
// parameters from the engine_config protobuf Struct. Returns an error on
// known key + invalid value (fail-close per K-LENG-018).
func ExtractManagedLlamaEngineConfig(engineConfig *structpb.Struct) (ManagedLlamaEngineConfig, error) {
	var cfg ManagedLlamaEngineConfig
	if engineConfig == nil {
		return cfg, nil
	}
	fields := engineConfig.GetFields()
	if fields == nil {
		return cfg, nil
	}
	llamaValue, ok := fields["llama"]
	if !ok || llamaValue == nil {
		return cfg, nil
	}
	llamaStruct := llamaValue.GetStructValue()
	if llamaStruct == nil {
		return cfg, nil
	}
	llamaFields := llamaStruct.GetFields()
	if llamaFields == nil {
		return cfg, nil
	}

	if v, ok := llamaFields["ctx_size"]; ok && v != nil {
		n := int(v.GetNumberValue())
		if n < 512 || n > 1048576 {
			return cfg, fmt.Errorf("extract llama engine config: ctx_size must be 512..1048576, got %d", n)
		}
		cfg.CtxSize = n
	}
	if v, ok := llamaFields["cache_type_k"]; ok && v != nil {
		s := strings.TrimSpace(v.GetStringValue())
		if s != "" && !isAllowedLlamaCacheType(s) {
			return cfg, fmt.Errorf("extract llama engine config: cache_type_k invalid: %q", s)
		}
		cfg.CacheTypeK = s
	}
	if v, ok := llamaFields["cache_type_v"]; ok && v != nil {
		s := strings.TrimSpace(v.GetStringValue())
		if s != "" && !isAllowedLlamaCacheType(s) {
			return cfg, fmt.Errorf("extract llama engine config: cache_type_v invalid: %q", s)
		}
		cfg.CacheTypeV = s
	}
	if v, ok := llamaFields["flash_attn"]; ok && v != nil {
		s := strings.TrimSpace(v.GetStringValue())
		if s != "" && !isAllowedLlamaFlashAttn(s) {
			return cfg, fmt.Errorf("extract llama engine config: flash_attn invalid: %q (must be on/off/auto)", s)
		}
		cfg.FlashAttn = strings.ToLower(s)
	}
	if v, ok := llamaFields["mmproj"]; ok && v != nil {
		s := strings.TrimSpace(v.GetStringValue())
		if s != "" {
			if !strings.HasSuffix(strings.ToLower(s), ".gguf") {
				return cfg, fmt.Errorf("extract llama engine config: mmproj must be a .gguf file: %q", s)
			}
			cfg.Mmproj = s
		}
	}
	if v, ok := llamaFields["n_gpu_layers"]; ok && v != nil {
		n := int(v.GetNumberValue())
		if n < 0 {
			return cfg, fmt.Errorf("extract llama engine config: n_gpu_layers must be >= 0, got %d", n)
		}
		cfg.NGPULayers = &n
	}

	return cfg, nil
}

// --- CLI arg projection ---

// projectLlamaEngineParams converts extended llama config parameters to
// llama-server CLI arguments. modelsRoot is used to resolve relative mmproj
// paths. Returns error on path traversal or invalid state.
func projectLlamaEngineParams(modelsRoot string, params llamaModelsConfigParameter) ([]string, error) {
	var args []string

	if params.CtxSize > 0 {
		args = append(args, "--ctx-size", strconv.Itoa(params.CtxSize))
	}
	if params.CacheTypeK != "" {
		args = append(args, "--cache-type-k", params.CacheTypeK)
	}
	if params.CacheTypeV != "" {
		args = append(args, "--cache-type-v", params.CacheTypeV)
	}
	if params.FlashAttn != "" {
		args = append(args, "--flash-attn", params.FlashAttn)
	}
	if params.Mmproj != "" {
		mmPath := params.Mmproj
		if !filepath.IsAbs(mmPath) && modelsRoot != "" {
			mmPath = filepath.Join(modelsRoot, filepath.FromSlash(mmPath))
		}
		if modelsRoot != "" {
			absRoot, err := filepath.Abs(modelsRoot)
			if err != nil {
				return nil, fmt.Errorf("resolve models root: %w", err)
			}
			absMM, err := filepath.Abs(mmPath)
			if err != nil {
				return nil, fmt.Errorf("resolve mmproj path: %w", err)
			}
			rel, err := filepath.Rel(absRoot, absMM)
			if err != nil || strings.HasPrefix(rel, "..") {
				return nil, fmt.Errorf("project llama engine params: mmproj path %q escapes models root", params.Mmproj)
			}
		}
		args = append(args, "--mmproj", mmPath)
	}
	if params.NGPULayers != nil {
		args = append(args, "--n-gpu-layers", strconv.Itoa(*params.NGPULayers))
	}

	return args, nil
}

func normalizeLlamaExternalBackends(backends []string) []string {
	if len(backends) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(backends))
	normalized := make([]string, 0, len(backends))
	for _, backend := range backends {
		trimmed := strings.TrimSpace(backend)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	sort.Strings(normalized)
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func normalizeLlamaExternalGRPCBackends(backends []string) []string {
	return normalizeLlamaExternalBackends(backends)
}

func detectLlamaExternalBackends(configPath string) []string {
	trimmedPath := strings.TrimSpace(configPath)
	if trimmedPath == "" {
		return nil
	}
	raw, err := os.ReadFile(trimmedPath)
	if err != nil {
		return nil
	}
	var entries []llamaModelsConfigEntry
	if err := yaml.Unmarshal(raw, &entries); err != nil {
		slog.Warn("llama external backend config parse failed", "path", trimmedPath, "error", err)
		return nil
	}
	backends := make([]string, 0, len(entries))
	for _, entry := range entries {
		backends = append(backends, entry.Backend)
	}
	return normalizeLlamaExternalBackends(backends)
}
