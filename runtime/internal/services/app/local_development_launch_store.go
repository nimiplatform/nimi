package app

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"net"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type localDevelopmentLaunchRequest struct {
	AuthorizationID    protectedlocal.Identifier
	SupervisorRunID    protectedlocal.Identifier
	Project            localDevelopmentProjectSnapshot
	ShellKind          runtimev1.LocalDevelopmentShellKind
	HostExecutable     string
	RendererOrigin     string
	PrincipalID        string
	RecordID           string
	ProvenanceRevision uint64
	ProjectGeneration  uint64
	PayloadDigest      string
	ExpectedHostDigest protectedlocal.Identifier
}

type localDevelopmentLaunchTicket struct {
	LaunchID     protectedlocal.Identifier
	BindDeadline time.Time
}

type localDevelopmentSessionProjection struct {
	LaunchID                         protectedlocal.Identifier
	SessionID                        protectedlocal.Identifier
	SessionProof                     protectedlocal.Identifier
	ExpiresAt                        time.Time
	AuthorizationID                  protectedlocal.Identifier
	AuthorizationGeneration          uint64
	SupervisorRunID                  protectedlocal.Identifier
	AppID                            string
	ProjectRoot                      string
	PermissionRequirementFingerprint protectedlocal.Identifier
	HostExecutableDigest             protectedlocal.Identifier
	AccountID                        string
	AccountGeneration                uint64
	RuntimeBootEpoch                 protectedlocal.Identifier
	Process                          protectedlocal.ProcessTuple
	PermissionRequirements           []localDevelopmentPermissionRequirement
	LocalAppPrincipalID              string
	LocalAppRecordID                 string
	ProvenanceRevision               uint64
	ProjectGeneration                uint64
	PayloadDigest                    string
}

type localDevelopmentSessionBinding struct {
	SessionID         protectedlocal.Identifier
	SessionProof      protectedlocal.Identifier
	Process           protectedlocal.ProcessTuple
	AccountGeneration uint64
	RuntimeBootEpoch  protectedlocal.Identifier
}

type localDevelopmentLaunchRow struct {
	LaunchID                         protectedlocal.Identifier
	AuthorizationID                  protectedlocal.Identifier
	SupervisorRunID                  protectedlocal.Identifier
	AppID                            string
	ProjectRoot                      string
	ManifestPath                     string
	ShellKind                        runtimev1.LocalDevelopmentShellKind
	AccountID                        string
	AccountGeneration                uint64
	PermissionRequirementFingerprint protectedlocal.Identifier
	HostExecutable                   string
	RendererOrigin                   string
	RuntimeBootEpoch                 protectedlocal.Identifier
	Status                           string
	ExpiresAt                        time.Time
	BindDeadline                     time.Time
	Process                          protectedlocal.ProcessTuple
	LocalAppPrincipalID              string
	LocalAppRecordID                 string
	ProvenanceRevision               uint64
	ProjectGeneration                uint64
	PayloadDigest                    string
	ExpectedHostDigest               protectedlocal.Identifier
}

const localDevelopmentLaunchSelect = `SELECT launch_id, authorization_id, supervisor_run_id, app_id, project_root, manifest_path, shell_kind, account_id, account_generation, capability_fingerprint,
	local_app_principal_id, local_app_record_id, provenance_revision, project_generation, payload_digest, expected_host_digest,
	host_executable_path, renderer_origin, runtime_boot_epoch, status, expires_unix_nano, bind_deadline_unix_nano, process_json FROM local_development_launch WHERE launch_id = ?`

