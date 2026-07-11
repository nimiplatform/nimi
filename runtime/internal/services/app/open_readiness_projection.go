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
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

const (
	accountGrantsSchemaVersion = 1
	accountGrantStateGranted   = "granted"
)

type runtimeAccountProjectionProvider interface {
	AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool)
}

type accountProjectionOpenReadinessVerifier struct {
	accounts       runtimeAccountProjectionProvider
	nimiDir        func() (string, error)
	now            func() time.Time
	catalog        *appregistrycatalog.Registry
	installRuntime *installRuntime
}

type OpenAppReadinessProjectionOption func(*accountProjectionOpenReadinessVerifier)

type AccountProjectionOpenAppReadinessVerifier interface {
	OpenAppReadinessVerifier
	accountservice.InstalledOperationPolicySource
}

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

func WithOpenAppReadinessCatalog(catalog *appregistrycatalog.Registry) OpenAppReadinessProjectionOption {
	return func(v *accountProjectionOpenReadinessVerifier) {
		v.catalog = catalog
	}
}

func WithOpenAppReadinessInstallRuntime(runtime *installRuntime) OpenAppReadinessProjectionOption {
	return func(v *accountProjectionOpenReadinessVerifier) {
		v.installRuntime = runtime
	}
}

// NewAccountProjectionOpenAppReadinessVerifier builds the production Runtime
// verifier for K-APP-017 account-inventory and permission gates. The verifier
// consumes Runtime AccountService authenticated projection and governed
// account-scoped files under ~/.nimi/accounts/<account-id>/...; it never
// treats package verification or registry structure as launch permission.
func NewAccountProjectionOpenAppReadinessVerifier(accounts runtimeAccountProjectionProvider, opts ...OpenAppReadinessProjectionOption) AccountProjectionOpenAppReadinessVerifier {
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

func (v *accountProjectionOpenReadinessVerifier) VerifyOpenAccountInventory(ctx context.Context, app appregistrycatalog.App) (OpenAppReadinessDecision, error) {
	accountID, decision := v.accountID(ctx)
	if !decision.Allowed {
		return decision, nil
	}
	record, err := v.readAccountAppInventory(accountID)
	if err != nil {
		return OpenAppReadinessDecision{Allowed: false, Detail: err.Error()}, nil
	}
	for _, row := range record.Apps {
		if strings.TrimSpace(row.AppID) != strings.TrimSpace(app.AppID) {
			continue
		}
		if !accountStateLaunchable(row.AccountState) {
			return OpenAppReadinessDecision{Allowed: false, Detail: "account app-inventory row is not verified or entitled"}, nil
		}
		switch strings.TrimSpace(row.InstallState) {
		case accountAppInstallStateInstalled, accountAppInstallStateAdoptedLocal:
			return OpenAppReadinessDecision{Allowed: true}, nil
		default:
			return OpenAppReadinessDecision{Allowed: false, Detail: "account app-inventory row is not locally materialized"}, nil
		}
	}
	return OpenAppReadinessDecision{Allowed: false, Detail: "account app-inventory row is missing"}, nil
}

func (v *accountProjectionOpenReadinessVerifier) VerifyOpenPermissions(ctx context.Context, app appregistrycatalog.App) (OpenAppReadinessDecision, error) {
	accountID, decision := v.accountID(ctx)
	if !decision.Allowed {
		return decision, nil
	}
	if app.PermissionScopeRefPending {
		return OpenAppReadinessDecision{Allowed: false, Detail: "app permission scope ref is permission_fabric_pending"}, nil
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

// ResolveInstalledOperationPolicy exposes current protected facts to the
// Account-owned evaluator. It does not authorize: Account supplies the closed
// operation-to-permission mapping and combines these facts with the live
// installed session/account decision.
func (v *accountProjectionOpenReadinessVerifier) ResolveInstalledOperationPolicy(ctx context.Context, query accountservice.InstalledOperationPolicyQuery) (accountservice.InstalledOperationPolicySnapshot, error) {
	var snapshot accountservice.InstalledOperationPolicySnapshot
	accountID := strings.TrimSpace(query.AccountID)
	appID := strings.TrimSpace(query.AppID)
	if accountID == "" || accountID != query.AccountID || appID == "" || appID != query.AppID ||
		strings.TrimSpace(query.ScopeFamily) == "" || strings.TrimSpace(query.ScopeName) == "" || strings.TrimSpace(query.Qualifier) == "" {
		return snapshot, errors.New("installed operation policy query is incomplete")
	}
	security, ok := v.accounts.(runtimeAccountSecurityContextProvider)
	if !ok {
		return snapshot, errors.New("installed operation account security context is unavailable")
	}
	projection, currentGeneration, authenticated := security.AuthenticatedRuntimeSecurityContext(ctx)
	if !authenticated || projection == nil || currentGeneration == 0 || currentGeneration != query.AccountGeneration || strings.TrimSpace(projection.GetAccountId()) != accountID {
		return snapshot, errors.New("installed operation account is no longer current")
	}
	snapshot.CurrentAccountGeneration = currentGeneration
	if v.catalog == nil || v.installRuntime == nil || v.catalog.Version <= 0 {
		return snapshot, errors.New("installed operation catalog and release facts are unavailable")
	}
	snapshot.CatalogVersion = uint64(v.catalog.Version)
	app, err := v.catalog.FindByID(appID)
	if err != nil || app.AdmissionStatus != appregistrycatalog.AdmissionStatusAdmitted || app.PermissionScopeRefPending {
		return snapshot, nil
	}
	for _, scope := range app.PermissionScopeRefs {
		if scope.AppID == appID && scope.ScopeFamily == query.ScopeFamily && scope.ScopeName == query.ScopeName && scope.Qualifier == query.Qualifier {
			snapshot.CatalogPermissionPresent = true
			break
		}
	}

	inventory, err := v.readAccountAppInventory(accountID)
	if err != nil {
		return snapshot, err
	}
	for _, row := range inventory.Apps {
		if row.AppID == appID {
			snapshot.InventoryAccountState = accountservice.InstalledInventoryAccountState(row.AccountState)
			snapshot.InventoryInstallState = accountservice.InstalledInventoryInstallState(row.InstallState)
			break
		}
	}

	grants, err := v.readAccountGrants(accountID)
	if err != nil {
		return snapshot, err
	}
	grant, found, err := grants.currentGrant(query)
	if err != nil {
		return snapshot, err
	}
	if found {
		snapshot.GrantID = grant.GrantID
		snapshot.GrantState = accountservice.InstalledGrantState(grant.State)
		snapshot.GrantVersion = *grant.Version
		if grant.ExpiresAt != nil {
			expiresAt, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(*grant.ExpiresAt))
			if parseErr != nil {
				return snapshot, parseErr
			}
			snapshot.GrantExpiresAt = expiresAt.UTC()
		}
	}

	_, descriptor, err := v.installRuntime.resolveDescriptor(appID)
	if err != nil {
		return snapshot, nil
	}
	plan, err := v.installRuntime.plan(descriptor)
	if err != nil {
		return snapshot, nil
	}
	resolution, blocked := verifyOpenPackage(v.installRuntime, plan, descriptor)
	if blocked != nil {
		return snapshot, nil
	}
	releaseDigest, err := installedReleaseDigest(resolution.Evidence.SHA256)
	if err != nil {
		return snapshot, nil
	}
	snapshot.ActiveReleaseDigest = releaseDigest
	return snapshot, nil
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

func (v *accountProjectionOpenReadinessVerifier) readAccountAppInventory(accountID string) (accountAppInventoryRecord, error) {
	path, err := v.accountAppInventoryPath(accountID)
	if err != nil {
		return accountAppInventoryRecord{}, err
	}
	var record accountAppInventoryRecord
	if err := readRequiredJSON(path, &record); err != nil {
		return accountAppInventoryRecord{}, err
	}
	if err := validateAccountAppInventoryRecord(record, accountID); err != nil {
		return accountAppInventoryRecord{}, err
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
			row.Version == nil || *row.Version == 0 {
			return accountGrantsRecord{}, errors.New("grants.json grant row requires grantId, subjectAccountId, appId, scopeFamily, scopeName, state, and a non-zero version")
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

func (v *accountProjectionOpenReadinessVerifier) accountAppInventoryPath(accountID string) (string, error) {
	root, err := v.nimiDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "accounts", accountPathSegment(accountID), "apps", "inventory.json"), nil
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
	grant, found, err := r.currentGrantForScope(
		strings.TrimSpace(required.AppID),
		strings.TrimSpace(required.ScopeFamily),
		strings.TrimSpace(required.ScopeName),
		strings.TrimSpace(required.Qualifier),
	)
	return err == nil && found && grant.State == accountGrantStateGranted && grant.Version != nil && *grant.Version > 0
}

func (r accountGrantsRecord) currentGrant(query accountservice.InstalledOperationPolicyQuery) (accountGrantRow, bool, error) {
	return r.currentGrantForScope(query.AppID, query.ScopeFamily, query.ScopeName, query.Qualifier)
}

func (r accountGrantsRecord) currentGrantForScope(appID string, scopeFamily string, scopeName string, qualifier string) (accountGrantRow, bool, error) {
	var current accountGrantRow
	found := false
	for _, grant := range r.Grants {
		if grant.AppID != appID || grant.ScopeFamily != scopeFamily || grant.ScopeName != scopeName || grantQualifier(grant) != qualifier {
			continue
		}
		if grant.Version == nil {
			return accountGrantRow{}, false, errors.New("matching installed operation grant has no version")
		}
		if !found || *grant.Version > *current.Version {
			current = grant
			found = true
			continue
		}
		if *grant.Version == *current.Version {
			return accountGrantRow{}, false, errors.New("matching installed operation grants have duplicate current versions")
		}
	}
	return current, found, nil
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

var _ accountservice.InstalledOperationPolicySource = (*accountProjectionOpenReadinessVerifier)(nil)
