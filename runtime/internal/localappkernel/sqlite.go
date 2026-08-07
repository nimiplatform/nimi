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

type VerifiedLocalOSUserIdentity struct{ canonical string }

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

type Kernel struct {
	db            *sql.DB
	anchor        string
	random        io.Reader
	now           func() time.Time
	mu            sync.Mutex
	registrations *RegistrationStore
	keys          *KeyDeriver
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
		return nil, fmt.Errorf("resolve registered App sqlite path: %w", err)
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
	kernel.registrations = &RegistrationStore{kernel: kernel}
	kernel.keys = &KeyDeriver{kernel: kernel}
	return kernel, nil
}

func (kernel *Kernel) initialize(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS registered_app_partition (
			singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
			local_os_user_anchor TEXT NOT NULL UNIQUE,
			bound_unix_nano INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS registered_app_records (
			local_os_user_anchor TEXT NOT NULL,
			registration_handle TEXT NOT NULL UNIQUE,
			registered_app_subject TEXT NOT NULL UNIQUE,
			app_id TEXT NOT NULL,
			display_name TEXT NOT NULL,
			source_class TEXT NOT NULL CHECK(source_class IN ('installed','local_import','development')),
			source_ref TEXT NOT NULL,
			project_root TEXT NOT NULL,
			manifest_path TEXT NOT NULL,
			shell_kind INTEGER NOT NULL CHECK(shell_kind > 0),
			raw_declaration_json TEXT NOT NULL,
			activated_domains_json TEXT NOT NULL,
			source_generation INTEGER NOT NULL CHECK(source_generation > 0),
			declaration_generation INTEGER NOT NULL CHECK(declaration_generation > 0),
			source_digest TEXT NOT NULL,
			declaration_digest TEXT NOT NULL,
			host_executable_digest TEXT NOT NULL,
			payload_root_digest TEXT NOT NULL,
			state TEXT NOT NULL CHECK(state IN ('active','tombstoned')),
			created_unix_nano INTEGER NOT NULL,
			updated_unix_nano INTEGER NOT NULL,
			tombstoned_unix_nano INTEGER,
			PRIMARY KEY(local_os_user_anchor, registration_handle),
			CHECK((state = 'active' AND tombstoned_unix_nano IS NULL) OR (state = 'tombstoned' AND tombstoned_unix_nano IS NOT NULL))
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS registered_app_active_source
			ON registered_app_records(local_os_user_anchor, source_class, source_ref)
			WHERE state = 'active'`,
		`CREATE TRIGGER IF NOT EXISTS registered_app_subject_immutable
		BEFORE UPDATE ON registered_app_records
		WHEN OLD.local_os_user_anchor <> NEW.local_os_user_anchor
		  OR OLD.registration_handle <> NEW.registration_handle
		  OR OLD.registered_app_subject <> NEW.registered_app_subject
		  OR OLD.source_class <> NEW.source_class
		  OR OLD.source_ref <> NEW.source_ref
		  OR OLD.app_id <> NEW.app_id
		  OR OLD.created_unix_nano <> NEW.created_unix_nano
		BEGIN SELECT RAISE(ABORT, 'registered App subject identity is immutable'); END`,
		`CREATE TRIGGER IF NOT EXISTS registered_app_no_reactivation
		BEFORE UPDATE OF state ON registered_app_records
		WHEN OLD.state = 'tombstoned' AND NEW.state <> 'tombstoned'
		BEGIN SELECT RAISE(ABORT, 'registered App subject cannot be reactivated'); END`,
		`CREATE TRIGGER IF NOT EXISTS registered_app_no_delete
		BEFORE DELETE ON registered_app_records
		BEGIN SELECT RAISE(ABORT, 'registered App subjects are permanently retained'); END`,
	}
	for _, statement := range statements {
		if _, err := kernel.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize registered App schema: %w", err)
		}
	}
	now := kernel.now().UTC().UnixNano()
	if _, err := kernel.db.ExecContext(ctx, `INSERT INTO registered_app_partition(singleton, local_os_user_anchor, bound_unix_nano) VALUES (1, ?, ?) ON CONFLICT(singleton) DO NOTHING`, kernel.anchor, now); err != nil {
		return fmt.Errorf("bind registered App OS-user partition: %w", err)
	}
	var existing string
	if err := kernel.db.QueryRowContext(ctx, `SELECT local_os_user_anchor FROM registered_app_partition WHERE singleton = 1`).Scan(&existing); err != nil {
		return fmt.Errorf("read registered App OS-user partition: %w", err)
	}
	if existing != kernel.anchor {
		return ErrPartitionMismatch
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

func identifierExists(ctx context.Context, db *sql.DB, column, candidate string) (bool, error) {
	var found int
	err := db.QueryRowContext(ctx, `SELECT 1 FROM registered_app_records WHERE `+column+` = ?`, candidate).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