func (store *localDevelopmentStore) PendingLaunchPolicy(ctx context.Context, launchID protectedlocal.Identifier) (protectedlocal.LocalDevelopmentProcessPolicy, error) {
	if store == nil || store.db == nil || launchID == (protectedlocal.Identifier{}) {
		return protectedlocal.LocalDevelopmentProcessPolicy{}, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	row, err := scanLocalDevelopmentLaunch(store.db.QueryRowContext(ctx, localDevelopmentLaunchSelect, launchID[:]))
	if err != nil || row.Status != "pending" || row.RuntimeBootEpoch != store.bootEpoch || !store.now().UTC().Before(row.ExpiresAt) {
		return protectedlocal.LocalDevelopmentProcessPolicy{}, errLocalDevelopmentLaunchExpired
	}
	policy := protectedlocal.LocalDevelopmentProcessPolicy{ProjectRoot: row.ProjectRoot, HostExecutablePath: row.HostExecutable}
	if row.ShellKind == runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON {
		policy.ProjectHostAliasPath = filepath.Join(row.ProjectRoot, "node_modules", "electron", "dist", "electron.exe")
	}
	return policy, nil
}

func (store *localDevelopmentStore) PrepareLaunch(ctx context.Context, request localDevelopmentLaunchRequest) (localDevelopmentLaunchTicket, error) {
	if store == nil || store.db == nil || request.AuthorizationID == (protectedlocal.Identifier{}) || request.SupervisorRunID == (protectedlocal.Identifier{}) ||
		request.ShellKind != request.Project.ShellKind || validateLocalDevelopmentProject(request.Project) != nil ||
		!validLocalDevelopmentHostPath(request.Project.ProjectRoot, request.HostExecutable, request.ShellKind) {
		return localDevelopmentLaunchTicket{}, errLocalDevelopmentInvalid
	}
	if strings.TrimSpace(request.PrincipalID) == "" || request.PrincipalID != strings.TrimSpace(request.PrincipalID) || strings.TrimSpace(request.RecordID) == "" || request.RecordID != strings.TrimSpace(request.RecordID) || request.ProvenanceRevision == 0 || request.ProjectGeneration == 0 || strings.TrimSpace(request.PayloadDigest) == "" || request.PayloadDigest != strings.TrimSpace(request.PayloadDigest) || request.ExpectedHostDigest == (protectedlocal.Identifier{}) {
		return localDevelopmentLaunchTicket{}, errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return localDevelopmentLaunchTicket{}, err
	}
	defer tx.Rollback()
	authorization, err := scanLocalDevelopmentAuthorization(tx.QueryRowContext(ctx, `SELECT authorization_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind, account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state, authorization_generation, approved_unix_nano, updated_unix_nano FROM local_development_authorization WHERE authorization_id = ?`, request.AuthorizationID[:]))
	if err != nil || authorization.State != localDevelopmentAuthorizationActive {
		return localDevelopmentLaunchTicket{}, errLocalDevelopmentAuthorization
	}
	if !localDevelopmentAuthorizationMatches(authorization, request.Project, request.SupervisorRunID) {
		return localDevelopmentLaunchTicket{}, errLocalDevelopmentProjectChanged
	}
	launchID, err := store.readIdentifier()
	if err != nil {
		return localDevelopmentLaunchTicket{}, err
	}
	now := store.now().UTC()
	expiresAt := now.Add(localDevelopmentLaunchTTL)
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_launch SET status = 'revoked', revoked_unix_nano = ? WHERE authorization_id = ? AND supervisor_run_id = ? AND status IN ('pending','process_bound')`, now.UnixNano(), request.AuthorizationID[:], request.SupervisorRunID[:]); err != nil {
		return localDevelopmentLaunchTicket{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_development_launch(
		launch_id, authorization_id, supervisor_run_id, app_id, project_root, manifest_path, shell_kind,
		account_id, account_generation, capability_fingerprint,
		local_app_principal_id, local_app_record_id, provenance_revision, project_generation, payload_digest, expected_host_digest,
		host_executable_path, renderer_origin,
		runtime_boot_epoch, status, issued_unix_nano, expires_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
		launchID[:], request.AuthorizationID[:], request.SupervisorRunID[:], request.Project.AppID, request.Project.ProjectRoot,
		request.Project.ManifestPath, int32(request.ShellKind), request.Project.AccountID, request.Project.AccountGeneration,
		request.Project.PermissionRequirementFingerprint[:], request.PrincipalID, request.RecordID, request.ProvenanceRevision, request.ProjectGeneration, request.PayloadDigest, request.ExpectedHostDigest[:],
		filepath.Clean(request.HostExecutable), request.RendererOrigin,
		store.bootEpoch[:], now.UnixNano(), expiresAt.UnixNano()); err != nil {
		return localDevelopmentLaunchTicket{}, err
	}
	if err := tx.Commit(); err != nil {
		return localDevelopmentLaunchTicket{}, err
	}
	return localDevelopmentLaunchTicket{LaunchID: launchID, BindDeadline: expiresAt}, nil
}

func (store *localDevelopmentStore) BindLaunch(ctx context.Context, launchID protectedlocal.Identifier, process protectedlocal.ProcessTuple) (time.Time, error) {
	encodedProcess, err := marshalLocalDevelopmentProcess(process)
	if store == nil || store.db == nil || launchID == (protectedlocal.Identifier{}) || err != nil {
		return time.Time{}, errLocalDevelopmentLaunchMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback()
	row, err := scanLocalDevelopmentLaunch(tx.QueryRowContext(ctx, localDevelopmentLaunchSelect, launchID[:]))
	if err != nil {
		return time.Time{}, errLocalDevelopmentLaunchMismatch
	}
	now := store.now().UTC()
	if row.Status != "pending" || row.RuntimeBootEpoch != store.bootEpoch || !now.Before(row.ExpiresAt) {
		return time.Time{}, errLocalDevelopmentLaunchExpired
	}
	if !sameLocalDevelopmentFile(row.HostExecutable, process.CanonicalExecutablePath) || process.ExecutableDigest != row.ExpectedHostDigest {
		return time.Time{}, errLocalDevelopmentLaunchMismatch
	}
	deadline := now.Add(localDevelopmentProcessBindTTL)
	result, err := tx.ExecContext(ctx, `UPDATE local_development_launch SET status = 'process_bound', bind_deadline_unix_nano = ?, process_json = ? WHERE launch_id = ? AND status = 'pending'`, deadline.UnixNano(), encodedProcess, launchID[:])
	if err != nil {
		return time.Time{}, err
	}
	if err := requireLocalDevelopmentRowsAffected(result); err != nil {
		return time.Time{}, err
	}
	if err := tx.Commit(); err != nil {
		return time.Time{}, err
	}
	return deadline, nil
}

func (store *localDevelopmentStore) ConsumeLaunch(ctx context.Context, launchID protectedlocal.Identifier, process protectedlocal.ProcessTuple) (localDevelopmentSessionProjection, error) {
	if store == nil || store.db == nil || launchID == (protectedlocal.Identifier{}) {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentLaunchMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	defer tx.Rollback()
	row, err := scanLocalDevelopmentLaunch(tx.QueryRowContext(ctx, localDevelopmentLaunchSelect, launchID[:]))
	if err != nil {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentLaunchMismatch
	}
	now := store.now().UTC()
	if row.Status != "process_bound" || row.RuntimeBootEpoch != store.bootEpoch || row.BindDeadline.IsZero() || !now.Before(row.ExpiresAt) || !now.Before(row.BindDeadline) {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentLaunchExpired
	}
	if row.Process != process {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentLaunchMismatch
	}
	authorization, err := scanLocalDevelopmentAuthorization(tx.QueryRowContext(ctx, `SELECT authorization_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind, account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state, authorization_generation, approved_unix_nano, updated_unix_nano FROM local_development_authorization WHERE authorization_id = ?`, row.AuthorizationID[:]))
	if err != nil || authorization.State != localDevelopmentAuthorizationActive || authorization.Project.AppID != row.AppID || authorization.Project.ProjectRoot != row.ProjectRoot || authorization.Project.PermissionRequirementFingerprint != row.PermissionRequirementFingerprint || authorization.Project.AccountID != row.AccountID ||
		(authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE && authorization.RunID != row.SupervisorRunID) {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentAuthorization
	}
	sessionID, err := store.readIdentifier()
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	sessionProof, err := store.readIdentifier()
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	proofHash := sha256.Sum256(sessionProof[:])
	expiresAt := now.Add(localDevelopmentSessionTTL)
	processJSON, err := marshalLocalDevelopmentProcess(process)
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE local_development_launch SET status = 'consumed' WHERE launch_id = ? AND status = 'process_bound'`, launchID[:])
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	if err := requireLocalDevelopmentRowsAffected(result); err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_development_session(
		session_id, session_proof_hash, launch_id, authorization_id, supervisor_run_id, app_id, project_root,
		account_id, account_generation, capability_fingerprint, runtime_boot_epoch, process_json,
		local_app_principal_id, local_app_record_id, provenance_revision, project_generation, payload_digest,
		issued_unix_nano, expires_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sessionID[:], proofHash[:], launchID[:], row.AuthorizationID[:], row.SupervisorRunID[:], row.AppID, row.ProjectRoot,
		row.AccountID, row.AccountGeneration, row.PermissionRequirementFingerprint[:], store.bootEpoch[:], processJSON,
		row.LocalAppPrincipalID, row.LocalAppRecordID, row.ProvenanceRevision, row.ProjectGeneration, row.PayloadDigest,
		now.UnixNano(), expiresAt.UnixNano()); err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	if err := tx.Commit(); err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	return localDevelopmentSessionProjection{
		LaunchID:                         row.LaunchID,
		SessionID:                        sessionID,
		SessionProof:                     sessionProof,
		ExpiresAt:                        expiresAt,
		AuthorizationID:                  row.AuthorizationID,
		AuthorizationGeneration:          authorization.Generation,
		SupervisorRunID:                  row.SupervisorRunID,
		AppID:                            row.AppID,
		ProjectRoot:                      row.ProjectRoot,
		PermissionRequirementFingerprint: row.PermissionRequirementFingerprint,
		HostExecutableDigest:             process.ExecutableDigest,
		AccountID:                        row.AccountID,
		AccountGeneration:                row.AccountGeneration,
		RuntimeBootEpoch:                 store.bootEpoch,
		Process:                          process,
		PermissionRequirements:           append([]localDevelopmentPermissionRequirement(nil), authorization.Project.PermissionRequirements...),
		LocalAppPrincipalID:              row.LocalAppPrincipalID,
		LocalAppRecordID:                 row.LocalAppRecordID,
		ProvenanceRevision:               row.ProvenanceRevision,
		ProjectGeneration:                row.ProjectGeneration,
		PayloadDigest:                    row.PayloadDigest,
	}, nil
}

