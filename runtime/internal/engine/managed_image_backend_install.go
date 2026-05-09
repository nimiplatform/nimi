package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const managedImageBackendRunScript = "run.sh"

var officialManagedImageBackendAllowlist = map[string]struct{}{
	"llama-cpp":            {},
	"whisper-ggml":         {},
	"stablediffusion-ggml": {},
}

const ociManifestMediaTypeV2 = "application/vnd.docker.distribution.manifest.v2+json"

type ociDistributionManifest struct {
	SchemaVersion int                    `json:"schemaVersion"`
	MediaType     string                 `json:"mediaType,omitempty"`
	Layers        []ociDistributionLayer `json:"layers,omitempty"`
}

type ociDistributionLayer struct {
	MediaType string `json:"mediaType,omitempty"`
	Size      int64  `json:"size,omitempty"`
	Digest    string `json:"digest,omitempty"`
}

type ociImageReference struct {
	Registry   string
	Repository string
	Reference  string
}

type managedImageBackendMetadata struct {
	Name           string `json:"name,omitempty"`
	Alias          string `json:"alias,omitempty"`
	MetaBackendFor string `json:"meta_backend_for,omitempty"`
}

type managedImageBackendLaunchConfig struct {
	Command    string
	Args       []string
	WorkingDir string
	Env        map[string]string
}

var managedImageBackendCurrentExecutable = os.Executable

func normalizeManagedImageBackendConfig(input *ManagedImageBackendConfig) *ManagedImageBackendConfig {
	cfg := cloneManagedImageBackendConfig(input)
	if cfg == nil {
		cfg = &ManagedImageBackendConfig{}
	}
	if cfg.Mode == "" {
		cfg.Mode = ManagedImageBackendDisabled
	}
	if strings.TrimSpace(cfg.BackendName) == "" {
		cfg.BackendName = "stablediffusion-ggml"
	}
	if strings.TrimSpace(cfg.Address) == "" {
		cfg.Address = "127.0.0.1:50052"
	}
	if cfg.StartupTimeout <= 0 {
		cfg.StartupTimeout = 45 * time.Second
	}
	if cfg.HealthInterval <= 0 {
		cfg.HealthInterval = 15 * time.Second
	}
	if cfg.ShutdownTimeout <= 0 {
		cfg.ShutdownTimeout = 10 * time.Second
	}
	return cfg
}

func managedImageBackendEngineConfig(cfg *ManagedImageBackendConfig) (EngineConfig, error) {
	if cfg == nil || !cfg.Enabled() {
		return EngineConfig{}, fmt.Errorf("managed image backend disabled")
	}
	address := strings.TrimSpace(cfg.Address)
	_, portValue, err := net.SplitHostPort(address)
	if err != nil {
		return EngineConfig{}, fmt.Errorf("invalid image backend address %q", address)
	}
	port, err := strconv.Atoi(strings.TrimSpace(portValue))
	if err != nil || port <= 0 || port > 65535 {
		return EngineConfig{}, fmt.Errorf("invalid image backend port in %q", address)
	}
	command := strings.TrimSpace(cfg.Command)
	if command == "" {
		return EngineConfig{}, fmt.Errorf("image backend command is required")
	}
	return EngineConfig{
		Kind:             engineManagedImageBackend,
		Port:             port,
		Address:          address,
		HealthMode:       HealthModeTCP,
		BinaryPath:       command,
		CommandArgs:      append([]string(nil), cfg.Args...),
		CommandEnv:       cloneStringMap(cfg.Env),
		WorkingDir:       strings.TrimSpace(cfg.WorkingDir),
		StartupTimeout:   cfg.StartupTimeout,
		HealthInterval:   cfg.HealthInterval,
		ShutdownTimeout:  cfg.ShutdownTimeout,
		RestartBaseDelay: 2 * time.Second,
		MaxRestarts:      5,
	}, nil
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}

func ensureManagedImageBackendInstalled(_ context.Context, backendsPath string, sharedDependenciesPath string, cfg *ManagedImageBackendConfig) (*ManagedImageBackendConfig, error) {
	return resolveInstalledManagedImageBackendConfig(backendsPath, sharedDependenciesPath, cfg)
}

