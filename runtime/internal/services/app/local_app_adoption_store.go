package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const localAppAdoptionsSchemaVersion = 1

type localAppAdoptionStore struct {
	nimiDir func() (string, error)
	now     func() string
}

type localAppAdoptionsRecord struct {
	SchemaVersion uint32                   `json:"schemaVersion"`
	UpdatedAt     string                   `json:"updatedAt"`
	Adoptions     []localAppAdoptionRecord `json:"adoptions"`
}

type localAppAdoptionRecord struct {
	AppID              string `json:"appId"`
	RootPath           string `json:"rootPath"`
	ManifestPath       string `json:"manifestPath"`
	DisplayName        string `json:"displayName"`
	Version            string `json:"version"`
	EntryRef           string `json:"entryRef"`
	PermissionScopeRef string `json:"permissionScopeRef"`
	StoragePolicyRef   string `json:"storagePolicyRef"`
	State              string `json:"state"`
	Trust              string `json:"trust"`
	AdoptedAt          string `json:"adoptedAt"`
	UpdatedAt          string `json:"updatedAt"`
	Detail             string `json:"detail,omitempty"`
}

type localAppManifest struct {
	AppID              string                  `json:"app_id" yaml:"app_id"`
	AppIDCamel         string                  `json:"appId" yaml:"appId"`
	DisplayName        string                  `json:"display_name" yaml:"display_name"`
	DisplayNameCamel   string                  `json:"displayName" yaml:"displayName"`
	Version            string                  `json:"version" yaml:"version"`
	EntryRef           string                  `json:"entry_ref" yaml:"entry_ref"`
	EntryRefCamel      string                  `json:"entryRef" yaml:"entryRef"`
	PermissionScopeRef string                  `json:"permission_scope_ref" yaml:"permission_scope_ref"`
	PermissionsRef     string                  `json:"permissions_ref" yaml:"permissions_ref"`
	StoragePolicyRef   string                  `json:"storage_policy_ref" yaml:"storage_policy_ref"`
	Runtime            localAppManifestRuntime `json:"runtime" yaml:"runtime"`
	Permissions        localAppManifestPerms   `json:"permissions" yaml:"permissions"`
	Storage            localAppManifestStorage `json:"storage" yaml:"storage"`
}

type localAppManifestRuntime struct {
	EntryRef      string `json:"entry_ref" yaml:"entry_ref"`
	EntryRefCamel string `json:"entryRef" yaml:"entryRef"`
}

type localAppManifestPerms struct {
	Ref           string `json:"ref" yaml:"ref"`
	ScopeRef      string `json:"scope_ref" yaml:"scope_ref"`
	ScopeRefCamel string `json:"scopeRef" yaml:"scopeRef"`
}

type localAppManifestStorage struct {
	PolicyRef      string `json:"policy_ref" yaml:"policy_ref"`
	PolicyRefCamel string `json:"policyRef" yaml:"policyRef"`
}

func newLocalAppAdoptionStore(nimiDir func() (string, error)) *localAppAdoptionStore {
	if nimiDir == nil {
		nimiDir = defaultNimiDir
	}
	return &localAppAdoptionStore{
		nimiDir: nimiDir,
		now:     nowAppInventoryTimestamp,
	}
}

func newLocalAppAdoptionStoreForTest(nimiDir string) *localAppAdoptionStore {
	return newLocalAppAdoptionStore(func() (string, error) {
		trimmed := strings.TrimSpace(nimiDir)
		if trimmed == "" {
			return "", errors.New("test ~/.nimi path is required")
		}
		return trimmed, nil
	})
}

func (s *localAppAdoptionStore) adopt(rootPath string, expectedAppID string) (localAppAdoptionRecord, error) {
	candidate, err := resolveLocalAppAdoptionCandidate(rootPath, expectedAppID)
	if err != nil {
		return localAppAdoptionRecord{}, err
	}
	return s.commitAdoption(candidate)
}

