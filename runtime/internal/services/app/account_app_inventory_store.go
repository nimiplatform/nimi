package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	accountAppInventorySchemaVersion = 2

	accountAppInventoryStateVerified = "verified"
	accountAppInventoryStateEntitled = "entitled"
	accountAppInventoryStateDisabled = "disabled"
	accountAppInventoryStateRemoved  = "removed"
	accountAppInventoryStateRevoked  = "revoked"

	accountAppInstallStateNotInstalled = "not-installed"
	accountAppInstallStateInstalled    = "installed"
	accountAppInstallStateRemoved      = "removed"

	accountAppDataPolicyKeepOnUninstall   = "keep_on_uninstall"
	accountAppDataPolicyDeleteOnUninstall = "delete_on_uninstall"
)

type accountAppInventoryMutation int

const (
	accountAppInventoryMutationInstalled accountAppInventoryMutation = iota
	accountAppInventoryMutationUninstalled
	accountAppInventoryMutationRemoved
)

type accountAppInventoryStore struct {
	nimiDir func() (string, error)
	now     func() string
}

type accountAppInventoryRecord struct {
	SchemaVersion uint32                   `json:"schemaVersion"`
	AccountID     string                   `json:"accountId"`
	UpdatedAt     string                   `json:"updatedAt"`
	Apps          []accountAppInventoryRow `json:"apps"`
}

type accountAppInventoryRow struct {
	AppID        string  `json:"appId"`
	AccountState string  `json:"accountState"`
	InstallState string  `json:"installState"`
	LastOpenedAt *string `json:"lastOpenedAt"`
	DataPolicy   string  `json:"dataPolicy"`
	VerifiedAt   string  `json:"verifiedAt,omitempty"`
	Source       string  `json:"source,omitempty"`
	Detail       string  `json:"detail,omitempty"`
}

func newAccountAppInventoryStore(nimiDir func() (string, error)) *accountAppInventoryStore {
	if nimiDir == nil {
		nimiDir = defaultNimiDir
	}
	return &accountAppInventoryStore{
		nimiDir: nimiDir,
		now:     nowAppInventoryTimestamp,
	}
}

func newAccountAppInventoryStoreForTest(nimiDir string) *accountAppInventoryStore {
	return newAccountAppInventoryStore(func() (string, error) {
		trimmed := strings.TrimSpace(nimiDir)
		if trimmed == "" {
			return "", errors.New("test ~/.nimi path is required")
		}
		return trimmed, nil
	})
}

func nowAppInventoryTimestamp() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func (s *Service) resolveAuthenticatedAccountIDForAppLifecycle(ctx context.Context) (string, error) {
	if s.accountProjection == nil {
		return "", errors.New("Runtime account projection provider is not configured")
	}
	projection, ok := s.accountProjection.AuthenticatedRuntimeProjection(ctx)
	if !ok || projection == nil || strings.TrimSpace(projection.GetAccountId()) == "" {
		return "", errors.New("authenticated Runtime account session is required for app lifecycle")
	}
	return strings.TrimSpace(projection.GetAccountId()), nil
}

func (s *Service) applyAccountAppInventoryLifecycleMutation(accountID string, appID string, mutation accountAppInventoryMutation) error {
	if s.accountInventory == nil {
		return errors.New("Runtime account app-inventory store is not configured")
	}
	_, err := s.accountInventory.applyMutation(accountID, appID, mutation)
	return err
}

func (s *Service) requireAccountAppLifecycleLaunchable(accountID string, appID string) error {
	if s.accountInventory == nil {
		return errors.New("Runtime account app-inventory store is not configured")
	}
	return s.accountInventory.requireLaunchableRow(accountID, appID)
}

