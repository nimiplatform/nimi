package protectedlocal

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func (ledger *Ledger) initialize(ctx context.Context) error {
	if err := ledger.db.PingContext(ctx); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("ping protected-local sqlite: %w", err))
	}
	if err := ledger.verifyPragmas(ctx); err != nil {
		return err
	}
	if err := ledger.ensureSchema(ctx); err != nil {
		return err
	}
	if err := ledger.integrityCheck(ctx); err != nil {
		return err
	}
	rows, err := ledger.loadAndVerifyCommits(ctx)
	if err != nil {
		return err
	}
	if err := ledger.verifyLogicalRecords(ctx, rows); err != nil {
		return err
	}
	storedAnchor, anchorErr := ledger.anchorStore.Load(ctx)
	if len(rows) == 0 {
		if anchorErr == nil {
			return ledger.rollbackFailure(fmt.Errorf("recover protected-local ledger: anchor exists without ledger head"))
		}
		if !errors.Is(anchorErr, ErrAnchorNotFound) {
			return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("load protected-local anchor: %w", anchorErr))
		}
		return ledger.initializeGenesis(ctx)
	}
	if anchorErr != nil {
		if errors.Is(anchorErr, ErrAnchorNotFound) && len(rows) == 1 && rows[0].sequence == 0 && rows[0].state == commitStatePending {
			if err := ledger.discardPending(ctx, rows[0].sequence); err != nil {
				return err
			}
			return ledger.initializeGenesis(ctx)
		}
		if errors.Is(anchorErr, ErrAnchorNotFound) {
			return ledger.rollbackFailure(fmt.Errorf("recover protected-local ledger: durable head has no external anchor"))
		}
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("load protected-local anchor: %w", anchorErr))
	}
	if storedAnchor.LedgerUUID != rows[0].ledgerUUID {
		return ledger.rollbackFailure(fmt.Errorf("recover protected-local ledger: ledger UUID mismatch"))
	}

	var pending *commitRow
	var complete *commitRow
	for index := range rows {
		row := &rows[index]
		if row.state == commitStatePending {
			pending = row
		} else {
			complete = row
		}
	}
	if pending == nil {
		if complete == nil || !anchorMatches(storedAnchor, *complete) {
			return ledger.rollbackFailure(fmt.Errorf("recover protected-local ledger: committed head mismatch"))
		}
		ledger.anchor = storedAnchor
		return nil
	}
	if anchorMatches(storedAnchor, *pending) {
		if err := ledger.completePending(ctx, pending.sequence); err != nil {
			return err
		}
		ledger.anchor = storedAnchor
		return nil
	}
	if complete != nil && anchorMatches(storedAnchor, *complete) && pending.sequence == complete.sequence+1 {
		if err := ledger.discardPending(ctx, pending.sequence); err != nil {
			return err
		}
		ledger.anchor = storedAnchor
		return nil
	}
	return ledger.rollbackFailure(fmt.Errorf("recover protected-local ledger: pending head mismatch"))
}

func (ledger *Ledger) verifyPragmas(ctx context.Context) error {
	var journalMode string
	if err := ledger.db.QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&journalMode); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected-local journal mode: %w", err))
	}
	if !strings.EqualFold(strings.TrimSpace(journalMode), "wal") {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "repair_runtime_service", fmt.Errorf("validate protected-local journal mode: WAL required"))
	}
	var synchronous int
	if err := ledger.db.QueryRowContext(ctx, `PRAGMA synchronous`).Scan(&synchronous); err != nil || synchronous != 2 {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "repair_runtime_service", fmt.Errorf("validate protected-local synchronous mode: FULL required"))
	}
	var foreignKeys int
	if err := ledger.db.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil || foreignKeys != 1 {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "repair_runtime_service", fmt.Errorf("validate protected-local foreign keys: enabled required"))
	}
	var busyTimeout int
	if err := ledger.db.QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&busyTimeout); err != nil || busyTimeout != ledgerBusyTimeoutMS {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "repair_runtime_service", fmt.Errorf("validate protected-local busy timeout: five seconds required"))
	}
	return nil
}

