package protectedlocal

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const (
	LedgerFilename      = "protected_local.db"
	ledgerSchemaVersion = 4
	ledgerBusyTimeoutMS = 5000
)

type LedgerOptions struct {
	Path         string
	AnchorStore  AnchorStore
	RecordMACKey []byte
	Random       io.Reader
	Now          func() time.Time
}

type commitPhase uint8

const (
	commitPhasePendingDurable commitPhase = iota + 1
	commitPhaseAnchorAdvanced
	commitPhaseCompleteDurable
)

type Ledger struct {
	db          *sql.DB
	anchorStore AnchorStore
	macKey      []byte
	random      io.Reader
	now         func() time.Time

	mu         sync.Mutex
	anchor     Anchor
	commitHook func(commitPhase) error
	closed     bool
}

func OpenLedger(ctx context.Context, options LedgerOptions) (*Ledger, error) {
	path := filepath.Clean(options.Path)
	if !filepath.IsAbs(path) || filepath.Base(path) != LedgerFilename {
		return nil, fail(ReasonProtectedLocalLedgerUnavailable, false, "repair_runtime_service", fmt.Errorf("open protected-local ledger: exact service-owned filename required"))
	}
	if options.AnchorStore == nil || len(options.RecordMACKey) < sha256.Size {
		return nil, fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "repair_runtime_service", fmt.Errorf("open protected-local ledger: secure anchor and 32-byte record key required"))
	}
	if options.Random == nil {
		options.Random = rand.Reader
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(%d)&_pragma=synchronous(FULL)&_txlock=immediate", filepath.ToSlash(path), ledgerBusyTimeoutMS)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("open protected-local sqlite: %w", err))
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ledger := &Ledger{
		db:          db,
		anchorStore: options.AnchorStore,
		macKey:      append([]byte(nil), options.RecordMACKey...),
		random:      options.Random,
		now:         options.Now,
	}
	if err := ledger.initialize(ctx); err != nil {
		_ = db.Close()
		zeroBytes(ledger.macKey)
		ledger.macKey = nil
		return nil, err
	}
	return ledger, nil
}

func (ledger *Ledger) initializeGenesis(ctx context.Context) error {
	ledgerUUID, err := readIdentifier(ledger.random)
	if err != nil {
		return fail(ReasonProtectedLocalCustodyBoundaryUnavailable, false, "restart_runtime_service", fmt.Errorf("generate protected-local ledger UUID: %w", err))
	}
	payloadHash := sha256.Sum256([]byte("nimi/protected-local/genesis/v1"))
	createdNanos := ledger.now().UTC().UnixNano()
	head := ledger.chainHead(ledgerUUID, 0, Identifier{}, payloadHash, "genesis", createdNanos)
	row := commitRow{sequence: 0, ledgerUUID: ledgerUUID, payloadHash: payloadHash, chainHead: head, state: commitStatePending, eventKind: "genesis", createdNanos: createdNanos, recordMAC: head}
	if err := ledger.insertPending(ctx, row, nil); err != nil {
		return err
	}
	anchor := Anchor{LedgerUUID: ledgerUUID, CommitSequence: 0, CommitChainHead: head}
	if err := ledger.anchorStore.Store(ctx, anchor); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("store protected-local genesis anchor: %w", err))
	}
	if err := ledger.completePending(ctx, 0); err != nil {
		return err
	}
	ledger.anchor = anchor
	return nil
}

