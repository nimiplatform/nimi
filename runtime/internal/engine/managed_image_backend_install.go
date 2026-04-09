package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
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

func ensureManagedImageBackendInstalled(ctx context.Context, backendsPath string, cfg *ManagedImageBackendConfig) (*ManagedImageBackendConfig, error) {
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

	launchCfg, err := discoverInstalledManagedImageBackendLaunchConfig(backendsPath, normalized.BackendName, packageSpec, normalized.Address)
	if err != nil {
		if installErr := installManagedImageBackendPackage(ctx, backendsPath, normalized.BackendName, packageSpec); installErr != nil {
			return nil, installErr
		}
		launchCfg, err = discoverInstalledManagedImageBackendLaunchConfig(backendsPath, normalized.BackendName, packageSpec, normalized.Address)
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

	tmpDir, err := os.MkdirTemp(filepath.Dir(backendsPath), ".managed-image-backend-*")
	if err != nil {
		return fmt.Errorf("install managed image backend %s: create temp dir: %w", backendName, err)
	}
	defer os.RemoveAll(tmpDir)

	layerPath := filepath.Join(tmpDir, "layer.tar.gz")
	if _, err := downloadOCIImageBlobToFile(ctx, parsedRef, layerDigest, layerPath); err != nil {
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
	if expected := strings.TrimSpace(spec.ArchiveSHA256); expected != "" && !strings.EqualFold(expected, archiveHash) {
		return fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, strings.ToLower(expected), archiveHash)
	}

	stagedDir := filepath.Join(tmpDir, "payload")
	if err := os.MkdirAll(stagedDir, 0o755); err != nil {
		return fmt.Errorf("install managed image backend %s: create staged dir: %w", backendName, err)
	}
	if err := extractManagedPayload(archivePath, stagedDir); err != nil {
		return fmt.Errorf("install managed image backend %s: %w", backendName, err)
	}
	for index, supplemental := range spec.SupplementalArchives {
		supplementalURL := strings.TrimSpace(supplemental.URL)
		if supplementalURL == "" {
			return fmt.Errorf("install managed image backend %s: supplemental archive URL is required", backendName)
		}
		supplementalName := filepath.Base(supplementalURL)
		if supplementalName == "." || supplementalName == "" {
			supplementalName = fmt.Sprintf("supplemental-%d.zip", index+1)
		}
		supplementalPath := filepath.Join(tmpDir, supplementalName)
		supplementalHash, downloadErr := downloadURLToFile(supplementalURL, supplementalPath)
		if downloadErr != nil {
			return fmt.Errorf("install managed image backend %s: supplemental archive %d: %w", backendName, index+1, downloadErr)
		}
		if expected := strings.TrimSpace(supplemental.SHA256); expected != "" && !strings.EqualFold(expected, supplementalHash) {
			return fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, strings.ToLower(expected), supplementalHash)
		}
		if err := extractManagedPayload(supplementalPath, stagedDir); err != nil {
			return fmt.Errorf("install managed image backend %s: supplemental archive %d: %w", backendName, index+1, err)
		}
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

func parseOCIImageReference(imageRef string) (ociImageReference, error) {
	trimmed := strings.TrimSpace(imageRef)
	if trimmed == "" {
		return ociImageReference{}, fmt.Errorf("OCI image reference is required")
	}
	firstSlash := strings.Index(trimmed, "/")
	if firstSlash <= 0 || firstSlash == len(trimmed)-1 {
		return ociImageReference{}, fmt.Errorf("invalid OCI image reference %q", imageRef)
	}
	registry := strings.TrimSpace(trimmed[:firstSlash])
	remainder := strings.TrimSpace(trimmed[firstSlash+1:])
	if registry == "" || remainder == "" {
		return ociImageReference{}, fmt.Errorf("invalid OCI image reference %q", imageRef)
	}
	lastColon := strings.LastIndex(remainder, ":")
	if lastColon <= 0 || lastColon == len(remainder)-1 {
		return ociImageReference{}, fmt.Errorf("OCI image tag is required in %q", imageRef)
	}
	repository := strings.TrimSpace(remainder[:lastColon])
	reference := strings.TrimSpace(remainder[lastColon+1:])
	if repository == "" || reference == "" {
		return ociImageReference{}, fmt.Errorf("invalid OCI image reference %q", imageRef)
	}
	return ociImageReference{
		Registry:   registry,
		Repository: repository,
		Reference:  reference,
	}, nil
}

func fetchOCIManifest(ctx context.Context, ref ociImageReference) (ociDistributionManifest, error) {
	url := fmt.Sprintf("https://%s/v2/%s/manifests/%s", ref.Registry, ref.Repository, ref.Reference)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ociDistributionManifest{}, fmt.Errorf("build OCI manifest request: %w", err)
	}
	req.Header.Set("User-Agent", "nimi-runtime/0.1")
	req.Header.Set("Accept", ociManifestMediaTypeV2)
	resp, err := doOCIRegistryRequestWithRetry(ctx, url, req, 5*time.Minute)
	if err != nil {
		return ociDistributionManifest{}, fmt.Errorf("request OCI manifest %s: %w", ref.Reference, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ociDistributionManifest{}, fmt.Errorf("request OCI manifest %s: HTTP %d", ref.Reference, resp.StatusCode)
	}
	var manifest ociDistributionManifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return ociDistributionManifest{}, fmt.Errorf("decode OCI manifest %s: %w", ref.Reference, err)
	}
	if manifest.SchemaVersion != 2 {
		return ociDistributionManifest{}, fmt.Errorf("unsupported OCI schema version %d for %s", manifest.SchemaVersion, ref.Reference)
	}
	return manifest, nil
}

func downloadOCIImageBlobToFile(ctx context.Context, ref ociImageReference, digest string, destPath string) (string, error) {
	trimmedDigest := strings.TrimSpace(digest)
	if trimmedDigest == "" {
		return "", fmt.Errorf("OCI blob digest is required")
	}
	url := fmt.Sprintf("https://%s/v2/%s/blobs/%s", ref.Registry, ref.Repository, trimmedDigest)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("build OCI blob request: %w", err)
	}
	req.Header.Set("User-Agent", "nimi-runtime/0.1")
	resp, err := doOCIRegistryRequestWithRetry(ctx, url, req, 30*time.Minute)
	if err != nil {
		return "", fmt.Errorf("request OCI blob %s: %w", trimmedDigest, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("request OCI blob %s: HTTP %d", trimmedDigest, resp.StatusCode)
	}
	out, err := os.Create(destPath)
	if err != nil {
		return "", fmt.Errorf("create OCI blob temp file: %w", err)
	}
	shouldRemove := true
	defer func() {
		_ = out.Close()
		if shouldRemove {
			_ = os.Remove(destPath)
		}
	}()
	if _, err := io.Copy(out, resp.Body); err != nil {
		return "", fmt.Errorf("write OCI blob %s: %w", trimmedDigest, err)
	}
	if err := out.Close(); err != nil {
		return "", fmt.Errorf("close OCI blob %s: %w", trimmedDigest, err)
	}
	shouldRemove = false
	return destPath, nil
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

func doOCIRegistryRequestWithRetry(ctx context.Context, sourceURL string, req *http.Request, timeout time.Duration) (*http.Response, error) {
	client := newEngineDownloadHTTPClient(sourceURL, nil, timeout)
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		cloned := req.Clone(ctx)
		resp, err := client.Do(cloned)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if attempt == 2 {
			break
		}
		delay := time.Duration(attempt+1) * 250 * time.Millisecond
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
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

func discoverInstalledManagedImageBackendLaunchConfig(backendsPath string, backendName string, spec managedImageBackendPackageSpec, address string) (managedImageBackendLaunchConfig, error) {
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
		}, nil
	default:
		return managedImageBackendLaunchConfig{}, fmt.Errorf("unsupported managed image backend launch mode %q", spec.LaunchMode)
	}
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