func (s *localAppAdoptionStore) commitAdoption(candidate localAppAdoptionRecord) (localAppAdoptionRecord, error) {
	path, err := s.localAppAdoptionsPath()
	if err != nil {
		return localAppAdoptionRecord{}, err
	}
	record, err := s.readOrEmpty()
	if err != nil {
		return localAppAdoptionRecord{}, err
	}
	now := s.now()
	candidate.State = "adopted"
	candidate.Trust = "explicit-local"
	candidate.UpdatedAt = now
	if strings.TrimSpace(candidate.AdoptedAt) == "" {
		candidate.AdoptedAt = now
	}
	replaced := false
	for index := range record.Adoptions {
		if record.Adoptions[index].AppID == candidate.AppID {
			if strings.TrimSpace(record.Adoptions[index].AdoptedAt) != "" {
				candidate.AdoptedAt = record.Adoptions[index].AdoptedAt
			}
			record.Adoptions[index] = candidate
			replaced = true
			break
		}
	}
	if !replaced {
		record.Adoptions = append(record.Adoptions, candidate)
	}
	record.UpdatedAt = now
	if err := validateLocalAppAdoptionsRecord(record); err != nil {
		return localAppAdoptionRecord{}, err
	}
	if err := writeLocalAppAdoptionsRecord(path, record); err != nil {
		return localAppAdoptionRecord{}, err
	}
	return candidate, nil
}

func resolveLocalAppAdoptionCandidate(rootPath string, expectedAppID string) (localAppAdoptionRecord, error) {
	root, manifestPath, manifest, err := loadLocalAppManifest(rootPath)
	if err != nil {
		return localAppAdoptionRecord{}, err
	}
	candidate, err := adoptionFromManifest(root, manifestPath, manifest)
	if err != nil {
		return localAppAdoptionRecord{}, err
	}
	if expected := strings.TrimSpace(expectedAppID); expected != "" && expected != candidate.AppID {
		return localAppAdoptionRecord{}, fmt.Errorf("local app manifest appId %s does not match expected appId %s", candidate.AppID, expected)
	}
	return candidate, nil
}

func (s *localAppAdoptionStore) remove(appID string) (localAppAdoptionRecord, error) {
	normalized := strings.TrimSpace(appID)
	if normalized == "" {
		return localAppAdoptionRecord{}, errors.New("local app adoption remove requires appId")
	}
	path, err := s.localAppAdoptionsPath()
	if err != nil {
		return localAppAdoptionRecord{}, err
	}
	record, err := s.readOrEmpty()
	if err != nil {
		return localAppAdoptionRecord{}, err
	}
	now := s.now()
	for index := range record.Adoptions {
		if record.Adoptions[index].AppID != normalized {
			continue
		}
		record.Adoptions[index].State = "removed"
		record.Adoptions[index].UpdatedAt = now
		record.UpdatedAt = now
		if err := validateLocalAppAdoptionsRecord(record); err != nil {
			return localAppAdoptionRecord{}, err
		}
		if err := writeLocalAppAdoptionsRecord(path, record); err != nil {
			return localAppAdoptionRecord{}, err
		}
		return record.Adoptions[index], nil
	}
	return localAppAdoptionRecord{}, fmt.Errorf("local app adoption %s is missing", normalized)
}

func (s *localAppAdoptionStore) list() ([]localAppAdoptionRecord, error) {
	record, err := s.readOrEmpty()
	if err != nil {
		return nil, err
	}
	return append([]localAppAdoptionRecord(nil), record.Adoptions...), nil
}

func (s *localAppAdoptionStore) findAdopted(appID string) (localAppAdoptionRecord, bool, error) {
	record, err := s.readOrEmpty()
	if err != nil {
		return localAppAdoptionRecord{}, false, err
	}
	for _, adoption := range record.Adoptions {
		if adoption.AppID == strings.TrimSpace(appID) && adoption.State == "adopted" {
			return adoption, true, nil
		}
	}
	return localAppAdoptionRecord{}, false, nil
}

