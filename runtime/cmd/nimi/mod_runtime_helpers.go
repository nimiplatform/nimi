package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func resolveModsDir(raw string) (string, error) {
	if value := strings.TrimSpace(raw); value != "" {
		return filepath.Clean(value), nil
	}
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_MODS_DIR")); value != "" {
		return filepath.Clean(value), nil
	}
	return "", fmt.Errorf("MODS_DIR_REQUIRED: actionHint=set_--mods-dir_or_NIMI_RUNTIME_MODS_DIR")
}

func resolveGitHubAPIBase() string {
	if value := strings.TrimSpace(os.Getenv("GITHUB_API_URL")); value != "" {
		return value
	}
	return defaultGitHubAPIBase
}

func listInstalledMods(modsDir string) ([]modListItem, error) {
	entries, err := os.ReadDir(modsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []modListItem{}, nil
		}
		return nil, fmt.Errorf("read mods dir: %w", err)
	}

	items := make([]modListItem, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		modPath := filepath.Join(modsDir, entry.Name())
		manifest, err := loadManifest(modPath)
		if err != nil {
			manifest = normalizeManifest(modManifest{Name: titleFromSlug(entry.Name())}, modPath)
		}
		metadata := readInstallMetadata(modPath)
		items = append(items, modListItem{
			ModID:        manifest.ID,
			Name:         manifest.Name,
			Version:      manifest.Version,
			Path:         modPath,
			Source:       metadata.Source,
			InstalledAt:  metadata.InstalledAt,
			Verified:     metadata.Verified,
			Capabilities: append([]string(nil), manifest.Capabilities...),
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].ModID < items[j].ModID
	})
	return items, nil
}

func readInstallMetadata(modPath string) modInstallMetadata {
	path := filepath.Join(modPath, ".nimi-install.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return modInstallMetadata{}
	}
	var metadata modInstallMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return modInstallMetadata{}
	}
	return metadata
}
