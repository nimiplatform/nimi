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

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
)

const (
	accountAppLibrarySchemaVersion = 1
	accountGrantsSchemaVersion     = 1

	accountAppLibraryStateEnabled = "enabled"
	accountGrantStateGranted      = "granted"
)

type runtimeAccountProjectionProvider interface {
	AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool)
}

type accountProjectionOpenReadinessVerifier struct {
	accounts runtimeAccountProjectionProvider
	nimiDir  func() (string, error)
	now      func() time.Time
}

type OpenAppReadinessProjectionOption func(*accountProjectionOpenReadinessVerifier)

func WithOpenAppReadinessNimiDirForTest(path string) OpenAppReadinessProjectionOption {
	return func(v *accountProjectionOpenReadinessVerifier) {
		v.nimiDir = func() (string, error) {
			trimmed := strings.TrimSpace(path)
			if trimmed == "" {
				return "", errors.New("test ~/.nimi path is required")
			}
			return trimmed, nil
		}
	}
}

func WithOpenAppReadinessClockForTest(now func() time.Time) OpenAppReadinessProjectionOption {
	return func(v *accountProjectionOpenReadinessVerifier) {
		if now != nil {
			v.now = now
		}
	}
}

// NewAccountProjectionOpenAppReadinessVerifier builds the production Runtime
// verifier for K-APP-017 account-library and permission gates. The verifier
// consumes Runtime AccountService authenticated projection and governed
// account-scoped files under ~/.nimi/accounts/<account-id>/...; it never
// treats package verification or registry structure as launch permission.
func NewAccountProjectionOpenAppReadinessVerifier(accounts runtimeAccountProjectionProvider, opts ...OpenAppReadinessProjectionOption) OpenAppReadinessVerifier {
	v := &accountProjectionOpenReadinessVerifier{
		accounts: accounts,
		nimiDir:  defaultNimiDir,
		now:      time.Now,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(v)
		}
	}
	return v
}

func defaultNimiDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory for ~/.nimi: %w", err)
	}
	home = strings.TrimSpace(home)
	if home == "" {
		return "", errors.New("home directory is empty; cannot resolve ~/.nimi")
	}
	return filepath.Join(home, ".nimi"), nil
}

func (v *accountProjectionOpenReadinessVerifier) accountID(ctx context.Context) (string, OpenAppReadinessDecision) {
	if v == nil || v.accounts == nil {
		return "", OpenAppReadinessDecision{Allowed: false, Detail: "Runtime account projection provider is not configured"}
	}
	projection, ok := v.accounts.AuthenticatedRuntimeProjection(ctx)
	if !ok || projection == nil {
		return "", OpenAppReadinessDecision{Allowed: false, Detail: "authenticated Runtime account session is required"}
	}
	accountID := strings.TrimSpace(projection.GetAccountId())
	if accountID == "" {
		return "", OpenAppReadinessDecision{Allowed: false, Detail: "authenticated Runtime account projection did not include account_id"}
	}
	return accountID, OpenAppReadinessDecision{Allowed: true}
}

func (v *accountProjectionOpenReadinessVerifier) VerifyOpenAccountLibrary(ctx context.Context, app appregistrycatalog.App) (OpenAppReadinessDecision, error) {
	accountID, decision := v.accountID(ctx)
	if !decision.Allowed {
		return decision, nil
	}
	record, err := v.readAccountAppLibrary(accountID)
	if err != nil {
		return OpenAppReadinessDecision{Allowed: false, Detail: err.Error()}, nil
	}
	for _, row := range record.Apps {
		if strings.TrimSpace(row.AppID) != strings.TrimSpace(app.AppID) {
			continue
		}
		if row.LibraryState != accountAppLibraryStateEnabled {
			return OpenAppReadinessDecision{Allowed: false, Detail: "account app-library row is not enabled"}, nil
		}
		if !row.Installed {
			return OpenAppReadinessDecision{Allowed: false, Detail: "account app-library row is not installed"}, nil
		}
		return OpenAppReadinessDecision{Allowed: true}, nil
	}
	return OpenAppReadinessDecision{Allowed: false, Detail: "account app-library row is missing"}, nil
}

