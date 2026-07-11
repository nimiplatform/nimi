package protectedlocal

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"math"
)

type lifecycleChallengeRecord struct {
	challengeID        Identifier
	desktopSessionID   Identifier
	processHash        Identifier
	accountGeneration  uint64
	action             LifecycleAction
	appID              string
	releaseRef         string
	artifactDigest     Identifier
	displayedDigest    Identifier
	adoptionGeneration uint64
	destructiveOptions LifecycleDestructiveOptions
	bootEpoch          Identifier
	issuedNanos        int64
	deadlineNanos      int64
	created            uint64
	revoked            *uint64
	recordMAC          Identifier
}

type lifecycleIntentRecord struct {
	intentID           Identifier
	challengeID        Identifier
	desktopSessionID   Identifier
	processHash        Identifier
	accountGeneration  uint64
	action             LifecycleAction
	appID              string
	releaseRef         string
	artifactDigest     Identifier
	displayedDigest    Identifier
	adoptionGeneration uint64
	destructiveOptions LifecycleDestructiveOptions
	bootEpoch          Identifier
	status             LifecycleIntentStatus
	jobID              string
	created            uint64
	revoked            *uint64
	recordMAC          Identifier
}

func lifecycleChallengeRecordFromAuthority(entry *lifecycleIntentAuthority) lifecycleChallengeRecord {
	return lifecycleChallengeRecord{
		challengeID:        entry.intentID,
		desktopSessionID:   entry.desktopSessionID,
		processHash:        entry.processHash,
		accountGeneration:  entry.accountGeneration,
		action:             entry.action,
		appID:              entry.appID,
		releaseRef:         entry.releaseRef,
		artifactDigest:     entry.artifactDigest,
		displayedDigest:    entry.displayedDigest,
		adoptionGeneration: entry.adoptionGeneration,
		destructiveOptions: entry.destructiveOptions,
		bootEpoch:          entry.bootEpoch,
		issuedNanos:        entry.issued.UTC().UnixNano(),
		deadlineNanos:      entry.deadline.UTC().UnixNano(),
	}
}

func lifecycleIntentRecordFromAuthority(entry *lifecycleIntentAuthority, status LifecycleIntentStatus) lifecycleIntentRecord {
	return lifecycleIntentRecord{
		intentID:           entry.intentID,
		challengeID:        entry.intentID,
		desktopSessionID:   entry.desktopSessionID,
		processHash:        entry.processHash,
		accountGeneration:  entry.accountGeneration,
		action:             entry.action,
		appID:              entry.appID,
		releaseRef:         entry.releaseRef,
		artifactDigest:     entry.artifactDigest,
		displayedDigest:    entry.displayedDigest,
		adoptionGeneration: entry.adoptionGeneration,
		destructiveOptions: entry.destructiveOptions,
		bootEpoch:          entry.bootEpoch,
		status:             status,
	}
}

func lifecycleIntentRecordFromChallenge(challenge lifecycleChallengeRecord, status LifecycleIntentStatus) lifecycleIntentRecord {
	return lifecycleIntentRecord{
		intentID:           challenge.challengeID,
		challengeID:        challenge.challengeID,
		desktopSessionID:   challenge.desktopSessionID,
		processHash:        challenge.processHash,
		accountGeneration:  challenge.accountGeneration,
		action:             challenge.action,
		appID:              challenge.appID,
		releaseRef:         challenge.releaseRef,
		artifactDigest:     challenge.artifactDigest,
		displayedDigest:    challenge.displayedDigest,
		adoptionGeneration: challenge.adoptionGeneration,
		destructiveOptions: challenge.destructiveOptions,
		bootEpoch:          challenge.bootEpoch,
		status:             status,
	}
}

