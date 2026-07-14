package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type localAppManifest struct {
	AppID            string                `json:"app_id" yaml:"app_id"`
	AppIDCamel       string                `json:"appId" yaml:"appId"`
	DisplayName      string                `json:"display_name" yaml:"display_name"`
	DisplayNameCamel string                `json:"displayName" yaml:"displayName"`
	Permissions      localAppManifestPerms `json:"permissions" yaml:"permissions"`
}

type localAppManifestPerms struct {
	DeclaredNimiAPIScopes []localAppManifestCapability `json:"declared_nimi_api_scopes" yaml:"declared_nimi_api_scopes"`
}

type localAppManifestCapability struct {
	Scope     string `json:"scope" yaml:"scope"`
	Qualifier string `json:"qualifier" yaml:"qualifier"`
	Purpose   string `json:"purpose" yaml:"purpose"`
}

func loadLocalAppManifest(rootPath string) (string, string, localAppManifest, error) {
	root := strings.TrimSpace(rootPath)
	if root == "" {
		return "", "", localAppManifest{}, errors.New("local app rootPath is required")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", "", localAppManifest{}, fmt.Errorf("resolve local app rootPath: %w", err)
	}
	info, err := os.Stat(absRoot)
	if err != nil {
		return "", "", localAppManifest{}, fmt.Errorf("local app rootPath is not readable: %w", err)
	}
	if !info.IsDir() {
		return "", "", localAppManifest{}, errors.New("local app rootPath must be a directory")
	}
	canonicalRoot, err := filepath.EvalSymlinks(absRoot)
	if err != nil {
		return "", "", localAppManifest{}, fmt.Errorf("canonicalize local app rootPath: %w", err)
	}
	absRoot = filepath.Clean(canonicalRoot)
	for _, name := range []string{"nimi.app.yaml", "nimi.app.json"} {
		path := filepath.Join(absRoot, name)
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			if errors.Is(readErr, os.ErrNotExist) {
				continue
			}
			return "", "", localAppManifest{}, fmt.Errorf("%s is not readable: %w", name, readErr)
		}
		var manifest localAppManifest
		if strings.HasSuffix(name, ".json") {
			err = json.Unmarshal(raw, &manifest)
		} else {
			err = yaml.Unmarshal(raw, &manifest)
		}
		if err != nil {
			return "", "", localAppManifest{}, fmt.Errorf("%s is invalid: %w", name, err)
		}
		return absRoot, path, manifest, nil
	}
	return "", "", localAppManifest{}, errors.New("local app rootPath must contain nimi.app.yaml or nimi.app.json")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if normalized := strings.TrimSpace(value); normalized != "" {
			return normalized
		}
	}
	return ""
}

func safeLocalAppID(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsAny(value, `/\`) {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' || character == '.' || character == '-' || character == '_' {
			continue
		}
		return false
	}
	return true
}