func (ledger *Ledger) StartRuntime(ctx context.Context) (Identifier, error) {
	epoch, err := NewBootEpoch(ledger.random)
	if err != nil {
		return Identifier{}, err
	}
	now := ledger.now().UTC().UnixNano()
	payload := make([]byte, 0, IdentifierBytes+8)
	payload = append(payload, epoch[:]...)
	var timestamp [8]byte
	binary.BigEndian.PutUint64(timestamp[:], uint64(now))
	payload = append(payload, timestamp[:]...)
	err = ledger.commit(ctx, "runtime_start", payload, func(tx *sql.Tx, sequence uint64) error {
		if err := ledger.setRuntimeEpochRevocations(ctx, tx, sequence); err != nil {
			return err
		}
		if err := ledger.setDesktopSessionRevocations(ctx, tx, sequence); err != nil {
			return err
		}
		recordMAC := ledger.runtimeEpochRecordMAC(epoch, now, sequence, nil)
		if _, err := tx.ExecContext(ctx, `INSERT INTO protected_runtime_epoch(runtime_boot_epoch, started_unix_nano, created_commit_sequence, record_hmac) VALUES (?, ?, ?, ?)`, epoch[:], now, sequence, recordMAC[:]); err != nil {
			return fmt.Errorf("insert runtime epoch: %w", err)
		}
		auditID := ledger.recordMAC("startup_audit_id", epoch[:], uint64Bytes(sequence))
		auditMAC := ledger.startupAuditRecordMAC(auditID, epoch, sequence, now, nil)
		if _, err := tx.ExecContext(ctx, `INSERT INTO protected_security_audit_outbox(audit_id, event_type, runtime_boot_epoch, occurred_unix_nano, created_commit_sequence, record_hmac) VALUES (?, 'runtime_start', ?, ?, ?, ?)`, auditID[:], epoch[:], now, sequence, auditMAC[:]); err != nil {
			return fmt.Errorf("insert startup audit: %w", err)
		}
		return nil
	})
	if err != nil {
		return Identifier{}, err
	}
	return epoch, nil
}

