package engine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const NVIDIACUDAUserSpaceRuntimeDependencyID = "nvidia-cuda-user-space-runtime"

type SharedAcceleratorDependencyState string

const (
	SharedAcceleratorDependencyReadySystem                        SharedAcceleratorDependencyState = "ready_system"
	SharedAcceleratorDependencyReadyManaged                       SharedAcceleratorDependencyState = "ready_managed"
	SharedAcceleratorDependencyMaterializableRequiresConfirmation SharedAcceleratorDependencyState = "materializable_requires_confirmation"
	SharedAcceleratorDependencyRepairRequired                     SharedAcceleratorDependencyState = "repair_required"
	SharedAcceleratorDependencyFailed                             SharedAcceleratorDependencyState = "failed"
	SharedAcceleratorDependencyUnsupported                        SharedAcceleratorDependencyState = "unsupported"
)

type SharedAcceleratorDependencyStatus struct {
	DependencyID           string
	HostProfileID          string
	ConsumerID             string
	State                  SharedAcceleratorDependencyState
	Source                 string
	CanonicalRoot          string
	SelectedSourceRecordID string
	Detail                 string
	RequiredArtifacts      []string
}

type sharedAcceleratorDependencyManagedSource struct {
	SourceID       string
	ArchiveURL     string
	ArchiveSHA256  string
	ReleaseVersion string
	ReleaseAsset   string
	InstallDirName string
}

var nvidiaCUDAUserSpaceRuntimeRequiredArtifacts = []string{
	"cudart64_12.dll",
	"cublas64_12.dll",
	"cublasLt64_12.dll",
}

var nvidiaCUDAUserSpaceRuntimeManagedSource = sharedAcceleratorDependencyManagedSource{
	SourceID:       "llama-cuda12.4-win-x64-runtime",
	ReleaseVersion: defaultLlamaVersion,
	ReleaseAsset:   "cudart-llama-bin-win-cuda-12.4-x64.zip",
	InstallDirName: NVIDIACUDAUserSpaceRuntimeDependencyID,
}

func defaultSharedAcceleratorDependenciesPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".nimi", "runtime", "accelerator-dependencies"), nil
}

func NormalizeSharedAcceleratorDependencyID(raw string) string {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	switch trimmed {
	case "", "cuda-user-space-runtime", NVIDIACUDAUserSpaceRuntimeDependencyID:
		return NVIDIACUDAUserSpaceRuntimeDependencyID
	default:
		return trimmed
	}
}

