package app

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type localDevelopmentRowScanner interface {
	Scan(...any) error
}

func (store *localDevelopmentStore) latestProjectAuthorization(ctx context.Context, projectRoot string, appID string, accountID string) (localDevelopmentAuthorization, bool, error) {
	authorization, err := scanLocalDevelopmentAuthorization(store.db.QueryRowContext(ctx, `SELECT authorization_id, supervisor_run_id, app_id, display_name, project_root, app_manifest_path, shell_kind, account_id, approved_account_generation, capabilities_json, capability_fingerprint, decision, state, authorization_generation, approved_unix_nano, updated_unix_nano FROM local_development_authorization WHERE account_id = ? AND (project_root = ? OR app_id = ?) ORDER BY CASE WHEN state = 'active' THEN 0 ELSE 1 END, updated_unix_nano DESC, authorization_generation DESC LIMIT 1`, accountID, projectRoot, appID))
	if errors.Is(err, sql.ErrNoRows) {
		return localDevelopmentAuthorization{}, false, nil
	}
	return authorization, err == nil, err
}

func scanLocalDevelopmentAuthorization(scanner localDevelopmentRowScanner) (localDevelopmentAuthorization, error) {
	var authorizationID, runID, capabilityFingerprint []byte
	var appID, displayName, projectRoot, manifestPath, accountID, capabilitiesJSON, state string
	var shellKind, decision int32
	var accountGeneration, generation uint64
	var approvedAt, updatedAt int64
	if err := scanner.Scan(
		&authorizationID, &runID, &appID, &displayName, &projectRoot, &manifestPath, &shellKind,
		&accountID, &accountGeneration, &capabilitiesJSON, &capabilityFingerprint, &decision, &state,
		&generation, &approvedAt, &updatedAt,
	); err != nil {
		return localDevelopmentAuthorization{}, err
	}
	parsedAuthorizationID, ok := localDevelopmentIdentifierFromBytes(authorizationID)
	if !ok {
		return localDevelopmentAuthorization{}, errLocalDevelopmentInvalid
	}
	parsedRunID, ok := localDevelopmentIdentifierFromBytes(runID)
	if !ok {
		return localDevelopmentAuthorization{}, errLocalDevelopmentInvalid
	}
	parsedFingerprint, ok := localDevelopmentIdentifierFromBytes(capabilityFingerprint)
	if !ok {
		return localDevelopmentAuthorization{}, errLocalDevelopmentInvalid
	}
	var permissionRequirements []localDevelopmentPermissionRequirement
	if err := json.Unmarshal([]byte(capabilitiesJSON), &permissionRequirements); err != nil {
		return localDevelopmentAuthorization{}, errLocalDevelopmentInvalid
	}
	authorization := localDevelopmentAuthorization{
		ID:    parsedAuthorizationID,
		RunID: parsedRunID,
		Project: localDevelopmentProjectSnapshot{
			AppID:                            appID,
			DisplayName:                      displayName,
			ProjectRoot:                      projectRoot,
			ManifestPath:                     manifestPath,
			ShellKind:                        runtimev1.LocalDevelopmentShellKind(shellKind),
			AccountID:                        accountID,
			AccountGeneration:                accountGeneration,
			PermissionRequirements:           permissionRequirements,
			PermissionRequirementFingerprint: parsedFingerprint,
		},
		Decision:   runtimev1.LocalDevelopmentDecision(decision),
		State:      state,
		Generation: generation,
		ApprovedAt: time.Unix(0, approvedAt).UTC(),
		UpdatedAt:  time.Unix(0, updatedAt).UTC(),
	}
	if authorization.ID == (protectedlocal.Identifier{}) || authorization.RunID == (protectedlocal.Identifier{}) || authorization.Generation == 0 ||
		!validLocalDevelopmentDecision(authorization.Decision) || validateLocalDevelopmentProject(authorization.Project) != nil {
		return localDevelopmentAuthorization{}, errLocalDevelopmentInvalid
	}
	return authorization, nil
}

func scanLocalDevelopmentEvaluation(scanner localDevelopmentRowScanner) (localDevelopmentEvaluation, string, error) {
	var runID, capabilityFingerprint []byte
	var appID, displayName, projectRoot, manifestPath, accountID, capabilitiesJSON, state string
	var shellKind int32
	var accountGeneration uint64
	var expiresAt int64
	if err := scanner.Scan(&runID, &appID, &displayName, &projectRoot, &manifestPath, &shellKind, &accountID, &accountGeneration, &capabilitiesJSON, &capabilityFingerprint, &state, &expiresAt); err != nil {
		return localDevelopmentEvaluation{}, "", err
	}
	parsedRunID, ok := localDevelopmentIdentifierFromBytes(runID)
	if !ok {
		return localDevelopmentEvaluation{}, "", errLocalDevelopmentInvalid
	}
	parsedFingerprint, ok := localDevelopmentIdentifierFromBytes(capabilityFingerprint)
	if !ok {
		return localDevelopmentEvaluation{}, "", errLocalDevelopmentInvalid
	}
	var permissionRequirements []localDevelopmentPermissionRequirement
	if err := json.Unmarshal([]byte(capabilitiesJSON), &permissionRequirements); err != nil {
		return localDevelopmentEvaluation{}, "", errLocalDevelopmentInvalid
	}
	evaluation := localDevelopmentEvaluation{
		RunID: parsedRunID,
		Project: localDevelopmentProjectSnapshot{
			AppID:                            appID,
			DisplayName:                      displayName,
			ProjectRoot:                      projectRoot,
			ManifestPath:                     manifestPath,
			ShellKind:                        runtimev1.LocalDevelopmentShellKind(shellKind),
			AccountID:                        accountID,
			AccountGeneration:                accountGeneration,
			PermissionRequirements:           permissionRequirements,
			PermissionRequirementFingerprint: parsedFingerprint,
		},
		ExpiresAt: time.Unix(0, expiresAt).UTC(),
	}
	if validateLocalDevelopmentProject(evaluation.Project) != nil {
		return localDevelopmentEvaluation{}, "", errLocalDevelopmentInvalid
	}
	return evaluation, state, nil
}