func (ledger *Ledger) setRuntimeEpochRevocations(ctx context.Context, tx *sql.Tx, sequence uint64) error {
	rows, err := tx.QueryContext(ctx, `SELECT runtime_boot_epoch, started_unix_nano, created_commit_sequence, record_hmac FROM protected_runtime_epoch WHERE revoked_commit_sequence IS NULL`)
	if err != nil {
		return fmt.Errorf("read prior runtime epochs: %w", err)
	}
	records := make([]runtimeEpochRow, 0)
	for rows.Next() {
		var encodedEpoch, encodedMAC []byte
		var started, created int64
		if err := rows.Scan(&encodedEpoch, &started, &created, &encodedMAC); err != nil {
			_ = rows.Close()
			return fmt.Errorf("decode prior runtime epoch: %w", err)
		}
		var epoch, recordMAC Identifier
		if created < 0 || !copyIdentifier(&epoch, encodedEpoch) || !copyIdentifier(&recordMAC, encodedMAC) {
			_ = rows.Close()
			return fmt.Errorf("decode prior runtime epoch: invalid field")
		}
		record := runtimeEpochRow{epoch: epoch, started: started, created: uint64(created), recordMAC: recordMAC}
		expectedMAC := ledger.runtimeEpochRecordMAC(record.epoch, record.started, record.created, nil)
		if subtle.ConstantTimeCompare(expectedMAC[:], record.recordMAC[:]) != 1 {
			_ = rows.Close()
			return fmt.Errorf("authenticate prior runtime epoch: record mismatch")
		}
		records = append(records, record)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close prior runtime epochs: %w", err)
	}
	for _, record := range records {
		revoked := sequence
		nextMAC := ledger.runtimeEpochRecordMAC(record.epoch, record.started, record.created, &revoked)
		result, err := tx.ExecContext(ctx, `UPDATE protected_runtime_epoch SET revoked_commit_sequence = ?, record_hmac = ? WHERE runtime_boot_epoch = ? AND revoked_commit_sequence IS NULL AND record_hmac = ?`, sequence, nextMAC[:], record.epoch[:], record.recordMAC[:])
		if err != nil {
			return fmt.Errorf("revoke prior runtime epoch: %w", err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return fmt.Errorf("revoke prior runtime epoch: authoritative row changed")
		}
	}
	return nil
}

func (ledger *Ledger) setDesktopSessionRevocations(ctx context.Context, tx *sql.Tx, sequence uint64) error {
	rows, err := tx.QueryContext(ctx, `SELECT desktop_session_id, runtime_boot_epoch, connection_id, process_tuple_hash, opened_unix_nano, created_commit_sequence, record_hmac FROM protected_desktop_session WHERE revoked_commit_sequence IS NULL`)
	if err != nil {
		return fmt.Errorf("read prior desktop sessions: %w", err)
	}
	records := make([]desktopSessionRow, 0)
	for rows.Next() {
		var encodedSession, encodedEpoch, encodedConnection, encodedProcess, encodedMAC []byte
		var opened, created int64
		if err := rows.Scan(&encodedSession, &encodedEpoch, &encodedConnection, &encodedProcess, &opened, &created, &encodedMAC); err != nil {
			_ = rows.Close()
			return fmt.Errorf("decode prior desktop session: %w", err)
		}
		var record desktopSessionRow
		if created < 0 || !copyIdentifier(&record.sessionID, encodedSession) || !copyIdentifier(&record.epoch, encodedEpoch) ||
			!copyIdentifier(&record.connection, encodedConnection) || !copyIdentifier(&record.processHash, encodedProcess) || !copyIdentifier(&record.recordMAC, encodedMAC) {
			_ = rows.Close()
			return fmt.Errorf("decode prior desktop session: invalid field")
		}
		record.opened = opened
		record.created = uint64(created)
		expectedMAC := ledger.desktopSessionRecordMAC(record)
		if subtle.ConstantTimeCompare(expectedMAC[:], record.recordMAC[:]) != 1 {
			_ = rows.Close()
			return fmt.Errorf("authenticate prior desktop session: record mismatch")
		}
		records = append(records, record)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close prior desktop sessions: %w", err)
	}
	for _, record := range records {
		revoked := sequence
		record.revoked = &revoked
		nextMAC := ledger.desktopSessionRecordMAC(record)
		result, err := tx.ExecContext(ctx, `UPDATE protected_desktop_session SET revoked_commit_sequence = ?, record_hmac = ? WHERE desktop_session_id = ? AND revoked_commit_sequence IS NULL AND record_hmac = ?`, sequence, nextMAC[:], record.sessionID[:], record.recordMAC[:])
		if err != nil {
			return fmt.Errorf("revoke prior desktop session: %w", err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return fmt.Errorf("revoke prior desktop session: authoritative row changed")
		}
	}
	return nil
}

func (ledger *Ledger) RecordDesktopSessionOpened(ctx context.Context, record DesktopSessionRecord) error {
	if record.SessionID == (Identifier{}) || record.BootEpoch == (Identifier{}) || record.Connection == (Identifier{}) || record.ProcessHash == (Identifier{}) {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "reconnect_desktop", fmt.Errorf("record desktop session: incomplete binding"))
	}
	if record.BootEpoch != ledger.currentBootEpoch(ctx) {
		return fail(ReasonProtectedLocalBootEpochMismatch, true, "reconnect_desktop", fmt.Errorf("record desktop session: boot epoch mismatch"))
	}
	now := ledger.now().UTC().UnixNano()
	payload := append(append(append(append([]byte{}, record.SessionID[:]...), record.BootEpoch[:]...), record.Connection[:]...), record.ProcessHash[:]...)
	return ledger.commit(ctx, "desktop_session_open", payload, func(tx *sql.Tx, sequence uint64) error {
		recordMAC := ledger.desktopSessionRecordMAC(desktopSessionRow{
			sessionID:   record.SessionID,
			epoch:       record.BootEpoch,
			connection:  record.Connection,
			processHash: record.ProcessHash,
			opened:      now,
			created:     sequence,
		})
		_, err := tx.ExecContext(ctx, `INSERT INTO protected_desktop_session(desktop_session_id, runtime_boot_epoch, connection_id, process_tuple_hash, opened_unix_nano, created_commit_sequence, record_hmac) VALUES (?, ?, ?, ?, ?, ?, ?)`, record.SessionID[:], record.BootEpoch[:], record.Connection[:], record.ProcessHash[:], now, sequence, recordMAC[:])
		if err != nil {
			return fmt.Errorf("insert desktop session: %w", err)
		}
		return nil
	})
}

func (ledger *Ledger) RecordDesktopSessionRevoked(ctx context.Context, sessionID Identifier) error {
	if sessionID == (Identifier{}) {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "reconnect_desktop", fmt.Errorf("revoke desktop session: empty session id"))
	}
	return ledger.commit(ctx, "desktop_session_revoke", sessionID[:], func(tx *sql.Tx, sequence uint64) error {
		var encodedEpoch, encodedConnection, encodedProcess, encodedMAC []byte
		var opened, created int64
		if err := tx.QueryRowContext(ctx, `SELECT runtime_boot_epoch, connection_id, process_tuple_hash, opened_unix_nano, created_commit_sequence, record_hmac FROM protected_desktop_session WHERE desktop_session_id = ? AND revoked_commit_sequence IS NULL`, sessionID[:]).Scan(&encodedEpoch, &encodedConnection, &encodedProcess, &opened, &created, &encodedMAC); err != nil {
			return fmt.Errorf("read authoritative desktop session: %w", err)
		}
		record := desktopSessionRow{sessionID: sessionID, opened: opened}
		if created < 0 || !copyIdentifier(&record.epoch, encodedEpoch) || !copyIdentifier(&record.connection, encodedConnection) ||
			!copyIdentifier(&record.processHash, encodedProcess) || !copyIdentifier(&record.recordMAC, encodedMAC) {
			return fmt.Errorf("decode authoritative desktop session: invalid field")
		}
		record.created = uint64(created)
		expectedMAC := ledger.desktopSessionRecordMAC(record)
		if subtle.ConstantTimeCompare(expectedMAC[:], record.recordMAC[:]) != 1 {
			return fmt.Errorf("authenticate authoritative desktop session: record mismatch")
		}
		revoked := sequence
		record.revoked = &revoked
		nextMAC := ledger.desktopSessionRecordMAC(record)
		result, err := tx.ExecContext(ctx, `UPDATE protected_desktop_session SET revoked_commit_sequence = ?, record_hmac = ? WHERE desktop_session_id = ? AND revoked_commit_sequence IS NULL AND record_hmac = ?`, sequence, nextMAC[:], sessionID[:], record.recordMAC[:])
		if err != nil {
			return fmt.Errorf("revoke desktop session: %w", err)
		}
		rows, err := result.RowsAffected()
		if err != nil || rows != 1 {
			return fmt.Errorf("revoke desktop session: authoritative live session not found")
		}
		return nil
	})
}

