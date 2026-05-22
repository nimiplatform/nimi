package grpcserver

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/firstpartymigration"
)

func loadNimiAppRegistryCatalog(path string) (*appregistrycatalog.Registry, *appreleasecatalog.Catalog, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, nil, nil
	}
	registry, err := appregistrycatalog.LoadRegistryFromFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("load Nimi App registry projection: %w", err)
	}
	releaseDescriptors, err := appreleasecatalog.LoadCatalogFromFile(deriveNimiAppReleaseDescriptorPath(path))
	if err != nil {
		return nil, nil, fmt.Errorf("load Nimi App release descriptor projection: %w", err)
	}
	violations := registry.ValidateReleaseDescriptorBindings(
		releaseDescriptorValidationRefs(releaseDescriptors),
		admittedNimiAppStoragePolicyRefs(),
	)
	if len(violations) > 0 {
		return nil, nil, fmt.Errorf("validate Nimi App registry release descriptor bindings: %s", formatNimiAppRegistryViolations(violations))
	}
	return registry, releaseDescriptors, nil
}

func deriveNimiAppReleaseDescriptorPath(registryPath string) string {
	dir := filepath.Dir(registryPath)
	base := filepath.Base(registryPath)
	if strings.Contains(base, "nimi-app-registry") {
		return filepath.Join(dir, strings.Replace(base, "nimi-app-registry", "nimi-app-release-descriptors", 1))
	}
	if base == "registry.json" {
		return filepath.Join(dir, "release-descriptors.json")
	}
	return filepath.Join(dir, "nimi-app-release-descriptors.yaml")
}

func releaseDescriptorValidationRefs(catalog *appreleasecatalog.Catalog) []appregistrycatalog.ReleaseDescriptorValidationRef {
	if catalog == nil {
		return nil
	}
	refs := make([]appregistrycatalog.ReleaseDescriptorValidationRef, 0, len(catalog.Descriptors))
	for _, descriptor := range catalog.Descriptors {
		refs = append(refs, appregistrycatalog.ReleaseDescriptorValidationRef{
			DescriptorID:     descriptor.DescriptorID,
			AppID:            descriptor.AppID,
			StoragePolicyRef: descriptor.StoragePolicyRef,
		})
	}
	return refs
}

func admittedNimiAppStoragePolicyRefs() []string {
	return []string{"nimi-data-app-roots"}
}

func formatNimiAppRegistryViolations(violations []appregistrycatalog.CrossTableViolation) string {
	parts := make([]string, 0, len(violations))
	for _, violation := range violations {
		parts = append(parts, violation.Error())
	}
	return strings.Join(parts, "; ")
}

func defaultFirstPartyMigrationLaunchGate() *firstpartymigration.LaunchGate {
	return firstpartymigration.NewLaunchGate(
		firstpartymigration.WithMigrationNotRequired("nimi.parentos"),
	)
}