func (s *localAppAdoptionStore) readOrEmpty() (localAppAdoptionsRecord, error) {
	path, err := s.localAppAdoptionsPath()
	if err != nil {
		return localAppAdoptionsRecord{}, err
	}
	var record localAppAdoptionsRecord
	if err := readRequiredJSON(path, &record); err != nil {
		if strings.Contains(err.Error(), "is missing; OpenApp fails closed") {
			return localAppAdoptionsRecord{
				SchemaVersion: localAppAdoptionsSchemaVersion,
				UpdatedAt:     s.now(),
				Adoptions:     []localAppAdoptionRecord{},
			}, nil
		}
		return localAppAdoptionsRecord{}, err
	}
	if err := validateLocalAppAdoptionsRecord(record); err != nil {
		return localAppAdoptionsRecord{}, err
	}
	return record, nil
}

func (s *localAppAdoptionStore) localAppAdoptionsPath() (string, error) {
	root, err := s.nimiDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "runtime", "app-adoptions.json"), nil
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
	for _, name := range []string{"nimi.app.yaml", "nimi.app.json"} {
		path := filepath.Join(absRoot, name)
		raw, err := os.ReadFile(path)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return "", "", localAppManifest{}, fmt.Errorf("%s is not readable: %w", name, err)
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

func adoptionFromManifest(root string, manifestPath string, manifest localAppManifest) (localAppAdoptionRecord, error) {
	row := localAppAdoptionRecord{
		AppID:              firstNonEmpty(manifest.AppID, manifest.AppIDCamel),
		RootPath:           root,
		ManifestPath:       manifestPath,
		DisplayName:        firstNonEmpty(manifest.DisplayName, manifest.DisplayNameCamel),
		Version:            manifest.Version,
		EntryRef:           firstNonEmpty(manifest.EntryRef, manifest.EntryRefCamel, manifest.Runtime.EntryRef, manifest.Runtime.EntryRefCamel),
		PermissionScopeRef: firstNonEmpty(manifest.PermissionScopeRef, manifest.PermissionsRef, manifest.Permissions.Ref, manifest.Permissions.ScopeRef, manifest.Permissions.ScopeRefCamel),
		StoragePolicyRef:   firstNonEmpty(manifest.StoragePolicyRef, manifest.Storage.PolicyRef, manifest.Storage.PolicyRefCamel),
	}
	if err := validateLocalAppAdoption(row); err != nil {
		return localAppAdoptionRecord{}, err
	}
	return row, nil
}

func validateLocalAppAdoptionsRecord(record localAppAdoptionsRecord) error {
	if record.SchemaVersion != localAppAdoptionsSchemaVersion {
		return fmt.Errorf("unsupported app-adoptions.json schemaVersion=%d expected=%d", record.SchemaVersion, localAppAdoptionsSchemaVersion)
	}
	if strings.TrimSpace(record.UpdatedAt) == "" {
		return errors.New("app-adoptions.json updatedAt is required")
	}
	seenAppIDs := map[string]struct{}{}
	for _, adoption := range record.Adoptions {
		if err := validateLocalAppAdoption(adoption); err != nil {
			return err
		}
		appID := strings.TrimSpace(adoption.AppID)
		if _, exists := seenAppIDs[appID]; exists {
			return fmt.Errorf("app-adoptions.json contains duplicate appId %s", appID)
		}
		seenAppIDs[appID] = struct{}{}
		switch adoption.State {
		case "adopted", "repair-required", "removed":
		default:
			return fmt.Errorf("local app adoption %s has invalid state %s", adoption.AppID, adoption.State)
		}
		switch adoption.Trust {
		case "explicit-local", "developer-local":
		default:
			return fmt.Errorf("local app adoption %s has invalid trust %s", adoption.AppID, adoption.Trust)
		}
	}
	return nil
}

func validateLocalAppAdoption(row localAppAdoptionRecord) error {
	required := map[string]string{
		"appId":              row.AppID,
		"rootPath":           row.RootPath,
		"manifestPath":       row.ManifestPath,
		"displayName":        row.DisplayName,
		"version":            row.Version,
		"entryRef":           row.EntryRef,
		"permissionScopeRef": row.PermissionScopeRef,
		"storagePolicyRef":   row.StoragePolicyRef,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("local app adoption requires %s", field)
		}
	}
	if !safeLocalAppID(row.AppID) {
		return fmt.Errorf("local app adoption appId %s is not a safe app id", row.AppID)
	}
	if strings.TrimSpace(row.AppID) != row.AppID {
		return fmt.Errorf("local app adoption appId %s must be canonical without surrounding whitespace", row.AppID)
	}
	if !safeLocalVersion(row.Version) {
		return fmt.Errorf("local app adoption version %s is not a safe version", row.Version)
	}
	root := filepath.Clean(row.RootPath)
	manifest := filepath.Clean(row.ManifestPath)
	if !filepath.IsAbs(root) || !filepath.IsAbs(manifest) {
		return errors.New("local app adoption paths must be absolute")
	}
	if rel, err := filepath.Rel(root, manifest); err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return errors.New("local app manifest must be inside local app root")
	}
	if err := validateLocalAppEntryRef(root, row.AppID, row.EntryRef); err != nil {
		return err
	}
	return nil
}