func (ledger *Ledger) currentBootEpoch(ctx context.Context) Identifier {
	var encoded []byte
	err := ledger.db.QueryRowContext(ctx, `SELECT runtime_boot_epoch FROM protected_runtime_epoch epoch JOIN protected_security_commit committed ON committed.commit_sequence = epoch.created_commit_sequence WHERE committed.state = 'complete' AND (epoch.revoked_commit_sequence IS NULL OR NOT EXISTS (SELECT 1 FROM protected_security_commit revocation WHERE revocation.commit_sequence = epoch.revoked_commit_sequence AND revocation.state = 'complete')) ORDER BY epoch.created_commit_sequence DESC LIMIT 1`).Scan(&encoded)
	if err != nil {
		return Identifier{}
	}
	var epoch Identifier
	if !copyIdentifier(&epoch, encoded) {
		return Identifier{}
	}
	return epoch
}

func (ledger *Ledger) commit(ctx context.Context, eventKind string, payload []byte, mutate func(*sql.Tx, uint64) error) error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	if ledger.closed {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "restart_runtime_service", fmt.Errorf("commit protected-local ledger: ledger is closed"))
	}
	if ledger.anchor.CommitSequence == math.MaxInt64 {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("commit protected-local ledger: sequence exhausted"))
	}
	sequence := ledger.anchor.CommitSequence + 1
	payloadHash := sha256.Sum256(payload)
	createdNanos := ledger.now().UTC().UnixNano()
	head := ledger.chainHead(ledger.anchor.LedgerUUID, sequence, ledger.anchor.CommitChainHead, payloadHash, eventKind, createdNanos)
	row := commitRow{sequence: sequence, ledgerUUID: ledger.anchor.LedgerUUID, previousHead: ledger.anchor.CommitChainHead, payloadHash: payloadHash, chainHead: head, state: commitStatePending, eventKind: eventKind, createdNanos: createdNanos, recordMAC: head}
	if err := ledger.insertPending(ctx, row, mutate); err != nil {
		return err
	}
	if ledger.commitHook != nil {
		if err := ledger.commitHook(commitPhasePendingDurable); err != nil {
			return fmt.Errorf("commit protected-local ledger after pending head: %w", err)
		}
	}
	nextAnchor := Anchor{LedgerUUID: row.ledgerUUID, CommitSequence: row.sequence, CommitChainHead: row.chainHead}
	if err := ledger.anchorStore.Store(ctx, nextAnchor); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("advance protected-local anchor: %w", err))
	}
	if ledger.commitHook != nil {
		if err := ledger.commitHook(commitPhaseAnchorAdvanced); err != nil {
			return fmt.Errorf("commit protected-local ledger after anchor advance: %w", err)
		}
	}
	if err := ledger.completePending(ctx, sequence); err != nil {
		return err
	}
	ledger.anchor = nextAnchor
	if ledger.commitHook != nil {
		if err := ledger.commitHook(commitPhaseCompleteDurable); err != nil {
			return fmt.Errorf("commit protected-local ledger after complete head: %w", err)
		}
	}
	return nil
}