func (ledger *Ledger) ensureSchema(ctx context.Context) error {
	tx, err := ledger.db.BeginTx(ctx, nil)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("begin protected-local schema transaction: %w", err))
	}
	defer func() { _ = tx.Rollback() }()
	for _, statement := range protectedLocalSchema {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("apply protected-local schema: %w", err))
		}
	}
	var schemaVersion int
	if err := tx.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&schemaVersion); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("read protected-local schema version: %w", err))
	}
	if schemaVersion == 0 {
		if _, err := tx.ExecContext(ctx, `PRAGMA user_version = 4`); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("write protected-local schema version: %w", err))
		}
	} else if schemaVersion == 2 {
		if err := retireImmutablePackageLifecycleSchema(ctx, tx); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `PRAGMA user_version = 4`); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("write protected-local schema version: %w", err))
		}
	} else if schemaVersion == 3 {
		if _, err := tx.ExecContext(ctx, `PRAGMA user_version = 4`); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("write protected-local schema version: %w", err))
		}
	} else if schemaVersion != ledgerSchemaVersion {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("validate protected-local schema version: unsupported version"))
	}
	if err := tx.Commit(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("commit protected-local schema: %w", err))
	}
	return ledger.checkpoint(ctx)
}

func retireImmutablePackageLifecycleSchema(ctx context.Context, tx *sql.Tx) error {
	for _, table := range []string{"protected_lifecycle_intent", "protected_lifecycle_challenge"} {
		var rows int
		query := fmt.Sprintf("SELECT COUNT(*) FROM %s", table)
		if err := tx.QueryRowContext(ctx, query).Scan(&rows); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("inspect retired immutable package lifecycle table %s: %w", table, err))
		}
		if rows != 0 {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("retired immutable package lifecycle table %s contains active state", table))
		}
	}
	for _, statement := range []string{
		"DROP TABLE protected_lifecycle_intent",
		"DROP TABLE protected_lifecycle_challenge",
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("retire immutable package lifecycle schema: %w", err))
		}
	}
	return nil
}

func (ledger *Ledger) integrityCheck(ctx context.Context) error {
	var result string
	if err := ledger.db.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&result); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("check protected-local sqlite integrity: %w", err))
	}
	if !strings.EqualFold(strings.TrimSpace(result), "ok") {
		return ledger.rollbackFailure(fmt.Errorf("check protected-local sqlite integrity: corruption detected"))
	}
	return nil
}

type commitState string

const (
	commitStatePending  commitState = "pending"
	commitStateComplete commitState = "complete"
)

type commitRow struct {
	sequence     uint64
	ledgerUUID   Identifier
	previousHead Identifier
	payloadHash  Identifier
	chainHead    Identifier
	state        commitState
	eventKind    string
	createdNanos int64
	recordMAC    Identifier
}

func (ledger *Ledger) loadAndVerifyCommits(ctx context.Context) ([]commitRow, error) {
	rows, err := ledger.db.QueryContext(ctx, `SELECT commit_sequence, ledger_uuid, previous_chain_head, payload_hash, chain_head, state, event_kind, created_unix_nano, record_hmac FROM protected_security_commit ORDER BY commit_sequence`)
	if err != nil {
		return nil, fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected-local commit chain: %w", err))
	}
	defer func() { _ = rows.Close() }()
	result := make([]commitRow, 0)
	for rows.Next() {
		var row commitRow
		var sequence int64
		var ledgerUUID, previousHead, payloadHash, chainHead, recordMAC []byte
		var state string
		if err := rows.Scan(&sequence, &ledgerUUID, &previousHead, &payloadHash, &chainHead, &state, &row.eventKind, &row.createdNanos, &recordMAC); err != nil {
			return nil, ledger.rollbackFailure(fmt.Errorf("decode protected-local commit chain: %w", err))
		}
		if sequence < 0 || !copyIdentifier(&row.ledgerUUID, ledgerUUID) || !copyIdentifierAllowZero(&row.previousHead, previousHead) ||
			!copyIdentifier(&row.payloadHash, payloadHash) || !copyIdentifier(&row.chainHead, chainHead) || !copyIdentifier(&row.recordMAC, recordMAC) {
			return nil, ledger.rollbackFailure(fmt.Errorf("decode protected-local commit chain: invalid field"))
		}
		row.sequence = uint64(sequence)
		row.state = commitState(state)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("iterate protected-local commit chain: %w", err))
	}
	var expectedPrevious Identifier
	for index, row := range result {
		if row.sequence != uint64(index) || row.ledgerUUID == (Identifier{}) || row.previousHead != expectedPrevious || strings.TrimSpace(row.eventKind) == "" {
			return nil, ledger.rollbackFailure(fmt.Errorf("verify protected-local commit chain: sequence mismatch"))
		}
		if index > 0 && row.ledgerUUID != result[0].ledgerUUID {
			return nil, ledger.rollbackFailure(fmt.Errorf("verify protected-local commit chain: UUID mismatch"))
		}
		if row.state != commitStateComplete && (row.state != commitStatePending || index != len(result)-1) {
			return nil, ledger.rollbackFailure(fmt.Errorf("verify protected-local commit chain: invalid pending state"))
		}
		expectedHead := ledger.chainHead(row.ledgerUUID, row.sequence, row.previousHead, row.payloadHash, row.eventKind, row.createdNanos)
		if subtle.ConstantTimeCompare(expectedHead[:], row.chainHead[:]) != 1 || subtle.ConstantTimeCompare(expectedHead[:], row.recordMAC[:]) != 1 {
			return nil, ledger.rollbackFailure(fmt.Errorf("verify protected-local commit chain: authentication mismatch"))
		}
		expectedPrevious = row.chainHead
	}
	return result, nil
}

