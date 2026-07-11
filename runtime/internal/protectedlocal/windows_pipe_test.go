//go:build windows

package protectedlocal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"testing"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

func TestWindowsNamedPipeBindsExactACLAndPeerProcessIDs(t *testing.T) {
	identity, err := inspectWindowsDesktopToken(windows.GetCurrentProcessToken(), nil)
	if err != nil {
		t.Fatalf("inspect current interactive token: %v", err)
	}
	principal := WindowsServicePrincipal{
		serviceSID:   WindowsProductionServiceSID,
		tokenUserSID: "S-1-5-18",
	}
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-runtime-e2e-%d-%d`, os.Getpid(), time.Now().UnixNano())
	instance, err := createWindowsDesktopPipeInstance(context.Background(), pipeName, principal, identity, true)
	if err != nil {
		t.Fatalf("create isolated test pipe: %v (cause: %v)", err, errors.Unwrap(err))
	}
	t.Cleanup(func() { _ = instance.Close() })

	clientResult := make(chan struct {
		handle    windows.Handle
		serverPID uint32
		err       error
	}, 1)
	go func() {
		name, encodeErr := windows.UTF16PtrFromString(pipeName)
		if encodeErr != nil {
			clientResult <- struct {
				handle    windows.Handle
				serverPID uint32
				err       error
			}{err: encodeErr}
			return
		}
		handle, openErr := windows.CreateFile(name, uint32(windowsPipeClientAccess), 0, nil, windows.OPEN_EXISTING, 0, 0)
		if openErr != nil {
			clientResult <- struct {
				handle    windows.Handle
				serverPID uint32
				err       error
			}{err: openErr}
			return
		}
		var serverPID uint32
		serverErr := windows.GetNamedPipeServerProcessId(handle, &serverPID)
		clientResult <- struct {
			handle    windows.Handle
			serverPID uint32
			err       error
		}{handle: handle, serverPID: serverPID, err: serverErr}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, err := instance.Accept(ctx)
	if err != nil {
		select {
		case client := <-clientResult:
			if client.handle != 0 && client.handle != windows.InvalidHandle {
				_ = windows.CloseHandle(client.handle)
			}
			t.Fatalf("accept isolated test pipe: %v (client: %v)", err, client.err)
		default:
		}
		t.Fatalf("accept isolated test pipe: %v", err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	client := <-clientResult
	if client.handle != 0 && client.handle != windows.InvalidHandle {
		t.Cleanup(func() { _ = windows.CloseHandle(client.handle) })
	}
	if client.err != nil {
		t.Fatalf("connect isolated test pipe: %v", client.err)
	}
	if connection.ClientProcessID() != uint32(os.Getpid()) {
		t.Fatalf("client PID = %d, want %d", connection.ClientProcessID(), os.Getpid())
	}
	if client.serverPID != uint32(os.Getpid()) {
		t.Fatalf("server PID = %d, want %d", client.serverPID, os.Getpid())
	}
	if _, err := VerifyWindowsProductionPipeServer(context.Background(), uintptr(client.handle), &capturingWindowsExecutableVerifier{trustSetID: WindowsRuntimeProductionTrustSetID}); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("interactive test server verification error = %v", err)
	}
	if err := validateWindowsDesktopPipeACL(instance.handle, identity.logonSID); err != nil {
		t.Fatalf("validate exact pipe ACL: %v", err)
	}
}

func TestWindowsNamedPipeACLRejectsAdditionalPrincipal(t *testing.T) {
	serviceSID, err := windows.StringToSid(WindowsProductionServiceSID)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := inspectWindowsDesktopToken(windows.GetCurrentProcessToken(), nil)
	if err != nil {
		t.Fatal(err)
	}
	logonSID, err := windows.StringToSid(identity.logonSID)
	if err != nil {
		t.Fatal(err)
	}
	everyoneSID, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatal(err)
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{
		windowsPipeAccessEntry(serviceSID, windows.GENERIC_ALL),
		windowsPipeAccessEntry(logonSID, windowsPipeClientAccess),
		windowsPipeAccessEntry(everyoneSID, windows.GENERIC_ALL),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsDesktopPipeDACL(acl, logonSID.String()); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("widened pipe DACL error = %v", err)
	}
}

func TestWindowsNamedPipeHandshakeDeadlineCancelsOverlappedConnect(t *testing.T) {
	identity, err := inspectWindowsDesktopToken(windows.GetCurrentProcessToken(), nil)
	if err != nil {
		t.Fatalf("inspect current interactive token: %v", err)
	}
	principal := WindowsServicePrincipal{
		serviceSID:   WindowsProductionServiceSID,
		tokenUserSID: "S-1-5-18",
	}
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-runtime-e2e-timeout-%d-%d`, os.Getpid(), time.Now().UnixNano())
	instance, err := createWindowsDesktopPipeInstance(context.Background(), pipeName, principal, identity, true)
	if err != nil {
		t.Fatalf("create isolated timeout pipe: %v (cause: %v)", err, errors.Unwrap(err))
	}
	t.Cleanup(func() { _ = instance.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err = instance.Accept(ctx)
	if !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("timeout error = %v, want desktop-process-verification-unavailable", err)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("overlapped connect cancellation took %s", elapsed)
	}
}