func (ledger *Ledger) insertPending(ctx context.Context, row commitRow, mutate func(*sql.Tx, uint64) error) error {
	tx, err := ledger.db.BeginTx(ctx, nil)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("begin protected-local pending transaction: %w", err))
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT INTO protected_security_commit(commit_sequence, ledger_uuid, previous_chain_head, payload_hash, chain_head, state, event_kind, created_unix_nano, record_hmac) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`, row.sequence, row.ledgerUUID[:], row.previousHead[:], row.payloadHash[:], row.chainHead[:], row.eventKind, row.createdNanos, row.recordMAC[:]); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("insert protected-local pending head: %w", err))
	}
	if mutate != nil {
		if err := mutate(tx, row.sequence); err != nil {
			var failure *Failure
			if errors.As(err, &failure) {
				return err
			}
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("apply protected-local anchored mutation: %w", err))
		}
	}
	if err := tx.Commit(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("commit protected-local pending head: %w", err))
	}
	return ledger.checkpoint(ctx)
}

func (ledger *Ledger) completePending(ctx context.Context, sequence uint64) error {
	tx, err := ledger.db.BeginTx(ctx, nil)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("begin protected-local completion transaction: %w", err))
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `UPDATE protected_security_commit SET state = 'complete' WHERE commit_sequence = ? AND state = 'pending'`, sequence)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("complete protected-local pending head: %w", err))
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return ledger.rollbackFailure(fmt.Errorf("complete protected-local pending head: expected one pending row"))
	}
	if err := tx.Commit(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("commit protected-local completion: %w", err))
	}
	return ledger.checkpoint(ctx)
}

func (ledger *Ledger) discardPending(ctx context.Context, sequence uint64) error {
	tx, err := ledger.db.BeginTx(ctx, nil)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("begin protected-local pending discard: %w", err))
	}
	defer func() { _ = tx.Rollback() }()
	if err := ledger.restorePendingRuntimeEpochRevocations(ctx, tx, sequence); err != nil {
		return err
	}
	if err := ledger.restorePendingDesktopSessionRevocations(ctx, tx, sequence); err != nil {
		return err
	}
	for _, statement := range pendingDiscardStatements {
		if _, err := tx.ExecContext(ctx, statement, sequence); err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("discard protected-local pending records: %w", err))
		}
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM protected_security_commit WHERE commit_sequence = ? AND state = 'pending'`, sequence)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, false, "reset_protected_state", fmt.Errorf("discard protected-local pending head: %w", err))
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return ledger.rollbackFailure(fmt.Errorf("discard protected-local pending head: expected one pending row"))
	}
	if err := tx.Commit(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("commit protected-local pending discard: %w", err))
	}
	return ledger.checkpoint(ctx)
}

func (ledger *Ledger) restorePendingRuntimeEpochRevocations(ctx context.Context, tx *sql.Tx, sequence uint64) error {
	rows, err := tx.QueryContext(ctx, `SELECT runtime_boot_epoch, started_unix_nano, created_commit_sequence, record_hmac FROM protected_runtime_epoch WHERE revoked_commit_sequence = ?`, sequence)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read pending runtime epoch revocations: %w", err))
	}
	records := make([]runtimeEpochRow, 0)
	for rows.Next() {
		var encodedEpoch, encodedMAC []byte
		var started, created int64
		if err := rows.Scan(&encodedEpoch, &started, &created, &encodedMAC); err != nil {
			_ = rows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode pending runtime epoch revocation: %w", err))
		}
		var record runtimeEpochRow
		if created < 0 || !copyIdentifier(&record.epoch, encodedEpoch) || !copyIdentifier(&record.recordMAC, encodedMAC) {
			_ = rows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode pending runtime epoch revocation: invalid field"))
		}
		record.started = started
		record.created = uint64(created)
		revoked := sequence
		record.revoked = &revoked
		expectedMAC := ledger.runtimeEpochRecordMAC(record.epoch, record.started, record.created, record.revoked)
		if subtle.ConstantTimeCompare(expectedMAC[:], record.recordMAC[:]) != 1 {
			_ = rows.Close()
			return ledger.rollbackFailure(fmt.Errorf("authenticate pending runtime epoch revocation: mismatch"))
		}
		records = append(records, record)
	}
	if err := rows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close pending runtime epoch revocations: %w", err))
	}
	for _, record := range records {
		restoredMAC := ledger.runtimeEpochRecordMAC(record.epoch, record.started, record.created, nil)
		result, err := tx.ExecContext(ctx, `UPDATE protected_runtime_epoch SET revoked_commit_sequence = NULL, record_hmac = ? WHERE runtime_boot_epoch = ? AND revoked_commit_sequence = ? AND record_hmac = ?`, restoredMAC[:], record.epoch[:], sequence, record.recordMAC[:])
		if err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("restore pending runtime epoch revocation: %w", err))
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return ledger.rollbackFailure(fmt.Errorf("restore pending runtime epoch revocation: authoritative row changed"))
		}
	}
	return nil
}