func (s *accountAppInventoryStore) requireLaunchableRow(accountID string, appID string) error {
	normalizedAccount := strings.TrimSpace(accountID)
	normalizedApp := strings.TrimSpace(appID)
	if normalizedAccount == "" {
		return errors.New("authenticated Runtime account_id is required")
	}
	if normalizedApp == "" {
		return errors.New("inventory lifecycle preflight requires a non-empty appId")
	}
	record, err := s.readOrEmpty(normalizedAccount)
	if err != nil {
		return err
	}
	for _, row := range record.Apps {
		if row.AppID != normalizedApp {
			continue
		}
		if !accountStateLaunchable(row.AccountState) {
			return fmt.Errorf("account app-inventory row %s is not verified or entitled", normalizedApp)
		}
		return nil
	}
	return fmt.Errorf("account app-inventory row %s is missing; lifecycle cannot create account entitlement", normalizedApp)
}

func (s *accountAppInventoryStore) applyMutation(accountID string, appID string, mutation accountAppInventoryMutation) (accountAppInventoryRecord, error) {
	normalizedAccount := strings.TrimSpace(accountID)
	normalizedApp := strings.TrimSpace(appID)
	if normalizedAccount == "" {
		return accountAppInventoryRecord{}, errors.New("authenticated Runtime account_id is required")
	}
	if normalizedApp == "" {
		return accountAppInventoryRecord{}, errors.New("inventory mutation requires a non-empty appId")
	}
	path, err := s.accountAppInventoryPath(normalizedAccount)
	if err != nil {
		return accountAppInventoryRecord{}, err
	}
	record, err := s.readOrEmpty(normalizedAccount)
	if err != nil {
		return accountAppInventoryRecord{}, err
	}

	var existing *accountAppInventoryRow
	for index := range record.Apps {
		if record.Apps[index].AppID == normalizedApp {
			existing = &record.Apps[index]
			break
		}
	}
	if existing == nil {
		return accountAppInventoryRecord{}, fmt.Errorf("account app-inventory row %s is missing; lifecycle cannot create account entitlement", normalizedApp)
	}
	if !accountStateLaunchable(existing.AccountState) {
		return accountAppInventoryRecord{}, fmt.Errorf("account app-inventory row %s is not verified or entitled", normalizedApp)
	}

	switch mutation {
	case accountAppInventoryMutationInstalled:
		existing.InstallState = accountAppInstallStateInstalled
	case accountAppInventoryMutationUninstalled:
		existing.InstallState = accountAppInstallStateNotInstalled
	case accountAppInventoryMutationRemoved:
		existing.InstallState = accountAppInstallStateRemoved
	default:
		return accountAppInventoryRecord{}, errors.New("unknown account app-inventory mutation")
	}
	if strings.TrimSpace(existing.DataPolicy) == "" {
		existing.DataPolicy = accountAppDataPolicyKeepOnUninstall
	}
	record.UpdatedAt = s.now()
	if err := validateAccountAppInventoryRecord(record, normalizedAccount); err != nil {
		return accountAppInventoryRecord{}, err
	}
	if err := writeAccountAppInventoryRecord(path, record); err != nil {
		return accountAppInventoryRecord{}, err
	}
	return record, nil
}

func (s *accountAppInventoryStore) readOrEmpty(accountID string) (accountAppInventoryRecord, error) {
	record, exists, err := s.readOptional(accountID)
	if err != nil {
		return accountAppInventoryRecord{}, err
	}
	if exists {
		return record, nil
	}
	return accountAppInventoryRecord{
		SchemaVersion: accountAppInventorySchemaVersion,
		AccountID:     accountID,
		UpdatedAt:     s.now(),
		Apps:          []accountAppInventoryRow{},
	}, nil
}

func (s *accountAppInventoryStore) readOptional(accountID string) (accountAppInventoryRecord, bool, error) {
	path, err := s.accountAppInventoryPath(accountID)
	if err != nil {
		return accountAppInventoryRecord{}, false, err
	}
	var record accountAppInventoryRecord
	if err := readRequiredJSON(path, &record); err != nil {
		if strings.Contains(err.Error(), "is missing; Runtime projection fails closed") {
			return accountAppInventoryRecord{}, false, nil
		}
		return accountAppInventoryRecord{}, false, err
	}
	if err := validateAccountAppInventoryRecord(record, accountID); err != nil {
		return accountAppInventoryRecord{}, false, err
	}
	return record, true, nil
}

