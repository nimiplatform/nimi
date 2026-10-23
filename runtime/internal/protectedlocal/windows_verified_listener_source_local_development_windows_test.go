//go:build windows && nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
)

func TestWindowsSourceDirectDesktopConnectionRetainsCompleteClientProcess(t *testing.T) {
	executablePath, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executablePath, err = filepath.EvalSymlinks(filepath.Clean(executablePath))
	if err != nil {
		t.Fatal(err)
	}
	canonicalIdentity, digest, err := inspectWindowsSourceExecutable(context.Background(), executablePath)
	if err != nil {
		t.Fatal(err)
	}
	observed := windowsSourceProcessIdentity{
		pid: uint32(os.Getpid()), parentPID: uint32(os.Getppid()),
		userSID: "S-1-5-21-source-test", logonLUID: "source-test-logon", sessionID: 7,
		creationMarker: "source-test-creation", executablePath: executablePath,
		canonicalExecutableIdentity: canonicalIdentity, executableDigest: digest,
	}
	process, err := observed.processTuple()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := newDirectDesktopConnectionWithClient(DesktopPeerIdentity{
		OS: OSWindows, PID: observed.pid, UID: observed.sessionID, AuditSession: observed.sessionID,
	}, process, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)

	retained, ok := connection.ClientProcess()
	if !ok || retained != process {
		t.Fatalf("retained source process = %+v ok=%v, want %+v", retained, ok, process)
	}
	if retained.CanonicalExecutableIdentity == "" || retained.ExecutableDigest == (Identifier{}) ||
		retained.CanonicalExecutablePath != executablePath || retained.ExecutableTrustSetID != windowsSourceExactExecutableTrustSetID {
		t.Fatalf("source process evidence is incomplete: %+v", retained)
	}
}

// These tests use isolated pipe names with the same owner-only ACL, the real
// connected PID/token/executable inspection, and the production Accept path.
// They never bind or dial the running source Runtime's endpoint.
func TestWindowsSourceDesktopPipeReplacesSameProcessWithoutWaitingForOldClient(t *testing.T) {
	listener, pipeName := newWindowsSourceDesktopPipeTestListener(t)
	firstClient, first := connectWindowsSourceDesktopPipe(t, listener, pipeName)
	assertWindowsSourcePipeRoundTrip(t, firstClient, first)
	var scopeRevoked bool
	var binding Identifier
	binding[0] = 1
	if err := first.connection.BindRevocationHook(binding, func() { scopeRevoked = true }); err != nil {
		t.Fatal(err)
	}
	// Keep the first client open, just as a retained streaming channel can.
	secondClient, second := connectWindowsSourceDesktopPipe(t, listener, pipeName)
	if !scopeRevoked || first.connection.VerifiedDesktopTransport() {
		t.Fatal("replacement returned before revoking the previous connection and its bound scope")
	}
	select {
	case <-first.connection.Done():
	default:
		t.Fatal("old connection authority remained live")
	}
	_ = firstClient.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := firstClient.Read(make([]byte, 1)); err == nil {
		t.Fatal("the old physical pipe remained readable after replacement")
	} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Fatalf("old pipe was not closed within the replacement boundary: %v", err)
	}
	assertWindowsSourcePipeRoundTrip(t, secondClient, second)
	_ = first.Close()
	listener.mu.Lock()
	active := listener.active
	listener.mu.Unlock()
	if active != second || !second.connection.VerifiedDesktopTransport() {
		t.Fatal("late old release cleared the new active connection")
	}
	thirdClient, third := connectWindowsSourceDesktopPipe(t, listener, pipeName)
	if second.connection.VerifiedDesktopTransport() {
		t.Fatal("repeated replacement retained a second active authority")
	}
	assertWindowsSourcePipeRoundTrip(t, thirdClient, third)
}

func TestWindowsSourceDesktopPipeRejectsDifferentProcessWithoutDisplacingCurrent(t *testing.T) {
	listener, pipeName := newWindowsSourceDesktopPipeTestListener(t)
	firstClient, first := connectWindowsSourceDesktopPipe(t, listener, pipeName)
	accepted := acceptWindowsSourceDesktopPipe(listener)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, executable, "-test.run=^TestWindowsSourceDesktopCompetingPipeHelper$")
	child.Env = append(os.Environ(), "NIMI_SOURCE_TEST_COMPETING_PIPE="+pipeName)
	child.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if output, err := child.CombinedOutput(); err != nil {
		t.Fatalf("competing verified process was not refused: %v, %s", err, output)
	}
	if !first.connection.VerifiedDesktopTransport() {
		t.Fatal("another process displaced the active Home process")
	}
	select {
	case result := <-accepted:
		if result.connection != nil {
			_ = result.connection.Close()
		}
		t.Fatalf("competing process escaped the listener: %v", result.err)
	default:
	}
	assertWindowsSourcePipeRoundTrip(t, firstClient, first)
	client := dialWindowsSourceDesktopPipe(t, pipeName)
	replacement := awaitWindowsSourceDesktopPipe(t, accepted)
	assertWindowsSourcePipeRoundTrip(t, client, replacement)
}

