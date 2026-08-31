// Package appstorage resolves Runtime-owned Nimi App payload and durable-data
// roots under the product-selected nimi_data root. Canonical installed-release
// and registration truth belongs to localappkernel, not filesystem metadata.
package appstorage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const StoragePolicyNimiMediatedDefault = "nimi-mediated-default"

type Plan struct {
	DataRootRef      string `json:"dataRootRef"`
	AppID            string `json:"appId"`
	SourceClass      string `json:"sourceClass"`
	Version          string `json:"version"`
	AppRoot          string `json:"appRoot"`
	ReleaseRoot      string `json:"releaseRoot"`
	DurableDataRoot  string `json:"durableDataRoot"`
	CacheRoot        string `json:"cacheRoot"`
	TempRoot         string `json:"tempRoot"`
	StoragePolicyRef string `json:"storagePolicyRef"`
}

var (
	ErrDataRootRequired         = errors.New("app storage dataRootRef is required")
	ErrDataRootMustBeAbsolute   = errors.New("app storage dataRootRef must be absolute")
	ErrInvalidAppIDSegment      = errors.New("app storage app id is not a safe path segment")
	ErrInvalidSourceClass       = errors.New("app storage source class is not admitted")
	ErrInvalidVersionSegment    = errors.New("app storage version is not a safe path segment")
	ErrStoragePolicyUnsupported = errors.New("app storage policy is not admitted")
	ErrStorageRootSymlink       = errors.New("app storage root contains a symlink")
	ErrStorageRootNotDirectory  = errors.New("app storage root component is not a directory")
)

// IsZero reports whether the plan was never resolved (no release root). It
// lets a caller skip partial-release cleanup when planning itself failed.
func (p Plan) IsZero() bool {
	return strings.TrimSpace(p.ReleaseRoot) == "" || strings.TrimSpace(p.AppRoot) == ""
}

func Resolve(dataRootRef string, appID string, sourceClass string, version string, storagePolicyRef string) (Plan, error) {
	dataRootRef, appID, storagePolicyRef, err := normalizeRootInputs(dataRootRef, appID, storagePolicyRef)
	if err != nil {
		return Plan{}, err
	}
	if !safeSegment(version) {
		return Plan{}, ErrInvalidVersionSegment
	}
	if sourceClass != "verified" && sourceClass != "user_imported" {
		return Plan{}, ErrInvalidSourceClass
	}
	appRoot := filepath.Join(dataRootRef, "apps", appID)
	plan := Plan{
		DataRootRef:      dataRootRef,
		AppID:            appID,
		SourceClass:      sourceClass,
		Version:          version,
		AppRoot:          appRoot,
		ReleaseRoot:      filepath.Join(appRoot, "releases", sourceClass, version),
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

func ResolveAppRoots(dataRootRef string, appID string, storagePolicyRef string) (Plan, error) {
	dataRootRef, appID, storagePolicyRef, err := normalizeRootInputs(dataRootRef, appID, storagePolicyRef)
	if err != nil {
		return Plan{}, err
	}
	appRoot := filepath.Join(dataRootRef, "apps", appID)
	plan := Plan{
		DataRootRef:      dataRootRef,
		AppID:            appID,
		AppRoot:          appRoot,
		DurableDataRoot:  filepath.Join(appRoot, "data"),
		CacheRoot:        filepath.Join(appRoot, "cache"),
		TempRoot:         filepath.Join(appRoot, "tmp"),
		StoragePolicyRef: storagePolicyRef,
	}
	if !within(appRoot, plan.DurableDataRoot) || !within(appRoot, plan.CacheRoot) ||
		!within(appRoot, plan.TempRoot) {
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

func MaterializeAppRoots(plan Plan) error {
	for _, root := range []string{plan.DurableDataRoot, plan.CacheRoot, plan.TempRoot} {
		if err := materializeRoot(plan.DataRootRef, root); err != nil {
			return fmt.Errorf("materialize app storage root %q: %w", root, err)
		}
	}
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

func normalizeRootInputs(dataRootRef string, appID string, storagePolicyRef string) (string, string, string, error) {
	dataRootRef = filepath.Clean(strings.TrimSpace(dataRootRef))
	if dataRootRef == "." || dataRootRef == "" {
		return "", "", "", ErrDataRootRequired
	}
	if !filepath.IsAbs(dataRootRef) {
		return "", "", "", ErrDataRootMustBeAbsolute
	}
	if storagePolicyRef != StoragePolicyNimiMediatedDefault {
		return "", "", "", ErrStoragePolicyUnsupported
	}
	if !safeSegment(appID) {
		return "", "", "", ErrInvalidAppIDSegment
	}
	return dataRootRef, appID, storagePolicyRef, nil
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
					// Another operation may have created the same managed
					// directory after Lstat. Revalidate the winner instead of
					// treating that safe race as an unavailable storage root.
					if !errors.Is(mkdirErr, os.ErrExist) {
						return mkdirErr
					}
					if validateErr := ensureDirectoryNoSymlink(current); validateErr != nil {
						return validateErr
					}
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