func (store *localDevelopmentStore) ValidateSession(ctx context.Context, binding localDevelopmentSessionBinding) (localDevelopmentSessionProjection, error) {
	if store == nil || store.db == nil || binding.SessionID == (protectedlocal.Identifier{}) || binding.SessionProof == (protectedlocal.Identifier{}) ||
		binding.AccountGeneration == 0 || binding.RuntimeBootEpoch != store.bootEpoch {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	if protectedlocal.ValidateProcessTuple(binding.Process) != nil {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentProcessMismatch
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	var launchID, proofHash, authorizationID, runID, capabilityFingerprint, bootEpoch []byte
	var appID, projectRoot, accountID, processJSON, principalID, recordID, payloadDigest string
	var accountGeneration, provenanceRevision, projectGeneration uint64
	var expiresAt int64
	var revokedAt sql.NullInt64
	err := store.db.QueryRowContext(ctx, `SELECT launch_id, session_proof_hash, authorization_id, supervisor_run_id, app_id, project_root, account_id, account_generation, capability_fingerprint, runtime_boot_epoch, process_json,
		local_app_principal_id, local_app_record_id, provenance_revision, project_generation, payload_digest,
		expires_unix_nano, revoked_unix_nano FROM local_development_session WHERE session_id = ?`, binding.SessionID[:]).Scan(
		&launchID, &proofHash, &authorizationID, &runID, &appID, &projectRoot, &accountID, &accountGeneration, &capabilityFingerprint, &bootEpoch, &processJSON,
		&principalID, &recordID, &provenanceRevision, &projectGeneration, &payloadDigest, &expiresAt, &revokedAt,
	)
	if err != nil || revokedAt.Valid || !store.now().UTC().Before(time.Unix(0, expiresAt).UTC()) {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	if accountGeneration != binding.AccountGeneration {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentAccountChanged
	}
	expectedProofHash := sha256.Sum256(binding.SessionProof[:])
	if len(proofHash) != len(expectedProofHash) || subtle.ConstantTimeCompare(proofHash, expectedProofHash[:]) != 1 {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	parsedAuthorizationID, ok := localDevelopmentIdentifierFromBytes(authorizationID)
	if !ok {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	parsedLaunchID, ok := localDevelopmentIdentifierFromBytes(launchID)
	if !ok {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	parsedRunID, ok := localDevelopmentIdentifierFromBytes(runID)
	if !ok {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	parsedFingerprint, ok := localDevelopmentIdentifierFromBytes(capabilityFingerprint)
	if !ok {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	parsedBootEpoch, ok := localDevelopmentIdentifierFromBytes(bootEpoch)
	if !ok || parsedBootEpoch != store.bootEpoch {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	process, err := unmarshalLocalDevelopmentProcess(processJSON)
	if err != nil || process != binding.Process {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentProcessMismatch
	}
	authorization, err := scanLocalDevelopmentAuthorization(store.db.QueryRowContext(ctx, `SELECT authorization_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind, account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state, authorization_generation, approved_unix_nano, updated_unix_nano FROM local_development_authorization WHERE authorization_id = ?`, parsedAuthorizationID[:]))
	if err != nil || authorization.State != localDevelopmentAuthorizationActive || authorization.Project.AppID != appID || authorization.Project.ProjectRoot != projectRoot || authorization.Project.AccountID != accountID || authorization.Project.PermissionRequirementFingerprint != parsedFingerprint ||
		(authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE && authorization.RunID != parsedRunID) {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	return localDevelopmentSessionProjection{
		LaunchID:                         parsedLaunchID,
		SessionID:                        binding.SessionID,
		SessionProof:                     binding.SessionProof,
		ExpiresAt:                        time.Unix(0, expiresAt).UTC(),
		AuthorizationID:                  parsedAuthorizationID,
		AuthorizationGeneration:          authorization.Generation,
		SupervisorRunID:                  parsedRunID,
		AppID:                            appID,
		ProjectRoot:                      projectRoot,
		PermissionRequirementFingerprint: parsedFingerprint,
		HostExecutableDigest:             process.ExecutableDigest,
		AccountID:                        accountID,
		AccountGeneration:                accountGeneration,
		RuntimeBootEpoch:                 store.bootEpoch,
		Process:                          process,
		PermissionRequirements:           append([]localDevelopmentPermissionRequirement(nil), authorization.Project.PermissionRequirements...),
		LocalAppPrincipalID:              principalID,
		LocalAppRecordID:                 recordID,
		ProvenanceRevision:               provenanceRevision,
		ProjectGeneration:                projectGeneration,
		PayloadDigest:                    payloadDigest,
	}, nil
}

func (store *localDevelopmentStore) RenewSession(ctx context.Context, binding localDevelopmentSessionBinding) (localDevelopmentSessionProjection, error) {
	current, err := store.ValidateSession(ctx, binding)
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	defer tx.Rollback()
	var revokedAt sql.NullInt64
	var expiresAt int64
	if err := tx.QueryRowContext(ctx, `SELECT expires_unix_nano, revoked_unix_nano FROM local_development_session WHERE session_id = ?`, binding.SessionID[:]).Scan(&expiresAt, &revokedAt); err != nil || revokedAt.Valid || !store.now().UTC().Before(time.Unix(0, expiresAt).UTC()) {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	var authorizationState string
	if err := tx.QueryRowContext(ctx, `SELECT state FROM local_development_authorization WHERE authorization_id = ?`, current.AuthorizationID[:]).Scan(&authorizationState); err != nil || authorizationState != localDevelopmentAuthorizationActive {
		return localDevelopmentSessionProjection{}, errLocalDevelopmentSessionRevoked
	}
	sessionID, err := store.readIdentifier()
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	sessionProof, err := store.readIdentifier()
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	proofHash := sha256.Sum256(sessionProof[:])
	now := store.now().UTC()
	nextExpiry := now.Add(localDevelopmentSessionTTL)
	processJSON, err := marshalLocalDevelopmentProcess(current.Process)
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE local_development_session SET revoked_unix_nano = ? WHERE session_id = ? AND revoked_unix_nano IS NULL`, now.UnixNano(), binding.SessionID[:])
	if err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	if err := requireLocalDevelopmentRowsAffected(result); err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO local_development_session(
		session_id, session_proof_hash, launch_id, authorization_id, supervisor_run_id, app_id, project_root,
		account_id, account_generation, capability_fingerprint, runtime_boot_epoch, process_json,
		local_app_principal_id, local_app_record_id, provenance_revision, project_generation, payload_digest,
		issued_unix_nano, expires_unix_nano
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sessionID[:], proofHash[:], current.LaunchID[:], current.AuthorizationID[:], current.SupervisorRunID[:], current.AppID, current.ProjectRoot,
		current.AccountID, current.AccountGeneration, current.PermissionRequirementFingerprint[:], current.RuntimeBootEpoch[:], processJSON,
		current.LocalAppPrincipalID, current.LocalAppRecordID, current.ProvenanceRevision, current.ProjectGeneration, current.PayloadDigest,
		now.UnixNano(), nextExpiry.UnixNano()); err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	if err := tx.Commit(); err != nil {
		return localDevelopmentSessionProjection{}, err
	}
	current.SessionID = sessionID
	current.SessionProof = sessionProof
	current.ExpiresAt = nextExpiry
	return current, nil
}

func (store *localDevelopmentStore) EndRun(ctx context.Context, authorizationID protectedlocal.Identifier, runID protectedlocal.Identifier) error {
	if store == nil || store.db == nil || authorizationID == (protectedlocal.Identifier{}) || runID == (protectedlocal.Identifier{}) {
		return errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	authorization, err := scanLocalDevelopmentAuthorization(tx.QueryRowContext(ctx, `SELECT authorization_id, supervisor_run_id, app_id, display_name, project_root, manifest_path, shell_kind, account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state, authorization_generation, approved_unix_nano, updated_unix_nano FROM local_development_authorization WHERE authorization_id = ?`, authorizationID[:]))
	if err != nil || authorization.State != localDevelopmentAuthorizationActive || (authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE && authorization.RunID != runID) {
		return errLocalDevelopmentAuthorization
	}
	now := store.now().UTC()
	if err := revokeLocalDevelopmentAuthorityTx(ctx, tx, authorizationID, &runID, now); err != nil {
		return err
	}
	if authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_RUN_ONCE {
		if _, err := tx.ExecContext(ctx, `UPDATE local_development_authorization SET state = 'revoked', updated_unix_nano = ? WHERE authorization_id = ? AND state = 'active'`, now.UnixNano(), authorizationID[:]); err != nil {
			return err
		}
	} else if authorization.Decision == runtimev1.LocalDevelopmentDecision_LOCAL_DEVELOPMENT_DECISION_ALLOW_REMEMBER_PROJECT {
		if _, err := tx.ExecContext(ctx, `UPDATE local_development_authorization SET state = 'dormant', updated_unix_nano = ? WHERE authorization_id = ? AND state = 'active'`, now.UnixNano(), authorizationID[:]); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (store *localDevelopmentStore) RevokeSession(ctx context.Context, sessionID protectedlocal.Identifier) error {
	if store == nil || store.db == nil || sessionID == (protectedlocal.Identifier{}) {
		return errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	_, err := store.db.ExecContext(ctx, `UPDATE local_development_session SET revoked_unix_nano = ? WHERE session_id = ? AND revoked_unix_nano IS NULL`, store.now().UTC().UnixNano(), sessionID[:])
	return err
}

func (store *localDevelopmentStore) RevokeLaunch(ctx context.Context, launchID protectedlocal.Identifier) error {
	if store == nil || store.db == nil || launchID == (protectedlocal.Identifier{}) {
		return errLocalDevelopmentInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	_, err := store.db.ExecContext(ctx, `UPDATE local_development_launch SET status = 'revoked', revoked_unix_nano = ? WHERE launch_id = ? AND status IN ('pending','process_bound')`, store.now().UTC().UnixNano(), launchID[:])
	return err
}

func validLocalDevelopmentHostPath(projectRoot string, hostExecutable string, shellKind runtimev1.LocalDevelopmentShellKind) bool {
	root := filepath.Clean(strings.TrimSpace(projectRoot))
	host := filepath.Clean(strings.TrimSpace(hostExecutable))
	if !filepath.IsAbs(root) || !filepath.IsAbs(host) || root != strings.TrimSpace(projectRoot) || host != strings.TrimSpace(hostExecutable) {
		return false
	}
	switch shellKind {
	case runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON:
		alias := filepath.Join(root, "node_modules", "electron", "dist", "electron.exe")
		canonicalAlias, err := canonicalLocalDevelopmentFilePath(alias)
		if err != nil {
			return false
		}
		_, err = validateCanonicalLocalDevelopmentHostExecutable(root, host, canonicalAlias, shellKind)
		return err == nil
	case runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_TAURI:
		return pathWithinLocalDevelopmentRoot(root, host)
	default:
		return false
	}
}

func validLocalDevelopmentRendererOrigin(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Hostname() == "" || parsed.Port() == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	host := strings.Trim(parsed.Hostname(), "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func scanLocalDevelopmentLaunch(scanner localDevelopmentRowScanner) (localDevelopmentLaunchRow, error) {
	var launchID, authorizationID, runID, capabilityFingerprint, bootEpoch, expectedHostDigest []byte
	var appID, projectRoot, manifestPath, accountID, hostExecutable, rendererOrigin, status, principalID, recordID, payloadDigest string
	var shellKind int32
	var accountGeneration, provenanceRevision, projectGeneration uint64
	var expiresAt int64
	var bindDeadline sql.NullInt64
	var processJSON sql.NullString
	if err := scanner.Scan(&launchID, &authorizationID, &runID, &appID, &projectRoot, &manifestPath, &shellKind, &accountID, &accountGeneration, &capabilityFingerprint,
		&principalID, &recordID, &provenanceRevision, &projectGeneration, &payloadDigest, &expectedHostDigest,
		&hostExecutable, &rendererOrigin, &bootEpoch, &status, &expiresAt, &bindDeadline, &processJSON); err != nil {
		return localDevelopmentLaunchRow{}, err
	}
	parsedLaunchID, ok := localDevelopmentIdentifierFromBytes(launchID)
	if !ok {
		return localDevelopmentLaunchRow{}, errLocalDevelopmentLaunchMismatch
	}
	parsedAuthorizationID, ok := localDevelopmentIdentifierFromBytes(authorizationID)
	if !ok {
		return localDevelopmentLaunchRow{}, errLocalDevelopmentLaunchMismatch
	}
	parsedRunID, ok := localDevelopmentIdentifierFromBytes(runID)
	if !ok {
		return localDevelopmentLaunchRow{}, errLocalDevelopmentLaunchMismatch
	}
	parsedFingerprint, ok := localDevelopmentIdentifierFromBytes(capabilityFingerprint)
	if !ok {
		return localDevelopmentLaunchRow{}, errLocalDevelopmentLaunchMismatch
	}
	parsedBootEpoch, ok := localDevelopmentIdentifierFromBytes(bootEpoch)
	if !ok {
		return localDevelopmentLaunchRow{}, errLocalDevelopmentLaunchMismatch
	}
	parsedHostDigest, ok := localDevelopmentIdentifierFromBytes(expectedHostDigest)
	if !ok || strings.TrimSpace(principalID) == "" || strings.TrimSpace(recordID) == "" || provenanceRevision == 0 || projectGeneration == 0 || strings.TrimSpace(payloadDigest) == "" {
		return localDevelopmentLaunchRow{}, errLocalDevelopmentLaunchMismatch
	}
	row := localDevelopmentLaunchRow{
		LaunchID: parsedLaunchID, AuthorizationID: parsedAuthorizationID, SupervisorRunID: parsedRunID,
		AppID: appID, ProjectRoot: projectRoot, ManifestPath: manifestPath, ShellKind: runtimev1.LocalDevelopmentShellKind(shellKind),
		AccountID: accountID, AccountGeneration: accountGeneration, PermissionRequirementFingerprint: parsedFingerprint,
		HostExecutable: hostExecutable, RendererOrigin: rendererOrigin, RuntimeBootEpoch: parsedBootEpoch, Status: status,
		ExpiresAt:           time.Unix(0, expiresAt).UTC(),
		LocalAppPrincipalID: principalID, LocalAppRecordID: recordID, ProvenanceRevision: provenanceRevision,
		ProjectGeneration: projectGeneration, PayloadDigest: payloadDigest, ExpectedHostDigest: parsedHostDigest,
	}
	if bindDeadline.Valid {
		row.BindDeadline = time.Unix(0, bindDeadline.Int64).UTC()
	}
	if processJSON.Valid {
		process, err := unmarshalLocalDevelopmentProcess(processJSON.String)
		if err != nil {
			return localDevelopmentLaunchRow{}, err
		}
		row.Process = process
	}
	return row, nil
}
