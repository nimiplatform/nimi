package localappkernel

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const identifierAllocationAttempts = 8
const dataRootRelativeLocatorPrefix = "nimi-data-relative:v1:"

type VerifiedLocalOSUserIdentity struct{ canonical string }

// LocalOSUserAnchor returns the stable verified OS-user scope used by current
// host bindings and account-scoped keys. A macOS audit session remains part of
// peer verification, but is deliberately excluded from this durable scope.
func (identity VerifiedLocalOSUserIdentity) LocalOSUserAnchor() (string, error) {
	stable, err := identity.stableOSUserScopeSource()
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte("nimi.local-os-user-anchor.v2\x00" + stable))
	return "loua_v2_" + base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func (identity VerifiedLocalOSUserIdentity) stableOSUserScopeSource() (string, error) {
	if identity.canonical == "" {
		return "", fmt.Errorf("%w: empty verified local OS-user identity", ErrInvalidArgument)
	}
	if strings.HasPrefix(identity.canonical, "windows:sid:") {
		if _, ok := identity.WindowsInteractiveUserSID(); !ok {
			return "", fmt.Errorf("%w: verified Windows OS-user scope", ErrInvalidArgument)
		}
		return identity.canonical, nil
	}
	if strings.HasPrefix(identity.canonical, "macos:euid:") {
		euid, _, ok := identity.MacOSInteractiveUser()
		if !ok {
			return "", fmt.Errorf("%w: verified macOS OS-user scope", ErrInvalidArgument)
		}
		return fmt.Sprintf("macos:euid:%d", euid), nil
	}
	return "", fmt.Errorf("%w: unsupported verified local OS-user identity", ErrInvalidArgument)
}

type Options struct {
	Random        io.Reader
	Now           func() time.Time
	HostInstallID string
	DataRoot      string
}

type Kernel struct {
	db               *sql.DB
	anchor           string
	hostInstallID    string
	dataRoot         string
	random           io.Reader
	now              func() time.Time
	mu               sync.Mutex
	registrations    *RegistrationStore
	keys             *KeyDeriver
	packageLifecycle *PackageLifecycleStore

	// In-package failure injection proves canonical+binding transactionality
	// without introducing a production harness or evidence surface.
	beforeCommit func() error
}

// @nimi-authority: rule.nimi.runtime.app-surface.r051
// @nimi-authority: rule.nimi.runtime.app-surface.r058
// CanonicalRegistrationDatabasePath is the one K-APP-owned database in an
// active data root. Canonical registrations and host binding partitions share
// it; there is no portable sidecar or per-host database.
func CanonicalRegistrationDatabasePath(dataRoot string) (string, error) {
	root := filepath.Clean(strings.TrimSpace(dataRoot))
	if root == "." || !filepath.IsAbs(root) {
		return "", fmt.Errorf("%w: data root", ErrInvalidArgument)
	}
	return filepath.Join(root, "apps", "local-app-kernel.db"), nil
}