func (m *Manager) ResolveSharedAcceleratorDependency(dependencyID string, consumerID string) SharedAcceleratorDependencyStatus {
	normalizedID := NormalizeSharedAcceleratorDependencyID(dependencyID)
	status := SharedAcceleratorDependencyStatus{
		DependencyID:      normalizedID,
		HostProfileID:     currentHostAcceleratorProfileID(),
		ConsumerID:        strings.TrimSpace(consumerID),
		RequiredArtifacts: append([]string(nil), nvidiaCUDAUserSpaceRuntimeRequiredArtifacts...),
	}
	if normalizedID != NVIDIACUDAUserSpaceRuntimeDependencyID {
		status.State = SharedAcceleratorDependencyUnsupported
		status.Source = "unavailable"
		status.Detail = "unsupported shared accelerator dependency"
		return status
	}
	if currentGOOS() != "windows" || currentGOARCH() != "amd64" || !strings.EqualFold(detectLocalGPUVendor(), "nvidia") {
		status.State = SharedAcceleratorDependencyUnsupported
		status.Source = "unavailable"
		status.Detail = "host accelerator profile does not admit Windows NVIDIA CUDA dependency"
		return status
	}
	if systemRoot, ok, detail := verifiedSystemNVIDIACUDARuntimeRoot(); ok {
		status.State = SharedAcceleratorDependencyReadySystem
		status.Source = "compatible_system"
		status.CanonicalRoot = systemRoot
		status.SelectedSourceRecordID = selectedAcceleratorDependencySourceRecordID(status.DependencyID, status.HostProfileID, status.Source, systemRoot)
		status.Detail = "nvidia_cuda_user_space_runtime state=ready_system source=compatible_system"
		return status
	} else if strings.TrimSpace(detail) != "" {
		status.Detail = detail
	}
	m.mu.RLock()
	dependenciesPath := strings.TrimSpace(m.sharedAcceleratorDependenciesPath)
	m.mu.RUnlock()
	canonicalRoot, ready, repairDetail := verifiedManagedNVIDIACUDARuntimeRoot(dependenciesPath)
	if ready {
		status.State = SharedAcceleratorDependencyReadyManaged
		status.Source = "runtime_managed"
		status.CanonicalRoot = canonicalRoot
		status.SelectedSourceRecordID = selectedAcceleratorDependencySourceRecordID(status.DependencyID, status.HostProfileID, status.Source, canonicalRoot)
		status.Detail = "nvidia_cuda_user_space_runtime state=ready_managed source=runtime_managed"
		return status
	}
	if strings.TrimSpace(repairDetail) != "" {
		status.State = SharedAcceleratorDependencyRepairRequired
		status.Source = "runtime_managed"
		status.CanonicalRoot = canonicalRoot
		status.Detail = repairDetail
		return status
	}
	status.State = SharedAcceleratorDependencyMaterializableRequiresConfirmation
	status.Source = "runtime_managed"
	status.Detail = strings.Join([]string{
		"nvidia_cuda_user_space_runtime state=materializable_requires_confirmation",
		"source=runtime_managed",
		"first_network_materialization_requires_confirmation=true",
		"install_location=nimi_data_runtime_dependency_directory",
		"system_path_mutation=false",
	}, "; ")
	return status
}

func (m *Manager) EnsureSharedAcceleratorDependency(ctx context.Context, dependencyID string) (SharedAcceleratorDependencyStatus, error) {
	status := m.ResolveSharedAcceleratorDependency(dependencyID, "")
	switch status.State {
	case SharedAcceleratorDependencyReadySystem, SharedAcceleratorDependencyReadyManaged:
		return status, nil
	case SharedAcceleratorDependencyUnsupported:
		return status, fmt.Errorf("%s", strings.TrimSpace(status.Detail))
	}
	normalizedID := NormalizeSharedAcceleratorDependencyID(dependencyID)
	if normalizedID != NVIDIACUDAUserSpaceRuntimeDependencyID {
		return status, fmt.Errorf("unsupported shared accelerator dependency %q", dependencyID)
	}
	m.mu.RLock()
	dependenciesPath := strings.TrimSpace(m.sharedAcceleratorDependenciesPath)
	m.mu.RUnlock()
	if strings.TrimSpace(dependenciesPath) == "" {
		return status, fmt.Errorf("shared accelerator dependency root is required")
	}
	if err := installManagedNVIDIACUDAUserSpaceRuntime(ctx, dependenciesPath, nvidiaCUDAUserSpaceRuntimeManagedSource); err != nil {
		status.State = SharedAcceleratorDependencyFailed
		status.Detail = err.Error()
		return status, err
	}
	return m.ResolveSharedAcceleratorDependency(normalizedID, ""), nil
}

func (m *Manager) SharedAcceleratorDependencyProcessEnv(dependencyID string) (map[string]string, error) {
	status := m.ResolveSharedAcceleratorDependency(dependencyID, "")
	if status.State != SharedAcceleratorDependencyReadySystem && status.State != SharedAcceleratorDependencyReadyManaged {
		return nil, fmt.Errorf("shared accelerator dependency %s is not ready: %s", status.DependencyID, status.State)
	}
	if strings.TrimSpace(status.CanonicalRoot) == "" {
		return nil, fmt.Errorf("shared accelerator dependency %s has no canonical root", status.DependencyID)
	}
	return map[string]string{
		"PATH": status.CanonicalRoot + string(os.PathListSeparator) + os.Getenv("PATH"),
	}, nil
}

