package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	_ "modernc.org/sqlite"
)

const (
	InstalledLaunchTicketTTL = 30 * time.Second
	InstalledProcessBindTTL  = 10 * time.Second
	installedSessionTTL      = time.Hour
)

var (
	ErrInstalledLaunchMismatch = errors.New("installed launch binding mismatch")
	ErrInstalledLaunchReplay   = errors.New("installed launch already consumed or revoked")
	ErrInstalledLaunchExpired  = errors.New("installed launch expired")
	ErrInstalledSessionRevoked = errors.New("installed session expired or revoked")
)

type InstalledLaunchIssue struct {
	AppID             string
	ReleaseDigest     protectedlocal.Identifier
	AccountGeneration uint64
}

type InstalledLaunchTicket struct {
	LaunchID     protectedlocal.Identifier
	BindDeadline time.Time
}

type InstalledLaunchBinding struct {
	LaunchID     protectedlocal.Identifier
	BindDeadline time.Time
	Process      InstalledLaunchProcess
}

type InstalledLaunchProcess struct {
	LaunchID          protectedlocal.Identifier
	PID               uint32
	CreationMarker    string
	ReleaseDigest     protectedlocal.Identifier
	AccountGeneration uint64
}

type InstalledSessionProjection struct {
	SessionID         protectedlocal.Identifier
	SessionProof      protectedlocal.Identifier
	ExpiresAt         time.Time
	AppID             string
	ReleaseDigest     protectedlocal.Identifier
	AccountGeneration uint64
	RuntimeBootEpoch  protectedlocal.Identifier
}

type InstalledSessionBinding struct {
	SessionID         protectedlocal.Identifier
	SessionProof      protectedlocal.Identifier
	ReleaseDigest     protectedlocal.Identifier
	PID               uint32
	CreationMarker    string
	AccountGeneration uint64
	RuntimeBootEpoch  protectedlocal.Identifier
}

type InstalledLaunchStore struct {
	db        *sql.DB
	bootEpoch protectedlocal.Identifier
	random    io.Reader
	now       func() time.Time
	mu        sync.Mutex
}

func (store *InstalledLaunchStore) BootEpoch() protectedlocal.Identifier {
	if store == nil {
		return protectedlocal.Identifier{}
	}
	return store.bootEpoch
}

