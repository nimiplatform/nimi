package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	_ "modernc.org/sqlite"
)

const (
	localDevelopmentAuthorizationActive  = "active"
	localDevelopmentAuthorizationDenied  = "denied"
	localDevelopmentAuthorizationRevoked = "revoked"
	localDevelopmentEvaluationTTL        = 5 * time.Minute
	localDevelopmentLaunchTTL            = 30 * time.Second
	localDevelopmentProcessBindTTL       = 10 * time.Second
	localDevelopmentSessionTTL           = 15 * time.Minute
)

var (
	errLocalDevelopmentInvalid           = errors.New("local-development authority input is invalid")
	errLocalDevelopmentEvaluationExpired = errors.New("local-development evaluation expired or consumed")
	errLocalDevelopmentAuthorization     = errors.New("local-development authorization is not active")
	errLocalDevelopmentProjectChanged    = errors.New("local-development project authority changed")
	errLocalDevelopmentLaunchMismatch    = errors.New("local-development launch binding mismatch")
	errLocalDevelopmentLaunchExpired     = errors.New("local-development launch expired")
	errLocalDevelopmentSessionRevoked    = errors.New("local-development session expired or revoked")
)

type localDevelopmentProjectSnapshot struct {
	AppID                 string
	DisplayName           string
	ProjectRoot           string
	ManifestPath          string
	ShellKind             runtimev1.LocalDevelopmentShellKind
	AccountID             string
	AccountGeneration     uint64
	Capabilities          []string
	CapabilityFingerprint protectedlocal.Identifier
}

type localDevelopmentEvaluation struct {
	EvaluationID  protectedlocal.Identifier
	Project       localDevelopmentProjectSnapshot
	RunID         protectedlocal.Identifier
	State         runtimev1.LocalDevelopmentAuthorizationState
	Authorization localDevelopmentAuthorization
	ExpiresAt     time.Time
}

type localDevelopmentAuthorization struct {
	ID         protectedlocal.Identifier
	Project    localDevelopmentProjectSnapshot
	RunID      protectedlocal.Identifier
	Decision   runtimev1.LocalDevelopmentDecision
	State      string
	Generation uint64
	ApprovedAt time.Time
	UpdatedAt  time.Time
}

type localDevelopmentStore struct {
	db        *sql.DB
	bootEpoch protectedlocal.Identifier
	random    io.Reader
	now       func() time.Time
	mu        sync.Mutex
}

// LocalDevelopmentStore is exported only for protected Runtime composition.
// Its mutation methods remain package-private so no app or SDK surface can
// issue authorization, launches, or technical sessions.
type LocalDevelopmentStore = localDevelopmentStore