func localDevelopmentIdentifierFromBytes(raw []byte) (protectedlocal.Identifier, bool) {
	var identifier protectedlocal.Identifier
	if len(raw) != len(identifier) {
		return identifier, false
	}
	copy(identifier[:], raw)
	return identifier, identifier != (protectedlocal.Identifier{})
}

type localDevelopmentProcessRecord struct {
	OS                          protectedlocal.OperatingSystem `json:"os"`
	PID                         uint32                         `json:"pid"`
	CreationMarker              string                         `json:"creation_marker"`
	OSLoginSession              string                         `json:"os_login_session"`
	SecurityPrincipal           string                         `json:"security_principal"`
	CanonicalExecutableIdentity string                         `json:"canonical_executable_identity"`
	CanonicalExecutablePath     string                         `json:"canonical_executable_path"`
	ExecutableDigest            string                         `json:"executable_digest"`
	ExecutableTrustSetID        string                         `json:"executable_trust_set_id"`
}

func marshalLocalDevelopmentProcess(process protectedlocal.ProcessTuple) (string, error) {
	if err := protectedlocal.ValidateProcessTuple(process); err != nil || process.CanonicalExecutablePath == "" || !protectedlocal.IsLocalDevelopmentProcessTrustSet(process) {
		return "", errLocalDevelopmentLaunchMismatch
	}
	record := localDevelopmentProcessRecord{
		OS:                          process.OS,
		PID:                         process.PID,
		CreationMarker:              process.CreationMarker,
		OSLoginSession:              process.OSLoginSession,
		SecurityPrincipal:           process.SecurityPrincipal,
		CanonicalExecutableIdentity: process.CanonicalExecutableIdentity,
		CanonicalExecutablePath:     process.CanonicalExecutablePath,
		ExecutableDigest:            hex.EncodeToString(process.ExecutableDigest[:]),
		ExecutableTrustSetID:        process.ExecutableTrustSetID,
	}
	encoded, err := json.Marshal(record)
	return string(encoded), err
}

func unmarshalLocalDevelopmentProcess(encoded string) (protectedlocal.ProcessTuple, error) {
	var record localDevelopmentProcessRecord
	if err := json.Unmarshal([]byte(encoded), &record); err != nil {
		return protectedlocal.ProcessTuple{}, errLocalDevelopmentLaunchMismatch
	}
	digest, err := hex.DecodeString(record.ExecutableDigest)
	if err != nil {
		return protectedlocal.ProcessTuple{}, errLocalDevelopmentLaunchMismatch
	}
	parsedDigest, ok := localDevelopmentIdentifierFromBytes(digest)
	if !ok {
		return protectedlocal.ProcessTuple{}, errLocalDevelopmentLaunchMismatch
	}
	process := protectedlocal.ProcessTuple{
		OS:                          record.OS,
		PID:                         record.PID,
		CreationMarker:              record.CreationMarker,
		OSLoginSession:              record.OSLoginSession,
		SecurityPrincipal:           record.SecurityPrincipal,
		CanonicalExecutableIdentity: record.CanonicalExecutableIdentity,
		CanonicalExecutablePath:     record.CanonicalExecutablePath,
		ExecutableDigest:            parsedDigest,
		ExecutableTrustSetID:        record.ExecutableTrustSetID,
	}
	if _, err := marshalLocalDevelopmentProcess(process); err != nil {
		return protectedlocal.ProcessTuple{}, err
	}
	return process, nil
}

func revokeLocalDevelopmentAuthorityTx(ctx context.Context, tx *sql.Tx, authorizationID protectedlocal.Identifier, runID *protectedlocal.Identifier, now time.Time, sessionScoped bool) error {
	if tx == nil || authorizationID == (protectedlocal.Identifier{}) {
		return errLocalDevelopmentInvalid
	}
	if runID == nil {
		if _, err := tx.ExecContext(ctx, `UPDATE local_development_authorization SET state = 'revoked', updated_unix_nano = ? WHERE authorization_id = ? AND state <> 'revoked'`, now.UnixNano(), authorizationID[:]); err != nil {
			return err
		}
		if !sessionScoped {
			return nil
		}
		if _, err := tx.ExecContext(ctx, `UPDATE local_development_launch SET status = 'revoked', revoked_unix_nano = ? WHERE authorization_id = ? AND status IN ('pending','process_bound')`, now.UnixNano(), authorizationID[:]); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE local_development_session SET revoked_unix_nano = ? WHERE authorization_id = ? AND revoked_unix_nano IS NULL`, now.UnixNano(), authorizationID[:])
		return err
	}
	if !sessionScoped {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE local_development_launch SET status = 'revoked', revoked_unix_nano = ? WHERE authorization_id = ? AND supervisor_run_id = ? AND status IN ('pending','process_bound')`, now.UnixNano(), authorizationID[:], runID[:]); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE local_development_session SET revoked_unix_nano = ? WHERE authorization_id = ? AND supervisor_run_id = ? AND revoked_unix_nano IS NULL`, now.UnixNano(), authorizationID[:], runID[:])
	return err
}

func requireLocalDevelopmentRowsAffected(result sql.Result) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("%w: expected one authority transition, got %d", errLocalDevelopmentInvalid, affected)
	}
	return nil
}