func currentHostAcceleratorProfileID() string {
	if currentGOOS() == "windows" && currentGOARCH() == "amd64" && strings.EqualFold(detectLocalGPUVendor(), "nvidia") {
		return "windows-amd64-nvidia-cuda"
	}
	if currentGOOS() == "darwin" && currentGOARCH() == "arm64" {
		return "darwin-arm64-apple-metal"
	}
	return currentGOOS() + "-" + currentGOARCH() + "-cpu"
}

func selectedAcceleratorDependencySourceRecordID(dependencyID string, hostProfileID string, source string, canonicalRoot string) string {
	seed := strings.Join([]string{
		strings.TrimSpace(dependencyID),
		strings.TrimSpace(hostProfileID),
		strings.TrimSpace(source),
		filepath.Clean(strings.TrimSpace(canonicalRoot)),
	}, "|")
	replacer := strings.NewReplacer("\\", "-", "/", "-", ":", "-", " ", "-", "|", "-")
	return strings.ToLower(replacer.Replace(seed))
}

func verifiedManagedNVIDIACUDARuntimeRoot(dependenciesPath string) (string, bool, string) {
	if strings.TrimSpace(dependenciesPath) == "" {
		return "", false, ""
	}
	root, err := filepath.Abs(filepath.Clean(filepath.Join(dependenciesPath, nvidiaCUDAUserSpaceRuntimeManagedSource.InstallDirName)))
	if err != nil {
		return "", false, fmt.Sprintf("canonicalize managed CUDA dependency root: %v", err)
	}
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return root, false, ""
		}
		return root, false, fmt.Sprintf("stat managed CUDA dependency root: %v", err)
	}
	for _, artifact := range nvidiaCUDAUserSpaceRuntimeRequiredArtifacts {
		if ok, err := artifactExistsCaseInsensitive(root, artifact); err != nil {
			return root, false, fmt.Sprintf("verify managed CUDA artifact %s: %v", artifact, err)
		} else if !ok {
			return root, false, "managed CUDA dependency artifact missing: " + artifact
		}
	}
	return root, true, ""
}

func verifiedSystemNVIDIACUDARuntimeRoot() (string, bool, string) {
	if currentGOOS() != "windows" {
		return "", false, ""
	}
	for _, root := range systemNVIDIACUDARuntimeCandidates() {
		if canonicalRoot, ok := verifiedNVIDIACUDARuntimeRoot(root); ok {
			return canonicalRoot, true, ""
		}
	}
	if detectMediaCUDAReady() {
		return "", false, "system CUDA signal exists but required CUDA user-space DLL set was not positively verified"
	}
	return "", false, ""
}

func systemNVIDIACUDARuntimeCandidates() []string {
	var candidates []string
	seen := make(map[string]struct{})
	add := func(root string) {
		trimmed := strings.TrimSpace(root)
		if trimmed == "" {
			return
		}
		for _, candidate := range []string{trimmed, filepath.Join(trimmed, "bin")} {
			cleaned, err := filepath.Abs(filepath.Clean(candidate))
			if err != nil {
				continue
			}
			key := strings.ToLower(cleaned)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			candidates = append(candidates, cleaned)
		}
	}
	for _, key := range []string{"CUDA_PATH", "CUDA_HOME"} {
		add(os.Getenv(key))
	}
	programFiles := strings.TrimSpace(os.Getenv("ProgramFiles"))
	if programFiles == "" {
		programFiles = `C:\Program Files`
	}
	cudaRoot := filepath.Join(programFiles, "NVIDIA GPU Computing Toolkit", "CUDA")
	if entries, err := os.ReadDir(cudaRoot); err == nil {
		var versionRoots []string
		for _, entry := range entries {
			if entry.IsDir() {
				versionRoots = append(versionRoots, filepath.Join(cudaRoot, entry.Name()))
			}
		}
		sort.Sort(sort.Reverse(sort.StringSlice(versionRoots)))
		for _, root := range versionRoots {
			add(root)
		}
	}
	return candidates
}