func ensureManagedImageBackendMaterialized(ctx context.Context, backendsPath string, sharedDependenciesPath string, cfg *ManagedImageBackendConfig) (*ManagedImageBackendConfig, error) {
	normalized := normalizeManagedImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return normalized, nil
	}
	if normalized.Mode != ManagedImageBackendOfficial {
		return normalized, nil
	}
	validatedBackendName, err := validateOfficialManagedImageBackendName(normalized.BackendName)
	if err != nil {
		return nil, err
	}
	normalized.BackendName = validatedBackendName
	if strings.TrimSpace(backendsPath) == "" {
		return nil, fmt.Errorf("managed image backends path is required")
	}
	if err := os.MkdirAll(backendsPath, 0o755); err != nil {
		return nil, fmt.Errorf("create managed image backends path: %w", err)
	}

	packageSpec, ok := resolveManagedImageBackendPackageSpecForCurrentHostWithSource(normalized.BackendName, normalized.PackageSource)
	if !ok {
		if source := strings.TrimSpace(normalized.PackageSource); source != "" {
			return nil, fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s with package source %q", normalized.BackendName, currentGOOS(), currentGOARCH(), source)
		}
		return nil, fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s", normalized.BackendName, currentGOOS(), currentGOARCH())
	}
	if !packageSpec.Supported {
		if strings.TrimSpace(packageSpec.Detail) != "" {
			return nil, fmt.Errorf("%s", strings.TrimSpace(packageSpec.Detail))
		}
		if source := strings.TrimSpace(normalized.PackageSource); source != "" {
			return nil, fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s with package source %q", normalized.BackendName, currentGOOS(), currentGOARCH(), source)
		}
		return nil, fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s", normalized.BackendName, currentGOOS(), currentGOARCH())
	}

	launchCfg, err := discoverInstalledManagedImageBackendLaunchConfig(backendsPath, sharedDependenciesPath, normalized.BackendName, packageSpec, normalized.Address)
	if err != nil {
		if installErr := installManagedImageBackendPackage(ctx, backendsPath, normalized.BackendName, packageSpec); installErr != nil {
			return nil, installErr
		}
		launchCfg, err = discoverInstalledManagedImageBackendLaunchConfig(backendsPath, sharedDependenciesPath, normalized.BackendName, packageSpec, normalized.Address)
		if err != nil {
			return nil, err
		}
	}

	normalized.Command = launchCfg.Command
	normalized.Args = append([]string(nil), launchCfg.Args...)
	normalized.WorkingDir = strings.TrimSpace(launchCfg.WorkingDir)
	normalized.Env = cloneStringMap(launchCfg.Env)
	return normalized, nil
}

func resolveInstalledManagedImageBackendConfig(backendsPath string, sharedDependenciesPath string, cfg *ManagedImageBackendConfig) (*ManagedImageBackendConfig, error) {
	normalized := normalizeManagedImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return normalized, nil
	}
	if normalized.Mode != ManagedImageBackendOfficial {
		return normalized, nil
	}
	validatedBackendName, err := validateOfficialManagedImageBackendName(normalized.BackendName)
	if err != nil {
		return nil, err
	}
	normalized.BackendName = validatedBackendName
	if strings.TrimSpace(backendsPath) == "" {
		return nil, fmt.Errorf("managed image backends path is required")
	}
	packageSpec, ok := resolveManagedImageBackendPackageSpecForCurrentHostWithSource(normalized.BackendName, normalized.PackageSource)
	if !ok {
		if source := strings.TrimSpace(normalized.PackageSource); source != "" {
			return nil, fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s with package source %q", normalized.BackendName, currentGOOS(), currentGOARCH(), source)
		}
		return nil, fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s", normalized.BackendName, currentGOOS(), currentGOARCH())
	}
	if !packageSpec.Supported {
		if strings.TrimSpace(packageSpec.Detail) != "" {
			return nil, fmt.Errorf("%s", strings.TrimSpace(packageSpec.Detail))
		}
		if source := strings.TrimSpace(normalized.PackageSource); source != "" {
			return nil, fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s with package source %q", normalized.BackendName, currentGOOS(), currentGOARCH(), source)
		}
		return nil, fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s", normalized.BackendName, currentGOOS(), currentGOARCH())
	}
	launchCfg, err := discoverInstalledManagedImageBackendLaunchConfig(backendsPath, sharedDependenciesPath, normalized.BackendName, packageSpec, normalized.Address)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrManagedImageBackendMaterializationRequired, err)
	}
	normalized.Command = launchCfg.Command
	normalized.Args = append([]string(nil), launchCfg.Args...)
	normalized.WorkingDir = strings.TrimSpace(launchCfg.WorkingDir)
	normalized.Env = cloneStringMap(launchCfg.Env)
	return normalized, nil
}

