//go:build windows

package protectedlocal

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
)

func TestWindowsVerifiedInstalledListenerMatchesRealPipePeerToPreboundProcess(t *testing.T) {
	identity, principal := resolveWindowsDesktopTestBootstrap(t)
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-runtime-installed-listener-%d-%d`, os.Getpid(), time.Now().UnixNano())
	initial, err := createWindowsDesktopPipeInstance(context.Background(), pipeName, principal, identity, true)
	if err != nil {
		t.Fatal(err)
	}
	boot := windowsVerifiedListenerTestIdentifier(0xc1)
	registry, err := NewInstalledLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	trustVerifier := &capturingWindowsExecutableVerifier{trustSetID: WindowsInstalledReleaseTrustSetID}
	process, liveness, err := verifyWindowsInstalledProcess(context.Background(), uint32(os.Getpid()), identity, trustVerifier)
	if err != nil {
		t.Fatal(err)
	}
	launchID := windowsVerifiedListenerTestIdentifier(0xc2)
	if _, err := registry.Bind(context.Background(), launchID, process.PID, installedRegistryVerifier{process: process, liveness: liveness}, func(got ProcessTuple) (time.Time, error) {
		if got != process {
			t.Fatalf("prebound process mismatch: %#v", got)
		}
		return time.Now().Add(InstalledProcessBindTestTTL), nil
	}, func() {}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	listener := &windowsVerifiedInstalledListener{ctx: ctx, cancel: cancel, state: &WindowsRuntimeSecurityState{principal: principal, desktopIdentity: identity, installedLaunches: registry}, verifier: trustVerifier, initial: initial}
	t.Cleanup(func() { _ = listener.Close() })
	accepted := acceptWindowsVerifiedListener(t, listener)
	client := dialWindowsInstalledListenerPipe(t, pipeName)
	t.Cleanup(func() { _ = client.Close() })
	server := awaitWindowsVerifiedListenerConnection(t, accepted)
	t.Cleanup(func() { _ = server.Close() })
	connection, ok := NativeInstalledConnectionFromNetConn(server)
	if !ok || connection.LaunchID() != launchID || connection.Process() != process || connection.RuntimeBootEpoch() != boot {
		t.Fatalf("installed native authority mismatch: connection=%+v ok=%v", connection, ok)
	}
}

func TestWindowsVerifiedInstalledListenerKeepsLocalDevelopmentPeerInSeparateTrustClass(t *testing.T) {
	identity, principal := resolveWindowsDesktopTestBootstrap(t)
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-runtime-development-listener-%d-%d`, os.Getpid(), time.Now().UnixNano())
	initial, err := createWindowsDesktopPipeInstance(context.Background(), pipeName, principal, identity, true)
	if err != nil {
		t.Fatal(err)
	}
	boot := windowsVerifiedListenerTestIdentifier(0xd1)
	registry, err := NewInstalledLaunchRegistry(boot)
	if err != nil {
		t.Fatal(err)
	}
	developmentVerifier, err := NewWindowsLocalDevelopmentProcessVerifier(identity)
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	policy := LocalDevelopmentProcessPolicy{ProjectRoot: filepath.Dir(executable), HostExecutablePath: executable}
	launchID := windowsVerifiedListenerTestIdentifier(0xd2)
	var bound ProcessTuple
	if _, err := BindLocalDevelopmentProcess(registry, context.Background(), launchID, uint32(os.Getpid()), developmentVerifier, policy, func(process ProcessTuple) (time.Time, error) {
		bound = process
		return time.Now().Add(InstalledProcessBindTestTTL), nil
	}, func() {}); err != nil {
		t.Fatal(err)
	}
	trustVerifier := &capturingWindowsExecutableVerifier{trustSetID: WindowsInstalledReleaseTrustSetID}
	ctx, cancel := context.WithCancel(context.Background())
	listener := &windowsVerifiedInstalledListener{ctx: ctx, cancel: cancel, state: &WindowsRuntimeSecurityState{principal: principal, desktopIdentity: identity, installedLaunches: registry}, verifier: trustVerifier, developmentVerifier: developmentVerifier, initial: initial}
	t.Cleanup(func() { _ = listener.Close() })
	accepted := acceptWindowsVerifiedListener(t, listener)
	client := dialWindowsInstalledListenerPipe(t, pipeName)
	t.Cleanup(func() { _ = client.Close() })
	server := awaitWindowsVerifiedListenerConnection(t, accepted)
	t.Cleanup(func() { _ = server.Close() })
	connection, ok := NativeInstalledConnectionFromNetConn(server)
	if !ok || connection.LaunchID() != launchID || connection.Process() != bound || connection.Process().ExecutableTrustSetID != WindowsLocalDevelopmentTrustSetID || connection.RuntimeBootEpoch() != boot {
		t.Fatalf("local-development native authority mismatch: connection=%+v ok=%v", connection, ok)
	}
}

const InstalledProcessBindTestTTL = 10 * time.Second

func dialWindowsInstalledListenerPipe(t *testing.T, pipeName string) net.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	connection, err := winio.DialPipeAccess(ctx, pipeName, uint32(windowsPipeClientAccess))
	if err != nil {
		t.Fatalf("dial installed listener pipe: %v", err)
	}
	return connection
}
