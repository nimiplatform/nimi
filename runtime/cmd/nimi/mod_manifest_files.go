package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

func resolvePrimarySourceFile(modDir string) (string, error) {
	candidates := []string{
		filepath.Join(modDir, "src", "index.ts"),
		filepath.Join(modDir, "src", "main.ts"),
		filepath.Join(modDir, "index.ts"),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("mod source file not found (expected src/index.ts)")
}

func loadManifest(modDir string) (modManifest, error) {
	jsonPath := filepath.Join(modDir, "mod.manifest.json")
	if raw, err := os.ReadFile(jsonPath); err == nil {
		manifest, parseErr := parseManifestJSON(raw)
		if parseErr != nil {
			return modManifest{}, parseErr
		}
		manifest = normalizeManifest(manifest, modDir)
		if validateErr := validateManifestCapabilities(manifest); validateErr != nil {
			return modManifest{}, validateErr
		}
		return manifest, nil
	}

	yamlCandidates := []string{
		filepath.Join(modDir, "mod.manifest.yaml"),
		filepath.Join(modDir, "mod.manifest.yml"),
	}
	for _, candidate := range yamlCandidates {
		if raw, err := os.ReadFile(candidate); err == nil {
			manifest, parseErr := parseManifestYAML(raw)
			if parseErr != nil {
				return modManifest{}, parseErr
			}
			manifest = normalizeManifest(manifest, modDir)
			if validateErr := validateManifestCapabilities(manifest); validateErr != nil {
				return modManifest{}, validateErr
			}
			return manifest, nil
		}
	}
	return modManifest{}, fmt.Errorf("manifest not found in %s", modDir)
}

func validateManifestCapabilities(manifest modManifest) error {
	for _, capability := range manifest.Capabilities {
		trimmed := strings.TrimSpace(capability)
		if trimmed == "" {
			continue
		}
		switch {
		case strings.HasPrefix(trimmed, "llm."):
			return fmt.Errorf(
				"MOD_MANIFEST_LEGACY_CAPABILITY_UNSUPPORTED: actionHint=replace_with_runtime_dot_capability capability=%s",
				trimmed,
			)
		case trimmed == "hook.agent-profile.read":
			return fmt.Errorf(
				"MOD_MANIFEST_LEGACY_CAPABILITY_UNSUPPORTED: actionHint=replace_with_runtime_profile_read_agent capability=%s",
				trimmed,
			)
		case trimmed == "data.query.data-api.runtime.route.options":
			return fmt.Errorf(
				"MOD_MANIFEST_LEGACY_CAPABILITY_UNSUPPORTED: actionHint=replace_with_runtime_route_list_options capability=%s",
				trimmed,
			)
		}
	}
	return nil
}

func parseManifestJSON(raw []byte) (modManifest, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return modManifest{}, fmt.Errorf("parse mod.manifest.json: %w", err)
	}
	manifest := modManifest{
		ID:          asManifestString(payload["id"]),
		Name:        asManifestString(payload["name"]),
		Version:     asManifestString(payload["version"]),
		Description: asManifestString(payload["description"]),
		License:     asManifestString(payload["license"]),
	}
	manifest.Capabilities = asManifestStringSlice(payload["capabilities"])
	return manifest, nil
}

func parseManifestYAML(raw []byte) (modManifest, error) {
	var payload struct {
		ID           string   `yaml:"id"`
		Name         string   `yaml:"name"`
		Version      string   `yaml:"version"`
		Description  string   `yaml:"description"`
		License      string   `yaml:"license"`
		Capabilities []string `yaml:"capabilities"`
	}
	if err := yaml.Unmarshal(raw, &payload); err != nil {
		return modManifest{}, fmt.Errorf("parse mod.manifest.yaml: %w", err)
	}
	return modManifest{
		ID:           payload.ID,
		Name:         payload.Name,
		Version:      payload.Version,
		Description:  payload.Description,
		License:      payload.License,
		Capabilities: payload.Capabilities,
	}, nil
}

func normalizeManifest(manifest modManifest, modDir string) modManifest {
	fallbackName := titleFromSlug(filepath.Base(modDir))
	if strings.TrimSpace(manifest.Name) == "" {
		manifest.Name = fallbackName
	}
	if strings.TrimSpace(manifest.ID) == "" {
		manifest.ID = "world.nimi." + slugify(manifest.Name)
	}
	if strings.TrimSpace(manifest.Version) == "" {
		manifest.Version = "0.1.0"
	}
	if strings.TrimSpace(manifest.Description) == "" {
		manifest.Description = "Nimi mod"
	}
	if strings.TrimSpace(manifest.License) == "" {
		manifest.License = "MIT"
	}
	if manifest.Capabilities == nil {
		manifest.Capabilities = []string{}
	}
	return manifest
}

func writeManifestYAML(path string, manifest modManifest) error {
	manifest = normalizeManifest(manifest, filepath.Dir(path))
	if err := validateManifestCapabilities(manifest); err != nil {
		return err
	}
	lines := []string{
		"id: " + manifest.ID,
		"name: " + manifest.Name,
		"version: " + manifest.Version,
		"description: " + manifest.Description,
		"entry: ./dist/index.js",
		"license: " + manifest.License,
	}
	if len(manifest.Capabilities) > 0 {
		lines = append(lines, "capabilities:")
		for _, capability := range manifest.Capabilities {
			trimmed := strings.TrimSpace(capability)
			if trimmed == "" {
				continue
			}
			lines = append(lines, "  - "+trimmed)
		}
	}
	content := strings.Join(lines, "\n") + "\n"
	return os.WriteFile(path, []byte(content), 0o644)
}

func updateManifestHash(modDir string, hash string) error {
	jsonPath := filepath.Join(modDir, "mod.manifest.json")
	if raw, err := os.ReadFile(jsonPath); err == nil {
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			return err
		}
		payload["hash"] = "sha256:" + hash
		return writeJSONFile(jsonPath, payload)
	}

	yamlCandidates := []string{
		filepath.Join(modDir, "mod.manifest.yaml"),
		filepath.Join(modDir, "mod.manifest.yml"),
	}
	for _, candidate := range yamlCandidates {
		raw, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		lines := strings.Split(string(raw), "\n")
		replaced := false
		for idx, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "hash:") {
				lines[idx] = "hash: sha256:" + hash
				replaced = true
				break
			}
		}
		if !replaced {
			if len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
				lines = lines[:len(lines)-1]
			}
			lines = append(lines, "hash: sha256:"+hash)
		}
		updated := strings.Join(lines, "\n")
		if !strings.HasSuffix(updated, "\n") {
			updated += "\n"
		}
		return os.WriteFile(candidate, []byte(updated), 0o644)
	}
	return fmt.Errorf("manifest file not found for hash update")
}