func TestWindowsSourceDesktopCompetingPipeHelper(t *testing.T) {
	pipeName := os.Getenv("NIMI_SOURCE_TEST_COMPETING_PIPE")
	if pipeName == "" {
		t.Skip("separate-process named-pipe test helper")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	client, err := winio.DialPipeContext(ctx, pipeName)
	if err != nil {
		t.Fatalf("connect competing test process: %v", err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := client.Read(make([]byte, 1)); err == nil {
		t.Fatal("competing process received application data")
	} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Fatalf("competing process was left waiting instead of refused: %v", err)
	}
}

func TestWindowsSourceDesktopReplacementRequiresFullProcessIdentity(t *testing.T) {
	listener, pipeName := newWindowsSourceDesktopPipeTestListener(t)
	_, current := connectWindowsSourceDesktopPipe(t, listener, pipeName)
	process, ok := current.connection.ClientProcess()
	if !ok {
		t.Fatal("actual pipe peer has no process tuple")
	}
	peer, _ := current.connection.DirectDesktopPeer()
	for name, mutate := range map[string]func(*ProcessTuple){
		"creation marker":     func(value *ProcessTuple) { value.CreationMarker += "-changed" },
		"logon":               func(value *ProcessTuple) { value.OSLoginSession += "-changed" },
		"principal":           func(value *ProcessTuple) { value.SecurityPrincipal += "-changed" },
		"executable identity": func(value *ProcessTuple) { value.CanonicalExecutableIdentity += "-changed" },
		"digest":              func(value *ProcessTuple) { value.ExecutableDigest[0] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			changed := process
			mutate(&changed)
			candidate, err := newDirectDesktopConnectionWithClient(peer, changed, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer candidate.Revoke()
			if replaced, ok := listener.activate(&windowsSourceDesktopNetConn{connection: candidate}); ok || replaced != nil {
				t.Fatal("same PID and path hid a changed exact process identity")
			}
		})
	}
}

func newWindowsSourceDesktopPipeTestListener(t *testing.T) (*windowsSourceDesktopListener, string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	principal, identity, err := validateWindowsSourceCurrentPrincipal(ctx)
	if err != nil {
		cancel()
		t.Fatalf("real current-user source principal is required: %v", err)
	}
	executable, err := os.Executable()
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	sddl, err := windowsSourceOwnerOnlyPipeSDDL(principal.tokenUserSID)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-source-listener-test-%d-%d`, os.Getpid(), time.Now().UnixNano())
	raw, err := winio.ListenPipe(pipeName, &winio.PipeConfig{SecurityDescriptor: sddl, InputBufferSize: windowsSourcePipeBufferBytes, OutputBufferSize: windowsSourcePipeBufferBytes})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	listener := &windowsSourceDesktopListener{ctx: ctx, cancel: cancel, raw: raw,
		state: &WindowsRuntimeSecurityState{principal: principal, desktopIdentity: identity, expectedDesktopPath: executable}}
	t.Cleanup(func() { _ = listener.Close() })
	return listener, pipeName
}

type windowsSourceDesktopAcceptResult struct {
	connection *windowsSourceDesktopNetConn
	err        error
}

func acceptWindowsSourceDesktopPipe(listener *windowsSourceDesktopListener) <-chan windowsSourceDesktopAcceptResult {
	accepted := make(chan windowsSourceDesktopAcceptResult, 1)
	go func() {
		connection, err := listener.Accept()
		verified, _ := connection.(*windowsSourceDesktopNetConn)
		accepted <- windowsSourceDesktopAcceptResult{connection: verified, err: err}
	}()
	return accepted
}

func awaitWindowsSourceDesktopPipe(t *testing.T, accepted <-chan windowsSourceDesktopAcceptResult) *windowsSourceDesktopNetConn {
	t.Helper()
	select {
	case result := <-accepted:
		if result.err != nil || result.connection == nil {
			t.Fatalf("accept real verified pipe: %v", result.err)
		}
		t.Cleanup(func() { _ = result.connection.Close() })
		return result.connection
	case <-time.After(5 * time.Second):
		t.Fatal("verified same-process replacement did not complete within five seconds")
		return nil
	}
}

func dialWindowsSourceDesktopPipe(t *testing.T, name string) net.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, err := winio.DialPipeContext(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func connectWindowsSourceDesktopPipe(t *testing.T, listener *windowsSourceDesktopListener, name string) (net.Conn, *windowsSourceDesktopNetConn) {
	t.Helper()
	accepted := acceptWindowsSourceDesktopPipe(listener)
	client := dialWindowsSourceDesktopPipe(t, name)
	return client, awaitWindowsSourceDesktopPipe(t, accepted)
}

func assertWindowsSourcePipeRoundTrip(t *testing.T, client, server net.Conn) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	_ = client.SetDeadline(deadline)
	_ = server.SetDeadline(deadline)
	completed := make(chan error, 1)
	go func() { _, err := io.CopyN(server, server, 1); completed <- err }()
	if _, err := client.Write([]byte{0x31}); err != nil {
		t.Fatal(err)
	}
	var response [1]byte
	if _, err := io.ReadFull(client, response[:]); err != nil || response[0] != 0x31 {
		t.Fatalf("actual pipe round trip failed: %v", err)
	}
	if err := <-completed; err != nil && !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
	_ = client.SetDeadline(time.Time{})
	_ = server.SetDeadline(time.Time{})
}