func verifiedNVIDIACUDARuntimeRoot(root string) (string, bool) {
	canonicalRoot, err := filepath.Abs(filepath.Clean(strings.TrimSpace(root)))
	if err != nil || canonicalRoot == "" {
		return "", false
	}
	for _, artifact := range nvidiaCUDAUserSpaceRuntimeRequiredArtifacts {
		if ok, err := artifactExistsCaseInsensitive(canonicalRoot, artifact); err != nil || !ok {
			return canonicalRoot, false
		}
	}
	return canonicalRoot, true
}

func artifactExistsCaseInsensitive(root string, artifactName string) (bool, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(entry.Name()), strings.TrimSpace(artifactName)) {
			return true, nil
		}
	}
	return false, nil
}

func installManagedNVIDIACUDAUserSpaceRuntime(ctx context.Context, dependenciesPath string, source sharedAcceleratorDependencyManagedSource) error {
	if strings.TrimSpace(source.InstallDirName) == "" {
		return fmt.Errorf("managed CUDA dependency install dir name is required")
	}
	if err := os.MkdirAll(dependenciesPath, 0o755); err != nil {
		return fmt.Errorf("create shared accelerator dependency root: %w", err)
	}
	tmpDir, err := os.MkdirTemp(filepath.Dir(dependenciesPath), ".accelerator-dependency-*")
	if err != nil {
		return fmt.Errorf("create managed CUDA dependency temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()
	archiveURL := strings.TrimSpace(source.ArchiveURL)
	archiveSHA256 := strings.TrimSpace(source.ArchiveSHA256)
	if archiveURL == "" {
		releaseVersion := strings.TrimSpace(source.ReleaseVersion)
		if releaseVersion == "" {
			return fmt.Errorf("managed CUDA dependency release version is required")
		}
		releaseAsset, err := llamaReleaseAssetByName(releaseVersion, source.ReleaseAsset)
		if err != nil {
			return fmt.Errorf("resolve managed CUDA dependency release asset: %w", err)
		}
		archiveURL = releaseAsset.DownloadURL
		archiveSHA256 = releaseAsset.SHA256
	}
	if archiveURL == "" {
		return fmt.Errorf("managed CUDA dependency archive URL is required")
	}
	archiveName := filepath.Base(archiveURL)
	if archiveName == "." || archiveName == "" {
		archiveName = "payload.zip"
	}
	archivePath := filepath.Join(tmpDir, archiveName)
	archiveHash, err := downloadURLToFile(archiveURL, archivePath)
	if err != nil {
		return fmt.Errorf("download managed CUDA dependency: %w", err)
	}
	if expected := archiveSHA256; expected != "" && !strings.EqualFold(expected, archiveHash) {
		return fmt.Errorf("%w: expected=%s actual=%s", ErrEngineBinaryHashMismatch, strings.ToLower(expected), archiveHash)
	}
	stagedDir := filepath.Join(tmpDir, "payload")
	if err := os.MkdirAll(stagedDir, 0o755); err != nil {
		return fmt.Errorf("create managed CUDA dependency staged dir: %w", err)
	}
	if err := extractManagedPayload(archivePath, stagedDir); err != nil {
		return fmt.Errorf("extract managed CUDA dependency: %w", err)
	}
	for _, artifact := range nvidiaCUDAUserSpaceRuntimeRequiredArtifacts {
		if ok, err := artifactExistsCaseInsensitive(stagedDir, artifact); err != nil {
			return fmt.Errorf("verify managed CUDA artifact %s: %w", artifact, err)
		} else if !ok {
			return fmt.Errorf("managed CUDA dependency artifact missing: %s", artifact)
		}
	}
	targetDir := filepath.Join(dependenciesPath, source.InstallDirName)
	if err := installManagedBinaryPayload(targetDir, stagedDir); err != nil {
		return fmt.Errorf("promote managed CUDA dependency: %w", err)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