func OpenInstalledLaunchStore(path string, bootEpoch protectedlocal.Identifier) (*InstalledLaunchStore, error) {
	if !filepath.IsAbs(path) || filepath.Base(path) != "installed-launch.db" || bootEpoch == (protectedlocal.Identifier{}) {
		return nil, fmt.Errorf("installed launch store requires fixed absolute path and boot epoch")
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(path))
	if err != nil {
		return nil, fmt.Errorf("open installed launch store: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &InstalledLaunchStore{db: db, bootEpoch: bootEpoch, random: rand.Reader, now: time.Now}
	if err := store.initialize(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (store *InstalledLaunchStore) initialize(ctx context.Context) error {
	for _, statement := range []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA synchronous = FULL`,
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`CREATE TABLE IF NOT EXISTS installed_launch_ticket (
			launch_id BLOB PRIMARY KEY CHECK(length(launch_id) = 32),
			app_id TEXT NOT NULL,
			release_digest BLOB NOT NULL CHECK(length(release_digest) = 32),
			account_generation INTEGER NOT NULL CHECK(account_generation > 0),
			runtime_boot_epoch BLOB NOT NULL CHECK(length(runtime_boot_epoch) = 32),
			issued_unix_nano INTEGER NOT NULL,
			expires_unix_nano INTEGER NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('pending','process_bound','consumed','cancelled','expired','revoked')),
			process_id INTEGER,
			process_creation_marker TEXT,
			bind_deadline_unix_nano INTEGER,
			consumed_unix_nano INTEGER,
			revoked_unix_nano INTEGER
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS installed_launch_one_pending ON installed_launch_ticket(app_id, account_generation) WHERE status IN ('pending','process_bound')`,
		`CREATE TABLE IF NOT EXISTS installed_app_session (
			session_id BLOB PRIMARY KEY CHECK(length(session_id) = 32),
			session_proof_hash BLOB NOT NULL CHECK(length(session_proof_hash) = 32),
			launch_id BLOB NOT NULL UNIQUE REFERENCES installed_launch_ticket(launch_id),
			app_id TEXT NOT NULL,
			release_digest BLOB NOT NULL CHECK(length(release_digest) = 32),
			account_generation INTEGER NOT NULL CHECK(account_generation > 0),
			runtime_boot_epoch BLOB NOT NULL CHECK(length(runtime_boot_epoch) = 32),
			process_id INTEGER NOT NULL CHECK(process_id > 0),
			process_creation_marker TEXT NOT NULL,
			issued_unix_nano INTEGER NOT NULL,
			expires_unix_nano INTEGER NOT NULL,
			revoked_unix_nano INTEGER
		)`,
		`UPDATE installed_launch_ticket SET status = 'revoked', revoked_unix_nano = ? WHERE status IN ('pending','process_bound') AND runtime_boot_epoch <> ?`,
		`UPDATE installed_app_session SET revoked_unix_nano = ? WHERE revoked_unix_nano IS NULL AND runtime_boot_epoch <> ?`,
	} {
		var err error
		if strings.Contains(statement, "runtime_boot_epoch <> ?") {
			_, err = store.db.ExecContext(ctx, statement, time.Now().UTC().UnixNano(), store.bootEpoch[:])
		} else {
			_, err = store.db.ExecContext(ctx, statement)
		}
		if err != nil {
			return fmt.Errorf("initialize installed launch store: %w", err)
		}
	}
	return nil
}

func (store *InstalledLaunchStore) Issue(ctx context.Context, input InstalledLaunchIssue) (InstalledLaunchTicket, error) {
	if store == nil || store.db == nil || strings.TrimSpace(input.AppID) == "" || input.AppID != strings.TrimSpace(input.AppID) || input.ReleaseDigest == (protectedlocal.Identifier{}) || input.AccountGeneration == 0 {
		return InstalledLaunchTicket{}, ErrInstalledLaunchMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	now := store.now().UTC()
	launchID, err := readInstalledIdentifier(store.random)
	if err != nil {
		return InstalledLaunchTicket{}, err
	}
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return InstalledLaunchTicket{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE installed_launch_ticket SET status = 'cancelled', revoked_unix_nano = ? WHERE app_id = ? AND account_generation = ? AND status IN ('pending','process_bound')`, now.UnixNano(), input.AppID, input.AccountGeneration); err != nil {
		return InstalledLaunchTicket{}, err
	}
	deadline := now.Add(InstalledLaunchTicketTTL)
	if _, err := tx.ExecContext(ctx, `INSERT INTO installed_launch_ticket(launch_id, app_id, release_digest, account_generation, runtime_boot_epoch, issued_unix_nano, expires_unix_nano, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`, launchID[:], input.AppID, input.ReleaseDigest[:], input.AccountGeneration, store.bootEpoch[:], now.UnixNano(), deadline.UnixNano()); err != nil {
		return InstalledLaunchTicket{}, err
	}
	if err := tx.Commit(); err != nil {
		return InstalledLaunchTicket{}, err
	}
	return InstalledLaunchTicket{LaunchID: launchID, BindDeadline: deadline}, nil
}

func (store *InstalledLaunchStore) BindProcess(ctx context.Context, input InstalledLaunchProcess) (InstalledLaunchBinding, error) {
	if store == nil || store.db == nil || input.LaunchID == (protectedlocal.Identifier{}) || input.PID == 0 || strings.TrimSpace(input.CreationMarker) == "" || input.CreationMarker != strings.TrimSpace(input.CreationMarker) || input.ReleaseDigest == (protectedlocal.Identifier{}) || input.AccountGeneration == 0 {
		return InstalledLaunchBinding{}, ErrInstalledLaunchMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	now := store.now().UTC()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return InstalledLaunchBinding{}, err
	}
	defer tx.Rollback()
	var status string
	var releaseDigest, bootEpoch []byte
	var accountGeneration uint64
	var expiresAt int64
	err = tx.QueryRowContext(ctx, `SELECT release_digest, account_generation, runtime_boot_epoch, expires_unix_nano, status FROM installed_launch_ticket WHERE launch_id = ?`, input.LaunchID[:]).Scan(&releaseDigest, &accountGeneration, &bootEpoch, &expiresAt, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return InstalledLaunchBinding{}, ErrInstalledLaunchMismatch
	}
	if err != nil {
		return InstalledLaunchBinding{}, err
	}
	if status != "pending" {
		return InstalledLaunchBinding{}, ErrInstalledLaunchReplay
	}
	if !now.Before(time.Unix(0, expiresAt)) {
		if _, err := tx.ExecContext(ctx, `UPDATE installed_launch_ticket SET status = 'expired', revoked_unix_nano = ? WHERE launch_id = ? AND status = 'pending'`, now.UnixNano(), input.LaunchID[:]); err != nil {
			return InstalledLaunchBinding{}, err
		}
		if err := tx.Commit(); err != nil {
			return InstalledLaunchBinding{}, err
		}
		return InstalledLaunchBinding{}, ErrInstalledLaunchExpired
	}
	if accountGeneration != input.AccountGeneration || !equalInstalledIdentifier(releaseDigest, input.ReleaseDigest) || !equalInstalledIdentifier(bootEpoch, store.bootEpoch) {
		return InstalledLaunchBinding{}, ErrInstalledLaunchMismatch
	}
	bindDeadline := now.Add(InstalledProcessBindTTL)
	if _, err := tx.ExecContext(ctx, `UPDATE installed_launch_ticket SET status = 'process_bound', process_id = ?, process_creation_marker = ?, bind_deadline_unix_nano = ? WHERE launch_id = ? AND status = 'pending'`, input.PID, input.CreationMarker, bindDeadline.UnixNano(), input.LaunchID[:]); err != nil {
		return InstalledLaunchBinding{}, err
	}
	if err := tx.Commit(); err != nil {
		return InstalledLaunchBinding{}, err
	}
	return InstalledLaunchBinding{LaunchID: input.LaunchID, BindDeadline: bindDeadline, Process: input}, nil
}

func (store *InstalledLaunchStore) Consume(ctx context.Context, input InstalledLaunchProcess) (InstalledSessionProjection, error) {
	if store == nil || store.db == nil || input.LaunchID == (protectedlocal.Identifier{}) || input.PID == 0 || strings.TrimSpace(input.CreationMarker) == "" || input.CreationMarker != strings.TrimSpace(input.CreationMarker) || input.ReleaseDigest == (protectedlocal.Identifier{}) || input.AccountGeneration == 0 {
		return InstalledSessionProjection{}, ErrInstalledLaunchMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	now := store.now().UTC()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return InstalledSessionProjection{}, err
	}
	defer tx.Rollback()
	var appID, status string
	var releaseDigest, bootEpoch []byte
	var accountGeneration uint64
	var expires int64
	var bindDeadline, processID sql.NullInt64
	var creationMarker sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT app_id, release_digest, account_generation, runtime_boot_epoch, expires_unix_nano, bind_deadline_unix_nano, process_id, process_creation_marker, status FROM installed_launch_ticket WHERE launch_id = ?`, input.LaunchID[:]).Scan(&appID, &releaseDigest, &accountGeneration, &bootEpoch, &expires, &bindDeadline, &processID, &creationMarker, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return InstalledSessionProjection{}, ErrInstalledLaunchMismatch
	}
	if err != nil {
		return InstalledSessionProjection{}, err
	}
	if status != "process_bound" {
		return InstalledSessionProjection{}, ErrInstalledLaunchReplay
	}
	if !bindDeadline.Valid || !processID.Valid || !creationMarker.Valid {
		return InstalledSessionProjection{}, ErrInstalledLaunchMismatch
	}
	if now.UnixNano() >= expires || now.UnixNano() >= bindDeadline.Int64 {
		if _, err := tx.ExecContext(ctx, `UPDATE installed_launch_ticket SET status = 'expired', revoked_unix_nano = ? WHERE launch_id = ? AND status = 'process_bound'`, now.UnixNano(), input.LaunchID[:]); err != nil {
			return InstalledSessionProjection{}, err
		}
		if err := tx.Commit(); err != nil {
			return InstalledSessionProjection{}, err
		}
		return InstalledSessionProjection{}, ErrInstalledLaunchExpired
	}
	if accountGeneration != input.AccountGeneration || processID.Int64 != int64(input.PID) || creationMarker.String != input.CreationMarker || !equalInstalledIdentifier(releaseDigest, input.ReleaseDigest) || !equalInstalledIdentifier(bootEpoch, store.bootEpoch) {
		return InstalledSessionProjection{}, ErrInstalledLaunchMismatch
	}
	sessionID, err := readInstalledIdentifier(store.random)
	if err != nil {
		return InstalledSessionProjection{}, err
	}
	sessionProof, err := readInstalledIdentifier(store.random)
	if err != nil {
		return InstalledSessionProjection{}, err
	}
	proofHash := sha256.Sum256(sessionProof[:])
	sessionExpiry := now.Add(installedSessionTTL)
	if _, err := tx.ExecContext(ctx, `UPDATE installed_launch_ticket SET status = 'consumed', consumed_unix_nano = ? WHERE launch_id = ? AND status = 'process_bound'`, now.UnixNano(), input.LaunchID[:]); err != nil {
		return InstalledSessionProjection{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO installed_app_session(session_id, session_proof_hash, launch_id, app_id, release_digest, account_generation, runtime_boot_epoch, process_id, process_creation_marker, issued_unix_nano, expires_unix_nano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, sessionID[:], proofHash[:], input.LaunchID[:], appID, input.ReleaseDigest[:], input.AccountGeneration, store.bootEpoch[:], input.PID, input.CreationMarker, now.UnixNano(), sessionExpiry.UnixNano()); err != nil {
		return InstalledSessionProjection{}, err
	}
	if err := tx.Commit(); err != nil {
		return InstalledSessionProjection{}, err
	}
	return InstalledSessionProjection{SessionID: sessionID, SessionProof: sessionProof, ExpiresAt: sessionExpiry, AppID: appID, ReleaseDigest: input.ReleaseDigest, AccountGeneration: input.AccountGeneration, RuntimeBootEpoch: store.bootEpoch}, nil
}

func (store *InstalledLaunchStore) RevokeAccountGeneration(ctx context.Context, generation uint64) error {
	if store == nil || store.db == nil || generation == 0 {
		return ErrInstalledLaunchMismatch
	}
	now := store.now().UTC().UnixNano()
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE installed_launch_ticket SET status = 'revoked', revoked_unix_nano = ? WHERE account_generation = ? AND status IN ('pending','process_bound')`, now, generation); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE installed_app_session SET revoked_unix_nano = ? WHERE account_generation = ? AND revoked_unix_nano IS NULL`, now, generation); err != nil {
		return err
	}
	return tx.Commit()
}

func (store *InstalledLaunchStore) RevokeSession(ctx context.Context, sessionID protectedlocal.Identifier) error {
	if store == nil || store.db == nil || sessionID == (protectedlocal.Identifier{}) {
		return ErrInstalledLaunchMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	_, err := store.db.ExecContext(ctx, `UPDATE installed_app_session SET revoked_unix_nano = ? WHERE session_id = ? AND revoked_unix_nano IS NULL`, store.now().UTC().UnixNano(), sessionID[:])
	return err
}

func (store *InstalledLaunchStore) RevokeLaunch(ctx context.Context, launchID protectedlocal.Identifier) error {
	if store == nil || store.db == nil || launchID == (protectedlocal.Identifier{}) {
		return ErrInstalledLaunchMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	_, err := store.db.ExecContext(ctx, `UPDATE installed_launch_ticket SET status = 'revoked', revoked_unix_nano = ? WHERE launch_id = ? AND status IN ('pending','process_bound')`, store.now().UTC().UnixNano(), launchID[:])
	return err
}

func (store *InstalledLaunchStore) ValidateSession(ctx context.Context, binding InstalledSessionBinding) (InstalledSessionProjection, error) {
	if store == nil || store.db == nil || binding.SessionID == (protectedlocal.Identifier{}) || binding.SessionProof == (protectedlocal.Identifier{}) ||
		binding.ReleaseDigest == (protectedlocal.Identifier{}) ||
		binding.PID == 0 || strings.TrimSpace(binding.CreationMarker) == "" || binding.CreationMarker != strings.TrimSpace(binding.CreationMarker) ||
		binding.AccountGeneration == 0 || binding.RuntimeBootEpoch == (protectedlocal.Identifier{}) {
		return InstalledSessionProjection{}, ErrInstalledLaunchMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	var proofHash, releaseDigest, bootEpoch []byte
	var appID, creationMarker string
	var processID uint32
	var accountGeneration uint64
	var expiresAt int64
	var revokedAt sql.NullInt64
	err := store.db.QueryRowContext(ctx, `SELECT session_proof_hash, app_id, release_digest, account_generation, runtime_boot_epoch, process_id, process_creation_marker, expires_unix_nano, revoked_unix_nano FROM installed_app_session WHERE session_id = ?`, binding.SessionID[:]).Scan(
		&proofHash, &appID, &releaseDigest, &accountGeneration, &bootEpoch, &processID, &creationMarker, &expiresAt, &revokedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return InstalledSessionProjection{}, ErrInstalledLaunchMismatch
	}
	if err != nil {
		return InstalledSessionProjection{}, err
	}
	if revokedAt.Valid || !store.now().UTC().Before(time.Unix(0, expiresAt)) {
		return InstalledSessionProjection{}, ErrInstalledSessionRevoked
	}
	expectedProofHash := sha256.Sum256(binding.SessionProof[:])
	if accountGeneration != binding.AccountGeneration {
		return InstalledSessionProjection{}, ErrInstalledSessionRevoked
	}
	if subtle.ConstantTimeCompare(proofHash, expectedProofHash[:]) != 1 || processID != binding.PID || creationMarker != binding.CreationMarker ||
		!equalInstalledIdentifier(releaseDigest, binding.ReleaseDigest) ||
		!equalInstalledIdentifier(bootEpoch, binding.RuntimeBootEpoch) || binding.RuntimeBootEpoch != store.bootEpoch {
		return InstalledSessionProjection{}, ErrInstalledLaunchMismatch
	}
	var resolvedRelease, resolvedBoot protectedlocal.Identifier
	copy(resolvedRelease[:], releaseDigest)
	copy(resolvedBoot[:], bootEpoch)
	return InstalledSessionProjection{
		SessionID:         binding.SessionID,
		ExpiresAt:         time.Unix(0, expiresAt).UTC(),
		AppID:             appID,
		ReleaseDigest:     resolvedRelease,
		AccountGeneration: accountGeneration,
		RuntimeBootEpoch:  resolvedBoot,
	}, nil
}

func (store *InstalledLaunchStore) Close() error {
	if store == nil || store.db == nil {
		return nil
	}
	return store.db.Close()
}

func readInstalledIdentifier(random io.Reader) (protectedlocal.Identifier, error) {
	if random == nil {
		random = rand.Reader
	}
	var value protectedlocal.Identifier
	if _, err := io.ReadFull(random, value[:]); err != nil {
		return value, err
	}
	if value == (protectedlocal.Identifier{}) {
		return value, fmt.Errorf("generated all-zero installed identifier")
	}
	return value, nil
}

func equalInstalledIdentifier(encoded []byte, expected protectedlocal.Identifier) bool {
	if len(encoded) != len(expected) {
		return false
	}
	var observed protectedlocal.Identifier
	copy(observed[:], encoded)
	return observed == expected
}