func (ledger *Ledger) prepareLifecycleChallenge(ctx context.Context, record lifecycleChallengeRecord) (Identifier, error) {
	if err := validateLifecycleChallengeRecord(record); err != nil {
		return Identifier{}, err
	}
	var replaced Identifier
	err := ledger.commit(ctx, "lifecycle_challenge_prepare", lifecycleChallengePayload(record), func(tx *sql.Tx, sequence uint64) error {
		if err := ledger.requireLiveLifecycleSession(ctx, tx, record.desktopSessionID, record.processHash, record.bootEpoch); err != nil {
			return err
		}
		prior, found, err := ledger.loadOutstandingLifecycleChallenge(ctx, tx, record.desktopSessionID, record.action, record.appID)
		if err != nil {
			return err
		}
		if found {
			if err := ledger.revokeLifecycleChallenge(ctx, tx, &prior, sequence); err != nil {
				return err
			}
			cancelled := lifecycleIntentRecordFromChallenge(prior, LifecycleIntentStatusCancelled)
			cancelled.created = sequence
			if err := ledger.insertLifecycleIntent(ctx, tx, &cancelled); err != nil {
				return err
			}
			replaced = prior.challengeID
		}
		record.created = sequence
		record.recordMAC = ledger.lifecycleChallengeRecordMAC(record)
		_, err = tx.ExecContext(ctx, `INSERT INTO protected_lifecycle_challenge(challenge_id, desktop_session_id, process_tuple_hash, account_generation, action, app_id, release_ref, artifact_digest, displayed_intent_hash, expected_adoption_generation, delete_durable_data, health_repair_action, target_job_id, runtime_boot_epoch, issued_unix_nano, deadline_unix_nano, created_commit_sequence, record_hmac) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			record.challengeID[:], record.desktopSessionID[:], record.processHash[:], int64(record.accountGeneration), string(record.action), record.appID, record.releaseRef,
			record.artifactDigest[:], record.displayedDigest[:], int64(record.adoptionGeneration), sqliteBool(record.destructiveOptions.DeleteDurableData),
			int64(record.destructiveOptions.HealthRepairAction), record.destructiveOptions.TargetJobID, record.bootEpoch[:], record.issuedNanos, record.deadlineNanos, sequence, record.recordMAC[:])
		if err != nil {
			return fmt.Errorf("insert lifecycle challenge: %w", err)
		}
		return nil
	})
	if err != nil {
		return Identifier{}, err
	}
	return replaced, nil
}

func (ledger *Ledger) consumeLifecycleChallenge(ctx context.Context, intent lifecycleIntentRecord) error {
	return ledger.finalizeLifecycleChallenge(ctx, "lifecycle_intent_consume", intent)
}

func (ledger *Ledger) expireLifecycleChallenge(ctx context.Context, intent lifecycleIntentRecord) error {
	return ledger.finalizeLifecycleChallenge(ctx, "lifecycle_challenge_expire", intent)
}

func (ledger *Ledger) finalizeLifecycleChallenge(ctx context.Context, eventKind string, intent lifecycleIntentRecord) error {
	if intent.intentID == (Identifier{}) || intent.challengeID != intent.intentID ||
		(intent.status != LifecycleIntentStatusConsumed && intent.status != LifecycleIntentStatusExpired) {
		return fail(ReasonLifecycleChallengeMismatch, false, "prepare_lifecycle_intent", fmt.Errorf("finalize lifecycle challenge: invalid intent projection"))
	}
	return ledger.commit(ctx, eventKind, lifecycleIntentPayload(intent), func(tx *sql.Tx, sequence uint64) error {
		challenge, found, err := ledger.loadLifecycleChallenge(ctx, tx, intent.challengeID, true)
		if err != nil {
			return err
		}
		if !found {
			if exists, err := ledger.lifecycleIntentExists(ctx, tx, intent.intentID); err != nil {
				return err
			} else if exists {
				return lifecycleReplayFailure("finalize lifecycle challenge: challenge already consumed")
			}
			return fail(ReasonLifecycleChallengeMismatch, false, "prepare_lifecycle_intent", fmt.Errorf("finalize lifecycle challenge: outstanding challenge not found"))
		}
		if !challengeMatchesIntent(challenge, intent) {
			return fail(ReasonLifecycleChallengeMismatch, false, "prepare_lifecycle_intent", fmt.Errorf("finalize lifecycle challenge: durable binding mismatch"))
		}
		if err := ledger.requireLiveLifecycleSession(ctx, tx, challenge.desktopSessionID, challenge.processHash, challenge.bootEpoch); err != nil {
			return err
		}
		if err := ledger.revokeLifecycleChallenge(ctx, tx, &challenge, sequence); err != nil {
			return err
		}
		intent.created = sequence
		return ledger.insertLifecycleIntent(ctx, tx, &intent)
	})
}

func (ledger *Ledger) requireLiveLifecycleSession(ctx context.Context, tx *sql.Tx, sessionID, processHash, bootEpoch Identifier) error {
	var encodedEpoch, encodedConnection, encodedProcess, encodedMAC []byte
	var opened, created int64
	var revoked sql.NullInt64
	err := tx.QueryRowContext(ctx, `SELECT runtime_boot_epoch, connection_id, process_tuple_hash, opened_unix_nano, created_commit_sequence, revoked_commit_sequence, record_hmac FROM protected_desktop_session WHERE desktop_session_id = ?`, sessionID[:]).Scan(
		&encodedEpoch, &encodedConnection, &encodedProcess, &opened, &created, &revoked, &encodedMAC,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("read live lifecycle desktop session: %w", err)
	}
	var record desktopSessionRow
	validSession := false
	if err == nil {
		if created < 0 || (revoked.Valid && revoked.Int64 < 0) || !copyIdentifier(&record.epoch, encodedEpoch) ||
			!copyIdentifier(&record.connection, encodedConnection) || !copyIdentifier(&record.processHash, encodedProcess) ||
			!copyIdentifier(&record.recordMAC, encodedMAC) {
			return ledger.rollbackFailure(fmt.Errorf("decode live lifecycle desktop session: invalid field"))
		}
		record.sessionID = sessionID
		record.opened = opened
		record.created = uint64(created)
		if revoked.Valid {
			value := uint64(revoked.Int64)
			record.revoked = &value
		}
		expectedMAC := ledger.desktopSessionRecordMAC(record)
		if subtle.ConstantTimeCompare(expectedMAC[:], record.recordMAC[:]) != 1 {
			return ledger.rollbackFailure(fmt.Errorf("authenticate live lifecycle desktop session: record mismatch"))
		}
		validSession = record.revoked == nil && record.epoch == bootEpoch && record.processHash == processHash
	}
	epochLive := false
	if validSession {
		var encodedRuntimeEpoch, encodedRuntimeMAC []byte
		var started, epochCreated int64
		var epochRevoked sql.NullInt64
		err := tx.QueryRowContext(ctx, `SELECT runtime_boot_epoch, started_unix_nano, created_commit_sequence, revoked_commit_sequence, record_hmac FROM protected_runtime_epoch WHERE runtime_boot_epoch = ?`, bootEpoch[:]).Scan(
			&encodedRuntimeEpoch, &started, &epochCreated, &epochRevoked, &encodedRuntimeMAC,
		)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("read live lifecycle runtime epoch: %w", err)
		}
		if err == nil {
			var epochRecord runtimeEpochRow
			if epochCreated < 0 || (epochRevoked.Valid && epochRevoked.Int64 < 0) || !copyIdentifier(&epochRecord.epoch, encodedRuntimeEpoch) || !copyIdentifier(&epochRecord.recordMAC, encodedRuntimeMAC) {
				return ledger.rollbackFailure(fmt.Errorf("decode live lifecycle runtime epoch: invalid field"))
			}
			epochRecord.started = started
			epochRecord.created = uint64(epochCreated)
			if epochRevoked.Valid {
				value := uint64(epochRevoked.Int64)
				epochRecord.revoked = &value
			}
			expectedMAC := ledger.runtimeEpochRecordMAC(epochRecord.epoch, epochRecord.started, epochRecord.created, epochRecord.revoked)
			if subtle.ConstantTimeCompare(expectedMAC[:], epochRecord.recordMAC[:]) != 1 {
				return ledger.rollbackFailure(fmt.Errorf("authenticate live lifecycle runtime epoch: record mismatch"))
			}
			epochLive = epochRecord.revoked == nil && epochRecord.epoch == bootEpoch
		}
	}
	if !validSession || !epochLive {
		var current []byte
		if err := tx.QueryRowContext(ctx, `SELECT runtime_boot_epoch FROM protected_runtime_epoch WHERE revoked_commit_sequence IS NULL ORDER BY created_commit_sequence DESC LIMIT 1`).Scan(&current); err == nil {
			var epoch Identifier
			if copyIdentifier(&epoch, current) && epoch != bootEpoch {
				return fail(ReasonProtectedLocalBootEpochMismatch, true, "reconnect_desktop", fmt.Errorf("authorize lifecycle ledger mutation: boot epoch mismatch"))
			}
		}
		return fail(ReasonLifecycleChallengeMismatch, false, "reconnect_desktop", fmt.Errorf("authorize lifecycle ledger mutation: live desktop session mismatch"))
	}
	return nil
}

func (ledger *Ledger) loadOutstandingLifecycleChallenge(ctx context.Context, tx *sql.Tx, sessionID Identifier, action LifecycleAction, appID string) (lifecycleChallengeRecord, bool, error) {
	row := tx.QueryRowContext(ctx, lifecycleChallengeSelect+` WHERE desktop_session_id = ? AND action = ? AND app_id = ? AND revoked_commit_sequence IS NULL`, sessionID[:], string(action), appID)
	return ledger.scanLifecycleChallenge(row)
}

func (ledger *Ledger) loadLifecycleChallenge(ctx context.Context, tx *sql.Tx, challengeID Identifier, liveOnly bool) (lifecycleChallengeRecord, bool, error) {
	query := lifecycleChallengeSelect + ` WHERE challenge_id = ?`
	if liveOnly {
		query += ` AND revoked_commit_sequence IS NULL`
	}
	return ledger.scanLifecycleChallenge(tx.QueryRowContext(ctx, query, challengeID[:]))
}

const lifecycleChallengeSelect = `SELECT challenge_id, desktop_session_id, process_tuple_hash, account_generation, action, app_id, release_ref, artifact_digest, displayed_intent_hash, expected_adoption_generation, delete_durable_data, health_repair_action, target_job_id, runtime_boot_epoch, issued_unix_nano, deadline_unix_nano, created_commit_sequence, revoked_commit_sequence, record_hmac FROM protected_lifecycle_challenge`

type rowScanner interface {
	Scan(...any) error
}

func (ledger *Ledger) scanLifecycleChallenge(row rowScanner) (lifecycleChallengeRecord, bool, error) {
	var record lifecycleChallengeRecord
	var encodedID, encodedSession, encodedProcess, encodedArtifact, encodedDisplayed, encodedEpoch, encodedMAC []byte
	var accountGeneration, adoptionGeneration, deleteDurableData, healthRepairAction, created int64
	var action string
	var revoked sql.NullInt64
	err := row.Scan(&encodedID, &encodedSession, &encodedProcess, &accountGeneration, &action, &record.appID, &record.releaseRef,
		&encodedArtifact, &encodedDisplayed, &adoptionGeneration, &deleteDurableData, &healthRepairAction, &record.destructiveOptions.TargetJobID,
		&encodedEpoch, &record.issuedNanos, &record.deadlineNanos, &created, &revoked, &encodedMAC)
	if errors.Is(err, sql.ErrNoRows) {
		return lifecycleChallengeRecord{}, false, nil
	}
	if err != nil {
		return lifecycleChallengeRecord{}, false, fmt.Errorf("read lifecycle challenge: %w", err)
	}
	if accountGeneration < 0 || adoptionGeneration < 0 || deleteDurableData < 0 || deleteDurableData > 1 || healthRepairAction < 0 || healthRepairAction > 4 ||
		created < 0 || (revoked.Valid && revoked.Int64 < 0) ||
		!copyIdentifier(&record.challengeID, encodedID) || !copyIdentifier(&record.desktopSessionID, encodedSession) ||
		!copyIdentifier(&record.processHash, encodedProcess) || !copyIdentifierAllowZero(&record.artifactDigest, encodedArtifact) ||
		!copyIdentifier(&record.displayedDigest, encodedDisplayed) || !copyIdentifier(&record.bootEpoch, encodedEpoch) || !copyIdentifier(&record.recordMAC, encodedMAC) {
		return lifecycleChallengeRecord{}, false, fmt.Errorf("decode lifecycle challenge: invalid field")
	}
	record.accountGeneration = uint64(accountGeneration)
	record.adoptionGeneration = uint64(adoptionGeneration)
	record.destructiveOptions.DeleteDurableData = deleteDurableData == 1
	record.destructiveOptions.HealthRepairAction = LifecycleHealthRepairAction(healthRepairAction)
	record.action = LifecycleAction(action)
	record.created = uint64(created)
	if revoked.Valid {
		value := uint64(revoked.Int64)
		record.revoked = &value
	}
	if expected := ledger.lifecycleChallengeRecordMAC(record); subtle.ConstantTimeCompare(expected[:], record.recordMAC[:]) != 1 {
		return lifecycleChallengeRecord{}, false, fmt.Errorf("authenticate lifecycle challenge: record mismatch")
	}
	return record, true, nil
}

func (ledger *Ledger) revokeLifecycleChallenge(ctx context.Context, tx *sql.Tx, record *lifecycleChallengeRecord, sequence uint64) error {
	priorMAC := record.recordMAC
	record.revoked = &sequence
	nextMAC := ledger.lifecycleChallengeRecordMAC(*record)
	result, err := tx.ExecContext(ctx, `UPDATE protected_lifecycle_challenge SET revoked_commit_sequence = ?, record_hmac = ? WHERE challenge_id = ? AND revoked_commit_sequence IS NULL AND record_hmac = ?`, sequence, nextMAC[:], record.challengeID[:], priorMAC[:])
	if err != nil {
		return fmt.Errorf("revoke lifecycle challenge: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return fmt.Errorf("revoke lifecycle challenge: authoritative row changed")
	}
	record.recordMAC = nextMAC
	return nil
}

func (ledger *Ledger) insertLifecycleIntent(ctx context.Context, tx *sql.Tx, record *lifecycleIntentRecord) error {
	record.recordMAC = ledger.lifecycleIntentRecordMAC(*record)
	_, err := tx.ExecContext(ctx, `INSERT INTO protected_lifecycle_intent(intent_id, challenge_id, desktop_session_id, process_tuple_hash, account_generation, action, app_id, release_ref, artifact_digest, displayed_impact_digest, expected_adoption_generation, delete_durable_data, health_repair_action, target_job_id, runtime_boot_epoch, status, job_id, created_commit_sequence, record_hmac) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.intentID[:], record.challengeID[:], record.desktopSessionID[:], record.processHash[:], int64(record.accountGeneration), string(record.action), record.appID,
		record.releaseRef, record.artifactDigest[:], record.displayedDigest[:], int64(record.adoptionGeneration), sqliteBool(record.destructiveOptions.DeleteDurableData),
		int64(record.destructiveOptions.HealthRepairAction), record.destructiveOptions.TargetJobID, record.bootEpoch[:], string(record.status), record.jobID, record.created, record.recordMAC[:])
	if err != nil {
		return fmt.Errorf("insert lifecycle intent: %w", err)
	}
	return nil
}

func (ledger *Ledger) lifecycleIntentExists(ctx context.Context, tx *sql.Tx, intentID Identifier) (bool, error) {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM protected_lifecycle_intent WHERE intent_id = ?`, intentID[:]).Scan(&count); err != nil {
		return false, fmt.Errorf("read lifecycle intent replay state: %w", err)
	}
	return count == 1, nil
}

func (ledger *Ledger) setLifecycleRevocations(ctx context.Context, tx *sql.Tx, sequence uint64, desktopSessionID *Identifier) error {
	query := lifecycleChallengeSelect + ` WHERE revoked_commit_sequence IS NULL`
	args := make([]any, 0, 1)
	if desktopSessionID != nil {
		query += ` AND desktop_session_id = ?`
		args = append(args, desktopSessionID[:])
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("read live lifecycle challenges for revocation: %w", err)
	}
	challenges := make([]lifecycleChallengeRecord, 0)
	for rows.Next() {
		record, found, err := ledger.scanLifecycleChallenge(rows)
		if err != nil {
			_ = rows.Close()
			return err
		}
		if found {
			challenges = append(challenges, record)
		}
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close lifecycle challenge revocation rows: %w", err)
	}
	for index := range challenges {
		if err := ledger.revokeLifecycleChallenge(ctx, tx, &challenges[index], sequence); err != nil {
			return err
		}
	}

	intentQuery := lifecycleIntentSelect + ` WHERE revoked_commit_sequence IS NULL AND status IN (?, ?)`
	intentArgs := []any{string(LifecycleIntentStatusConsumed), string(LifecycleIntentStatusSideEffectStarted)}
	if desktopSessionID != nil {
		intentQuery += ` AND desktop_session_id = ?`
		intentArgs = append(intentArgs, desktopSessionID[:])
	}
	intentRows, err := tx.QueryContext(ctx, intentQuery, intentArgs...)
	if err != nil {
		return fmt.Errorf("read live lifecycle intents for revocation: %w", err)
	}
	intents := make([]lifecycleIntentRecord, 0)
	for intentRows.Next() {
		record, found, err := ledger.scanLifecycleIntent(intentRows)
		if err != nil {
			_ = intentRows.Close()
			return err
		}
		if found {
			intents = append(intents, record)
		}
	}
	if err := intentRows.Close(); err != nil {
		return fmt.Errorf("close lifecycle intent revocation rows: %w", err)
	}
	for index := range intents {
		if err := ledger.revokeLifecycleIntent(ctx, tx, &intents[index], sequence); err != nil {
			return err
		}
	}
	return nil
}

const lifecycleIntentSelect = `SELECT intent_id, challenge_id, desktop_session_id, process_tuple_hash, account_generation, action, app_id, release_ref, artifact_digest, displayed_impact_digest, expected_adoption_generation, delete_durable_data, health_repair_action, target_job_id, runtime_boot_epoch, status, job_id, created_commit_sequence, revoked_commit_sequence, record_hmac FROM protected_lifecycle_intent`

func (ledger *Ledger) scanLifecycleIntent(row rowScanner) (lifecycleIntentRecord, bool, error) {
	var record lifecycleIntentRecord
	var encodedIntent, encodedChallenge, encodedSession, encodedProcess, encodedArtifact, encodedDisplayed, encodedEpoch, encodedMAC []byte
	var accountGeneration, adoptionGeneration, deleteDurableData, healthRepairAction, created int64
	var action, status string
	var revoked sql.NullInt64
	err := row.Scan(&encodedIntent, &encodedChallenge, &encodedSession, &encodedProcess, &accountGeneration, &action, &record.appID, &record.releaseRef,
		&encodedArtifact, &encodedDisplayed, &adoptionGeneration, &deleteDurableData, &healthRepairAction, &record.destructiveOptions.TargetJobID,
		&encodedEpoch, &status, &record.jobID, &created, &revoked, &encodedMAC)
	if errors.Is(err, sql.ErrNoRows) {
		return lifecycleIntentRecord{}, false, nil
	}
	if err != nil {
		return lifecycleIntentRecord{}, false, fmt.Errorf("read lifecycle intent: %w", err)
	}
	if accountGeneration < 0 || adoptionGeneration < 0 || deleteDurableData < 0 || deleteDurableData > 1 || healthRepairAction < 0 || healthRepairAction > 4 ||
		created < 0 || (revoked.Valid && revoked.Int64 < 0) ||
		!copyIdentifier(&record.intentID, encodedIntent) || !copyIdentifier(&record.challengeID, encodedChallenge) ||
		!copyIdentifier(&record.desktopSessionID, encodedSession) || !copyIdentifier(&record.processHash, encodedProcess) ||
		!copyIdentifierAllowZero(&record.artifactDigest, encodedArtifact) || !copyIdentifier(&record.displayedDigest, encodedDisplayed) ||
		!copyIdentifier(&record.bootEpoch, encodedEpoch) || !copyIdentifier(&record.recordMAC, encodedMAC) {
		return lifecycleIntentRecord{}, false, fmt.Errorf("decode lifecycle intent: invalid field")
	}
	record.accountGeneration = uint64(accountGeneration)
	record.adoptionGeneration = uint64(adoptionGeneration)
	record.destructiveOptions.DeleteDurableData = deleteDurableData == 1
	record.destructiveOptions.HealthRepairAction = LifecycleHealthRepairAction(healthRepairAction)
	record.action = LifecycleAction(action)
	record.status = LifecycleIntentStatus(status)
	record.created = uint64(created)
	if revoked.Valid {
		value := uint64(revoked.Int64)
		record.revoked = &value
	}
	if expected := ledger.lifecycleIntentRecordMAC(record); subtle.ConstantTimeCompare(expected[:], record.recordMAC[:]) != 1 {
		return lifecycleIntentRecord{}, false, fmt.Errorf("authenticate lifecycle intent: record mismatch")
	}
	return record, true, nil
}

func (ledger *Ledger) revokeLifecycleIntent(ctx context.Context, tx *sql.Tx, record *lifecycleIntentRecord, sequence uint64) error {
	priorMAC := record.recordMAC
	record.revoked = &sequence
	nextMAC := ledger.lifecycleIntentRecordMAC(*record)
	result, err := tx.ExecContext(ctx, `UPDATE protected_lifecycle_intent SET revoked_commit_sequence = ?, record_hmac = ? WHERE intent_id = ? AND revoked_commit_sequence IS NULL AND record_hmac = ?`, sequence, nextMAC[:], record.intentID[:], priorMAC[:])
	if err != nil {
		return fmt.Errorf("revoke lifecycle intent: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return fmt.Errorf("revoke lifecycle intent: authoritative row changed")
	}
	record.recordMAC = nextMAC
	return nil
}

func (ledger *Ledger) restorePendingLifecycleRevocations(ctx context.Context, tx *sql.Tx, sequence uint64) error {
	challengeRows, err := tx.QueryContext(ctx, lifecycleChallengeSelect+` WHERE revoked_commit_sequence = ?`, sequence)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read pending lifecycle challenge revocations: %w", err))
	}
	challenges := make([]lifecycleChallengeRecord, 0)
	for challengeRows.Next() {
		record, found, err := ledger.scanLifecycleChallenge(challengeRows)
		if err != nil {
			_ = challengeRows.Close()
			return ledger.rollbackFailure(err)
		}
		if found {
			challenges = append(challenges, record)
		}
	}
	if err := challengeRows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close pending lifecycle challenge revocations: %w", err))
	}
	for _, record := range challenges {
		priorMAC := record.recordMAC
		record.revoked = nil
		nextMAC := ledger.lifecycleChallengeRecordMAC(record)
		result, err := tx.ExecContext(ctx, `UPDATE protected_lifecycle_challenge SET revoked_commit_sequence = NULL, record_hmac = ? WHERE challenge_id = ? AND revoked_commit_sequence = ? AND record_hmac = ?`, nextMAC[:], record.challengeID[:], sequence, priorMAC[:])
		if err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("restore pending lifecycle challenge revocation: %w", err))
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return ledger.rollbackFailure(fmt.Errorf("restore pending lifecycle challenge revocation: authoritative row changed"))
		}
	}

	intentRows, err := tx.QueryContext(ctx, lifecycleIntentSelect+` WHERE revoked_commit_sequence = ?`, sequence)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read pending lifecycle intent revocations: %w", err))
	}
	intents := make([]lifecycleIntentRecord, 0)
	for intentRows.Next() {
		record, found, err := ledger.scanLifecycleIntent(intentRows)
		if err != nil {
			_ = intentRows.Close()
			return ledger.rollbackFailure(err)
		}
		if found {
			intents = append(intents, record)
		}
	}
	if err := intentRows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close pending lifecycle intent revocations: %w", err))
	}
	for _, record := range intents {
		priorMAC := record.recordMAC
		record.revoked = nil
		nextMAC := ledger.lifecycleIntentRecordMAC(record)
		result, err := tx.ExecContext(ctx, `UPDATE protected_lifecycle_intent SET revoked_commit_sequence = NULL, record_hmac = ? WHERE intent_id = ? AND revoked_commit_sequence = ? AND record_hmac = ?`, nextMAC[:], record.intentID[:], sequence, priorMAC[:])
		if err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("restore pending lifecycle intent revocation: %w", err))
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return ledger.rollbackFailure(fmt.Errorf("restore pending lifecycle intent revocation: authoritative row changed"))
		}
	}
	return nil
}

func (ledger *Ledger) deletePendingLifecycleCreations(ctx context.Context, tx *sql.Tx, sequence uint64) error {
	for _, statement := range []string{
		`DELETE FROM protected_lifecycle_intent WHERE created_commit_sequence = ?`,
		`DELETE FROM protected_lifecycle_challenge WHERE created_commit_sequence = ?`,
	} {
		if _, err := tx.ExecContext(ctx, statement, sequence); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("discard pending lifecycle creation: %w", err))
		}
	}
	return nil
}

func (ledger *Ledger) verifyLifecycleRecords(ctx context.Context, commits map[uint64]commitRow, createdCounts, revokedCounts map[uint64]int) error {
	challengeRecords := make([]lifecycleChallengeRecord, 0)
	challengeRows, err := ledger.db.QueryContext(ctx, lifecycleChallengeSelect)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected lifecycle challenges: %w", err))
	}
	for challengeRows.Next() {
		record, found, err := ledger.scanLifecycleChallenge(challengeRows)
		if err != nil || !found {
			_ = challengeRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle challenge record: %w", err))
		}
		challengeRecords = append(challengeRecords, record)
	}
	if err := challengeRows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close protected lifecycle challenge rows: %w", err))
	}
	challenges := make(map[Identifier]lifecycleChallengeRecord, len(challengeRecords))
	for _, record := range challengeRecords {
		if err := validateLifecycleChallengeRecord(record); err != nil {
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle challenge binding: %w", err))
		}
		var parentCount int
		if err := ledger.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM protected_desktop_session WHERE desktop_session_id = ? AND process_tuple_hash = ? AND runtime_boot_epoch = ?`, record.desktopSessionID[:], record.processHash[:], record.bootEpoch[:]).Scan(&parentCount); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("verify lifecycle challenge parent: %w", err))
		}
		commit, ok := commits[record.created]
		expectedPayload := sha256.Sum256(lifecycleChallengePayload(record))
		if parentCount != 1 || !ok || commit.eventKind != "lifecycle_challenge_prepare" || subtle.ConstantTimeCompare(expectedPayload[:], commit.payloadHash[:]) != 1 {
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle challenge: creation binding mismatch"))
		}
		createdCounts[record.created]++
		if record.revoked != nil {
			revocation, ok := commits[*record.revoked]
			if !ok || *record.revoked <= record.created || !lifecycleChallengeRevocationEvent(revocation.eventKind) {
				return ledger.rollbackFailure(fmt.Errorf("verify lifecycle challenge: revocation commit mismatch"))
			}
			revokedCounts[*record.revoked]++
		}
		if _, duplicate := challenges[record.challengeID]; duplicate {
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle challenge: duplicate identifier"))
		}
		challenges[record.challengeID] = record
	}

	intents := make(map[Identifier]lifecycleIntentRecord)
	intentRows, err := ledger.db.QueryContext(ctx, lifecycleIntentSelect)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read protected lifecycle intents: %w", err))
	}
	for intentRows.Next() {
		record, found, err := ledger.scanLifecycleIntent(intentRows)
		if err != nil || !found {
			_ = intentRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle intent record: %w", err))
		}
		challenge, ok := challenges[record.challengeID]
		if !ok || record.intentID != record.challengeID || !challengeMatchesIntent(challenge, record) || record.jobID != "" {
			_ = intentRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle intent: challenge binding mismatch"))
		}
		expectedEvent := lifecycleIntentCreationEvent(record.status)
		commit, ok := commits[record.created]
		if !ok || expectedEvent == "" || commit.eventKind != expectedEvent {
			_ = intentRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle intent: creation commit mismatch"))
		}
		if record.status != LifecycleIntentStatusCancelled {
			expectedPayload := sha256.Sum256(lifecycleIntentPayload(record))
			if subtle.ConstantTimeCompare(expectedPayload[:], commit.payloadHash[:]) != 1 {
				_ = intentRows.Close()
				return ledger.rollbackFailure(fmt.Errorf("verify lifecycle intent: creation payload mismatch"))
			}
		}
		createdCounts[record.created]++
		if record.revoked != nil {
			revocation, ok := commits[*record.revoked]
			if record.status.terminal() || !ok || *record.revoked <= record.created ||
				(revocation.eventKind != "runtime_start" && revocation.eventKind != "desktop_session_revoke") {
				_ = intentRows.Close()
				return ledger.rollbackFailure(fmt.Errorf("verify lifecycle intent: revocation commit mismatch"))
			}
			revokedCounts[*record.revoked]++
		}
		if _, duplicate := intents[record.intentID]; duplicate {
			_ = intentRows.Close()
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle intent: duplicate identifier"))
		}
		intents[record.intentID] = record
	}
	if err := intentRows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close protected lifecycle intent rows: %w", err))
	}

	for challengeID, challenge := range challenges {
		intent, hasIntent := intents[challengeID]
		if challenge.revoked == nil {
			if hasIntent {
				return ledger.rollbackFailure(fmt.Errorf("verify lifecycle challenge: live challenge already has an intent"))
			}
			continue
		}
		revocation := commits[*challenge.revoked]
		expectedStatus := lifecycleStatusForChallengeRevocation(revocation.eventKind)
		if expectedStatus == "" {
			if hasIntent {
				return ledger.rollbackFailure(fmt.Errorf("verify lifecycle challenge: session revocation unexpectedly created intent"))
			}
			continue
		}
		if !hasIntent || intent.created != *challenge.revoked || intent.status != expectedStatus {
			return ledger.rollbackFailure(fmt.Errorf("verify lifecycle challenge: durable terminal intent mismatch"))
		}
	}
	return nil
}