func OpenSQLite(ctx context.Context, databasePath string, identity VerifiedLocalOSUserIdentity, options Options) (*Kernel, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	trimmedPath := strings.TrimSpace(databasePath)
	if trimmedPath == "" || trimmedPath != databasePath {
		return nil, fmt.Errorf("%w: sqlite path", ErrInvalidArgument)
	}
	if err := requireExactText("host_install_id", options.HostInstallID); err != nil {
		return nil, err
	}
	dataRoot := filepath.Clean(strings.TrimSpace(options.DataRoot))
	if dataRoot == "." || !filepath.IsAbs(dataRoot) || dataRoot == filepath.VolumeName(dataRoot)+string(filepath.Separator) {
		return nil, fmt.Errorf("%w: data root", ErrInvalidArgument)
	}
	canonicalPath, err := CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		return nil, err
	}
	absolutePath, err := filepath.Abs(filepath.Clean(trimmedPath))
	if err != nil {
		return nil, fmt.Errorf("resolve registered App sqlite path: %w", err)
	}
	if !sameKAPPPath(absolutePath, canonicalPath) {
		return nil, fmt.Errorf("%w: sqlite path must be the canonical data-root owner store", ErrInvalidArgument)
	}
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o700); err != nil {
		return nil, fmt.Errorf("create registered App sqlite directory: %w", err)
	}
	anchor, err := identity.LocalOSUserAnchor()
	if err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.ToSlash(absolutePath) + "?_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open registered App sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	kernel := &Kernel{
		db: db, anchor: anchor, hostInstallID: options.HostInstallID, dataRoot: dataRoot,
		random: options.Random, now: options.Now,
	}
	if kernel.random == nil {
		kernel.random = rand.Reader
	}
	if kernel.now == nil {
		kernel.now = time.Now
	}
	if err := kernel.initialize(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	kernel.registrations = &RegistrationStore{kernel: kernel}
	kernel.keys = &KeyDeriver{kernel: kernel}
	kernel.packageLifecycle = &PackageLifecycleStore{kernel: kernel}
	return kernel, nil
}

func sameKAPPPath(left string, right string) bool {
	left = filepath.Clean(left)
	right = filepath.Clean(right)
	if filepath.Separator == '\\' {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func (kernel *Kernel) encodeBindingLocator(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if kernel == nil || kernel.dataRoot == "" || trimmed == "" {
		return "", fmt.Errorf("%w: binding locator", ErrInvalidArgument)
	}
	if !filepath.IsAbs(trimmed) {
		return trimmed, nil
	}
	cleaned := filepath.Clean(trimmed)
	relative, err := filepath.Rel(kernel.dataRoot, cleaned)
	if err != nil || filepath.IsAbs(relative) {
		return cleaned, nil
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return cleaned, nil
	}
	return dataRootRelativeLocatorPrefix + filepath.ToSlash(relative), nil
}

func (kernel *Kernel) decodeBindingLocator(value string) (string, error) {
	if !strings.HasPrefix(value, dataRootRelativeLocatorPrefix) {
		return value, nil
	}
	relative := filepath.Clean(filepath.FromSlash(strings.TrimPrefix(value, dataRootRelativeLocatorPrefix)))
	if relative == "" || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: data-root-relative binding locator", ErrInvalidArgument)
	}
	return filepath.Join(kernel.dataRoot, relative), nil
}

const canonicalRegistrationCreateStatement = `CREATE TABLE IF NOT EXISTS canonical_registration (
	registration_handle TEXT PRIMARY KEY,
	registered_app_subject TEXT NOT NULL UNIQUE,
	app_id TEXT NOT NULL,
	display_name TEXT NOT NULL,
	source_class TEXT NOT NULL CHECK(source_class IN ('verified','local_development')),
	source_ref TEXT NOT NULL,
	shell_kind INTEGER NOT NULL CHECK(shell_kind > 0),
	raw_declaration_json TEXT NOT NULL,
	activated_domains_json TEXT NOT NULL,
	source_generation INTEGER NOT NULL CHECK(source_generation > 0),
	declaration_generation INTEGER NOT NULL CHECK(declaration_generation > 0),
	immutable_lineage_id TEXT NOT NULL,
	provenance_attestation_refs_json TEXT NOT NULL,
	provenance_revision INTEGER NOT NULL CHECK(provenance_revision >= 0),
	execution_profile_ref TEXT NOT NULL,
	declaration_digest TEXT NOT NULL,
	state TEXT NOT NULL CHECK(state IN ('active','tombstoned')),
	created_unix_nano INTEGER NOT NULL,
	updated_unix_nano INTEGER NOT NULL,
	tombstoned_unix_nano INTEGER,
	CHECK((state = 'active' AND tombstoned_unix_nano IS NULL) OR (state = 'tombstoned' AND tombstoned_unix_nano IS NOT NULL))
)`

func sqliteTableColumns(ctx context.Context, database *sql.DB, table string) (map[string]bool, error) {
	rows, err := database.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return nil, fmt.Errorf("inspect registered App schema: %w", err)
	}
	defer func() { _ = rows.Close() }()
	columns := make(map[string]bool)
	for rows.Next() {
		var ordinal, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&ordinal, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, fmt.Errorf("read registered App schema: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate registered App schema: %w", err)
	}
	return columns, nil
}