func openLocalDevelopmentStore(path string, bootEpoch protectedlocal.Identifier) (*localDevelopmentStore, error) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if !filepath.IsAbs(cleaned) || filepath.Base(cleaned) != "local-development.db" || bootEpoch == (protectedlocal.Identifier{}) {
		return nil, fmt.Errorf("%w: fixed absolute local-development.db path and boot epoch are required", errLocalDevelopmentInvalid)
	}
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(cleaned))
	if err != nil {
		return nil, fmt.Errorf("open local-development store: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &localDevelopmentStore{db: db, bootEpoch: bootEpoch, random: rand.Reader, now: time.Now}
	if err := store.initialize(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (store *localDevelopmentStore) initialize(ctx context.Context) error {
	now := time.Now().UTC().UnixNano()
	statements := []struct {
		query string
		args  []any
	}{
		{query: `PRAGMA journal_mode = WAL`},
		{query: `PRAGMA synchronous = FULL`},
		{query: `PRAGMA foreign_keys = ON`},
		{query: `PRAGMA busy_timeout = 5000`},
		{query: `CREATE TABLE IF NOT EXISTS local_development_evaluation (
			evaluation_id BLOB PRIMARY KEY CHECK(length(evaluation_id) = 32),
			supervisor_run_id BLOB NOT NULL CHECK(length(supervisor_run_id) = 32),
			app_id TEXT NOT NULL, display_name TEXT NOT NULL, project_root TEXT NOT NULL,
			manifest_path TEXT NOT NULL, shell_kind INTEGER NOT NULL,
			account_id TEXT NOT NULL, account_generation INTEGER NOT NULL CHECK(account_generation > 0),
			capabilities_json TEXT NOT NULL, capability_fingerprint BLOB NOT NULL CHECK(length(capability_fingerprint) = 32),
			state TEXT NOT NULL CHECK(state IN ('pending','consumed','denied','expired')),
			issued_unix_nano INTEGER NOT NULL, expires_unix_nano INTEGER NOT NULL
		)`},
		{query: `CREATE TABLE IF NOT EXISTS local_development_authorization (
			authorization_id BLOB PRIMARY KEY CHECK(length(authorization_id) = 32),
			supervisor_run_id BLOB NOT NULL CHECK(length(supervisor_run_id) = 32),
			app_id TEXT NOT NULL, display_name TEXT NOT NULL, project_root TEXT NOT NULL,
			manifest_path TEXT NOT NULL, shell_kind INTEGER NOT NULL,
			account_id TEXT NOT NULL, approved_account_generation INTEGER NOT NULL CHECK(approved_account_generation > 0),
			capabilities_json TEXT NOT NULL, capability_fingerprint BLOB NOT NULL CHECK(length(capability_fingerprint) = 32),
			decision INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','denied','revoked')),
			authorization_generation INTEGER NOT NULL CHECK(authorization_generation > 0),
			approved_unix_nano INTEGER NOT NULL, updated_unix_nano INTEGER NOT NULL
		)`},
		{query: `CREATE INDEX IF NOT EXISTS local_development_authorization_project ON local_development_authorization(project_root, app_id, updated_unix_nano DESC)`},
		{query: `CREATE TABLE IF NOT EXISTS local_development_launch (
			launch_id BLOB PRIMARY KEY CHECK(length(launch_id) = 32),
			authorization_id BLOB NOT NULL REFERENCES local_development_authorization(authorization_id),
			supervisor_run_id BLOB NOT NULL CHECK(length(supervisor_run_id) = 32),
			app_id TEXT NOT NULL, project_root TEXT NOT NULL, manifest_path TEXT NOT NULL,
			shell_kind INTEGER NOT NULL, account_id TEXT NOT NULL,
			account_generation INTEGER NOT NULL CHECK(account_generation > 0),
			capability_fingerprint BLOB NOT NULL CHECK(length(capability_fingerprint) = 32),
			host_executable_path TEXT NOT NULL, renderer_origin TEXT NOT NULL,
			runtime_boot_epoch BLOB NOT NULL CHECK(length(runtime_boot_epoch) = 32),
			status TEXT NOT NULL CHECK(status IN ('pending','process_bound','consumed','revoked','expired')),
			issued_unix_nano INTEGER NOT NULL, expires_unix_nano INTEGER NOT NULL,
			bind_deadline_unix_nano INTEGER, process_json TEXT, revoked_unix_nano INTEGER
		)`},
		{query: `CREATE INDEX IF NOT EXISTS local_development_launch_run ON local_development_launch(authorization_id, supervisor_run_id, status)`},
		{query: `CREATE TABLE IF NOT EXISTS local_development_session (
			session_id BLOB PRIMARY KEY CHECK(length(session_id) = 32),
			session_proof_hash BLOB NOT NULL CHECK(length(session_proof_hash) = 32),
			launch_id BLOB NOT NULL REFERENCES local_development_launch(launch_id),
			authorization_id BLOB NOT NULL REFERENCES local_development_authorization(authorization_id),
			supervisor_run_id BLOB NOT NULL CHECK(length(supervisor_run_id) = 32),
			app_id TEXT NOT NULL, project_root TEXT NOT NULL,
			account_id TEXT NOT NULL, account_generation INTEGER NOT NULL CHECK(account_generation > 0),
			capability_fingerprint BLOB NOT NULL CHECK(length(capability_fingerprint) = 32),
			runtime_boot_epoch BLOB NOT NULL CHECK(length(runtime_boot_epoch) = 32),
			process_json TEXT NOT NULL, issued_unix_nano INTEGER NOT NULL,
			expires_unix_nano INTEGER NOT NULL, revoked_unix_nano INTEGER
		)`},
		{query: `UPDATE local_development_launch SET status = 'revoked', revoked_unix_nano = ? WHERE status IN ('pending','process_bound') AND runtime_boot_epoch <> ?`, args: []any{now, store.bootEpoch[:]}},
		{query: `UPDATE local_development_session SET revoked_unix_nano = ? WHERE revoked_unix_nano IS NULL AND runtime_boot_epoch <> ?`, args: []any{now, store.bootEpoch[:]}},
	}
	for _, statement := range statements {
		if _, err := store.db.ExecContext(ctx, statement.query, statement.args...); err != nil {
			return fmt.Errorf("initialize local-development store: %w", err)
		}
	}
	return nil
}

func (store *localDevelopmentStore) BootEpoch() protectedlocal.Identifier {
	if store == nil {
		return protectedlocal.Identifier{}
	}
	return store.bootEpoch
}

func (store *localDevelopmentStore) Close() error {
	if store == nil || store.db == nil {
		return nil
	}
	return store.db.Close()
}

func (store *localDevelopmentStore) Evaluate(ctx context.Context, project localDevelopmentProjectSnapshot, runID protectedlocal.Identifier) (localDevelopmentEvaluation, error) {
	if store == nil || store.db == nil || runID == (protectedlocal.Identifier{}) || validateLocalDevelopmentProject(project) != nil {
		return localDevelopmentEvaluation{}, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()

	active, found, err := store.latestProjectAuthorization(ctx, project.ProjectRoot, project.AppID)
	if err != nil {
		return localDevelopmentEvaluation{}, err
	}
	if found && active.State == localDevelopmentAuthorizationActive && localDevelopmentAuthorizationMatches(active, project, runID) {
		active.Project.AccountGeneration = project.AccountGeneration
		return localDevelopmentEvaluation{Project: project, RunID: runID, State: runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_ACTIVE, Authorization: active}, nil
	}

	evaluationID, err := store.readIdentifier()
	if err != nil {
		return localDevelopmentEvaluation{}, err
	}
	now := store.now().UTC()
	expiresAt := now.Add(localDevelopmentEvaluationTTL)
	capabilities, err := json.Marshal(project.Capabilities)
	if err != nil {
		return localDevelopmentEvaluation{}, err
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO local_development_evaluation(
		evaluation_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind,
		account_id, account_generation, capabilities_json, capability_fingerprint, state, issued_unix_nano, expires_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
		evaluationID[:], runID[:], project.AppID, project.DisplayName, project.ProjectRoot, project.ManifestPath, int32(project.ShellKind),
		project.AccountID, project.AccountGeneration, string(capabilities), project.CapabilityFingerprint[:], now.UnixNano(), expiresAt.UnixNano()); err != nil {
		return localDevelopmentEvaluation{}, err
	}
	state := runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_CONFIRMATION_REQUIRED
	if found {
		state = runtimev1.LocalDevelopmentAuthorizationState_LOCAL_DEVELOPMENT_AUTHORIZATION_STATE_REAPPROVAL_REQUIRED
	}
	return localDevelopmentEvaluation{EvaluationID: evaluationID, Project: project, RunID: runID, State: state, ExpiresAt: expiresAt}, nil
}

func (store *localDevelopmentStore) Decide(ctx context.Context, evaluationID protectedlocal.Identifier, decision runtimev1.LocalDevelopmentDecision) (localDevelopmentAuthorization, error) {
	if store == nil || store.db == nil || evaluationID == (protectedlocal.Identifier{}) || !validLocalDevelopmentDecision(decision) {
		return localDevelopmentAuthorization{}, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return localDevelopmentAuthorization{}, err
	}
	defer tx.Rollback()
	evaluation, state, err := scanLocalDevelopmentEvaluation(tx.QueryRowContext(ctx, `SELECT supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind, account_id, account_generation, capabilities_json, capability_fingerprint, state, expires_unix_nano FROM local_development_evaluation WHERE evaluation_id = ?`, evaluationID[:]))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return localDevelopmentAuthorization{}, errLocalDevelopmentEvaluationExpired
		}
		return localDevelopmentAuthorization{}, err
	}
	now := store.now().UTC()
	if state != "pending" || !now.Before(evaluation.ExpiresAt) {
		return localDevelopmentAuthorization{}, errLocalDevelopmentEvaluationExpired
	}
	authorizationID, err := store.readIdentifier()
	if err != nil {
		return localDevelopmentAuthorization{}, err
	}
	var generation uint64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(authorization_generation), 0) + 1 FROM local_development_authorization WHERE project_root = ? OR app_id = ?`, evaluation.Project.ProjectRoot, evaluation.Project.AppID).Scan(&generation); err != nil {
		return localDevelopmentAuthorization{}, err
	}
	authorizationState := localDevelopmentAuthorizationActive
	evaluationState := "consumed"
	if decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_DENY {
		authorizationState = localDevelopmentAuthorizationDenied
		evaluationState = "denied"
	}
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_authorization SET state = 'revoked', updated_unix_nano = ? WHERE state = 'active' AND (project_root = ? OR app_id = ?)`, now.UnixNano(), evaluation.Project.ProjectRoot, evaluation.Project.AppID); err != nil {
		return localDevelopmentAuthorization{}, err
	}
	capabilities, _ := json.Marshal(evaluation.Project.Capabilities)
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_development_authorization(
		authorization_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind,
		account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state,
		authorization_generation, approved_unix_nano, updated_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		authorizationID[:], evaluation.RunID[:], evaluation.Project.AppID, evaluation.Project.DisplayName, evaluation.Project.ProjectRoot,
		evaluation.Project.ManifestPath, int32(evaluation.Project.ShellKind), evaluation.Project.AccountID, evaluation.Project.AccountGeneration,
		string(capabilities), evaluation.Project.CapabilityFingerprint[:], int32(decision), authorizationState, generation, now.UnixNano(), now.UnixNano()); err != nil {
		return localDevelopmentAuthorization{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_evaluation SET state = ? WHERE evaluation_id = ? AND state = 'pending'`, evaluationState, evaluationID[:]); err != nil {
		return localDevelopmentAuthorization{}, err
	}
	if err := tx.Commit(); err != nil {
		return localDevelopmentAuthorization{}, err
	}
	return localDevelopmentAuthorization{ID: authorizationID, Project: evaluation.Project, RunID: evaluation.RunID, Decision: decision, State: authorizationState, Generation: generation, ApprovedAt: now, UpdatedAt: now}, nil
}

func (store *localDevelopmentStore) List(ctx context.Context) ([]localDevelopmentAuthorization, error) {
	if store == nil || store.db == nil {
		return nil, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	rows, err := store.db.QueryContext(ctx, `SELECT authorization_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind, account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state, authorization_generation, approved_unix_nano, updated_unix_nano FROM local_development_authorization ORDER BY updated_unix_nano DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var authorizations []localDevelopmentAuthorization
	for rows.Next() {
		authorization, err := scanLocalDevelopmentAuthorization(rows)
		if err != nil {
			return nil, err
		}
		authorizations = append(authorizations, authorization)
	}
	return authorizations, rows.Err()
}

func (store *localDevelopmentStore) GetAuthorization(ctx context.Context, authorizationID protectedlocal.Identifier) (localDevelopmentAuthorization, error) {
	if store == nil || store.db == nil || authorizationID == (protectedlocal.Identifier{}) {
		return localDevelopmentAuthorization{}, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	return scanLocalDevelopmentAuthorization(store.db.QueryRowContext(ctx, `SELECT authorization_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind, account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state, authorization_generation, approved_unix_nano, updated_unix_nano FROM local_development_authorization WHERE authorization_id = ?`, authorizationID[:]))
}

func (store *localDevelopmentStore) RevokeAuthorization(ctx context.Context, authorizationID protectedlocal.Identifier) (localDevelopmentAuthorization, error) {
	if store == nil || store.db == nil || authorizationID == (protectedlocal.Identifier{}) {
		return localDevelopmentAuthorization{}, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return localDevelopmentAuthorization{}, err
	}
	defer tx.Rollback()
	authorization, err := scanLocalDevelopmentAuthorization(tx.QueryRowContext(ctx, `SELECT authorization_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind, account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state, authorization_generation, approved_unix_nano, updated_unix_nano FROM local_development_authorization WHERE authorization_id = ?`, authorizationID[:]))
	if err != nil {
		return localDevelopmentAuthorization{}, err
	}
	now := store.now().UTC()
	if err := revokeLocalDevelopmentAuthorityTx(ctx, tx, authorizationID, nil, now); err != nil {
		return localDevelopmentAuthorization{}, err
	}
	if err := tx.Commit(); err != nil {
		return localDevelopmentAuthorization{}, err
	}
	authorization.State = localDevelopmentAuthorizationRevoked
	authorization.UpdatedAt = now
	return authorization, nil
}

func (store *localDevelopmentStore) RevokeAccountAuthority(ctx context.Context, accountID string) error {
	normalized := strings.TrimSpace(accountID)
	if store == nil || store.db == nil || normalized == "" || normalized != accountID {
		return errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := store.now().UTC().UnixNano()
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_authorization SET state = 'revoked', updated_unix_nano = ? WHERE account_id = ? AND state = 'active'`, now, normalized); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_launch SET status = 'revoked', revoked_unix_nano = ? WHERE account_id = ? AND status IN ('pending','process_bound')`, now, normalized); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_session SET revoked_unix_nano = ? WHERE account_id = ? AND revoked_unix_nano IS NULL`, now, normalized); err != nil {
		return err
	}
	return tx.Commit()
}

func localDevelopmentCapabilityFingerprint(capabilities []string) protectedlocal.Identifier {
	normalized := append([]string(nil), capabilities...)
	for index := range normalized {
		normalized[index] = strings.TrimSpace(normalized[index])
	}
	sort.Strings(normalized)
	hash := sha256.New()
	for _, capability := range normalized {
		_, _ = io.WriteString(hash, fmt.Sprintf("%d:%s", len(capability), capability))
	}
	var fingerprint protectedlocal.Identifier
	copy(fingerprint[:], hash.Sum(nil))
	return fingerprint
}

func validateLocalDevelopmentProject(project localDevelopmentProjectSnapshot) error {
	if strings.TrimSpace(project.AppID) == "" || project.AppID != strings.TrimSpace(project.AppID) || strings.TrimSpace(project.DisplayName) == "" ||
		!filepath.IsAbs(project.ProjectRoot) || filepath.Clean(project.ProjectRoot) != project.ProjectRoot || !filepath.IsAbs(project.ManifestPath) ||
		filepath.Clean(project.ManifestPath) != project.ManifestPath || !pathWithinLocalDevelopmentRoot(project.ProjectRoot, project.ManifestPath) ||
		(project.ShellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON && project.ShellKind != runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI) ||
		strings.TrimSpace(project.AccountID) == "" || project.AccountID != strings.TrimSpace(project.AccountID) || project.AccountGeneration == 0 ||
		len(project.Capabilities) == 0 || project.CapabilityFingerprint == (protectedlocal.Identifier{}) || project.CapabilityFingerprint != localDevelopmentCapabilityFingerprint(project.Capabilities) {
		return errLocalDevelopmentInvalid
	}
	seen := make(map[string]struct{}, len(project.Capabilities))
	for _, capability := range project.Capabilities {
		if capability == "" || capability != strings.TrimSpace(capability) {
			return errLocalDevelopmentInvalid
		}
		if _, duplicate := seen[capability]; duplicate {
			return errLocalDevelopmentInvalid
		}
		seen[capability] = struct{}{}
	}
	return nil
}

func validLocalDevelopmentDecision(decision runtimev1.LocalDevelopmentDecision) bool {
	switch decision {
	case runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_DENY,
		runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE,
		runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_REMEMBER_PROJECT:
		return true
	default:
		return false
	}
}

func localDevelopmentAuthorizationMatches(authorization localDevelopmentAuthorization, project localDevelopmentProjectSnapshot, runID protectedlocal.Identifier) bool {
	if authorization.State != localDevelopmentAuthorizationActive || !localDevelopmentProjectsMatch(authorization.Project, project) {
		return false
	}
	return authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_REMEMBER_PROJECT ||
		(authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE && authorization.RunID == runID)
}

func localDevelopmentProjectsMatch(approved localDevelopmentProjectSnapshot, current localDevelopmentProjectSnapshot) bool {
	return approved.AppID == current.AppID && approved.ProjectRoot == current.ProjectRoot && approved.ManifestPath == current.ManifestPath &&
		approved.ShellKind == current.ShellKind && approved.AccountID == current.AccountID &&
		approved.CapabilityFingerprint == current.CapabilityFingerprint
}

func (store *localDevelopmentStore) readIdentifier() (protectedlocal.Identifier, error) {
	var identifier protectedlocal.Identifier
	if store == nil || store.random == nil {
		return identifier, errLocalDevelopmentInvalid
	}
	if _, err := io.ReadFull(store.random, identifier[:]); err != nil {
		return identifier, err
	}
	if identifier == (protectedlocal.Identifier{}) {
		return identifier, errLocalDevelopmentInvalid
	}
	return identifier, nil
}

func pathWithinLocalDevelopmentRoot(root string, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}