func managedImageBackendDependencyStatusFromConfig(cfg *ManagedImageBackendConfig, spec managedImageBackendPackageSpec) ManagedImageBackendDependencyStatus {
	status := ManagedImageBackendDependencyStatus{
		BackendName:       strings.TrimSpace(cfg.BackendName),
		PackageSource:     strings.TrimSpace(string(spec.PackageSource)),
		PackageFormat:     strings.TrimSpace(string(spec.PackageFormat)),
		LaunchMode:        strings.TrimSpace(string(spec.LaunchMode)),
		VerifiedArtifacts: normalizeManagedImageBackendVerifiedArtifacts(cfg, spec),
	}
	if root := strings.TrimSpace(cfg.WorkingDir); root != "" {
		status.CanonicalRoot = root
	} else if command := strings.TrimSpace(cfg.Command); command != "" {
		status.CanonicalRoot = filepath.Dir(command)
	}
	if status.PackageSource != "" {
		status.Detail = "managed image backend package verified from " + status.PackageSource
	} else {
		status.Detail = "managed image backend package verified"
	}
	return status
}

func normalizeManagedImageBackendVerifiedArtifacts(cfg *ManagedImageBackendConfig, spec managedImageBackendPackageSpec) []string {
	artifacts := make([]string, 0, 1+len(spec.ExecutableCandidates))
	if command := strings.TrimSpace(cfg.Command); command != "" {
		artifacts = append(artifacts, command)
	}
	for _, candidate := range spec.ExecutableCandidates {
		trimmed := strings.TrimSpace(candidate)
		if trimmed != "" {
			artifacts = append(artifacts, trimmed)
		}
	}
	return artifacts
}

func installManagedImageBackendPackage(ctx context.Context, backendsPath string, backendName string, spec managedImageBackendPackageSpec) error {
	validatedBackendName, err := validateOfficialManagedImageBackendName(backendName)
	if err != nil {
		return err
	}
	switch spec.PackageFormat {
	case managedImageBackendPackageFormatOCIPayload:
		return installManagedImageBackendFromOCI(ctx, backendsPath, validatedBackendName, spec)
	case managedImageBackendPackageFormatDirectArchive:
		return installManagedImageBackendFromDirectArchive(ctx, backendsPath, validatedBackendName, spec)
	case managedImageBackendPackageFormatNone:
		if strings.TrimSpace(spec.Detail) != "" {
			return fmt.Errorf("%s", strings.TrimSpace(spec.Detail))
		}
		return fmt.Errorf("no published runtime-owned managed image backend package is available for %s on %s/%s", validatedBackendName, currentGOOS(), currentGOARCH())
	default:
		return fmt.Errorf("unsupported managed image backend package format %q for %s", spec.PackageFormat, validatedBackendName)
	}
}

func validateOfficialManagedImageBackendName(backendName string) (string, error) {
	trimmedBackendName := strings.TrimSpace(backendName)
	if trimmedBackendName == "" {
		return "", fmt.Errorf("managed image backend name is required")
	}
	if _, ok := officialManagedImageBackendAllowlist[trimmedBackendName]; !ok {
		return "", fmt.Errorf("unsupported official managed image backend %q", trimmedBackendName)
	}
	return trimmedBackendName, nil
}