func validateLocalAppEntryRef(root string, appID string, entryRef string) error {
	normalized := strings.TrimSpace(entryRef)
	if normalized == "" {
		return errors.New("local app adoption entryRef is required")
	}
	if normalized != entryRef {
		return errors.New("local app adoption entryRef must not contain surrounding whitespace")
	}
	if strings.Contains(normalized, `\`) {
		return errors.New("local app adoption entryRef must not contain backslash path separators")
	}
	if parsed, err := url.Parse(normalized); err == nil {
		if parsed.Scheme != "" {
			return validateLocalAppURIEntryRef(parsed, appID)
		}
	} else if strings.Contains(normalized, "://") {
		return fmt.Errorf("local app adoption entryRef is not a valid URI: %w", err)
	}
	return validateLocalAppRelativeEntryRef(root, normalized)
}

func validateLocalAppURIEntryRef(parsed *url.URL, appID string) error {
	if parsed.Scheme != "app" {
		return fmt.Errorf("local app adoption entryRef scheme %s is not supported", parsed.Scheme)
	}
	if strings.TrimSpace(parsed.User.String()) != "" {
		return errors.New("local app adoption entryRef must not include user info")
	}
	if parsed.Host != appID {
		return fmt.Errorf("local app adoption entryRef host %s does not match appId %s", parsed.Host, appID)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("local app adoption entryRef must not include query or fragment")
	}
	path := strings.TrimSpace(parsed.Path)
	if path == "" || path == "/" {
		return errors.New("local app adoption entryRef path is required")
	}
	for _, segment := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		if segment == "" || segment == "." || segment == ".." {
			return errors.New("local app adoption entryRef path contains an unsafe segment")
		}
	}
	if strings.Contains(path, "//") {
		return errors.New("local app adoption entryRef path must not contain empty segments")
	}
	return nil
}

func validateLocalAppRelativeEntryRef(root string, entryRef string) error {
	if path.IsAbs(entryRef) || filepath.IsAbs(entryRef) {
		return errors.New("local app adoption relative entryRef must not be absolute")
	}
	clean := path.Clean(entryRef)
	if clean == "." || clean == "" || clean != entryRef {
		return errors.New("local app adoption relative entryRef must be a clean non-empty path")
	}
	if strings.HasPrefix(clean, "../") || clean == ".." || strings.Contains(clean, "/../") {
		return errors.New("local app adoption relative entryRef must stay inside local app root")
	}
	resolved := filepath.Join(root, filepath.FromSlash(clean))
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return errors.New("local app adoption relative entryRef must stay inside local app root")
	}
	return nil
}

func writeLocalAppAdoptionsRecord(path string, record localAppAdoptionsRecord) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("create app-adoptions.json directory failed (%s): %w", parent, err)
	}
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize app-adoptions.json failed: %w", err)
	}
	tmpPath := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())
	if err := os.WriteFile(tmpPath, raw, 0o644); err != nil {
		return fmt.Errorf("write app-adoptions.json temporary file failed (%s): %w", tmpPath, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("commit app-adoptions.json record failed (%s): %w", path, err)
	}
	return nil
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
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func safeLocalVersion(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsAny(value, `/\`) {
		return false
	}
	return value == filepath.Base(value)
}
