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

// VerifiedLocalOSUserIdentity is deliberately constructible only through a
// strict platform validator. Callers must source its input from the protected
// transport's kernel-verified peer identity, never request data.
type VerifiedLocalOSUserIdentity struct {
	canonical string
}

func (identity VerifiedLocalOSUserIdentity) LocalOSUserAnchor() (string, error) {
	if identity.canonical == "" {
		return "", fmt.Errorf("%w: empty verified local OS-user identity", ErrInvalidArgument)
	}
	digest := sha256.Sum256([]byte("nimi.local-os-user-anchor.v1\x00" + identity.canonical))
	return "loua_v1_" + base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

type Options struct {
	Random io.Reader
	Now    func() time.Time
}

// Kernel owns one SQLite file bound to one local OS-user anchor. It is not
// wired into the Runtime daemon in the private-preparation phase.
type Kernel struct {
	db     *sql.DB
	anchor string
	random io.Reader
	now    func() time.Time
	mu     sync.Mutex

	principals *PrincipalStore
	records    *RecordStore
	keys       *KeyDeriver
}

func OpenSQLite(ctx context.Context, databasePath string, identity VerifiedLocalOSUserIdentity, options Options) (*Kernel, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	trimmedPath := strings.TrimSpace(databasePath)
	if trimmedPath == "" || trimmedPath != databasePath {
		return nil, fmt.Errorf("%w: sqlite path", ErrInvalidArgument)
	}
	absolutePath, err := filepath.Abs(filepath.Clean(trimmedPath))
	if err != nil {
		return nil, fmt.Errorf("resolve local-app sqlite path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o700); err != nil {
		return nil, fmt.Errorf("create local-app sqlite directory: %w", err)
	}
	anchor, err := identity.LocalOSUserAnchor()
	if err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.ToSlash(absolutePath) + "?_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open local-app sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	kernel := &Kernel{db: db, anchor: anchor, random: options.Random, now: options.Now}
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
	kernel.principals = &PrincipalStore{kernel: kernel}
	kernel.records = &RecordStore{kernel: kernel}
	kernel.keys = &KeyDeriver{kernel: kernel}
	return kernel, nil
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

func (kernel *Kernel) Principals() *PrincipalStore {
	if kernel == nil {
		return nil
	}
	return kernel.principals
}

func (kernel *Kernel) Records() *RecordStore {
	if kernel == nil {
		return nil
	}
	return kernel.records
}

func (kernel *Kernel) SecurityKeys() *KeyDeriver {
	if kernel == nil {
		return nil
	}
	return kernel.keys
}

func (kernel *Kernel) initialize(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS local_app_partition (
			singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
			local_os_user_anchor TEXT NOT NULL UNIQUE,
			bound_unix_nano INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS local_app_principals (
			local_os_user_anchor TEXT NOT NULL,
			local_app_principal_id TEXT NOT NULL,
			principal_kind TEXT NOT NULL CHECK(principal_kind IN ('immutable','development')),
			app_id TEXT NOT NULL,
			immutable_lineage_id TEXT,
			development_authorization_id TEXT,
			canonical_project_file_id TEXT,
			state TEXT NOT NULL CHECK(state IN ('active','tombstoned')),
			created_unix_nano INTEGER NOT NULL,
			tombstoned_unix_nano INTEGER,
			PRIMARY KEY(local_os_user_anchor, local_app_principal_id),
			UNIQUE(local_app_principal_id),
			CHECK(
				(principal_kind = 'immutable' AND immutable_lineage_id IS NOT NULL AND development_authorization_id IS NULL AND canonical_project_file_id IS NULL) OR
				(principal_kind = 'development' AND immutable_lineage_id IS NULL AND development_authorization_id IS NOT NULL AND canonical_project_file_id IS NOT NULL)
			),
			CHECK((state = 'active' AND tombstoned_unix_nano IS NULL) OR (state = 'tombstoned' AND tombstoned_unix_nano IS NOT NULL))
		)`,
		`CREATE TABLE IF NOT EXISTS local_app_records (
			local_os_user_anchor TEXT NOT NULL,
			local_app_record_id TEXT NOT NULL,
			local_app_principal_id TEXT NOT NULL,
			trust_class TEXT NOT NULL CHECK(trust_class IN ('verified','user_imported','local_development')),
			provenance_attestation_refs_json TEXT NOT NULL,
			provenance_revision INTEGER NOT NULL CHECK(provenance_revision > 0),
			active_release_or_project_identity_ref TEXT NOT NULL,
			install_or_project_generation INTEGER NOT NULL CHECK(install_or_project_generation > 0),
			active_capability_fingerprint TEXT NOT NULL,
			execution_profile_ref TEXT NOT NULL,
			host_executable_digest TEXT NOT NULL,
			payload_root_digest TEXT NOT NULL,
			lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('active','dormant','revoked','security_revoked','removed')),
			PRIMARY KEY(local_os_user_anchor, local_app_record_id),
			UNIQUE(local_app_record_id),
			UNIQUE(local_os_user_anchor, local_app_principal_id),
			FOREIGN KEY(local_os_user_anchor, local_app_principal_id) REFERENCES local_app_principals(local_os_user_anchor, local_app_principal_id)
		)`,
		`CREATE TABLE IF NOT EXISTS local_app_provenance_invalidation_facts (
			sequence INTEGER PRIMARY KEY AUTOINCREMENT,
			local_os_user_anchor TEXT NOT NULL,
			local_app_principal_id TEXT NOT NULL,
			local_app_record_id TEXT NOT NULL,
			previous_revision INTEGER NOT NULL CHECK(previous_revision > 0),
			current_revision INTEGER NOT NULL CHECK(current_revision = previous_revision + 1),
			launch_leases_invalidated INTEGER NOT NULL CHECK(launch_leases_invalidated = 1),
			sessions_invalidated INTEGER NOT NULL CHECK(sessions_invalidated = 1),
			recorded_unix_nano INTEGER NOT NULL
		)`,
		`CREATE TRIGGER IF NOT EXISTS local_app_principal_identity_immutable
		BEFORE UPDATE ON local_app_principals
		WHEN OLD.local_os_user_anchor <> NEW.local_os_user_anchor
		  OR OLD.local_app_principal_id <> NEW.local_app_principal_id
		  OR OLD.principal_kind <> NEW.principal_kind
		  OR OLD.app_id <> NEW.app_id
		  OR COALESCE(OLD.immutable_lineage_id, '') <> COALESCE(NEW.immutable_lineage_id, '')
		  OR COALESCE(OLD.development_authorization_id, '') <> COALESCE(NEW.development_authorization_id, '')
		  OR COALESCE(OLD.canonical_project_file_id, '') <> COALESCE(NEW.canonical_project_file_id, '')
		  OR OLD.created_unix_nano <> NEW.created_unix_nano
		BEGIN SELECT RAISE(ABORT, 'local app principal identity is immutable'); END`,
		`CREATE TRIGGER IF NOT EXISTS local_app_principal_no_reactivation
		BEFORE UPDATE OF state ON local_app_principals
		WHEN OLD.state = 'tombstoned' AND NEW.state <> 'tombstoned'
		BEGIN SELECT RAISE(ABORT, 'local app principal cannot be reactivated'); END`,
		`CREATE TRIGGER IF NOT EXISTS local_app_principal_no_delete
		BEFORE DELETE ON local_app_principals
		BEGIN SELECT RAISE(ABORT, 'local app principal identifiers are permanently retained'); END`,
		`CREATE TRIGGER IF NOT EXISTS local_app_invalidation_fact_immutable_update
		BEFORE UPDATE ON local_app_provenance_invalidation_facts
		BEGIN SELECT RAISE(ABORT, 'local app invalidation fact is immutable'); END`,
		`CREATE TRIGGER IF NOT EXISTS local_app_invalidation_fact_immutable_delete
		BEFORE DELETE ON local_app_provenance_invalidation_facts
		BEGIN SELECT RAISE(ABORT, 'local app invalidation fact is immutable'); END`,
	}
	for _, statement := range statements {
		if _, err := kernel.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize local-app sqlite schema: %w", err)
		}
	}
	var duplicateAnchor string
	var duplicateAuthorization string
	var duplicateCount int
	err := kernel.db.QueryRowContext(ctx, `SELECT local_os_user_anchor, development_authorization_id, COUNT(*)
		FROM local_app_principals
		WHERE principal_kind = 'development' AND state = 'active'
		GROUP BY local_os_user_anchor, development_authorization_id
		HAVING COUNT(*) > 1 LIMIT 1`).Scan(&duplicateAnchor, &duplicateAuthorization, &duplicateCount)
	if err == nil {
		return fmt.Errorf("initialize local-app sqlite schema: operator repair required for %d active development principals on anchor %q authorization %q", duplicateCount, duplicateAnchor, duplicateAuthorization)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("preflight active development principal uniqueness: %w", err)
	}
	if _, err := kernel.db.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS local_app_active_development_authorization
		ON local_app_principals(local_os_user_anchor, development_authorization_id)
		WHERE principal_kind = 'development' AND state = 'active'`); err != nil {
		return fmt.Errorf("enforce active development principal uniqueness: %w", err)
	}
	now := kernel.now().UTC().UnixNano()
	if _, err := kernel.db.ExecContext(ctx, `INSERT INTO local_app_partition(singleton, local_os_user_anchor, bound_unix_nano) VALUES (1, ?, ?) ON CONFLICT(singleton) DO NOTHING`, kernel.anchor, now); err != nil {
		return fmt.Errorf("bind local-app OS-user partition: %w", err)
	}
	var existing string
	if err := kernel.db.QueryRowContext(ctx, `SELECT local_os_user_anchor FROM local_app_partition WHERE singleton = 1`).Scan(&existing); err != nil {
		return fmt.Errorf("read local-app OS-user partition: %w", err)
	}
	if existing != kernel.anchor {
		return fmt.Errorf("%w: data root is bound to a different verified SID", ErrPartitionMismatch)
	}
	return nil
}

func (kernel *Kernel) nextIdentifier(prefix string, exists func(string) (bool, error)) (string, error) {
	for attempt := 0; attempt < identifierAllocationAttempts; attempt++ {
		entropy := make([]byte, 32)
		if _, err := io.ReadFull(kernel.random, entropy); err != nil {
			return "", fmt.Errorf("allocate local-app identifier: %w", err)
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

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}
