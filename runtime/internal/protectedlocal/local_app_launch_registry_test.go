package protectedlocal

import (
	"context"
	"encoding/base64"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type localAppRegistryVerifier struct {
	process  ProcessTuple
	liveness DesktopProcessLiveness
	err      error
}

func (verifier localAppRegistryVerifier) VerifyLocalDevelopmentProcess(context.Context, uint32, LocalDevelopmentProcessPolicy) (ProcessTuple, DesktopProcessLiveness, error) {
	return verifier.process, verifier.liveness, verifier.err
}

func TestLocalAppLaunchRegistryProjectsBoundedFailureStages(t *testing.T) {
	process := localAppRegistryProcess(6601, 0x61)
	cases := []struct {
		name     string
		verifier localAppRegistryVerifier
		commit   func(ProcessTuple) (time.Time, error)
		want     LocalDevelopmentBindFailureStage
	}{
		{name: "verify", verifier: localAppRegistryVerifier{err: errors.New("private verifier detail")}, want: LocalDevelopmentBindStageVerify},
		{name: "witness", verifier: localAppRegistryVerifier{process: process}, want: LocalDevelopmentBindStageWitness},
		{name: "commit", verifier: localAppRegistryVerifier{process: process, liveness: newManualDesktopLiveness()}, commit: func(ProcessTuple) (time.Time, error) { return time.Time{}, errors.New("private commit detail") }, want: LocalDevelopmentBindStageCommit},
	}
	for index, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			registry, err := NewLocalAppLaunchRegistry(identifierFilled(byte(0x62 + index)))
			if err != nil {
				t.Fatal(err)
			}
			commit := testCase.commit
			if commit == nil {
				commit = func(ProcessTuple) (time.Time, error) { return time.Now().Add(time.Second), nil }
			}
			_, err = BindLocalDevelopmentProcess(registry, context.Background(), identifierFilled(byte(0x72+index)), process.PID, testCase.verifier, LocalDevelopmentProcessPolicy{ProjectRoot: "project", HostExecutablePath: "host"}, commit, func() {})
			stage, ok := LocalDevelopmentBindStageFromError(err)
			if !ok || stage != testCase.want {
				t.Fatalf("bind failure stage = (%q, %v), want %q", stage, ok, testCase.want)
			}
		})
	}
}

func TestLocalAppLaunchRegistryRequiresExactIndependentPipePeer(t *testing.T) {
	boot := identifierFilled(0x71)
	registry, err := NewLocalAppLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	process := localAppRegistryProcess(7701, 0x72)
	prebindLiveness := newManualDesktopLiveness()
	launchID := identifierFilled(0x73)
	deadline := time.Now().Add(10 * time.Second)
	committed := false
	gotDeadline, err := BindLocalDevelopmentProcess(registry, context.Background(), launchID, process.PID, localAppRegistryVerifier{process: process, liveness: prebindLiveness}, LocalDevelopmentProcessPolicy{ProjectRoot: "project", HostExecutablePath: "host"}, func(got ProcessTuple) (time.Time, error) {
		if got != process {
			t.Fatalf("committed process = %#v, want %#v", got, process)
		}
		committed = true
		return deadline, nil
	}, func() {})
	if err != nil || !committed || !gotDeadline.Equal(deadline) {
		t.Fatalf("bind result deadline=%v committed=%v err=%v", gotDeadline, committed, err)
	}

	wrong := process
	wrong.CreationMarker = "different-process-start"
	if _, err := registry.Promote(wrong, newManualDesktopLiveness()); err == nil {
		t.Fatal("registry promoted a mismatched pipe peer")
	}
	peer, err := registry.Promote(process, newManualDesktopLiveness())
	if err != nil {
		t.Fatalf("promote exact peer: %v", err)
	}
	if peer.LaunchID != launchID || peer.Process != process || peer.RuntimeBootEpoch != boot || peer.ProcessLiveness != prebindLiveness {
		t.Fatalf("promoted authority mismatch: %#v", peer)
	}
	if _, err := registry.Promote(process, newManualDesktopLiveness()); err == nil {
		t.Fatal("registry replayed a promoted process")
	}
}