func TestWindowsNamedPipeConnectedHandleTransfersOnceToDeadlineNetConn(t *testing.T) {
	identity, err := inspectWindowsDesktopToken(windows.GetCurrentProcessToken(), nil)
	if err != nil {
		t.Fatalf("inspect current interactive token: %v", err)
	}
	principal := WindowsServicePrincipal{serviceSID: WindowsProductionServiceSID, tokenUserSID: "S-1-5-18"}
	pipeName := fmt.Sprintf(`\\.\pipe\nimi-runtime-e2e-stream-%d-%d`, os.Getpid(), time.Now().UnixNano())
	instance, err := createWindowsDesktopPipeInstance(context.Background(), pipeName, principal, identity, true)
	if err != nil {
		t.Fatalf("create isolated stream pipe: %v", err)
	}
	t.Cleanup(func() { _ = instance.Close() })

	clientDone := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		client, err := winio.DialPipeAccess(ctx, pipeName, uint32(windowsPipeClientAccess))
		if err != nil {
			clientDone <- err
			return
		}
		defer client.Close()
		if err := client.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
			clientDone <- err
			return
		}
		if _, err := client.Write([]byte("desktop-frame")); err != nil {
			clientDone <- err
			return
		}
		response := make([]byte, len("runtime-frame"))
		if _, err := io.ReadFull(client, response); err != nil {
			clientDone <- err
			return
		}
		if !bytes.Equal(response, []byte("runtime-frame")) {
			clientDone <- fmt.Errorf("response = %q", response)
			return
		}
		clientDone <- nil
	}()

	acceptCtx, cancelAccept := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelAccept()
	connected, err := instance.Accept(acceptCtx)
	if err != nil {
		t.Fatalf("accept isolated stream pipe: %v", err)
	}
	if _, err := connected.NetConn(); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("unverified handle transfer error = %v", err)
	}
	verifier := &capturingWindowsExecutableVerifier{trustSetID: windowsDesktopE2ETrustSetID}
	verified, liveness, err := connected.verifyAndBindClientProcess(context.Background(), verifier, windowsDesktopE2ETrustSetID)
	if err != nil {
		t.Fatalf("verify isolated stream client: %v", err)
	}
	defer liveness.Close()
	if verified.PID != uint32(os.Getpid()) || verified.ExecutableTrustSetID != windowsDesktopE2ETrustSetID {
		t.Fatalf("verified isolated stream client = %#v", verified)
	}
	if _, repeatedLiveness, err := connected.verifyAndBindClientProcess(context.Background(), verifier, windowsDesktopE2ETrustSetID); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		if repeatedLiveness != nil {
			_ = repeatedLiveness.Close()
		}
		t.Fatalf("repeated client verification error = %v", err)
	}
	stream, err := connected.NetConn()
	if err != nil {
		t.Fatalf("transfer connected pipe handle: %v", err)
	}
	if stream.LocalAddr().String() != pipeName || stream.RemoteAddr().String() != pipeName {
		t.Fatalf("stream addresses = %q / %q", stream.LocalAddr(), stream.RemoteAddr())
	}
	if err := stream.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set server stream deadline: %v", err)
	}
	request := make([]byte, len("desktop-frame"))
	if _, err := io.ReadFull(stream, request); err != nil {
		t.Fatalf("read Desktop frame: %v", err)
	}
	if !bytes.Equal(request, []byte("desktop-frame")) {
		t.Fatalf("request = %q", request)
	}
	if _, err := stream.Write([]byte("runtime-frame")); err != nil {
		t.Fatalf("write Runtime frame: %v", err)
	}
	if _, err := connected.NetConn(); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("second handle transfer error = %v", err)
	}
	if err := <-clientDone; err != nil {
		t.Fatalf("client stream: %v", err)
	}
	if err := stream.Close(); err != nil {
		t.Fatalf("close server stream: %v", err)
	}
}

func TestWindowsNamedPipeNetConnRejectsReleasedVerifiedProcessWitness(t *testing.T) {
	_, connected, closePipe := openCurrentProcessWindowsTestPipe(t)
	defer closePipe()

	verifier := &capturingWindowsExecutableVerifier{trustSetID: windowsDesktopE2ETrustSetID}
	_, liveness, err := connected.verifyAndBindClientProcess(context.Background(), verifier, windowsDesktopE2ETrustSetID)
	if err != nil {
		t.Fatalf("verify isolated stream client: %v", err)
	}
	if err := liveness.Close(); err != nil {
		t.Fatalf("release verified client liveness: %v", err)
	}
	select {
	case <-liveness.Revoked():
	default:
		t.Fatal("released process witness did not revoke its capability")
	}
	if _, err := connected.NetConn(); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("released-witness handle transfer error = %v", err)
	}
}

func TestWindowsProductionNamedPipeRequiresVerifiedRuntimeExecutableCapability(t *testing.T) {
	principal := WindowsServicePrincipal{serviceSID: WindowsProductionServiceSID, tokenUserSID: "S-1-5-18"}
	if _, _, err := OpenWindowsProductionDesktopPipe(context.Background(), principal, WindowsRuntimeProcess{}); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("missing Runtime executable capability error = %v", err)
	}
}
