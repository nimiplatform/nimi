package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const llamaBackendRunScript = "run.sh"

var officialLlamaBackendAllowlist = map[string]struct{}{
	"llama-cpp":            {},
	"whisper-ggml":         {},
	"stablediffusion-ggml": {},
}

const ociManifestMediaTypeV2 = "application/vnd.docker.distribution.manifest.v2+json"

type llamaBackendPackageSpec struct {
	InstallDirName string
	ImageRef       string
}

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

type llamaBackendMetadata struct {
	Name           string `json:"name,omitempty"`
	Alias          string `json:"alias,omitempty"`
	MetaBackendFor string `json:"meta_backend_for,omitempty"`
}

func normalizeLlamaImageBackendConfig(input *LlamaImageBackendConfig) *LlamaImageBackendConfig {
	cfg := cloneLlamaImageBackendConfig(input)
	if cfg == nil {
		cfg = &LlamaImageBackendConfig{}
	}
	if cfg.Mode == "" {
		cfg.Mode = LlamaImageBackendDisabled
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

func llamaImageBackendEngineConfig(cfg *LlamaImageBackendConfig) (EngineConfig, error) {
	if cfg == nil || !cfg.Enabled() {
		return EngineConfig{}, fmt.Errorf("llama image backend disabled")
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
		Kind:             engineMediaDiffusersBackend,
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

func ensureOfficialLlamaImageBackend(ctx context.Context, llamaBinaryPath string, backendsPath string, cfg *LlamaImageBackendConfig) (*LlamaImageBackendConfig, error) {
	normalized := normalizeLlamaImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return normalized, nil
	}
	if normalized.Mode != LlamaImageBackendOfficial {
		return normalized, nil
	}
	validatedBackendName, err := validateOfficialLlamaBackendName(normalized.BackendName)
	if err != nil {
		return nil, err
	}
	normalized.BackendName = validatedBackendName
	if strings.TrimSpace(backendsPath) == "" {
		return nil, fmt.Errorf("llama backends path is required")
	}
	if err := os.MkdirAll(backendsPath, 0o755); err != nil {
		return nil, fmt.Errorf("create llama backends path: %w", err)
	}

	runPath, err := discoverInstalledLlamaBackendRunPath(backendsPath, normalized.BackendName)
	if err != nil {
		if installErr := installLlamaBackend(ctx, llamaBinaryPath, backendsPath, normalized.BackendName); installErr != nil {
			return nil, installErr
		}
		runPath, err = discoverInstalledLlamaBackendRunPath(backendsPath, normalized.BackendName)
		if err != nil {
			return nil, err
		}
	}

	normalized.Command = runPath
	normalized.Args = []string{"--addr", normalized.Address}
	return normalized, nil
}

func installLlamaBackend(ctx context.Context, llamaBinaryPath string, backendsPath string, backendName string) error {
	validatedBackendName, err := validateOfficialLlamaBackendName(backendName)
	if err != nil {
		return err
	}
	if packageSpec, ok := resolveOfficialLlamaBackendPackageSpec(validatedBackendName); ok {
		return installLlamaBackendFromOCI(ctx, backendsPath, validatedBackendName, packageSpec)
	}
	if strings.TrimSpace(llamaBinaryPath) == "" {
		return fmt.Errorf("llama binary path is required")
	}
	cmd := exec.CommandContext(ctx, llamaBinaryPath, "backends", "install", validatedBackendName, "--backends-path", backendsPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("install llama backend %s: %w: %s", validatedBackendName, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func validateOfficialLlamaBackendName(backendName string) (string, error) {
	trimmedBackendName := strings.TrimSpace(backendName)
	if trimmedBackendName == "" {
		return "", fmt.Errorf("llama backend name is required")
	}
	if _, ok := officialLlamaBackendAllowlist[trimmedBackendName]; !ok {
		return "", fmt.Errorf("unsupported official llama backend %q", trimmedBackendName)
	}
	return trimmedBackendName, nil
}

func resolveOfficialLlamaBackendPackageSpec(backendName string) (llamaBackendPackageSpec, bool) {
	switch strings.TrimSpace(backendName) {
	case "stablediffusion-ggml":
		if currentGOOS() == "darwin" && currentGOARCH() == "arm64" {
			return llamaBackendPackageSpec{
				InstallDirName: "metal-stablediffusion-ggml",
				ImageRef:       "quay.io/go-skynet/local-ai-backends:latest-metal-darwin-arm64-stablediffusion-ggml",
			}, true
		}
	}
	return llamaBackendPackageSpec{}, false
}

func installLlamaBackendFromOCI(ctx context.Context, backendsPath string, backendName string, spec llamaBackendPackageSpec) error {
	parsedRef, err := parseOCIImageReference(spec.ImageRef)
	if err != nil {
		return fmt.Errorf("install llama backend %s: %w", backendName, err)
	}
	manifest, err := fetchOCIManifest(ctx, parsedRef)
	if err != nil {
		return fmt.Errorf("install llama backend %s: %w", backendName, err)
	}
	if len(manifest.Layers) != 1 {
		return fmt.Errorf("install llama backend %s: unsupported OCI layer count %d for %s", backendName, len(manifest.Layers), spec.ImageRef)
	}
	layerDigest := strings.TrimSpace(manifest.Layers[0].Digest)
	if layerDigest == "" {
		return fmt.Errorf("install llama backend %s: OCI layer digest is required", backendName)
	}

	tmpDir, err := os.MkdirTemp(filepath.Dir(backendsPath), ".llama-backend-*")
	if err != nil {
		return fmt.Errorf("install llama backend %s: create temp dir: %w", backendName, err)
	}
	defer os.RemoveAll(tmpDir)

	layerPath := filepath.Join(tmpDir, "layer.tar.gz")
	if _, err := downloadOCIImageBlobToFile(ctx, parsedRef, layerDigest, layerPath); err != nil {
		return fmt.Errorf("install llama backend %s: %w", backendName, err)
	}

	stagedDir := filepath.Join(tmpDir, "payload")
	if err := os.MkdirAll(stagedDir, 0o755); err != nil {
		return fmt.Errorf("install llama backend %s: create staged dir: %w", backendName, err)
	}
	if err := extractManagedPayload(layerPath, stagedDir); err != nil {
		return fmt.Errorf("install llama backend %s: %w", backendName, err)
	}
	if err := writeLlamaBackendMetadata(filepath.Join(stagedDir, "metadata.json"), llamaBackendMetadata{
		Name:  spec.InstallDirName,
		Alias: backendName,
	}); err != nil {
		return fmt.Errorf("install llama backend %s: %w", backendName, err)
	}
	targetDir := filepath.Join(backendsPath, spec.InstallDirName)
	if err := installManagedBinaryPayload(targetDir, stagedDir); err != nil {
		return fmt.Errorf("install llama backend %s: %w", backendName, err)
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

func writeLlamaBackendMetadata(path string, metadata llamaBackendMetadata) error {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal llama backend metadata: %w", err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		return fmt.Errorf("write llama backend metadata %s: %w", path, err)
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

func discoverInstalledLlamaBackendRunPath(backendsPath string, backendName string) (string, error) {
	entries, err := os.ReadDir(backendsPath)
	if err != nil {
		return "", fmt.Errorf("read llama backends path: %w", err)
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
		runPath := filepath.Join(backendsPath, dir, llamaBackendRunScript)
		metadata, metadataErr := readLlamaBackendMetadata(filepath.Join(backendsPath, dir, "metadata.json"))
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
		return "", fmt.Errorf("llama backend %q not installed in %s", backendName, backendsPath)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score < candidates[j].score
		}
		return candidates[i].dir < candidates[j].dir
	})
	return candidates[0].runPath, nil
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
	return filepath.Join(targetDir, llamaBackendRunScript), true
}

func readLlamaBackendMetadata(path string) (*llamaBackendMetadata, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read llama backend metadata %s: %w", path, err)
	}
	var metadata llamaBackendMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil, fmt.Errorf("parse llama backend metadata %s: %w", path, err)
	}
	return &metadata, nil
}
