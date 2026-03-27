package engine

import (
	"log/slog"
	"os"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type llamaModelsConfigEntry struct {
	Backend string `yaml:"backend"`
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
