package auth

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestInstalledLaunchStorePersistsSingleUseAtomicSession(t *testing.T) {
	path := filepath.Join(t.TempDir(), "installed-launch.db")
	boot := installedIdentifier(0x11)
	store, err := OpenInstalledLaunchStore(path, boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	store.random = installedIdentifierReader(0x31, 3)
	now := time.Date(2026, 7, 11, 4, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	release := installedIdentifier(0x21)
	ticket, err := store.Issue(context.Background(), InstalledLaunchIssue{AppID: "world.nimi.app", ReleaseDigest: release, AccountGeneration: 7})
	if err != nil {
		t.Fatal(err)
	}
	if ticket.LaunchID == (protectedlocal.Identifier{}) || !ticket.BindDeadline.Equal(now.Add(InstalledLaunchTicketTTL)) {
		t.Fatalf("invalid ticket: %+v", ticket)
	}
	process := InstalledLaunchProcess{LaunchID: ticket.LaunchID, PID: 4201, CreationMarker: "01dc", ReleaseDigest: release, AccountGeneration: 7}
	binding, err := store.BindProcess(context.Background(), process)
	if err != nil || !binding.BindDeadline.Equal(now.Add(InstalledProcessBindTTL)) {
		t.Fatalf("bind process: binding=%+v err=%v", binding, err)
	}
	session, err := store.Consume(context.Background(), process)
	if err != nil {
		t.Fatal(err)
	}
	if session.AppID != "world.nimi.app" || session.SessionID == (protectedlocal.Identifier{}) || session.SessionProof == (protectedlocal.Identifier{}) || session.RuntimeBootEpoch != boot {
		t.Fatalf("invalid session: %+v", session)
	}
	if _, err := store.Consume(context.Background(), process); !errors.Is(err, ErrInstalledLaunchReplay) {
		t.Fatalf("replay error = %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenInstalledLaunchStore(path, boot)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err := reopened.Consume(context.Background(), process); !errors.Is(err, ErrInstalledLaunchReplay) {
		t.Fatalf("durable replay error = %v", err)
	}
}

func TestInstalledLaunchStoreRejectsMismatchExpiryReplacementAndOldBoot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "installed-launch.db")
	boot := installedIdentifier(0x12)
	store, err := OpenInstalledLaunchStore(path, boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	store.random = installedIdentifierReader(0x41, 4)
	now := time.Date(2026, 7, 11, 5, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	release := installedIdentifier(0x22)
	first, err := store.Issue(context.Background(), InstalledLaunchIssue{AppID: "persona.nimi.app", ReleaseDigest: release, AccountGeneration: 9})
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Issue(context.Background(), InstalledLaunchIssue{AppID: "persona.nimi.app", ReleaseDigest: release, AccountGeneration: 9})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Consume(context.Background(), InstalledLaunchProcess{LaunchID: first.LaunchID, PID: 9, CreationMarker: "m1", ReleaseDigest: release, AccountGeneration: 9}); !errors.Is(err, ErrInstalledLaunchReplay) {
		t.Fatalf("replaced ticket error = %v", err)
	}
	if _, err := store.BindProcess(context.Background(), InstalledLaunchProcess{LaunchID: second.LaunchID, PID: 9, CreationMarker: "m1", ReleaseDigest: installedIdentifier(0xff), AccountGeneration: 9}); !errors.Is(err, ErrInstalledLaunchMismatch) {
		t.Fatalf("release mismatch error = %v", err)
	}
	now = now.Add(InstalledLaunchTicketTTL)
	if _, err := store.BindProcess(context.Background(), InstalledLaunchProcess{LaunchID: second.LaunchID, PID: 9, CreationMarker: "m1", ReleaseDigest: release, AccountGeneration: 9}); !errors.Is(err, ErrInstalledLaunchExpired) {
		t.Fatalf("expiry error = %v", err)
	}
	third, err := store.Issue(context.Background(), InstalledLaunchIssue{AppID: "persona.nimi.app", ReleaseDigest: release, AccountGeneration: 9})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	newBoot, err := OpenInstalledLaunchStore(path, installedIdentifier(0x13))
	if err != nil {
		t.Fatal(err)
	}
	defer newBoot.Close()
	if _, err := newBoot.Consume(context.Background(), InstalledLaunchProcess{LaunchID: third.LaunchID, PID: 9, CreationMarker: "m1", ReleaseDigest: release, AccountGeneration: 9}); !errors.Is(err, ErrInstalledLaunchReplay) {
		t.Fatalf("old boot ticket error = %v", err)
	}
}

func installedIdentifier(value byte) protectedlocal.Identifier {
	var out protectedlocal.Identifier
	for index := range out {
		out[index] = value
	}
	return out
}

func installedIdentifierReader(first byte, count int) *bytes.Reader {
	encoded := make([]byte, 0, count*len(protectedlocal.Identifier{}))
	for offset := 0; offset < count; offset++ {
		encoded = append(encoded, bytes.Repeat([]byte{first + byte(offset)}, len(protectedlocal.Identifier{}))...)
	}
	return bytes.NewReader(encoded)
}