func (ledger *Ledger) restorePendingDesktopSessionRevocations(ctx context.Context, tx *sql.Tx, sequence uint64) error {
	rows, err := tx.QueryContext(ctx, `SELECT desktop_session_id, runtime_boot_epoch, connection_id, process_tuple_hash, opened_unix_nano, created_commit_sequence, record_hmac FROM protected_desktop_session WHERE revoked_commit_sequence = ?`, sequence)
	if err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("read pending desktop session revocations: %w", err))
	}
	records := make([]desktopSessionRow, 0)
	for rows.Next() {
		var encodedSession, encodedEpoch, encodedConnection, encodedProcess, encodedMAC []byte
		var opened, created int64
		if err := rows.Scan(&encodedSession, &encodedEpoch, &encodedConnection, &encodedProcess, &opened, &created, &encodedMAC); err != nil {
			_ = rows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode pending desktop session revocation: %w", err))
		}
		var record desktopSessionRow
		if created < 0 || !copyIdentifier(&record.sessionID, encodedSession) || !copyIdentifier(&record.epoch, encodedEpoch) ||
			!copyIdentifier(&record.connection, encodedConnection) || !copyIdentifier(&record.processHash, encodedProcess) || !copyIdentifier(&record.recordMAC, encodedMAC) {
			_ = rows.Close()
			return ledger.rollbackFailure(fmt.Errorf("decode pending desktop session revocation: invalid field"))
		}
		record.opened = opened
		record.created = uint64(created)
		revoked := sequence
		record.revoked = &revoked
		expectedMAC := ledger.desktopSessionRecordMAC(record)
		if subtle.ConstantTimeCompare(expectedMAC[:], record.recordMAC[:]) != 1 {
			_ = rows.Close()
			return ledger.rollbackFailure(fmt.Errorf("authenticate pending desktop session revocation: mismatch"))
		}
		records = append(records, record)
	}
	if err := rows.Close(); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("close pending desktop session revocations: %w", err))
	}
	for _, record := range records {
		record.revoked = nil
		restoredMAC := ledger.desktopSessionRecordMAC(record)
		result, err := tx.ExecContext(ctx, `UPDATE protected_desktop_session SET revoked_commit_sequence = NULL, record_hmac = ? WHERE desktop_session_id = ? AND revoked_commit_sequence = ? AND record_hmac = ?`, restoredMAC[:], record.sessionID[:], sequence, record.recordMAC[:])
		if err != nil {
			return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("restore pending desktop session revocation: %w", err))
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return ledger.rollbackFailure(fmt.Errorf("restore pending desktop session revocation: authoritative row changed"))
		}
	}
	return nil
}

func (ledger *Ledger) checkpoint(ctx context.Context) error {
	var busy, logFrames, checkpointed int
	if err := ledger.db.QueryRowContext(ctx, `PRAGMA wal_checkpoint(FULL)`).Scan(&busy, &logFrames, &checkpointed); err != nil {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("fsync protected-local WAL: %w", err))
	}
	if busy != 0 || checkpointed < logFrames {
		return fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("fsync protected-local WAL: checkpoint incomplete"))
	}
	return nil
}

func (ledger *Ledger) Anchor(ctx context.Context) (Anchor, error) {
	anchor, err := ledger.anchorStore.Load(ctx)
	if err != nil {
		return Anchor{}, fail(ReasonProtectedLocalLedgerUnavailable, true, "restart_runtime_service", fmt.Errorf("load protected-local anchor: %w", err))
	}
	return anchor, nil
}