func (v *accountProjectionOpenReadinessVerifier) VerifyOpenPermissions(ctx context.Context, app appregistrycatalog.App) (OpenAppReadinessDecision, error) {
	accountID, decision := v.accountID(ctx)
	if !decision.Allowed {
		return decision, nil
	}
	if len(app.PermissionScopeRefs) == 0 {
		return OpenAppReadinessDecision{Allowed: true}, nil
	}
	record, err := v.readAccountGrants(accountID)
	if err != nil {
		return OpenAppReadinessDecision{Allowed: false, Detail: err.Error()}, nil
	}
	for _, required := range app.PermissionScopeRefs {
		if !record.hasGrantedScope(required) {
			return OpenAppReadinessDecision{
				Allowed: false,
				Detail:  fmt.Sprintf("permission grant is missing for scope %s", requiredPermissionScope(required)),
			}, nil
		}
	}
	return OpenAppReadinessDecision{Allowed: true}, nil
}

type accountAppLibraryRecord struct {
	SchemaVersion uint32                 `json:"schemaVersion"`
	AccountID     string                 `json:"accountId"`
	UpdatedAt     string                 `json:"updatedAt"`
	Apps          []accountAppLibraryRow `json:"apps"`
}

type accountAppLibraryRow struct {
	AppID        string  `json:"appId"`
	LibraryState string  `json:"libraryState"`
	Installed    bool    `json:"installed"`
	LastOpenedAt *string `json:"lastOpenedAt"`
	DataPolicy   string  `json:"dataPolicy"`
}

type accountGrantsRecord struct {
	SchemaVersion uint32            `json:"schemaVersion"`
	AccountID     string            `json:"accountId"`
	UpdatedAt     string            `json:"updatedAt"`
	Grants        []accountGrantRow `json:"grants"`
}

type accountGrantRow struct {
	GrantID          string  `json:"grantId"`
	SubjectAccountID string  `json:"subjectAccountId"`
	AppID            string  `json:"appId"`
	ScopeFamily      string  `json:"scopeFamily"`
	ScopeName        string  `json:"scopeName"`
	Qualifier        *string `json:"qualifier"`
	State            string  `json:"state"`
	ExpiresAt        *string `json:"expiresAt"`
	Version          *uint64 `json:"version"`
}

func (v *accountProjectionOpenReadinessVerifier) readAccountAppLibrary(accountID string) (accountAppLibraryRecord, error) {
	path, err := v.accountAppLibraryPath(accountID)
	if err != nil {
		return accountAppLibraryRecord{}, err
	}
	var record accountAppLibraryRecord
	if err := readRequiredJSON(path, &record); err != nil {
		return accountAppLibraryRecord{}, err
	}
	if err := validateAccountAppLibraryRecord(record, accountID); err != nil {
		return accountAppLibraryRecord{}, err
	}
	return record, nil
}

