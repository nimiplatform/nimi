package app

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestLocalDevelopmentModeAndLaunchCarryNoAccountDecision(t *testing.T) {
	store, err := openDirectLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	ctx := context.Background()
	mode, err := store.SetDeveloperMode(ctx, true)
	if err != nil || !mode.Enabled || mode.Revision != 2 {
		t.Fatalf("mode = (%+v, %v)", mode, err)
	}
	handle := protectedlocal.Identifier{1}
	run := protectedlocal.Identifier{2}
	digest := protectedlocal.Identifier{3}
	store.random = &repeatingIdentifierReader{value: 4}
	ticket, err := store.PrepareLaunch(ctx, localDevelopmentLaunchRequest{
		RegistrationHandle: handle, SupervisorRunID: run,
		Project:        localDevelopmentProjectSnapshot{AppID: "nimi.example", ProjectRoot: t.TempDir()},
		HostExecutable: "/host", ExpectedHostDigest: digest,
	})
	if err != nil || ticket.RegistrationHandle != handle {
		t.Fatalf("ticket = (%+v, %v)", ticket, err)
	}
	if err := store.EndRun(ctx, handle, run); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PendingLaunchPolicy(ctx, ticket.LaunchID); err == nil {
		t.Fatal("ended run retained its launch")
	}
}

type repeatingIdentifierReader struct{ value byte }

func (reader *repeatingIdentifierReader) Read(target []byte) (int, error) {
	for index := range target {
		target[index] = reader.value
	}
	return len(target), nil
}