func installManagedImageBackendFromOCI(ctx context.Context, backendsPath string, backendName string, spec managedImageBackendPackageSpec) error {
	parsedRef, err := parseOCIImageReference(spec.ImageRef)
	if err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	manifest, err := fetchOCIManifest(ctx, parsedRef)
	if err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	if len(manifest.Layers) != 1 {
		return fmt.Errorf("install managed image backend %s: unsupported OCI layer count %d for %s", backendName, len(manifest.Layers), spec.ImageRef)
	}
	layerDigest := strings.TrimSpace(manifest.Layers[0].Digest)
	if layerDigest == "" {
		return fmt.Errorf("install managed image backend %s: OCI layer digest is required", backendName)
	}
	expectedLayerDigest := normalizeOCIContentDigest(spec.OCILayerDigest)
	if expectedLayerDigest == "" {
		return fmt.Errorf("install managed image backend %s: admitted OCI layer digest is required for %s", backendName, spec.ImageRef)
	}
	if !strings.EqualFold(expectedLayerDigest, normalizeOCIContentDigest(layerDigest)) {
		return fmt.Errorf("%w: OCI layer digest mismatch for %s: expected=%s actual=%s", ErrEngineBinaryHashMismatch, spec.ImageRef, expectedLayerDigest, normalizeOCIContentDigest(layerDigest))
	}

	tmpDir, err := os.MkdirTemp(filepath.Dir(backendsPath), ".managed-image-backend-*")
	if err != nil {
		return fmt.Errorf("install managed image backend %s: create temp dir: %w", backendName, err)
	}
	defer os.RemoveAll(tmpDir)

	layerPath := filepath.Join(tmpDir, "layer.tar.gz")
	if _, err := downloadOCIImageBlobToFile(ctx, parsedRef, expectedLayerDigest, layerPath); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}

	stagedDir := filepath.Join(tmpDir, "payload")
	if err := os.MkdirAll(stagedDir, 0o755); err != nil {
		return fmt.Errorf("install managed image backend %s: create staged dir: %w", backendName, err)
	}
	if err := extractManagedPayload(layerPath, stagedDir); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	if err := writeManagedImageBackendMetadata(filepath.Join(stagedDir, "metadata.json"), managedImageBackendMetadata{
		Name:  spec.InstallDirName,
		Alias: backendName,
	}); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	targetDir := filepath.Join(backendsPath, spec.InstallDirName)
	if err := installManagedBinaryPayload(targetDir, stagedDir); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	return nil
}

func installManagedImageBackendFromDirectArchive(ctx context.Context, backendsPath string, backendName string, spec managedImageBackendPackageSpec) error {
	if strings.TrimSpace(spec.ArchiveURL) == "" {
		return fmt.Errorf("install managed image backend %s: archive URL is required", backendName)
	}
	if strings.TrimSpace(spec.InstallDirName) == "" {
		return fmt.Errorf("install managed image backend %s: install dir name is required", backendName)
	}
	if len(spec.ExecutableCandidates) == 0 {
		return fmt.Errorf("install managed image backend %s: executable candidates are required", backendName)
	}
	expectedArchiveSHA256 := strings.TrimSpace(spec.ArchiveSHA256)
	if expectedArchiveSHA256 == "" {
		return fmt.Errorf("install managed image backend %s: admitted archive sha256 is required for %s", backendName, spec.ArchiveURL)
	}

	tmpDir, err := os.MkdirTemp(filepath.Dir(backendsPath), ".managed-image-backend-*")
	if err != nil {
		return fmt.Errorf("install managed image backend %s: create temp dir: %w", backendName, err)
	}
	defer os.RemoveAll(tmpDir)

	archiveName := filepath.Base(strings.TrimSpace(spec.ArchiveURL))
	if archiveName == "." || archiveName == "" {
		archiveName = "payload.zip"
	}
	archivePath := filepath.Join(tmpDir, archiveName)
	archiveHash, err := downloadURLToFile(strings.TrimSpace(spec.ArchiveURL), archivePath)
	if err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	if !strings.EqualFold(expectedArchiveSHA256, archiveHash) {
		return fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, strings.ToLower(expectedArchiveSHA256), archiveHash)
	}

	stagedDir := filepath.Join(tmpDir, "payload")
	if err := os.MkdirAll(stagedDir, 0o755); err != nil {
		return fmt.Errorf("install managed image backend %s: create staged dir: %w", backendName, err)
	}
	if err := extractManagedPayload(archivePath, stagedDir); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	if _, _, err := discoverManagedImageBackendExecutablePathInDir(stagedDir, spec.ExecutableCandidates); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	if err := writeManagedImageBackendMetadata(filepath.Join(stagedDir, "metadata.json"), managedImageBackendMetadata{
		Name:  spec.InstallDirName,
		Alias: backendName,
	}); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	targetDir := filepath.Join(backendsPath, spec.InstallDirName)
	if err := installManagedBinaryPayload(targetDir, stagedDir); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	return nil
}

func writeManagedImageBackendMetadata(path string, metadata managedImageBackendMetadata) error {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal managed image backend metadata: %w", err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		return fmt.Errorf("write managed image backend metadata %s: %w", path, err)
	}
	return nil
}

