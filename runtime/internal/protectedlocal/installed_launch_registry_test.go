package protectedlocal

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

type installedRegistryVerifier struct {
	process  ProcessTuple
	liveness DesktopProcessLiveness
}

func (verifier installedRegistryVerifier) VerifyInstalledProcess(context.Context, uint32) (ProcessTuple, DesktopProcessLiveness, error) {
	return verifier.process, verifier.liveness, nil
}

func TestInstalledLaunchRegistryRequiresExactIndependentPipePeer(t *testing.T) {
	boot := identifierFilled(0x71)
	registry, err := NewInstalledLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	process := installedRegistryProcess(7701, 0x72)
	prebindLiveness := newManualDesktopLiveness()
	launchID := identifierFilled(0x73)
	deadline := time.Now().Add(10 * time.Second)
	committed := false
	gotDeadline, err := registry.Bind(context.Background(), launchID, process.PID, installedRegistryVerifier{process: process, liveness: prebindLiveness}, func(got ProcessTuple) (time.Time, error) {
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

func TestInstalledLaunchRegistryRevokesBindingOnProcessExit(t *testing.T) {
	registry, err := NewInstalledLaunchRegistry(identifierFilled(0x81))
	if err != nil {
		t.Fatal(err)
	}
	process := installedRegistryProcess(8801, 0x82)
	liveness := newManualDesktopLiveness()
	var revoked atomic.Bool
	if _, err := registry.Bind(context.Background(), identifierFilled(0x83), process.PID, installedRegistryVerifier{process: process, liveness: liveness}, func(ProcessTuple) (time.Time, error) {
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

func installedRegistryProcess(pid uint32, digest byte) ProcessTuple {
	return ProcessTuple{OS: OSWindows, PID: pid, CreationMarker: "installed-start", OSLoginSession: "interactive-logon", SecurityPrincipal: "interactive-user", CanonicalExecutableIdentity: "installed-file", ExecutableDigest: identifierFilled(digest), ExecutableTrustSetID: "installed-release-policy"}
}