type runtimeEpochRow struct {
	epoch     Identifier
	started   int64
	created   uint64
	revoked   *uint64
	recordMAC Identifier
}

type desktopSessionRow struct {
	sessionID   Identifier
	epoch       Identifier
	connection  Identifier
	processHash Identifier
	opened      int64
	created     uint64
	revoked     *uint64
	recordMAC   Identifier
}

func (ledger *Ledger) verifyLogicalRecords(ctx context.Context, commits []commitRow) error {
	commitBySequence := make(map[uint64]commitRow, len(commits))
	createdCounts := make(map[uint64]int, len(commits))
	revokedCounts := make(map[uint64]int, len(commits))
	for _, commit := range commits {
		commitBySequence[commit.sequence] = commit
	}

	epochs := make(map[Identifier]runtimeEpochRow)
	epochRows, err := ledger.db.QueryContext(ctx, `SELECT runtime_boot_epoch, started_unix_nano, created_commit_sequence, revoked_commit_sequence, record_hmac FROM protected_runtime_epoch`)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected runtime epochs: %w", err))
	}
	for epochRows.Next() {
		var encodedEpoch, encodedMAC []byte
		var started, created int64
		var revoked sql.NullInt64
		if err := epochRows.Scan(&encodedEpoch, &started, &created, &revoked, &encodedMAC); err != nil {
			_ = epochRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode protected runtime epoch: %w", err))
		}
		var epoch, recordMAC Identifier
		if created < 0 || !copyIdentifier(&epoch, encodedEpoch) || !copyIdentifier(&recordMAC, encodedMAC) {
			_ = epochRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode protected runtime epoch: invalid field"))
		}
		createdSequence := uint64(created)
		commit, ok := commitBySequence[createdSequence]
		if !ok || commit.eventKind != "runtime_start" {
			_ = epochRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected runtime epoch: creation commit mismatch"))
		}
		row := runtimeEpochRow{epoch: epoch, started: started, created: createdSequence, recordMAC: recordMAC}
		if revoked.Valid {
			if revoked.Int64 < 0 {
				_ = epochRows.Close()
				return ledger.rollbackFailure(fmt.Errorf("verify protected runtime epoch: invalid revocation sequence"))
			}
			revokedSequence := uint64(revoked.Int64)
			revocation, ok := commitBySequence[revokedSequence]
			if !ok || revocation.eventKind != "runtime_start" || revokedSequence <= createdSequence {
				_ = epochRows.Close()
				return ledger.rollbackFailure(fmt.Errorf("verify protected runtime epoch: revocation commit mismatch"))
			}
			row.revoked = &revokedSequence
			revokedCounts[revokedSequence]++
		}
		expectedMAC := ledger.runtimeEpochRecordMAC(row.epoch, row.started, row.created, row.revoked)
		payload := append(append([]byte{}, epoch[:]...), int64Bytes(started)...)
		expectedPayload := sha256.Sum256(payload)
		if subtle.ConstantTimeCompare(expectedMAC[:], recordMAC[:]) != 1 || subtle.ConstantTimeCompare(expectedPayload[:], commit.payloadHash[:]) != 1 {
			_ = epochRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected runtime epoch: authentication mismatch"))
		}
		epochs[epoch] = row
		createdCounts[createdSequence]++
	}
	if err := epochRows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close protected runtime epoch rows: %w", err))
	}

	sessionRows, err := ledger.db.QueryContext(ctx, `SELECT desktop_session_id, runtime_boot_epoch, connection_id, process_tuple_hash, opened_unix_nano, created_commit_sequence, revoked_commit_sequence, record_hmac FROM protected_desktop_session`)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected desktop sessions: %w", err))
	}
	for sessionRows.Next() {
		var encodedSession, encodedEpoch, encodedConnection, encodedProcess, encodedMAC []byte
		var opened, created int64
		var revoked sql.NullInt64
		if err := sessionRows.Scan(&encodedSession, &encodedEpoch, &encodedConnection, &encodedProcess, &opened, &created, &revoked, &encodedMAC); err != nil {
			_ = sessionRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode protected desktop session: %w", err))
		}
		var sessionID, epoch, connectionID, processHash, recordMAC Identifier
		if created < 0 || !copyIdentifier(&sessionID, encodedSession) || !copyIdentifier(&epoch, encodedEpoch) ||
			!copyIdentifier(&connectionID, encodedConnection) || !copyIdentifier(&processHash, encodedProcess) || !copyIdentifier(&recordMAC, encodedMAC) {
			_ = sessionRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode protected desktop session: invalid field"))
		}
		createdSequence := uint64(created)
		commit, ok := commitBySequence[createdSequence]
		if !ok || commit.eventKind != "desktop_session_open" {
			_ = sessionRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected desktop session: creation commit mismatch"))
		}
		if _, ok := epochs[epoch]; !ok {
			_ = sessionRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected desktop session: boot epoch missing"))
		}
		row := desktopSessionRow{
			sessionID:   sessionID,
			epoch:       epoch,
			connection:  connectionID,
			processHash: processHash,
			opened:      opened,
			created:     createdSequence,
			recordMAC:   recordMAC,
		}
		if revoked.Valid {
			if revoked.Int64 < 0 {
				_ = sessionRows.Close()
				return ledger.rollbackFailure(fmt.Errorf("verify protected desktop session: invalid revocation sequence"))
			}
			revokedSequence := uint64(revoked.Int64)
			revocation, ok := commitBySequence[revokedSequence]
			if !ok || revokedSequence <= createdSequence || (revocation.eventKind != "runtime_start" && revocation.eventKind != "desktop_session_revoke") {
				_ = sessionRows.Close()
				return ledger.rollbackFailure(fmt.Errorf("verify protected desktop session: revocation commit mismatch"))
			}
			if revocation.eventKind == "desktop_session_revoke" {
				expectedRevokePayload := sha256.Sum256(sessionID[:])
				if subtle.ConstantTimeCompare(expectedRevokePayload[:], revocation.payloadHash[:]) != 1 {
					_ = sessionRows.Close()
					return ledger.rollbackFailure(fmt.Errorf("verify protected desktop session: revocation payload mismatch"))
				}
			}
			row.revoked = &revokedSequence
			revokedCounts[revokedSequence]++
		}
		expectedMAC := ledger.desktopSessionRecordMAC(row)
		payload := make([]byte, 0, IdentifierBytes*4)
		payload = append(payload, sessionID[:]...)
		payload = append(payload, epoch[:]...)
		payload = append(payload, connectionID[:]...)
		payload = append(payload, processHash[:]...)
		expectedPayload := sha256.Sum256(payload)
		if subtle.ConstantTimeCompare(expectedMAC[:], recordMAC[:]) != 1 || subtle.ConstantTimeCompare(expectedPayload[:], commit.payloadHash[:]) != 1 {
			_ = sessionRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected desktop session: authentication mismatch"))
		}
		createdCounts[createdSequence]++
	}
	if err := sessionRows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close protected desktop session rows: %w", err))
	}

	auditRows, err := ledger.db.QueryContext(ctx, `SELECT audit_id, event_type, runtime_boot_epoch, occurred_unix_nano, created_commit_sequence, delivered_unix_nano, record_hmac FROM protected_security_audit_outbox`)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected security audit outbox: %w", err))
	}
	for auditRows.Next() {
		var encodedAudit, encodedEpoch, encodedMAC []byte
		var eventType string
		var occurred, created int64
		var delivered sql.NullInt64
		if err := auditRows.Scan(&encodedAudit, &eventType, &encodedEpoch, &occurred, &created, &delivered, &encodedMAC); err != nil {
			_ = auditRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode protected startup audit: %w", err))
		}
		var auditID, epoch, recordMAC Identifier
		if created < 0 || eventType != "runtime_start" || !copyIdentifier(&auditID, encodedAudit) || !copyIdentifier(&epoch, encodedEpoch) || !copyIdentifier(&recordMAC, encodedMAC) {
			_ = auditRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode protected startup audit: invalid field"))
		}
		createdSequence := uint64(created)
		commit, ok := commitBySequence[createdSequence]
		if !ok || commit.eventKind != "runtime_start" {
			_ = auditRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected startup audit: commit mismatch"))
		}
		var deliveredAt *int64
		if delivered.Valid {
			if delivered.Int64 < 0 {
				_ = auditRows.Close()
				return ledger.rollbackFailure(fmt.Errorf("verify protected startup audit: invalid delivery time"))
			}
			deliveredAt = &delivered.Int64
		}
		expectedID := ledger.recordMAC("startup_audit_id", epoch[:], uint64Bytes(createdSequence))
		expectedMAC := ledger.startupAuditRecordMAC(auditID, epoch, createdSequence, occurred, deliveredAt)
		if subtle.ConstantTimeCompare(expectedID[:], auditID[:]) != 1 || subtle.ConstantTimeCompare(expectedMAC[:], recordMAC[:]) != 1 {
			_ = auditRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected startup audit: authentication mismatch"))
		}
		createdCounts[createdSequence]++
	}
	if err := auditRows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close protected security audit rows: %w", err))
	}

	releaseRows, err := ledger.db.QueryContext(ctx, `SELECT executable_role, release_id, release_generation, artifact_sha256, created_commit_sequence, record_hmac FROM protected_release_lineage`)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected release lineage: %w", err))
	}
	for releaseRows.Next() {
		var row releaseLineageRow
		var generation, created int64
		var encodedDigest, encodedMAC []byte
		if err := releaseRows.Scan(&row.ExecutableRole, &row.ReleaseID, &generation, &encodedDigest, &created, &encodedMAC); err != nil {
			_ = releaseRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode protected release lineage: %w", err))
		}
		if generation <= 0 || created < 0 || !copyIdentifier(&row.ArtifactSHA256, encodedDigest) || !copyIdentifier(&row.recordMAC, encodedMAC) {
			_ = releaseRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode protected release lineage: invalid field"))
		}
		row.Generation = uint64(generation)
		row.created = uint64(created)
		commit, ok := commitBySequence[row.created]
		if !ok || commit.eventKind != releaseLineageEventKind || row.ReleaseLineageRecord.validate() != nil {
			_ = releaseRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected release lineage: creation commit mismatch"))
		}
		expectedMAC := ledger.releaseLineageRecordMAC(row)
		expectedPayload := sha256.Sum256(releaseLineagePayload(row.ReleaseLineageRecord))
		if subtle.ConstantTimeCompare(expectedMAC[:], row.recordMAC[:]) != 1 ||
			subtle.ConstantTimeCompare(expectedPayload[:], commit.payloadHash[:]) != 1 {
			_ = releaseRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify protected release lineage: authentication mismatch"))
		}
		createdCounts[row.created]++
	}
	if err := releaseRows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close protected release lineage rows: %w", err))
	}

	for _, commit := range commits {
		switch commit.eventKind {
		case "genesis":
			if commit.sequence != 0 || createdCounts[commit.sequence] != 0 || revokedCounts[commit.sequence] != 0 {
				return ledger.rollbackFailure(fmt.Errorf("verify protected-local genesis: unexpected records"))
			}
		case "runtime_start":
			if createdCounts[commit.sequence] != 2 {
				return ledger.rollbackFailure(fmt.Errorf("verify protected-local runtime start: epoch and audit required"))
			}
		case "desktop_session_open":
			if createdCounts[commit.sequence] != 1 || revokedCounts[commit.sequence] != 0 {
				return ledger.rollbackFailure(fmt.Errorf("verify protected-local desktop session open: record mismatch"))
			}
		case "desktop_session_revoke":
			if createdCounts[commit.sequence] != 0 || revokedCounts[commit.sequence] < 1 {
				return ledger.rollbackFailure(fmt.Errorf("verify protected-local desktop session revoke: record mismatch"))
			}
		case releaseLineageEventKind:
			if createdCounts[commit.sequence] != 1 || revokedCounts[commit.sequence] != 0 {
				return ledger.rollbackFailure(fmt.Errorf("verify protected-local release lineage: record mismatch"))
			}
		default:
			return ledger.rollbackFailure(fmt.Errorf("verify protected-local commit event: unsupported event kind"))
		}
	}
	return nil
}