func lifecycleChallengeRevocationEvent(eventKind string) bool {
	switch eventKind {
	case "lifecycle_challenge_prepare", "lifecycle_intent_consume", "lifecycle_challenge_expire", "runtime_start", "desktop_session_revoke":
		return true
	default:
		return false
	}
}

func lifecycleIntentCreationEvent(status LifecycleIntentStatus) string {
	switch status {
	case LifecycleIntentStatusCancelled:
		return "lifecycle_challenge_prepare"
	case LifecycleIntentStatusConsumed:
		return "lifecycle_intent_consume"
	case LifecycleIntentStatusExpired:
		return "lifecycle_challenge_expire"
	default:
		return ""
	}
}

func lifecycleStatusForChallengeRevocation(eventKind string) LifecycleIntentStatus {
	switch eventKind {
	case "lifecycle_challenge_prepare":
		return LifecycleIntentStatusCancelled
	case "lifecycle_intent_consume":
		return LifecycleIntentStatusConsumed
	case "lifecycle_challenge_expire":
		return LifecycleIntentStatusExpired
	default:
		return ""
	}
}

func sqliteBool(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

func validateLifecycleChallengeRecord(record lifecycleChallengeRecord) error {
	ttlNanos := int64(LifecycleChallengeTTL)
	if record.challengeID == (Identifier{}) || record.desktopSessionID == (Identifier{}) || record.processHash == (Identifier{}) ||
		record.bootEpoch == (Identifier{}) || record.accountGeneration == 0 || record.accountGeneration > math.MaxInt64 ||
		record.issuedNanos <= 0 || record.issuedNanos > math.MaxInt64-ttlNanos || record.deadlineNanos != record.issuedNanos+ttlNanos {
		return fail(ReasonLifecycleChallengeMismatch, false, "prepare_lifecycle_intent", fmt.Errorf("prepare lifecycle challenge: incomplete durable binding"))
	}
	return validateLifecycleChallengeInput(LifecycleChallengeInput{
		AccountGeneration:          record.accountGeneration,
		Action:                     record.action,
		AppID:                      record.appID,
		ReleaseRef:                 record.releaseRef,
		ArtifactDigest:             record.artifactDigest,
		DisplayedImpactDigest:      record.displayedDigest,
		ExpectedAdoptionGeneration: record.adoptionGeneration,
		DestructiveOptions:         record.destructiveOptions,
	})
}

func challengeMatchesIntent(challenge lifecycleChallengeRecord, intent lifecycleIntentRecord) bool {
	return challenge.challengeID == intent.challengeID && challenge.desktopSessionID == intent.desktopSessionID &&
		challenge.processHash == intent.processHash && challenge.accountGeneration == intent.accountGeneration &&
		challenge.action == intent.action && challenge.appID == intent.appID && challenge.releaseRef == intent.releaseRef &&
		challenge.adoptionGeneration == intent.adoptionGeneration && challenge.destructiveOptions == intent.destructiveOptions &&
		subtle.ConstantTimeCompare(challenge.artifactDigest[:], intent.artifactDigest[:]) == 1 &&
		subtle.ConstantTimeCompare(challenge.displayedDigest[:], intent.displayedDigest[:]) == 1 && challenge.bootEpoch == intent.bootEpoch
}

func (ledger *Ledger) lifecycleChallengeRecordMAC(record lifecycleChallengeRecord) Identifier {
	return ledger.recordMAC("lifecycle_challenge", lifecycleChallengePayload(record), uint64Bytes(record.created), optionalUint64Bytes(record.revoked))
}

func (ledger *Ledger) lifecycleIntentRecordMAC(record lifecycleIntentRecord) Identifier {
	return ledger.recordMAC("lifecycle_intent", lifecycleIntentPayload(record), []byte(record.jobID), uint64Bytes(record.created), optionalUint64Bytes(record.revoked))
}

func lifecycleChallengePayload(record lifecycleChallengeRecord) []byte {
	var payload bytes.Buffer
	_, _ = payload.Write(record.challengeID[:])
	_, _ = payload.Write(record.desktopSessionID[:])
	_, _ = payload.Write(record.processHash[:])
	_, _ = payload.Write(uint64Bytes(record.accountGeneration))
	writeCanonicalString(&payload, string(record.action))
	writeCanonicalString(&payload, record.appID)
	writeCanonicalString(&payload, record.releaseRef)
	_, _ = payload.Write(record.artifactDigest[:])
	_, _ = payload.Write(record.displayedDigest[:])
	_, _ = payload.Write(uint64Bytes(record.adoptionGeneration))
	_, _ = payload.Write(uint64Bytes(uint64(sqliteBool(record.destructiveOptions.DeleteDurableData))))
	_, _ = payload.Write(uint64Bytes(uint64(record.destructiveOptions.HealthRepairAction)))
	writeCanonicalString(&payload, record.destructiveOptions.TargetJobID)
	_, _ = payload.Write(record.bootEpoch[:])
	_, _ = payload.Write(int64Bytes(record.issuedNanos))
	_, _ = payload.Write(int64Bytes(record.deadlineNanos))
	return payload.Bytes()
}

func lifecycleIntentPayload(record lifecycleIntentRecord) []byte {
	var payload bytes.Buffer
	_, _ = payload.Write(record.intentID[:])
	_, _ = payload.Write(record.challengeID[:])
	_, _ = payload.Write(record.desktopSessionID[:])
	_, _ = payload.Write(record.processHash[:])
	_, _ = payload.Write(uint64Bytes(record.accountGeneration))
	writeCanonicalString(&payload, string(record.action))
	writeCanonicalString(&payload, record.appID)
	writeCanonicalString(&payload, record.releaseRef)
	_, _ = payload.Write(record.artifactDigest[:])
	_, _ = payload.Write(record.displayedDigest[:])
	_, _ = payload.Write(uint64Bytes(record.adoptionGeneration))
	_, _ = payload.Write(uint64Bytes(uint64(sqliteBool(record.destructiveOptions.DeleteDurableData))))
	_, _ = payload.Write(uint64Bytes(uint64(record.destructiveOptions.HealthRepairAction)))
	writeCanonicalString(&payload, record.destructiveOptions.TargetJobID)
	_, _ = payload.Write(record.bootEpoch[:])
	writeCanonicalString(&payload, string(record.status))
	return payload.Bytes()
}
