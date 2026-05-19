// Package appstorage resolves and persists Runtime-owned Nimi App install
// storage projections under the product-selected nimi_data root.
package appstorage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Plan struct {
	DataRootRef      string `json:"dataRootRef"`
	AppID            string `json:"appId"`
	Version          string `json:"version"`
	AppRoot          string `json:"appRoot"`
	ReleaseRoot      string `json:"releaseRoot"`
	DurableDataRoot  string `json:"durableDataRoot"`
	CacheRoot        string `json:"cacheRoot"`
	TempRoot         string `json:"tempRoot"`
	StoragePolicyRef string `json:"storagePolicyRef"`
}

type InstallEvidence struct {
	AppID                string `json:"appId"`
	ReleaseDescriptorRef string `json:"releaseDescriptorRef"`
	StoragePolicyRef     string `json:"storagePolicyRef"`
	InstalledVersion     string `json:"installedVersion"`
	SHA256               string `json:"sha256"`
	VerificationState    string `json:"verificationState"`
	ReleaseRoot          string `json:"releaseRoot"`
	DurableDataRoot      string `json:"durableDataRoot"`
	CacheRoot            string `json:"cacheRoot"`
	TempRoot             string `json:"tempRoot"`
}

type UninstallOptions struct {
	DeleteDurableData             bool
	DestructiveDataDeleteApproved bool
}

var (
	ErrDataRootRequired              = errors.New("app storage dataRootRef is required")
	ErrDataRootMustBeAbsolute        = errors.New("app storage dataRootRef must be absolute")
	ErrInvalidAppIDSegment           = errors.New("app storage app id is not a safe path segment")
	ErrInvalidVersionSegment         = errors.New("app storage version is not a safe path segment")
	ErrStoragePolicyUnsupported      = errors.New("app storage policy is not admitted")
	ErrDestructiveDeleteConfirmation = errors.New("destructive app data deletion requires explicit confirmation")
	ErrStorageRootSymlink            = errors.New("app storage root contains a symlink")
	ErrStorageRootNotDirectory       = errors.New("app storage root component is not a directory")
)

func Resolve(dataRootRef string, appID string, version string, storagePolicyRef string) (Plan, error) {
	dataRootRef = filepath.Clean(strings.TrimSpace(dataRootRef))
	if dataRootRef == "." || dataRootRef == "" {
		return Plan{}, ErrDataRootRequired
	}
	if !filepath.IsAbs(dataRootRef) {
		return Plan{}, ErrDataRootMustBeAbsolute
	}
	if storagePolicyRef != "nimi-data-app-roots" {
		return Plan{}, ErrStoragePolicyUnsupported
	}
	if !safeSegment(appID) {
		return Plan{}, ErrInvalidAppIDSegment
	}
	if !safeSegment(version) {
		return Plan{}, ErrInvalidVersionSegment
	}
	appRoot := filepath.Join(dataRootRef, "apps", appID)
	plan := Plan{
		DataRootRef:      dataRootRef,
		AppID:            appID,
		Version:          version,
		AppRoot:          appRoot,
		ReleaseRoot:      filepath.Join(appRoot, "releases", version),
		DurableDataRoot:  filepath.Join(appRoot, "data"),
		CacheRoot:        filepath.Join(appRoot, "cache"),
		TempRoot:         filepath.Join(appRoot, "tmp"),
		StoragePolicyRef: storagePolicyRef,
	}
	if !within(appRoot, plan.ReleaseRoot) || !within(appRoot, plan.DurableDataRoot) ||
		!within(appRoot, plan.CacheRoot) || !within(appRoot, plan.TempRoot) {
		return Plan{}, ErrInvalidAppIDSegment
	}
	return plan, nil
}

func Materialize(plan Plan) error {
	for _, root := range []string{plan.ReleaseRoot, plan.DurableDataRoot, plan.CacheRoot, plan.TempRoot} {
		if err := materializeRoot(plan.DataRootRef, root); err != nil {
			return fmt.Errorf("materialize app storage root %q: %w", root, err)
		}
	}
	return nil
}

func WriteInstallEvidence(plan Plan, evidence InstallEvidence) error {
	evidencePath := EvidencePath(plan)
	evidenceDir := filepath.Dir(evidencePath)
	if err := materializeRoot(plan.DataRootRef, evidenceDir); err != nil {
		return fmt.Errorf("create app install evidence dir: %w", err)
	}
	if info, err := os.Lstat(evidencePath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return ErrStorageRootSymlink
	}
	bytes, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return fmt.Errorf("encode app install evidence: %w", err)
	}
	tmpFile, err := os.CreateTemp(evidenceDir, "install-evidence-*.tmp")
	if err != nil {
		return fmt.Errorf("write app install evidence: %w", err)
	}
	tmp := tmpFile.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(tmp)
		}
	}()
	if _, err := tmpFile.Write(append(bytes, '\n')); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("write app install evidence: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("close app install evidence: %w", err)
	}
	if err := os.Rename(tmp, evidencePath); err != nil {
		return fmt.Errorf("commit app install evidence: %w", err)
	}
	committed = true
	return nil
}

func ReadInstallEvidence(plan Plan) (InstallEvidence, error) {
	bytes, err := os.ReadFile(EvidencePath(plan))
	if err != nil {
		return InstallEvidence{}, err
	}
	var evidence InstallEvidence
	if err := json.Unmarshal(bytes, &evidence); err != nil {
		return InstallEvidence{}, err
	}
	return evidence, nil
}

func EvidencePath(plan Plan) string {
	return filepath.Join(plan.ReleaseRoot, ".nimi", "install-evidence.json")
}

func Uninstall(plan Plan, options UninstallOptions) error {
	if options.DeleteDurableData && !options.DestructiveDataDeleteApproved {
		return ErrDestructiveDeleteConfirmation
	}
	if err := os.RemoveAll(plan.ReleaseRoot); err != nil {
		return fmt.Errorf("remove app release payload: %w", err)
	}
	if options.DeleteDurableData {
		if err := os.RemoveAll(plan.DurableDataRoot); err != nil {
			return fmt.Errorf("remove app durable data: %w", err)
		}
	}
	return nil
}

func safeSegment(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "." || trimmed == ".." {
		return false
	}
	if filepath.IsAbs(trimmed) || filepath.Clean(trimmed) != trimmed {
		return false
	}
	return !strings.ContainsAny(trimmed, `/\`)
}

func within(parent string, child string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel != "." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}

func materializeRoot(dataRoot string, target string) error {
	rel, err := filepath.Rel(dataRoot, target)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
		return ErrInvalidAppIDSegment
	}
	if err := ensureDirectoryNoSymlink(dataRoot); err != nil {
		return err
	}
	current := dataRoot
	for _, segment := range strings.Split(rel, string(filepath.Separator)) {
		current = filepath.Join(current, segment)
		if err := ensureDirectoryNoSymlink(current); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				if mkdirErr := os.Mkdir(current, 0o755); mkdirErr != nil {
					return mkdirErr
				}
				continue
			}
			return err
		}
	}
	return nil
}

func ensureDirectoryNoSymlink(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return ErrStorageRootSymlink
	}
	if !info.IsDir() {
		return ErrStorageRootNotDirectory
	}
	return nil
}
