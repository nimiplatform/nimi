package app

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
)

type installedProcessTestVerifier struct {
	process protectedlocal.ProcessTuple
}

func (verifier installedProcessTestVerifier) VerifyInstalledProcess(context.Context, uint32) (protectedlocal.ProcessTuple, protectedlocal.DesktopProcessLiveness, error) {
	return verifier.process, newInstalledProcessTestLiveness(), nil
}

type installedProcessTestLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func newInstalledProcessTestLiveness() *installedProcessTestLiveness {
	return &installedProcessTestLiveness{revoked: make(chan struct{})}
}

func (liveness *installedProcessTestLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *installedProcessTestLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func TestBindInstalledLaunchProcessCommitsRuntimeVerifiedProcess(t *testing.T) {
	boot := appInstalledIdentifier(0x91)
	store, err := authservice.OpenInstalledLaunchStore(filepath.Join(t.TempDir(), "installed-launch.db"), boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	release := appInstalledIdentifier(0x92)
	ticket, err := store.Issue(context.Background(), authservice.InstalledLaunchIssue{AppID: "world.nimi.app", ReleaseDigest: release, AccountGeneration: 7})
	if err != nil {
		t.Fatal(err)
	}
	process := protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 9911, CreationMarker: "child-start", OSLoginSession: "interactive-logon", SecurityPrincipal: "interactive-user", CanonicalExecutableIdentity: "installed-file", ExecutableDigest: release, ExecutableTrustSetID: "installed-release-policy"}
	registry, err := protectedlocal.NewInstalledLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	account := &lifecycleIntentTestAccount{generation: 7}
	service := New(testLogger(), WithRuntimeAccountProjectionProvider(account), WithInstalledLaunchStore(store), WithInstalledLaunchProcessBinding(registry, installedProcessTestVerifier{process: process}))
	response, err := service.BindInstalledLaunchProcess(context.Background(), &runtimev1.BindInstalledLaunchProcessRequest{LaunchId: ticket.LaunchID[:], ChildProcessId: process.PID})
	if err != nil {
		t.Fatalf("bind installed process: %v", err)
	}
	if response.GetBindDeadline() == nil || string(response.GetLaunchId()) != string(ticket.LaunchID[:]) {
		t.Fatalf("invalid binding response: %+v", response)
	}
	peer, err := registry.Promote(process, newInstalledProcessTestLiveness())
	if err != nil || peer.LaunchID != ticket.LaunchID {
		t.Fatalf("promote bound process: peer=%+v err=%v", peer, err)
	}
}

func TestBindInstalledLaunchProcessFailsClosedWithoutVerifierAndOnReleaseMismatch(t *testing.T) {
	boot := appInstalledIdentifier(0xa1)
	store, err := authservice.OpenInstalledLaunchStore(filepath.Join(t.TempDir(), "installed-launch.db"), boot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	release := appInstalledIdentifier(0xa2)
	ticket, err := store.Issue(context.Background(), authservice.InstalledLaunchIssue{AppID: "persona.nimi.app", ReleaseDigest: release, AccountGeneration: 8})
	if err != nil {
		t.Fatal(err)
	}
	registry, _ := protectedlocal.NewInstalledLaunchRegistry(boot)
	account := &lifecycleIntentTestAccount{generation: 8}
	request := &runtimev1.BindInstalledLaunchProcessRequest{LaunchId: ticket.LaunchID[:], ChildProcessId: 9912}
	withoutVerifier := New(testLogger(), WithRuntimeAccountProjectionProvider(account), WithInstalledLaunchStore(store), WithInstalledLaunchProcessBinding(registry, nil))
	if _, err := withoutVerifier.BindInstalledLaunchProcess(context.Background(), request); appInstalledReason(err) != runtimev1.ReasonCode_PROTECTED_LOCAL_TRANSPORT_UNSUPPORTED {
		t.Fatalf("missing verifier reason=%v err=%v", appInstalledReason(err), err)
	}
	wrongProcess := protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 9912, CreationMarker: "child-start", OSLoginSession: "interactive-logon", SecurityPrincipal: "interactive-user", CanonicalExecutableIdentity: "installed-file", ExecutableDigest: appInstalledIdentifier(0xff), ExecutableTrustSetID: "installed-release-policy"}
	service := New(testLogger(), WithRuntimeAccountProjectionProvider(account), WithInstalledLaunchStore(store), WithInstalledLaunchProcessBinding(registry, installedProcessTestVerifier{process: wrongProcess}))
	if _, err := service.BindInstalledLaunchProcess(context.Background(), request); appInstalledReason(err) != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("release mismatch reason=%v err=%v", appInstalledReason(err), err)
	}
}

func appInstalledIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func appInstalledReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