func (ledger *Ledger) Close() error {
	if ledger == nil {
		return nil
	}
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	if ledger.closed {
		return nil
	}
	ledger.closed = true
	err := ledger.db.Close()
	zeroBytes(ledger.macKey)
	ledger.macKey = nil
	if err != nil {
		return fmt.Errorf("close protected-local ledger: %w", err)
	}
	return nil
}

func (ledger *Ledger) chainHead(uuid Identifier, sequence uint64, previous Identifier, payloadHash Identifier, eventKind string, createdNanos int64) Identifier {
	return ledger.recordMAC("security_commit", uuid[:], uint64Bytes(sequence), previous[:], payloadHash[:], []byte(eventKind), int64Bytes(createdNanos))
}

func (ledger *Ledger) runtimeEpochRecordMAC(epoch Identifier, started int64, created uint64, revoked *uint64) Identifier {
	return ledger.recordMAC(
		"runtime_epoch",
		epoch[:],
		uint64Bytes(created),
		int64Bytes(started),
		optionalUint64Bytes(revoked),
	)
}

func (ledger *Ledger) desktopSessionRecordMAC(row desktopSessionRow) Identifier {
	return ledger.recordMAC(
		"desktop_session",
		row.sessionID[:],
		row.epoch[:],
		row.connection[:],
		row.processHash[:],
		uint64Bytes(row.created),
		int64Bytes(row.opened),
		optionalUint64Bytes(row.revoked),
	)
}

func (ledger *Ledger) startupAuditRecordMAC(auditID, epoch Identifier, created uint64, occurred int64, delivered *int64) Identifier {
	return ledger.recordMAC(
		"startup_audit",
		auditID[:],
		epoch[:],
		uint64Bytes(created),
		int64Bytes(occurred),
		optionalInt64Bytes(delivered),
	)
}

func (ledger *Ledger) recordMAC(domain string, fields ...[]byte) Identifier {
	mac := hmac.New(sha256.New, ledger.macKey)
	writeCanonicalString(mac, "nimi/protected-local/record/v1")
	writeCanonicalString(mac, domain)
	for _, field := range fields {
		var length [8]byte
		binary.BigEndian.PutUint64(length[:], uint64(len(field)))
		_, _ = mac.Write(length[:])
		_, _ = mac.Write(field)
	}
	var result Identifier
	copy(result[:], mac.Sum(nil))
	return result
}

func (ledger *Ledger) rollbackFailure(cause error) error {
	return fail(ReasonProtectedLocalLedgerRollbackDetected, false, "reset_protected_state", cause)
}

func anchorMatches(anchor Anchor, row commitRow) bool {
	return anchor.LedgerUUID == row.ledgerUUID && anchor.CommitSequence == row.sequence && subtle.ConstantTimeCompare(anchor.CommitChainHead[:], row.chainHead[:]) == 1
}

func copyIdentifier(target *Identifier, encoded []byte) bool {
	if !copyIdentifierAllowZero(target, encoded) {
		return false
	}
	return *target != (Identifier{})
}

func copyIdentifierAllowZero(target *Identifier, encoded []byte) bool {
	if len(encoded) != IdentifierBytes {
		return false
	}
	copy(target[:], encoded)
	return true
}

func uint64Bytes(value uint64) []byte {
	encoded := make([]byte, 8)
	binary.BigEndian.PutUint64(encoded, value)
	return encoded
}

func int64Bytes(value int64) []byte { return uint64Bytes(uint64(value)) }

func optionalUint64Bytes(value *uint64) []byte {
	if value == nil {
		return []byte{0}
	}
	encoded := make([]byte, 9)
	encoded[0] = 1
	binary.BigEndian.PutUint64(encoded[1:], *value)
	return encoded
}

func optionalInt64Bytes(value *int64) []byte {
	if value == nil {
		return []byte{0}
	}
	encoded := make([]byte, 9)
	encoded[0] = 1
	binary.BigEndian.PutUint64(encoded[1:], uint64(*value))
	return encoded
}

