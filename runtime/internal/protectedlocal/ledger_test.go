package protectedlocal

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLedgerRecoversOnlyTheTwoAdmittedCrashWindows(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		phase commitPhase
	}{
		{name: "discard unadvanced pending head", phase: commitPhasePendingDurable},
		{name: "complete anchor-advanced pending head", phase: commitPhaseAnchorAdvanced},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			anchor := newTestAnchorStore()
			options := testLedgerOptions(directory, anchor)
			options.Random = distinctIdentifierReader(0xd1, 3)
			ledger, err := OpenLedger(context.Background(), options)
			if err != nil {
				t.Fatalf("open ledger: %v", err)
			}
			initialEpoch, err := ledger.StartRuntime(context.Background())
			if err != nil {
				t.Fatalf("start initial runtime: %v", err)
			}
			sessionID := identifierFilled(0xd4)
			if err := ledger.RecordDesktopSessionOpened(context.Background(), DesktopSessionRecord{
				SessionID:   sessionID,
				BootEpoch:   initialEpoch,
				Connection:  identifierFilled(0xd5),
				ProcessHash: identifierFilled(0xd6),
			}); err != nil {
				t.Fatalf("record initial desktop session: %v", err)
			}
			before, err := ledger.Anchor(context.Background())
			if err != nil {
				t.Fatalf("read initial anchor: %v", err)
			}
			ledger.commitHook = func(phase commitPhase) error {
				if phase == test.phase {
					return errors.New("injected crash")
				}
				return nil
			}
			if _, err := ledger.StartRuntime(context.Background()); err == nil {
				t.Fatal("expected injected crash")
			}
			if err := ledger.Close(); err != nil {
				t.Fatalf("close crashed ledger: %v", err)
			}

			recovered, err := OpenLedger(context.Background(), testLedgerOptions(directory, anchor))
			if err != nil {
				t.Fatalf("recover ledger: %v", err)
			}
			t.Cleanup(func() { _ = recovered.Close() })
			after, err := recovered.Anchor(context.Background())
			if err != nil {
				t.Fatalf("read recovered anchor: %v", err)
			}
			if test.phase == commitPhasePendingDurable && after.CommitSequence != before.CommitSequence {
				t.Fatalf("unadvanced pending head survived: before=%d after=%d", before.CommitSequence, after.CommitSequence)
			}
			if test.phase == commitPhaseAnchorAdvanced && after.CommitSequence != before.CommitSequence+1 {
				t.Fatalf("anchor-advanced pending head was not completed: before=%d after=%d", before.CommitSequence, after.CommitSequence)
			}
			currentEpoch := recovered.currentBootEpoch(context.Background())
			var liveSessionCount int
			if err := recovered.db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM protected_desktop_session WHERE desktop_session_id = ? AND revoked_commit_sequence IS NULL`, sessionID[:]).Scan(&liveSessionCount); err != nil {
				t.Fatalf("read recovered session revocation: %v", err)
			}
			if test.phase == commitPhasePendingDurable && (currentEpoch != initialEpoch || liveSessionCount != 1) {
				t.Fatalf("discard did not restore prior epoch/session: epoch=%x live_sessions=%d", currentEpoch, liveSessionCount)
			}
			if test.phase == commitPhaseAnchorAdvanced && (currentEpoch == initialEpoch || liveSessionCount != 0) {
				t.Fatalf("completed startup did not retain revocations: epoch=%x live_sessions=%d", currentEpoch, liveSessionCount)
			}
			if err := recovered.Close(); err != nil {
				t.Fatalf("close recovered ledger: %v", err)
			}
			secondRecovery, err := OpenLedger(context.Background(), testLedgerOptions(directory, anchor))
			if err != nil {
				t.Fatalf("second recovery must remain stable: %v", err)
			}
			if err := secondRecovery.Close(); err != nil {
				t.Fatalf("close second recovery: %v", err)
			}
		})
	}
}

func TestLedgerCloseWaitsForCommitAndRejectsLateMutation(t *testing.T) {
	ledger, err := OpenLedger(context.Background(), testLedgerOptions(t.TempDir(), newTestAnchorStore()))
	if err != nil {
		t.Fatalf("open ledger: %v", err)
	}

	commitEntered := make(chan struct{})
	releaseCommit := make(chan struct{})
	ledger.commitHook = func(phase commitPhase) error {
		if phase == commitPhasePendingDurable {
			close(commitEntered)
			<-releaseCommit
		}
		return nil
	}
	commitDone := make(chan error, 1)
	go func() {
		_, err := ledger.StartRuntime(context.Background())
		commitDone <- err
	}()
	<-commitEntered

	closeDone := make(chan error, 1)
	go func() { closeDone <- ledger.Close() }()
	select {
	case err := <-closeDone:
		t.Fatalf("close returned before in-flight commit completed: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseCommit)
	if err := <-commitDone; err != nil {
		t.Fatalf("complete in-flight commit: %v", err)
	}
	if err := <-closeDone; err != nil {
		t.Fatalf("close ledger: %v", err)
	}
	if ledger.macKey != nil {
		t.Fatal("closed ledger retained record-MAC key")
	}
	if _, err := ledger.StartRuntime(context.Background()); !IsReason(err, ReasonProtectedLocalLedgerUnavailable) {
		t.Fatalf("late mutation error = %v", err)
	}
}

func TestLedgerRejectsRollbackAndCommitTampering(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	anchor := newTestAnchorStore()
	options := testLedgerOptions(directory, anchor)
	ledger, err := OpenLedger(context.Background(), options)
	if err != nil {
		t.Fatalf("open ledger: %v", err)
	}
	oldAnchor, err := ledger.Anchor(context.Background())
	if err != nil {
		t.Fatalf("initial anchor: %v", err)
	}
	if _, err := ledger.StartRuntime(context.Background()); err != nil {
		t.Fatalf("start runtime: %v", err)
	}
	if err := ledger.Close(); err != nil {
		t.Fatalf("close ledger: %v", err)
	}

	if err := anchor.Store(context.Background(), oldAnchor); err != nil {
		t.Fatalf("roll back anchor: %v", err)
	}
	if _, err := OpenLedger(context.Background(), testLedgerOptions(directory, anchor)); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("expected rollback detection, got %v", err)
	}

	anchor = newTestAnchorStore()
	secondDirectory := t.TempDir()
	second, err := OpenLedger(context.Background(), testLedgerOptions(secondDirectory, anchor))
	if err != nil {
		t.Fatalf("open second ledger: %v", err)
	}
	if _, err := second.StartRuntime(context.Background()); err != nil {
		t.Fatalf("start second runtime: %v", err)
	}
	if _, err := second.db.ExecContext(context.Background(), `UPDATE protected_security_commit SET chain_head = zeroblob(32) WHERE commit_sequence = 1`); err != nil {
		t.Fatalf("tamper commit: %v", err)
	}
	if err := second.Close(); err != nil {
		t.Fatalf("close second ledger: %v", err)
	}
	if _, err := OpenLedger(context.Background(), testLedgerOptions(secondDirectory, anchor)); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("expected commit tamper detection, got %v", err)
	}
}

func TestLedgerRejectsAuthenticatedRecordDeletionOrMutation(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name   string
		tamper string
	}{
		{name: "record mutation", tamper: `UPDATE protected_runtime_epoch SET started_unix_nano = started_unix_nano + 1`},
		{name: "record deletion", tamper: `DELETE FROM protected_security_audit_outbox`},
		{name: "audit delivery mutation", tamper: `UPDATE protected_security_audit_outbox SET delivered_unix_nano = 1700000000000000000`},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			anchor := newTestAnchorStore()
			ledger, err := OpenLedger(context.Background(), testLedgerOptions(directory, anchor))
			if err != nil {
				t.Fatalf("open ledger: %v", err)
			}
			if _, err := ledger.StartRuntime(context.Background()); err != nil {
				t.Fatalf("start runtime: %v", err)
			}
			if _, err := ledger.db.ExecContext(context.Background(), test.tamper); err != nil {
				t.Fatalf("tamper logical record: %v", err)
			}
			if err := ledger.Close(); err != nil {
				t.Fatalf("close ledger: %v", err)
			}
			if _, err := OpenLedger(context.Background(), testLedgerOptions(directory, anchor)); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
				t.Fatalf("expected logical record tamper detection, got %v", err)
			}
		})
	}
}

func TestLedgerRejectsStartupRevocationTampering(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name   string
		tamper func(*Ledger, Identifier, Identifier) error
	}{
		{
			name: "runtime epoch revocation",
			tamper: func(ledger *Ledger, epoch Identifier, _ Identifier) error {
				_, err := ledger.db.ExecContext(
					context.Background(),
					`UPDATE protected_runtime_epoch SET revoked_commit_sequence = NULL WHERE runtime_boot_epoch = ?`,
					epoch[:],
				)
				return err
			},
		},
		{
			name: "desktop session revocation",
			tamper: func(ledger *Ledger, _ Identifier, sessionID Identifier) error {
				_, err := ledger.db.ExecContext(
					context.Background(),
					`UPDATE protected_desktop_session SET revoked_commit_sequence = NULL WHERE desktop_session_id = ?`,
					sessionID[:],
				)
				return err
			},
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			anchor := newTestAnchorStore()
			options := testLedgerOptions(directory, anchor)
			options.Random = bytes.NewReader(bytes.Join([][]byte{
				bytes.Repeat([]byte{0xc1}, IdentifierBytes),
				bytes.Repeat([]byte{0xc2}, IdentifierBytes),
				bytes.Repeat([]byte{0xc3}, IdentifierBytes),
			}, nil))
			ledger, err := OpenLedger(context.Background(), options)
			if err != nil {
				t.Fatalf("open ledger: %v", err)
			}
			t.Cleanup(func() { _ = ledger.Close() })
			oldEpoch, err := ledger.StartRuntime(context.Background())
			if err != nil {
				t.Fatalf("start first runtime epoch: %v", err)
			}
			sessionID := identifierFilled(0xb1)
			if err := ledger.RecordDesktopSessionOpened(context.Background(), DesktopSessionRecord{
				SessionID:   sessionID,
				BootEpoch:   oldEpoch,
				Connection:  identifierFilled(0xb2),
				ProcessHash: identifierFilled(0xb3),
			}); err != nil {
				t.Fatalf("record desktop session: %v", err)
			}
			if _, err := ledger.StartRuntime(context.Background()); err != nil {
				t.Fatalf("start replacement runtime epoch: %v: %v", err, errors.Unwrap(err))
			}
			if err := test.tamper(ledger, oldEpoch, sessionID); err != nil {
				t.Fatalf("tamper startup revocation: %v", err)
			}
			if err := ledger.Close(); err != nil {
				t.Fatalf("close ledger: %v", err)
			}

			reopened, err := OpenLedger(context.Background(), testLedgerOptions(directory, anchor))
			if err == nil {
				_ = reopened.Close()
				t.Fatal("expected startup revocation tamper detection")
			}
			if !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
				t.Fatalf("expected rollback detection, got %v", err)
			}
		})
	}
}

func TestFileAnchorStoreUsesAuthenticatedAtomicRepresentation(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	path := filepath.Join(directory, "protected_local.anchor")
	store, err := NewFileAnchorStore(path, bytes.Repeat([]byte{0x91}, 32))
	if err != nil {
		t.Fatalf("new file anchor store: %v", err)
	}
	want := Anchor{LedgerUUID: identifierFilled(0xa1), CommitSequence: 12, CommitChainHead: identifierFilled(0xa2)}
	if err := store.Store(context.Background(), want); err != nil {
		t.Fatalf("store anchor: %v", err)
	}
	got, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("load anchor: %v", err)
	}
	if got != want {
		t.Fatalf("anchor mismatch: got=%v want=%v", got, want)
	}
	next := Anchor{LedgerUUID: want.LedgerUUID, CommitSequence: want.CommitSequence + 1, CommitChainHead: identifierFilled(0xa3)}
	if err := store.Store(context.Background(), next); err != nil {
		t.Fatalf("atomically replace anchor: %v", err)
	}
	got, err = store.Load(context.Background())
	if err != nil {
		t.Fatalf("load replaced anchor: %v", err)
	}
	if got != next {
		t.Fatalf("replaced anchor mismatch: got=%v want=%v", got, next)
	}

	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read anchor file: %v", err)
	}
	encoded[len(encoded)/2] ^= 0xff
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatalf("tamper anchor file: %v", err)
	}
	if _, err := store.Load(context.Background()); !IsReason(err, ReasonProtectedLocalLedgerRollbackDetected) {
		t.Fatalf("expected authenticated anchor tamper rejection, got %v", err)
	}
}

func testLedgerOptions(directory string, anchor AnchorStore) LedgerOptions {
	return LedgerOptions{
		Path:         filepath.Join(directory, LedgerFilename),
		AnchorStore:  anchor,
		RecordMACKey: bytes.Repeat([]byte{0x81}, 32),
		Random:       bytes.NewReader(bytes.Repeat([]byte{0x82}, IdentifierBytes*16)),
		Now:          func() time.Time { return time.Unix(1_700_000_000, 123).UTC() },
	}
}

type testAnchorStore struct {
	anchor Anchor
	set    bool
}

func newTestAnchorStore() *testAnchorStore { return &testAnchorStore{} }

func (s *testAnchorStore) Load(context.Context) (Anchor, error) {
	if !s.set {
		return Anchor{}, ErrAnchorNotFound
	}
	return s.anchor, nil
}

func (s *testAnchorStore) Store(_ context.Context, anchor Anchor) error {
	s.anchor = anchor
	s.set = true
	return nil
}
