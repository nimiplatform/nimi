package app

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

func TestLocalDevelopmentPendingPolicyRetainsProjectElectronAlias(t *testing.T) {
	store, err := openDirectLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	root := t.TempDir()
	ticket, err := store.PrepareLaunch(context.Background(), localDevelopmentLaunchRequest{
		RegistrationHandle: protectedlocal.Identifier{1}, SupervisorRunID: protectedlocal.Identifier{2}, ExpectedHostDigest: protectedlocal.Identifier{3},
		Project:        localDevelopmentProjectSnapshot{ProjectRoot: root, ShellKind: runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON},
		HostExecutable: filepath.Join(t.TempDir(), "electron.exe"),
	})
	if err != nil {
		t.Fatal(err)
	}
	policy, err := store.PendingLaunchPolicy(context.Background(), ticket.LaunchID)
	if err != nil {
		t.Fatal(err)
	}
	want := localDevelopmentProjectHostAliasPath(root, runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON)
	if want == "" {
		t.Skip("platform has no project Electron alias")
	}
	if policy.ProjectHostAliasPath != want {
		t.Fatalf("pending launch lost the registered project alias: got %q want %q", policy.ProjectHostAliasPath, want)
	}
}

type repeatingIdentifierReader struct{ value byte }

func (reader *repeatingIdentifierReader) Read(target []byte) (int, error) {
	for index := range target {
		target[index] = reader.value
	}
	return len(target), nil
}
