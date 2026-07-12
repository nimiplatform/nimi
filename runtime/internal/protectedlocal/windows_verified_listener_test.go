//go:build windows

package protectedlocal

import (
	"context"
	cryptorand "crypto/rand"
	"fmt"
	"io"
	"net"
	"os"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
)

func TestWindowsVerifiedDesktopListenerBindsAuthenticatedPipeAndReopens(t *testing.T) {
	identity, principal := resolveWindowsDesktopTestBootstrap(t)
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-runtime-verified-listener-%d-%d`, os.Getpid(), time.Now().UnixNano())
	initialPipe, err := createWindowsDesktopPipeInstance(context.Background(), pipeName, principal, identity, true)
	if err != nil {
		t.Fatalf("create initial test pipe: %v", err)
	}

	reopened := make(chan struct{}, 1)
	listener, err := newWindowsVerifiedDesktopListener(context.Background(), windowsVerifiedDesktopListenerOptions{
		initialPipe:               initialPipe,
		runtimeProcess:            windowsVerifiedListenerTestRuntimeProcess(),
		bootEpoch:                 windowsVerifiedListenerTestIdentifier(0x71),
		verifier:                  &capturingWindowsExecutableVerifier{trustSetID: windowsDesktopE2ETrustSetID},
		expectedDesktopTrustSetID: windowsDesktopE2ETrustSetID,
		random:                    cryptorand.Reader,
		reopen: func(ctx context.Context) (*WindowsDesktopPipeInstance, error) {
			pipe, err := createWindowsDesktopPipeInstance(ctx, pipeName, principal, identity, false)
			if err == nil {
				reopened <- struct{}{}
			}
			return pipe, err
		},
	})
	if err != nil {
		t.Fatalf("create verified Desktop listener: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	first := acceptWindowsVerifiedListener(t, listener)
	firstClient := dialWindowsVerifiedListenerPipe(t, pipeName)
	firstConnection := awaitWindowsVerifiedListenerConnection(t, first)
	assertWindowsVerifiedListenerConnection(t, firstConnection)
	exchangeWindowsVerifiedListenerFrames(t, firstClient, firstConnection)
	if err := firstConnection.Close(); err != nil {
		t.Fatalf("close first verified server connection: %v", err)
	}
	if err := firstClient.Close(); err != nil {
		t.Fatalf("close first verified client connection: %v", err)
	}

	second := acceptWindowsVerifiedListener(t, listener)
	select {
	case <-reopened:
	case <-time.After(5 * time.Second):
		t.Fatal("verified listener did not recreate a named-pipe endpoint after disconnect")
	}
	secondClient := dialWindowsVerifiedListenerPipe(t, pipeName)
	secondConnection := awaitWindowsVerifiedListenerConnection(t, second)
	assertWindowsVerifiedListenerConnection(t, secondConnection)
	if err := secondConnection.Close(); err != nil {
		t.Fatalf("close reconnected verified server connection: %v", err)
	}
	if err := secondClient.Close(); err != nil {
		t.Fatalf("close reconnected verified client connection: %v", err)
	}
}

func windowsVerifiedListenerTestRuntimeProcess() WindowsRuntimeProcess {
	profile := mustActiveWindowsRuntimeProfile()
	return WindowsRuntimeProcess{
		principalSID: profile.serviceSID,
		tuple: ProcessTuple{
			OS:                          OSWindows,
			PID:                         9001,
			CreationMarker:              "verified-listener-runtime-fixture",
			OSLoginSession:              "service-session-0",
			SecurityPrincipal:           profile.serviceSID,
			CanonicalExecutableIdentity: "verified-listener-runtime-fixture-file",
			ExecutableDigest:            windowsVerifiedListenerTestIdentifier(0x72),
			ExecutableTrustSetID:        profile.runtimeTrustSetID,
		},
	}
}

func windowsVerifiedListenerTestIdentifier(value byte) Identifier {
	var identifier Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func dialWindowsVerifiedListenerPipe(t *testing.T, pipeName string) net.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	connection, err := winio.DialPipeAccess(ctx, pipeName, uint32(windowsPipeClientAccess))
	if err != nil {
		t.Fatalf("dial verified listener pipe: %v", err)
	}
	return connection
}

func acceptWindowsVerifiedListener(t *testing.T, listener net.Listener) <-chan struct {
	connection net.Conn
	err        error
} {
	t.Helper()
	result := make(chan struct {
		connection net.Conn
		err        error
	}, 1)
	go func() {
		connection, err := listener.Accept()
		result <- struct {
			connection net.Conn
			err        error
		}{connection: connection, err: err}
	}()
	return result
}

func awaitWindowsVerifiedListenerConnection(t *testing.T, result <-chan struct {
	connection net.Conn
	err        error
}) net.Conn {
	t.Helper()
	select {
	case accepted := <-result:
		if accepted.err != nil {
			t.Fatalf("accept verified listener connection: %v", accepted.err)
		}
		return accepted.connection
	case <-time.After(5 * time.Second):
		t.Fatal("verified listener did not accept Desktop pipe client")
		return nil
	}
}

func assertWindowsVerifiedListenerConnection(t *testing.T, raw net.Conn) {
	t.Helper()
	connection, ok := NativeDesktopConnectionFromNetConn(raw)
	if !ok || connection == nil {
		t.Fatal("verified listener accepted a connection without protected-local authority")
	}
	origin := connection.Origin()
	if origin.TransportClass != TransportDesktopControl || !origin.HasRole(RoleVerifiedDesktopProcess) || !origin.HasRole(RoleDesktopAccountHost) || !origin.HasRole(RoleDesktopLifecycleHost) {
		t.Fatalf("verified listener origin = %#v, want authenticated Desktop control roles", origin)
	}
}

func exchangeWindowsVerifiedListenerFrames(t *testing.T, client, server net.Conn) {
	t.Helper()
	if err := client.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set client deadline: %v", err)
	}
	if err := server.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set server deadline: %v", err)
	}
	if _, err := client.Write([]byte("desktop-frame")); err != nil {
		t.Fatalf("write Desktop frame: %v", err)
	}
	request := make([]byte, len("desktop-frame"))
	if _, err := io.ReadFull(server, request); err != nil {
		t.Fatalf("read Desktop frame: %v", err)
	}
	if string(request) != "desktop-frame" {
		t.Fatalf("Desktop frame = %q", request)
	}
	if _, err := server.Write([]byte("runtime-frame")); err != nil {
		t.Fatalf("write Runtime frame: %v", err)
	}
	response := make([]byte, len("runtime-frame"))
	if _, err := io.ReadFull(client, response); err != nil {
		t.Fatalf("read Runtime frame: %v", err)
	}
	if string(response) != "runtime-frame" {
		t.Fatalf("Runtime frame = %q", response)
	}
}