func (kernel *Kernel) requireCanonicalRegistrationSchema(ctx context.Context) error {
	columns, err := sqliteTableColumns(ctx, kernel.db, "canonical_registration")
	if err != nil {
		return err
	}
	expected := []string{
		"registration_handle", "registered_app_subject", "app_id", "display_name", "source_class",
		"source_ref", "shell_kind", "raw_declaration_json", "activated_domains_json", "source_generation",
		"declaration_generation", "immutable_lineage_id", "provenance_attestation_refs_json",
		"provenance_revision", "execution_profile_ref", "declaration_digest", "state",
		"created_unix_nano", "updated_unix_nano", "tombstoned_unix_nano",
	}
	if len(columns) != len(expected) {
		return fmt.Errorf("initialize registered App schema: unsupported canonical_registration shape")
	}
	for _, name := range expected {
		if !columns[name] {
			return fmt.Errorf("initialize registered App schema: unsupported canonical_registration shape")
		}
	}
	if err := requireSQLiteConstraint(ctx, kernel.db, "canonical_registration", "source-class", "check(source_classin('verified','local_development'))", "user_imported"); err != nil {
		return fmt.Errorf("initialize registered App schema: %w", err)
	}
	return nil
}

func requireSQLiteConstraint(ctx context.Context, database *sql.DB, table string, label string, expected string, forbidden ...string) error {
	var statement string
	if err := database.QueryRowContext(ctx, `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&statement); err != nil {
		return fmt.Errorf("inspect %s %s constraint: %w", table, label, err)
	}
	compact := strings.ToLower(strings.NewReplacer(" ", "", "\t", "", "\r", "", "\n", "").Replace(statement))
	for _, value := range forbidden {
		if strings.Contains(compact, value) {
			return fmt.Errorf("unsupported %s %s constraint", table, label)
		}
	}
	if !strings.Contains(compact, expected) {
		return fmt.Errorf("unsupported %s %s constraint", table, label)
	}
	return nil
}

func (kernel *Kernel) initialize(ctx context.Context) error {
	if _, err := kernel.db.ExecContext(ctx, canonicalRegistrationCreateStatement); err != nil {
		return fmt.Errorf("initialize registered App schema: %w", err)
	}
	if err := kernel.requireCanonicalRegistrationSchema(ctx); err != nil {
		return err
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS current_host_binding (
			host_install_id TEXT NOT NULL,
			local_os_user_scope TEXT NOT NULL,
			registration_handle TEXT NOT NULL,
			binding_slot TEXT NOT NULL DEFAULT '',
			project_root TEXT NOT NULL,
			manifest_path TEXT NOT NULL,
			host_executable_digest TEXT NOT NULL,
			payload_root_digest TEXT NOT NULL,
			created_unix_nano INTEGER NOT NULL,
			updated_unix_nano INTEGER NOT NULL,
			PRIMARY KEY(host_install_id, local_os_user_scope, registration_handle),
			FOREIGN KEY(registration_handle) REFERENCES canonical_registration(registration_handle)
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS current_host_binding_slot
			ON current_host_binding(host_install_id, local_os_user_scope, binding_slot)
			WHERE binding_slot <> ''`,
		`CREATE TRIGGER IF NOT EXISTS canonical_registration_identity_immutable
		BEFORE UPDATE ON canonical_registration
		WHEN OLD.registration_handle <> NEW.registration_handle
		  OR OLD.registered_app_subject <> NEW.registered_app_subject
		  OR OLD.source_class <> NEW.source_class
		  OR OLD.source_ref <> NEW.source_ref
		  OR OLD.app_id <> NEW.app_id
		  OR OLD.created_unix_nano <> NEW.created_unix_nano
		BEGIN SELECT RAISE(ABORT, 'registered App canonical identity is immutable'); END`,
		`CREATE TRIGGER IF NOT EXISTS canonical_registration_no_reactivation
		BEFORE UPDATE OF state ON canonical_registration
		WHEN OLD.state = 'tombstoned' AND NEW.state <> 'tombstoned'
		BEGIN SELECT RAISE(ABORT, 'registered App subject cannot be reactivated'); END`,
		`CREATE TRIGGER IF NOT EXISTS canonical_registration_no_delete
		BEFORE DELETE ON canonical_registration
		BEGIN SELECT RAISE(ABORT, 'registered App subjects are permanently retained'); END`,
		`CREATE TRIGGER IF NOT EXISTS current_host_binding_identity_immutable
		BEFORE UPDATE ON current_host_binding
		WHEN OLD.host_install_id <> NEW.host_install_id
		  OR OLD.local_os_user_scope <> NEW.local_os_user_scope
		  OR OLD.registration_handle <> NEW.registration_handle
		  OR OLD.created_unix_nano <> NEW.created_unix_nano
		BEGIN SELECT RAISE(ABORT, 'registered App current-host binding identity is immutable'); END`,
		`CREATE TRIGGER IF NOT EXISTS current_host_binding_no_delete
		BEFORE DELETE ON current_host_binding
		BEGIN SELECT RAISE(ABORT, 'registered App current-host bindings are retained'); END`,
	}
	statements = append(statements, packageLifecycleSchemaStatements...)
	for _, statement := range statements {
		if _, err := kernel.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize registered App schema: %w", err)
		}
	}
	if err := kernel.requirePackageLifecycleSchema(ctx); err != nil {
		return err
	}
	return nil
}

