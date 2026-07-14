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

func TestWindowsVerifiedLocalAppListenerRequiresSupervisedDevelopmentPeer(t *testing.T) {
	identity, principal := resolveWindowsDesktopTestBootstrap(t)
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-runtime-development-listener-%d-%d`, os.Getpid(), time.Now().UnixNano())
	initial, err := createWindowsDesktopPipeInstance(context.Background(), pipeName, principal, identity, true)
	if err != nil {
		t.Fatal(err)
	}
	boot := windowsVerifiedListenerTestIdentifier(0xd1)
	registry, err := NewLocalAppLaunchRegistry(boot)
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
		return time.Now().Add(localAppProcessBindTestTTL), nil
	}, func() {}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	listener := &windowsVerifiedLocalAppListener{ctx: ctx, cancel: cancel, state: &WindowsRuntimeSecurityState{principal: principal, desktopIdentity: identity, localAppLaunches: registry}, developmentVerifier: developmentVerifier, initial: initial}
	t.Cleanup(func() { _ = listener.Close() })
	accepted := acceptWindowsVerifiedListener(t, listener)
	client := dialWindowsLocalAppListenerPipe(t, pipeName)
	t.Cleanup(func() { _ = client.Close() })
	server := awaitWindowsVerifiedListenerConnection(t, accepted)
	t.Cleanup(func() { _ = server.Close() })
	connection, ok := NativeLocalAppConnectionFromNetConn(server)
	if !ok || connection.LaunchID() != launchID || connection.Process() != bound || connection.Process().ExecutableTrustSetID != WindowsLocalDevelopmentTrustSetID || connection.RuntimeBootEpoch() != boot || connection.TrustClass() != LocalAppTrustLocalDevelopment {
		t.Fatalf("local-development native authority mismatch: connection=%+v ok=%v", connection, ok)
	}
}

const localAppProcessBindTestTTL = 10 * time.Second

func dialWindowsLocalAppListenerPipe(t *testing.T, pipeName string) net.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	connection, err := winio.DialPipeAccess(ctx, pipeName, uint32(windowsPipeClientAccess))
	if err != nil {
		t.Fatalf("dial local-app listener pipe: %v", err)
	}
	return connection
}
