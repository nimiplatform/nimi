package app

import (
	"cmp"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
	"github.com/nimiplatform/nimi/runtime/internal/appidentity"
	"gopkg.in/yaml.v3"
)

func resolveLocalDevelopmentProject(rootPath, expectedAppID string, shellKind runtimev1.LocalDevelopmentShellKind) (localDevelopmentProjectSnapshot, error) {
	root, manifestPath, manifest, err := loadLocalAppManifest(rootPath)
	if err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	appID := cmp.Or(manifest.AppID, manifest.AppIDCamel)
	displayName := firstNonEmpty(manifest.DisplayName, manifest.DisplayNameCamel)
	if !appidentity.Valid(appID) || displayName == "" || displayName != strings.TrimSpace(displayName) {
		return localDevelopmentProjectSnapshot{}, errors.New("local-development manifest requires canonical app_id and display_name")
	}
	if expected := strings.TrimSpace(expectedAppID); expected == "" || expected != expectedAppID || expected != appID {
		return localDevelopmentProjectSnapshot{}, fmt.Errorf("local-development manifest app_id %s does not match expected app_id %s", appID, expectedAppID)
	}
	if shellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON &&
		shellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI {
		return localDevelopmentProjectSnapshot{}, errors.New("local-development shell kind is invalid")
	}
	managedWeb, err := detectManagedWebBuildProfile(filepath.Clean(root))
	if err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	if managedWeb && shellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON {
		return localDevelopmentProjectSnapshot{}, errors.New("managed-web local-development requires electron carrier shell kind")
	}
	raw, activated, err := appaccess.ResolveDeclaration(*manifest.AppAccess)
	if err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	project := localDevelopmentProjectSnapshot{
		AppID: appID, DisplayName: displayName, ProjectRoot: filepath.Clean(root),
		ManifestPath: filepath.Clean(manifestPath), ShellKind: shellKind, ManagedWeb: managedWeb,
		RawAppAccess: raw, ActivatedDomains: activated,
	}
	if err := validateLocalDevelopmentProject(project); err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	return project, nil
}

func detectManagedWebBuildProfile(projectRoot string) (bool, error) {
	profilePath := filepath.Join(projectRoot, ".nimi", "config", "build-profile.yaml")
	raw, err := os.ReadFile(profilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("read local-development build profile: %w", err)
	}
	var parsed struct {
		BuildProfileRef string `yaml:"build_profile_ref"`
	}
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		return false, fmt.Errorf("parse local-development build profile: %w", err)
	}
	return strings.TrimSpace(parsed.BuildProfileRef) == "managed-web-pnpm-vite", nil
}

func validateLocalDevelopmentProject(project localDevelopmentProjectSnapshot) error {
	if !appidentity.Valid(project.AppID) || strings.TrimSpace(project.DisplayName) == "" ||
		!filepath.IsAbs(project.ProjectRoot) || !filepath.IsAbs(project.ManifestPath) || project.ShellKind <= 0 {
		return errLocalDevelopmentInvalid
	}
	if filepath.Dir(project.ManifestPath) != project.ProjectRoot {
		return errLocalDevelopmentInvalid
	}
	raw, activated, err := appaccess.ResolveDeclaration(project.RawAppAccess)
	if err != nil || len(raw) != len(project.RawAppAccess) || len(activated) != len(project.ActivatedDomains) {
		return errLocalDevelopmentInvalid
	}
	for index := range activated {
		if activated[index] != project.ActivatedDomains[index] {
			return errLocalDevelopmentInvalid
		}
	}
	return nil
}