func (s *accountAppInventoryStore) accountAppInventoryPath(accountID string) (string, error) {
	root, err := s.nimiDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "accounts", accountPathSegment(accountID), "apps", "inventory.json"), nil
}

func validateAccountAppInventoryRecord(record accountAppInventoryRecord, accountID string) error {
	if record.SchemaVersion != accountAppInventorySchemaVersion {
		return fmt.Errorf("unsupported inventory.json schemaVersion=%d expected=%d", record.SchemaVersion, accountAppInventorySchemaVersion)
	}
	if record.AccountID != accountID {
		return errors.New("inventory.json accountId does not match the authenticated Runtime account")
	}
	if strings.TrimSpace(record.UpdatedAt) == "" {
		return errors.New("inventory.json updatedAt is required")
	}
	seenAppIDs := map[string]struct{}{}
	for _, row := range record.Apps {
		appID := strings.TrimSpace(row.AppID)
		if appID == "" {
			return errors.New("inventory.json app row requires appId")
		}
		if appID != row.AppID {
			return fmt.Errorf("inventory.json app row %s appId must be canonical without surrounding whitespace", row.AppID)
		}
		if _, exists := seenAppIDs[appID]; exists {
			return fmt.Errorf("inventory.json contains duplicate appId %s", appID)
		}
		seenAppIDs[appID] = struct{}{}
		if !accountStateKnown(row.AccountState) {
			return fmt.Errorf("inventory.json app row %s has an unknown accountState: %s", row.AppID, row.AccountState)
		}
		if !installStateKnown(row.InstallState) {
			return fmt.Errorf("inventory.json app row %s has an unknown installState: %s", row.AppID, row.InstallState)
		}
		switch row.DataPolicy {
		case accountAppDataPolicyKeepOnUninstall, accountAppDataPolicyDeleteOnUninstall:
		default:
			return fmt.Errorf("inventory.json app row %s has an unknown dataPolicy: %s", row.AppID, row.DataPolicy)
		}
		if row.LastOpenedAt != nil && strings.TrimSpace(*row.LastOpenedAt) == "" {
			return fmt.Errorf("inventory.json app row %s lastOpenedAt must be omitted or a non-empty timestamp", row.AppID)
		}
	}
	return nil
}

func writeAccountAppInventoryRecord(path string, record accountAppInventoryRecord) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("create inventory.json directory failed (%s): %w", parent, err)
	}
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize inventory.json failed: %w", err)
	}
	tmpPath := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())
	if err := os.WriteFile(tmpPath, raw, 0o644); err != nil {
		return fmt.Errorf("write inventory.json temporary file failed (%s): %w", tmpPath, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("commit inventory.json record failed (%s): %w", path, err)
	}
	return nil
}

func accountStateKnown(state string) bool {
	switch strings.TrimSpace(state) {
	case accountAppInventoryStateVerified,
		accountAppInventoryStateEntitled,
		accountAppInventoryStateDisabled,
		accountAppInventoryStateRemoved,
		accountAppInventoryStateRevoked:
		return true
	default:
		return false
	}
}

func accountStateLaunchable(state string) bool {
	switch strings.TrimSpace(state) {
	case accountAppInventoryStateVerified, accountAppInventoryStateEntitled:
		return true
	default:
		return false
	}
}

func installStateKnown(state string) bool {
	switch strings.TrimSpace(state) {
	case accountAppInstallStateNotInstalled,
		accountAppInstallStateInstalled,
		accountAppInstallStateRemoved:
		return true
	default:
		return false
	}
}
