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

// ActiveReleasePointer is the app-root-level record of which materialized
// release version is currently the active one. An update job swaps this
// pointer atomically (P-NAPP-014 / K-APP-015) only after the new release is
// fully materialized and digest-verified; the old release stays usable until
// the swap commits.
type ActiveReleasePointer struct {
	AppID         string `json:"appId"`
	ActiveVersion string `json:"activeVersion"`
	ReleaseRoot   string `json:"releaseRoot"`
	UpdatedAt     string `json:"updatedAt"`
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
	ErrActiveReleaseNotFound         = errors.New("app storage active release pointer not found")
)

// IsZero reports whether the plan was never resolved (no release root). It
// lets a caller skip partial-release cleanup when planning itself failed.
func (p Plan) IsZero() bool {
	return strings.TrimSpace(p.ReleaseRoot) == "" || strings.TrimSpace(p.AppRoot) == ""
}

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

// ActiveReleasePath is the app-root-level active release pointer file path.
func ActiveReleasePath(plan Plan) string {
	return filepath.Join(plan.AppRoot, ".nimi", "active-release.json")
}

// ReadActiveRelease reads the active release pointer at the app root. It
// returns ErrActiveReleaseNotFound when no pointer exists yet (the app has
// never had a release activated).
func ReadActiveRelease(plan Plan) (ActiveReleasePointer, error) {
	bytes, err := os.ReadFile(ActiveReleasePath(plan))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ActiveReleasePointer{}, ErrActiveReleaseNotFound
		}
		return ActiveReleasePointer{}, fmt.Errorf("read app active release pointer: %w", err)
	}
	var pointer ActiveReleasePointer
	if err := json.Unmarshal(bytes, &pointer); err != nil {
		return ActiveReleasePointer{}, fmt.Errorf("decode app active release pointer: %w", err)
	}
	return pointer, nil
}

// WriteActiveRelease atomically writes the active release pointer at the app
// root. It is the single commit point of an install/update activation: the
// rename is the atomic swap of the active release. A failed write before the
// rename leaves the previous pointer (and thus the previous release) intact.
func WriteActiveRelease(plan Plan, pointer ActiveReleasePointer) error {
	pointerPath := ActiveReleasePath(plan)
	pointerDir := filepath.Dir(pointerPath)
	if err := materializeRoot(plan.DataRootRef, pointerDir); err != nil {
		return fmt.Errorf("create app active release pointer dir: %w", err)
	}
	if info, err := os.Lstat(pointerPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return ErrStorageRootSymlink
	}
	bytes, err := json.MarshalIndent(pointer, "", "  ")
	if err != nil {
		return fmt.Errorf("encode app active release pointer: %w", err)
	}
	tmpFile, err := os.CreateTemp(pointerDir, "active-release-*.tmp")
	if err != nil {
		return fmt.Errorf("write app active release pointer: %w", err)
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
		return fmt.Errorf("write app active release pointer: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("close app active release pointer: %w", err)
	}
	if err := os.Rename(tmp, pointerPath); err != nil {
		return fmt.Errorf("commit app active release pointer: %w", err)
	}
	committed = true
	return nil
}

// RemoveRelease removes a single release payload directory without touching
// durable data, cache, tmp, or any other release. It is used to drop a failed
// or superseded release materialization.
func RemoveRelease(plan Plan) error {
	if strings.TrimSpace(plan.ReleaseRoot) == "" {
		return ErrInvalidVersionSegment
	}
	if !within(plan.AppRoot, plan.ReleaseRoot) {
		return ErrInvalidVersionSegment
	}
	if err := os.RemoveAll(plan.ReleaseRoot); err != nil {
		return fmt.Errorf("remove app release payload: %w", err)
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