func discoverInstalledManagedImageBackendRunPath(backendsPath string, backendName string) (string, error) {
	entries, err := os.ReadDir(backendsPath)
	if err != nil {
		return "", fmt.Errorf("read managed image backends path: %w", err)
	}
	type candidate struct {
		dir     string
		runPath string
		score   int
	}
	candidates := make([]candidate, 0, len(entries))
	trimmedBackend := strings.TrimSpace(backendName)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := entry.Name()
		runPath := filepath.Join(backendsPath, dir, managedImageBackendRunScript)
		metadata, metadataErr := readManagedImageBackendMetadata(filepath.Join(backendsPath, dir, "metadata.json"))
		if metadataErr != nil {
			return "", metadataErr
		}
		var score int
		switch {
		case dir == trimmedBackend:
			score = 0
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.Alias), trimmedBackend):
			score = 1
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.Name), trimmedBackend):
			score = 2
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.MetaBackendFor), trimmedBackend):
			score = 3
		default:
			continue
		}
		targetRunPath := runPath
		if metadata != nil && strings.TrimSpace(metadata.MetaBackendFor) != "" {
			resolvedRunPath, ok := resolveMetaBackendRunPath(backendsPath, metadata.MetaBackendFor)
			if !ok {
				continue
			}
			targetRunPath = resolvedRunPath
		}
		if _, statErr := os.Stat(targetRunPath); statErr != nil {
			continue
		}
		candidates = append(candidates, candidate{
			dir:     dir,
			runPath: targetRunPath,
			score:   score,
		})
	}
	if len(candidates) == 0 {
		return "", fmt.Errorf("managed image backend %q not installed in %s", backendName, backendsPath)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score < candidates[j].score
		}
		return candidates[i].dir < candidates[j].dir
	})
	return candidates[0].runPath, nil
}

func discoverInstalledManagedImageBackendLaunchConfig(backendsPath string, sharedDependenciesPath string, backendName string, spec managedImageBackendPackageSpec, address string) (managedImageBackendLaunchConfig, error) {
	switch spec.LaunchMode {
	case managedImageBackendLaunchModePackageEntrypoint:
		runPath, err := discoverInstalledManagedImageBackendRunPath(backendsPath, backendName)
		if err != nil {
			return managedImageBackendLaunchConfig{}, err
		}
		return managedImageBackendLaunchConfig{
			Command: runPath,
			Args:    []string{"--addr", strings.TrimSpace(address)},
		}, nil
	case managedImageBackendLaunchModeRuntimeWrapper:
		currentExecutable, err := managedImageBackendCurrentExecutable()
		if err != nil {
			return managedImageBackendLaunchConfig{}, fmt.Errorf("resolve runtime executable: %w", err)
		}
		backendExecutablePath, workingDir, err := discoverInstalledManagedImageBackendExecutablePath(backendsPath, backendName, spec)
		if err != nil {
			return managedImageBackendLaunchConfig{}, err
		}
		env, err := managedImageBackendRuntimeWrapperEnv(sharedDependenciesPath, spec)
		if err != nil {
			return managedImageBackendLaunchConfig{}, err
		}
		return managedImageBackendLaunchConfig{
			Command: currentExecutable,
			Args: []string{
				"managed-image-backend",
				"serve",
				"--listen", strings.TrimSpace(address),
				"--driver", strings.TrimSpace(spec.WrapperDriver),
				"--backend-executable", backendExecutablePath,
			},
			WorkingDir: workingDir,
			Env:        env,
		}, nil
	default:
		return managedImageBackendLaunchConfig{}, fmt.Errorf("unsupported managed image backend launch mode %q", spec.LaunchMode)
	}
}

func managedImageBackendRuntimeWrapperEnv(sharedDependenciesPath string, spec managedImageBackendPackageSpec) (map[string]string, error) {
	if currentGOOS() != "windows" || spec.PackageSource != managedImageBackendPackageSourceCanonicalRuntimeWrapper {
		return nil, nil
	}
	canonicalRoot, err := filepath.Abs(filepath.Clean(strings.TrimSpace(sharedDependenciesPath)))
	if err != nil {
		return nil, fmt.Errorf("canonicalize shared accelerator dependency root: %w", err)
	}
	canonicalDependencyDir, err := filepath.Abs(filepath.Clean(filepath.Join(canonicalRoot, NVIDIACUDAUserSpaceRuntimeDependencyID)))
	if err != nil {
		return nil, fmt.Errorf("canonicalize shared CUDA dependency path: %w", err)
	}
	rel, err := filepath.Rel(canonicalRoot, canonicalDependencyDir)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil, fmt.Errorf("shared CUDA dependency path must stay under shared accelerator dependency root")
	}
	for _, artifact := range nvidiaCUDAUserSpaceRuntimeRequiredArtifacts {
		if ok, err := artifactExistsCaseInsensitive(canonicalDependencyDir, artifact); err != nil {
			return nil, fmt.Errorf("read shared CUDA dependency path: %w", err)
		} else if !ok {
			return nil, fmt.Errorf("shared CUDA dependency DLL set is incomplete: missing %s", artifact)
		}
	}
	return map[string]string{
		"PATH": canonicalDependencyDir + string(os.PathListSeparator) + os.Getenv("PATH"),
	}, nil
}