func TestLocalAppLaunchRegistryRevokesBindingOnProcessExit(t *testing.T) {
	registry, err := NewLocalAppLaunchRegistry(identifierFilled(0x81))
	if err != nil {
		t.Fatal(err)
	}
	process := localAppRegistryProcess(8801, 0x82)
	liveness := newManualDesktopLiveness()
	var revoked atomic.Bool
	if _, err := BindLocalDevelopmentProcess(registry, context.Background(), identifierFilled(0x83), process.PID, localAppRegistryVerifier{process: process, liveness: liveness}, LocalDevelopmentProcessPolicy{ProjectRoot: "project", HostExecutablePath: "host"}, func(ProcessTuple) (time.Time, error) {
		return time.Now().Add(time.Second), nil
	}, func() { revoked.Store(true) }); err != nil {
		t.Fatal(err)
	}
	liveness.revoke()
	deadline := time.Now().Add(time.Second)
	for !revoked.Load() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !revoked.Load() {
		t.Fatal("process exit did not revoke bound launch")
	}
	if _, err := registry.Promote(process, newManualDesktopLiveness()); err == nil {
		t.Fatal("registry promoted a process after exit")
	}
}

func TestInstalledPipeConnectionPreservesCommittedSourceTrust(t *testing.T) {
	for _, trustClass := range []LocalAppTrustClass{LocalAppTrustVerified, LocalAppTrustUserImported} {
		t.Run(string(trustClass), func(t *testing.T) {
			registry, err := NewLocalAppLaunchRegistry(identifierFilled(0x91))
			if err != nil {
				t.Fatal(err)
			}
			process := localAppRegistryProcess(9902, 0x92)
			process.CanonicalExecutablePath = filepath.Join(t.TempDir(), "app.exe")
			registration := identifierFilled(0x93)
			policy := InstalledAppProcessPolicy{
				RegistrationHandle: "rar_v1_" + base64.RawURLEncoding.EncodeToString(registration[:]),
				TrustClass:         trustClass, SourceGeneration: 3, DeclarationGeneration: 4,
				HostExecutablePath: process.CanonicalExecutablePath, HostExecutableDigest: process.ExecutableDigest,
				ExecutionProfileRef: "windows-user-mode-as-invoker-v1", SupervisorProcess: localAppRegistryProcess(9901, 0x94),
			}
			launch := identifierFilled(0x95)
			wrongTrust := policy
			wrongTrust.TrustClass = LocalAppTrustLocalDevelopment
			if err := registry.BindInstalled(launch, wrongTrust, process, newManualDesktopLiveness(), func() {}); err == nil {
				t.Fatal("development trust admitted as installed")
			}
			if err := registry.BindInstalled(launch, policy, process, newManualDesktopLiveness(), func() {}); err != nil {
				t.Fatal(err)
			}
			peer, err := registry.Promote(process, newManualDesktopLiveness())
			if err != nil {
				t.Fatal(err)
			}
			connection, err := EstablishLocalAppConnection(context.Background(), localAppTestVerifier{peer: peer})
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Revoke()
			handle, installed := connection.InstalledRegistrationHandle()
			if !installed || handle != policy.RegistrationHandle || connection.TrustClass() != trustClass {
				t.Fatal("installed connection lost its committed source")
			}
		})
	}
}

func localAppRegistryProcess(pid uint32, digest byte) ProcessTuple {
	return ProcessTuple{OS: OSWindows, PID: pid, CreationMarker: "local-app-start", OSLoginSession: "interactive-logon", SecurityPrincipal: "interactive-user", CanonicalExecutableIdentity: "local-app-file", ExecutableDigest: identifierFilled(digest), ExecutableTrustSetID: "local-development-policy"}
}