func (v *accountProjectionOpenReadinessVerifier) readAccountGrants(accountID string) (accountGrantsRecord, error) {
	path, err := v.accountGrantsPath(accountID)
	if err != nil {
		return accountGrantsRecord{}, err
	}
	var record accountGrantsRecord
	if err := readRequiredJSON(path, &record); err != nil {
		return accountGrantsRecord{}, err
	}
	if record.SchemaVersion != accountGrantsSchemaVersion {
		return accountGrantsRecord{}, fmt.Errorf("unsupported grants.json schemaVersion=%d expected=%d", record.SchemaVersion, accountGrantsSchemaVersion)
	}
	if record.AccountID != accountID {
		return accountGrantsRecord{}, errors.New("grants.json accountId does not match the authenticated Runtime account")
	}
	if strings.TrimSpace(record.UpdatedAt) == "" {
		return accountGrantsRecord{}, errors.New("grants.json updatedAt is required")
	}
	now := v.now().UTC()
	for _, row := range record.Grants {
		if strings.TrimSpace(row.GrantID) == "" ||
			strings.TrimSpace(row.SubjectAccountID) == "" ||
			strings.TrimSpace(row.AppID) == "" ||
			strings.TrimSpace(row.ScopeFamily) == "" ||
			strings.TrimSpace(row.ScopeName) == "" ||
			row.Version == nil {
			return accountGrantsRecord{}, errors.New("grants.json grant row requires grantId, subjectAccountId, appId, scopeFamily, scopeName, state, and version")
		}
		if !knownAccountGrantState(row.State) {
			return accountGrantsRecord{}, fmt.Errorf("grants.json grant %s has an unknown state: %s", row.GrantID, row.State)
		}
		if row.SubjectAccountID != accountID {
			return accountGrantsRecord{}, fmt.Errorf("grants.json grant %s subjectAccountId does not match the authenticated Runtime account", row.GrantID)
		}
		if row.Qualifier != nil && strings.TrimSpace(*row.Qualifier) == "" {
			return accountGrantsRecord{}, fmt.Errorf("grants.json grant %s qualifier must be omitted or a non-empty value", row.GrantID)
		}
		if row.State == accountGrantStateGranted && row.ExpiresAt != nil {
			expiresAt, err := time.Parse(time.RFC3339, strings.TrimSpace(*row.ExpiresAt))
			if err != nil {
				return accountGrantsRecord{}, fmt.Errorf("grants.json grant %s has an unparseable expiresAt: %w", row.GrantID, err)
			}
			if !expiresAt.After(now) {
				return accountGrantsRecord{}, fmt.Errorf("grants.json grant %s is expired; the permission projection is stale and fails closed", row.GrantID)
			}
		}
	}
	return record, nil
}

func (v *accountProjectionOpenReadinessVerifier) accountAppLibraryPath(accountID string) (string, error) {
	root, err := v.nimiDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "accounts", accountPathSegment(accountID), "apps", "library.json"), nil
}

func (v *accountProjectionOpenReadinessVerifier) accountGrantsPath(accountID string) (string, error) {
	root, err := v.nimiDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "accounts", accountPathSegment(accountID), "permissions", "grants.json"), nil
}

func readRequiredJSON(path string, out any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("%s is missing; OpenApp fails closed", filepath.Base(path))
		}
		return fmt.Errorf("%s is not readable: %w", filepath.Base(path), err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%s is not valid JSON: %w", filepath.Base(path), err)
	}
	return nil
}

func (r accountGrantsRecord) hasGrantedScope(required appregistrycatalog.PermissionScopeRef) bool {
	for _, grant := range r.Grants {
		if grant.State != accountGrantStateGranted {
			continue
		}
		if strings.TrimSpace(grant.AppID) != strings.TrimSpace(required.AppID) {
			continue
		}
		if strings.TrimSpace(grant.ScopeFamily) != strings.TrimSpace(required.ScopeFamily) {
			continue
		}
		if strings.TrimSpace(grant.ScopeName) != strings.TrimSpace(required.ScopeName) {
			continue
		}
		if grantQualifier(grant) == strings.TrimSpace(required.Qualifier) {
			return true
		}
	}
	return false
}

func knownAccountGrantState(state string) bool {
	switch state {
	case "pending", "granted", "denied", "expired", "revoked", "superseded":
		return true
	default:
		return false
	}
}

func grantQualifier(grant accountGrantRow) string {
	if grant.Qualifier == nil {
		return ""
	}
	return strings.TrimSpace(*grant.Qualifier)
}

func requiredPermissionScope(scope appregistrycatalog.PermissionScopeRef) string {
	base := strings.TrimSpace(scope.ScopeName)
	qualifier := strings.TrimSpace(scope.Qualifier)
	if qualifier == "" {
		return base
	}
	return base + " qualifier " + qualifier
}

func accountPathSegment(accountID string) string {
	var out strings.Builder
	for _, b := range []byte(accountID) {
		switch {
		case b >= 'A' && b <= 'Z',
			b >= 'a' && b <= 'z',
			b >= '0' && b <= '9',
			b == '-' || b == '_' || b == '.':
			out.WriteByte(b)
		default:
			out.WriteString(fmt.Sprintf("%%%02X", b))
		}
	}
	return out.String()
}