func discoverInstalledManagedImageBackendExecutablePath(backendsPath string, backendName string, spec managedImageBackendPackageSpec) (string, string, error) {
	entries, err := os.ReadDir(backendsPath)
	if err != nil {
		return "", "", fmt.Errorf("read managed image backends path: %w", err)
	}
	type candidate struct {
		dir        string
		executable string
		score      int
	}
	candidates := make([]candidate, 0, len(entries))
	trimmedBackend := strings.TrimSpace(backendName)
	trimmedInstallDir := strings.TrimSpace(spec.InstallDirName)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := entry.Name()
		dirPath := filepath.Join(backendsPath, dir)
		metadata, metadataErr := readManagedImageBackendMetadata(filepath.Join(dirPath, "metadata.json"))
		if metadataErr != nil {
			return "", "", metadataErr
		}
		score := 100
		switch {
		case trimmedInstallDir != "" && strings.EqualFold(dir, trimmedInstallDir):
			score = 0
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.Alias), trimmedBackend):
			score = 1
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.Name), trimmedInstallDir):
			score = 2
		case metadata != nil && strings.EqualFold(strings.TrimSpace(metadata.Name), trimmedBackend):
			score = 3
		default:
			continue
		}
		executablePath, _, execErr := discoverManagedImageBackendExecutablePathInDir(dirPath, spec.ExecutableCandidates)
		if execErr != nil {
			continue
		}
		candidates = append(candidates, candidate{
			dir:        dir,
			executable: executablePath,
			score:      score,
		})
	}
	if len(candidates) == 0 {
		return "", "", fmt.Errorf("managed image backend %q not installed in %s", backendName, backendsPath)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score < candidates[j].score
		}
		return candidates[i].dir < candidates[j].dir
	})
	return candidates[0].executable, filepath.Dir(candidates[0].executable), nil
}

func discoverManagedImageBackendExecutablePathInDir(root string, candidates []string) (string, string, error) {
	if strings.TrimSpace(root) == "" {
		return "", "", fmt.Errorf("managed image backend root is required")
	}
	normalizedCandidates := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		trimmed := strings.TrimSpace(candidate)
		if trimmed != "" {
			normalizedCandidates = append(normalizedCandidates, strings.ToLower(trimmed))
		}
	}
	if len(normalizedCandidates) == 0 {
		return "", "", fmt.Errorf("managed image backend executable candidates are required")
	}
	var resolved string
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info == nil || info.IsDir() {
			return nil
		}
		name := strings.ToLower(strings.TrimSpace(info.Name()))
		for _, candidate := range normalizedCandidates {
			if name == candidate {
				resolved = path
				return io.EOF
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, io.EOF) {
		return "", "", fmt.Errorf("scan managed image backend executable: %w", err)
	}
	if strings.TrimSpace(resolved) == "" {
		return "", "", fmt.Errorf("managed image backend executable not found in %s", root)
	}
	return resolved, filepath.Base(resolved), nil
}

func resolveMetaBackendRunPath(backendsPath string, metaBackendFor string) (string, bool) {
	trimmed := strings.TrimSpace(metaBackendFor)
	if trimmed == "" {
		return "", false
	}
	cleaned := filepath.Clean(trimmed)
	if cleaned == "." || cleaned == ".." || filepath.IsAbs(cleaned) || cleaned != filepath.Base(cleaned) {
		return "", false
	}
	targetDir := filepath.Join(backendsPath, cleaned)
	rel, err := filepath.Rel(backendsPath, targetDir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.Join(targetDir, managedImageBackendRunScript), true
}

func readManagedImageBackendMetadata(path string) (*managedImageBackendMetadata, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read managed image backend metadata %s: %w", path, err)
	}
	var metadata managedImageBackendMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil, fmt.Errorf("parse managed image backend metadata %s: %w", path, err)
	}
	return &metadata, nil
}