func (kernel *Kernel) Close() error {
	if kernel == nil || kernel.db == nil {
		return nil
	}
	return kernel.db.Close()
}

func (kernel *Kernel) LocalOSUserAnchor() string {
	if kernel == nil {
		return ""
	}
	return kernel.anchor
}

func (kernel *Kernel) Registrations() *RegistrationStore {
	if kernel == nil {
		return nil
	}
	return kernel.registrations
}

func (kernel *Kernel) SecurityKeys() *KeyDeriver {
	if kernel == nil {
		return nil
	}
	return kernel.keys
}

func (kernel *Kernel) PackageLifecycle() *PackageLifecycleStore {
	if kernel == nil {
		return nil
	}
	return kernel.packageLifecycle
}

func (kernel *Kernel) nextIdentifier(prefix string, exists func(string) (bool, error)) (string, error) {
	for attempt := 0; attempt < identifierAllocationAttempts; attempt++ {
		entropy := make([]byte, 32)
		if _, err := io.ReadFull(kernel.random, entropy); err != nil {
			return "", fmt.Errorf("allocate registered App identifier: %w", err)
		}
		allZero := true
		for _, value := range entropy {
			if value != 0 {
				allZero = false
				break
			}
		}
		if allZero {
			continue
		}
		candidate := prefix + base64.RawURLEncoding.EncodeToString(entropy)
		found, err := exists(candidate)
		if err != nil {
			return "", err
		}
		if !found {
			return candidate, nil
		}
	}
	return "", ErrRandomExhausted
}

func identifierExistsTx(ctx context.Context, tx *sql.Tx, column, candidate string) (bool, error) {
	var found int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM canonical_registration WHERE `+column+` = ?`, candidate).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (kernel *Kernel) commitTransaction(tx *sql.Tx) error {
	if kernel.beforeCommit != nil {
		if err := kernel.beforeCommit(); err != nil {
			return err
		}
	}
	return tx.Commit()
}
