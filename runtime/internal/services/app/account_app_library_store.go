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
	accountAppLibraryStateDisabled = "disabled"
	accountAppLibraryStateRemoved  = "removed"

	accountAppDataPolicyKeepOnUninstall   = "keep_on_uninstall"
	accountAppDataPolicyDeleteOnUninstall = "delete_on_uninstall"
)

type accountAppLibraryMutation int

const (
	accountAppLibraryMutationInstalledEnabled accountAppLibraryMutation = iota
	accountAppLibraryMutationUninstalledKeepRecord
	accountAppLibraryMutationRemovedFromLibrary
)

type accountAppLibraryStore struct {
	nimiDir func() (string, error)
	now     func() string
}

func newAccountAppLibraryStore(nimiDir func() (string, error)) *accountAppLibraryStore {
	if nimiDir == nil {
		nimiDir = defaultNimiDir
	}
	return &accountAppLibraryStore{
		nimiDir: nimiDir,
		now:     nowAppLibraryTimestamp,
	}
}

func newAccountAppLibraryStoreForTest(nimiDir string) *accountAppLibraryStore {
	return newAccountAppLibraryStore(func() (string, error) {
		trimmed := strings.TrimSpace(nimiDir)
		if trimmed == "" {
			return "", errors.New("test ~/.nimi path is required")
		}
		return trimmed, nil
	})
}

func nowAppLibraryTimestamp() string {
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

func (s *Service) applyAccountAppLibraryLifecycleMutation(accountID string, appID string, mutation accountAppLibraryMutation) error {
	if s.accountLibrary == nil {
		return errors.New("Runtime account app-library store is not configured")
	}
	_, err := s.accountLibrary.applyMutation(accountID, appID, mutation)
	return err
}

func (s *accountAppLibraryStore) applyMutation(accountID string, appID string, mutation accountAppLibraryMutation) (accountAppLibraryRecord, error) {
	normalizedAccount := strings.TrimSpace(accountID)
	normalizedApp := strings.TrimSpace(appID)
	if normalizedAccount == "" {
		return accountAppLibraryRecord{}, errors.New("authenticated Runtime account_id is required")
	}
	if normalizedApp == "" {
		return accountAppLibraryRecord{}, errors.New("library.json mutation requires a non-empty appId")
	}
	path, err := s.accountAppLibraryPath(normalizedAccount)
	if err != nil {
		return accountAppLibraryRecord{}, err
	}
	record, err := s.readOrEmpty(normalizedAccount)
	if err != nil {
		return accountAppLibraryRecord{}, err
	}

	var existing *accountAppLibraryRow
	for index := range record.Apps {
		if record.Apps[index].AppID == normalizedApp {
			existing = &record.Apps[index]
			break
		}
	}
	switch mutation {
	case accountAppLibraryMutationInstalledEnabled:
		if existing == nil {
			record.Apps = append(record.Apps, accountAppLibraryRow{
				AppID:        normalizedApp,
				LibraryState: accountAppLibraryStateEnabled,
				Installed:    true,
				DataPolicy:   accountAppDataPolicyKeepOnUninstall,
			})
		} else {
			existing.LibraryState = accountAppLibraryStateEnabled
			existing.Installed = true
		}
	case accountAppLibraryMutationUninstalledKeepRecord:
		if existing != nil {
			existing.Installed = false
		}
	case accountAppLibraryMutationRemovedFromLibrary:
		if existing != nil {
			existing.LibraryState = accountAppLibraryStateRemoved
			existing.Installed = false
		}
	default:
		return accountAppLibraryRecord{}, errors.New("unknown account app-library mutation")
	}
	record.UpdatedAt = s.now()
	if err := validateAccountAppLibraryRecord(record, normalizedAccount); err != nil {
		return accountAppLibraryRecord{}, err
	}
	if err := writeAccountAppLibraryRecord(path, record); err != nil {
		return accountAppLibraryRecord{}, err
	}
	return record, nil
}

func (s *accountAppLibraryStore) readOrEmpty(accountID string) (accountAppLibraryRecord, error) {
	record, exists, err := s.readOptional(accountID)
	if err != nil {
		return accountAppLibraryRecord{}, err
	}
	if exists {
		return record, nil
	}
	return accountAppLibraryRecord{
		SchemaVersion: accountAppLibrarySchemaVersion,
		AccountID:     accountID,
		UpdatedAt:     s.now(),
		Apps:          []accountAppLibraryRow{},
	}, nil
}

func (s *accountAppLibraryStore) readOptional(accountID string) (accountAppLibraryRecord, bool, error) {
	path, err := s.accountAppLibraryPath(accountID)
	if err != nil {
		return accountAppLibraryRecord{}, false, err
	}
	var record accountAppLibraryRecord
	if err := readRequiredJSON(path, &record); err != nil {
		if strings.Contains(err.Error(), "is missing; OpenApp fails closed") {
			return accountAppLibraryRecord{}, false, nil
		}
		return accountAppLibraryRecord{}, false, err
	}
	if err := validateAccountAppLibraryRecord(record, accountID); err != nil {
		return accountAppLibraryRecord{}, false, err
	}
	return record, true, nil
}

func (s *accountAppLibraryStore) accountAppLibraryPath(accountID string) (string, error) {
	root, err := s.nimiDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "accounts", accountPathSegment(accountID), "apps", "library.json"), nil
}

func validateAccountAppLibraryRecord(record accountAppLibraryRecord, accountID string) error {
	if record.SchemaVersion != accountAppLibrarySchemaVersion {
		return fmt.Errorf("unsupported library.json schemaVersion=%d expected=%d", record.SchemaVersion, accountAppLibrarySchemaVersion)
	}
	if record.AccountID != accountID {
		return errors.New("library.json accountId does not match the authenticated Runtime account")
	}
	if strings.TrimSpace(record.UpdatedAt) == "" {
		return errors.New("library.json updatedAt is required")
	}
	for _, row := range record.Apps {
		if strings.TrimSpace(row.AppID) == "" {
			return errors.New("library.json app row requires appId")
		}
		switch row.LibraryState {
		case accountAppLibraryStateEnabled, accountAppLibraryStateDisabled, accountAppLibraryStateRemoved:
		default:
			return fmt.Errorf("library.json app row %s has an unknown libraryState: %s", row.AppID, row.LibraryState)
		}
		switch row.DataPolicy {
		case accountAppDataPolicyKeepOnUninstall, accountAppDataPolicyDeleteOnUninstall:
		default:
			return fmt.Errorf("library.json app row %s has an unknown dataPolicy: %s", row.AppID, row.DataPolicy)
		}
		if row.LastOpenedAt != nil && strings.TrimSpace(*row.LastOpenedAt) == "" {
			return fmt.Errorf("library.json app row %s lastOpenedAt must be omitted or a non-empty timestamp", row.AppID)
		}
	}
	return nil
}

func writeAccountAppLibraryRecord(path string, record accountAppLibraryRecord) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("create library.json directory failed (%s): %w", parent, err)
	}
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize library.json failed: %w", err)
	}
	tmpPath := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())
	if err := os.WriteFile(tmpPath, raw, 0o644); err != nil {
		return fmt.Errorf("write library.json temporary file failed (%s): %w", tmpPath, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("commit library.json record failed (%s): %w", path, err)
	}
	return nil
}