var protectedLocalSchema = []string{
	`CREATE TABLE IF NOT EXISTS protected_security_commit (
		commit_sequence INTEGER PRIMARY KEY CHECK(commit_sequence >= 0),
		ledger_uuid BLOB NOT NULL CHECK(length(ledger_uuid) = 32),
		previous_chain_head BLOB NOT NULL CHECK(length(previous_chain_head) = 32),
		payload_hash BLOB NOT NULL CHECK(length(payload_hash) = 32),
		chain_head BLOB NOT NULL CHECK(length(chain_head) = 32),
		state TEXT NOT NULL CHECK(state IN ('pending', 'complete')),
		event_kind TEXT NOT NULL CHECK(length(event_kind) BETWEEN 1 AND 64),
		created_unix_nano INTEGER NOT NULL,
		record_hmac BLOB NOT NULL CHECK(length(record_hmac) = 32)
	) STRICT`,
	`CREATE UNIQUE INDEX IF NOT EXISTS protected_security_commit_single_pending ON protected_security_commit(state) WHERE state = 'pending'`,
	`CREATE TABLE IF NOT EXISTS protected_runtime_epoch (
		runtime_boot_epoch BLOB PRIMARY KEY CHECK(length(runtime_boot_epoch) = 32),
		started_unix_nano INTEGER NOT NULL,
		created_commit_sequence INTEGER NOT NULL REFERENCES protected_security_commit(commit_sequence),
		revoked_commit_sequence INTEGER REFERENCES protected_security_commit(commit_sequence),
		record_hmac BLOB NOT NULL CHECK(length(record_hmac) = 32)
	) STRICT`,
	`CREATE TABLE IF NOT EXISTS protected_desktop_session (
		desktop_session_id BLOB PRIMARY KEY CHECK(length(desktop_session_id) = 32),
		runtime_boot_epoch BLOB NOT NULL CHECK(length(runtime_boot_epoch) = 32),
		connection_id BLOB NOT NULL CHECK(length(connection_id) = 32),
		process_tuple_hash BLOB NOT NULL CHECK(length(process_tuple_hash) = 32),
		opened_unix_nano INTEGER NOT NULL,
		created_commit_sequence INTEGER NOT NULL REFERENCES protected_security_commit(commit_sequence),
		revoked_commit_sequence INTEGER REFERENCES protected_security_commit(commit_sequence),
		record_hmac BLOB NOT NULL CHECK(length(record_hmac) = 32),
		FOREIGN KEY(runtime_boot_epoch) REFERENCES protected_runtime_epoch(runtime_boot_epoch)
	) STRICT`,
	`CREATE UNIQUE INDEX IF NOT EXISTS protected_desktop_session_one_live_process ON protected_desktop_session(process_tuple_hash) WHERE revoked_commit_sequence IS NULL`,
	`CREATE TABLE IF NOT EXISTS protected_security_audit_outbox (
		audit_id BLOB PRIMARY KEY CHECK(length(audit_id) = 32),
		event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 64),
		runtime_boot_epoch BLOB NOT NULL CHECK(length(runtime_boot_epoch) = 32),
		occurred_unix_nano INTEGER NOT NULL,
		created_commit_sequence INTEGER NOT NULL REFERENCES protected_security_commit(commit_sequence),
		delivered_unix_nano INTEGER,
		record_hmac BLOB NOT NULL CHECK(length(record_hmac) = 32)
	) STRICT`,
	`CREATE TABLE IF NOT EXISTS protected_release_lineage (
		executable_role TEXT NOT NULL CHECK(length(executable_role) BETWEEN 1 AND 64),
		release_id TEXT NOT NULL CHECK(length(release_id) BETWEEN 1 AND 128),
		release_generation INTEGER NOT NULL CHECK(release_generation > 0),
		artifact_sha256 BLOB NOT NULL CHECK(length(artifact_sha256) = 32),
		created_commit_sequence INTEGER NOT NULL REFERENCES protected_security_commit(commit_sequence),
		record_hmac BLOB NOT NULL CHECK(length(record_hmac) = 32),
		PRIMARY KEY(executable_role, release_generation),
		UNIQUE(executable_role, release_id)
	) STRICT`,
}

var pendingDiscardStatements = []string{
	`DELETE FROM protected_release_lineage WHERE created_commit_sequence = ?`,
	`DELETE FROM protected_security_audit_outbox WHERE created_commit_sequence = ?`,
	`DELETE FROM protected_desktop_session WHERE created_commit_sequence = ?`,
	`DELETE FROM protected_runtime_epoch WHERE created_commit_sequence = ?`,
}
