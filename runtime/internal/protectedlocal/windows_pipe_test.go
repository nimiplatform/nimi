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

func TestWindowsRestrictedServiceBootstrapDefersExactLogonBindingToConnectedProcess(t *testing.T) {
	profile := mustActiveWindowsRuntimeProfile()
	principal := WindowsServicePrincipal{serviceSID: profile.serviceSID, tokenUserSID: profile.serviceHostSID}
	active, err := ResolveWindowsActiveDesktopIdentity(context.Background(), principal)
	if err != nil {
		stage, _ := WindowsPipeStageFromError(err)
		t.Fatalf("resolve active WTS identity: %v (stage=%d cause=%v)", err, stage, errors.Unwrap(err))
	}
	if err := active.validate(); err != nil {
		t.Fatalf("validate active WTS identity: %v", err)
	}
	if active.wtsLogonTime <= 0 || active.accountScope != windowsActiveSessionAccountScope(active.userSID, active.sessionID, active.wtsLogonTime) {
		t.Fatalf("active WTS identity is incomplete: %#v", active)
	}
	observed, err := inspectWindowsDesktopToken(windows.GetCurrentProcessToken(), active)
	if err != nil {
		t.Fatalf("bind current process token through exact LSA lookup: %v", err)
	}
	if !observed.matchesActiveSession(active) || observed.validate() != nil {
		t.Fatalf("connected token did not bind to active WTS session: active=%#v observed=%#v", active, observed)
	}
	if err := revalidateWindowsActiveSessionIdentity(context.Background(), active); err != nil {
		t.Fatalf("revalidate active WTS identity: %v", err)
	}
	staleIdentity := active
	staleIdentity.wtsLogonTime++
	if err := revalidateWindowsActiveSessionIdentity(context.Background(), staleIdentity); err == nil {
		t.Fatal("stale WTS logon time remained valid")
	}
	wrongSession := observed
	wrongSession.sessionID++
	if wrongSession.matchesActiveSession(active) {
		t.Fatal("exact active identity admitted a token from another terminal session")
	}
	wrongLogon := observed
	wrongLogon.logonLUID = "ffffffff:ffffffff"
	wrongLogon.logonSID = "S-1-5-5-4294967295-4294967295"
	if observed.sameLogon(wrongLogon) {
		t.Fatal("exact active identity admitted another logon LUID for the same account and terminal session")
	}
}

func TestWindowsConnectedLogonCorrelationRejectsEveryWrongTupleField(t *testing.T) {
	active := WindowsDesktopIdentity{
		userSID:      "S-1-5-21-1-2-3-1001",
		sessionID:    7,
		wtsLogonTime: 1_000,
	}
	active.accountScope = windowsActiveSessionAccountScope(active.userSID, active.sessionID, active.wtsLogonTime)
	authenticationID := windows.LUID{LowPart: 77}
	lsa := windowsLogonSessionIdentity{
		logonID:   authenticationID,
		userSID:   active.userSID,
		logonType: windowsLogonTypeInteractive,
		sessionID: active.sessionID,
		logonTime: 900,
	}
	// A token logon SID is an independent exact token-group value. It must not
	// be guessed by formatting TokenStatistics.AuthenticationId.
	logonSID := "S-1-5-5-42-99"
	valid, err := correlateWindowsConnectedLogon(active, active.userSID, active.sessionID, logonSID, authenticationID, lsa)
	if err != nil || valid.validate() != nil {
		t.Fatalf("valid exact connected logon rejected: identity=%#v error=%v", valid, err)
	}

	tests := []struct {
		name             string
		userSID          string
		sessionID        uint32
		logonSID         string
		authenticationID windows.LUID
		lsa              windowsLogonSessionIdentity
	}{
		{name: "token account", userSID: "S-1-5-21-1-2-3-1002", sessionID: active.sessionID, logonSID: logonSID, authenticationID: authenticationID, lsa: lsa},
		{name: "token session", userSID: active.userSID, sessionID: active.sessionID + 1, logonSID: logonSID, authenticationID: authenticationID, lsa: lsa},
		{name: "token logon sid", userSID: active.userSID, sessionID: active.sessionID, logonSID: "S-1-5-21-1-2-3-1001", authenticationID: authenticationID, lsa: lsa},
		{name: "empty authentication id", userSID: active.userSID, sessionID: active.sessionID, logonSID: logonSID, authenticationID: windows.LUID{}, lsa: lsa},
		{name: "LSA logon id", userSID: active.userSID, sessionID: active.sessionID, logonSID: logonSID, authenticationID: authenticationID, lsa: func() windowsLogonSessionIdentity { value := lsa; value.logonID.LowPart++; return value }()},
		{name: "LSA account", userSID: active.userSID, sessionID: active.sessionID, logonSID: logonSID, authenticationID: authenticationID, lsa: func() windowsLogonSessionIdentity { value := lsa; value.userSID = "S-1-5-21-1-2-3-1002"; return value }()},
		{name: "LSA session", userSID: active.userSID, sessionID: active.sessionID, logonSID: logonSID, authenticationID: authenticationID, lsa: func() windowsLogonSessionIdentity { value := lsa; value.sessionID++; return value }()},
		{name: "LSA noninteractive", userSID: active.userSID, sessionID: active.sessionID, logonSID: logonSID, authenticationID: authenticationID, lsa: func() windowsLogonSessionIdentity { value := lsa; value.logonType = 3; return value }()},
		{name: "LSA empty logon time", userSID: active.userSID, sessionID: active.sessionID, logonSID: logonSID, authenticationID: authenticationID, lsa: func() windowsLogonSessionIdentity { value := lsa; value.logonTime = 0; return value }()},
		{name: "LSA secondary logon after WTS session", userSID: active.userSID, sessionID: active.sessionID, logonSID: logonSID, authenticationID: authenticationID, lsa: func() windowsLogonSessionIdentity {
			value := lsa
			value.logonTime = active.wtsLogonTime + 1
			return value
		}()},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := correlateWindowsConnectedLogon(active, test.userSID, test.sessionID, test.logonSID, test.authenticationID, test.lsa); err == nil {
				t.Fatal("wrong connected logon tuple was admitted")
			}
		})
	}

	differentLogon := valid
	differentLogon.logonLUID = "00000000:0000004e"
	if valid.sameLogon(differentLogon) {
		t.Fatal("same account and terminal session converted a different AuthenticationId into the bound logon")
	}
}

func TestWindowsNamedPipeBindsExactACLAndPeerProcessIDs(t *testing.T) {
	identity, principal := resolveWindowsDesktopTestBootstrap(t)
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
	if _, err := VerifyWindowsProductionPipeServer(context.Background(), uintptr(client.handle), &capturingWindowsExecutableVerifier{trustSetID: mustActiveWindowsRuntimeProfile().runtimeTrustSetID}); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("interactive test server verification error = %v", err)
	}
	if err := validateWindowsDesktopPipeACL(instance.handle, identity.userSID); err != nil {
		t.Fatalf("validate connect-only account pipe ACL: %v", err)
	}
}

func TestWindowsNamedPipeACLRejectsAdditionalPrincipal(t *testing.T) {
	serviceSID, err := windows.StringToSid(mustActiveWindowsRuntimeProfile().serviceSID)
	if err != nil {
		t.Fatal(err)
	}
	identity, _ := resolveWindowsDesktopTestBootstrap(t)
	userSID, err := windows.StringToSid(identity.userSID)
	if err != nil {
		t.Fatal(err)
	}
	everyoneSID, err := windows.StringToSid("S-1-1-0")
	if err != nil {
		t.Fatal(err)
	}
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{
		windowsPipeAccessEntry(serviceSID, windows.GENERIC_ALL),
		windowsPipeAccessEntry(userSID, windowsPipeClientAccess),
		windowsPipeAccessEntry(everyoneSID, windows.GENERIC_ALL),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsDesktopPipeDACL(acl, userSID.String()); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("widened pipe DACL error = %v", err)
	}
}

func TestWindowsNamedPipeHandshakeDeadlineCancelsOverlappedConnect(t *testing.T) {
	identity, principal := resolveWindowsDesktopTestBootstrap(t)
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
	identity, principal := resolveWindowsDesktopTestBootstrap(t)
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

func resolveWindowsDesktopTestBootstrap(t testing.TB) (WindowsDesktopIdentity, WindowsServicePrincipal) {
	t.Helper()
	profile := mustActiveWindowsRuntimeProfile()
	principal := WindowsServicePrincipal{serviceSID: profile.serviceSID, tokenUserSID: profile.serviceHostSID}
	identity, err := ResolveWindowsActiveDesktopIdentity(context.Background(), principal)
	if err != nil {
		stage, _ := WindowsPipeStageFromError(err)
		t.Fatalf("resolve active Windows Desktop bootstrap identity: %v (stage=%d cause=%v)", err, stage, errors.Unwrap(err))
	}
	return identity, principal
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
	principal := WindowsServicePrincipal{serviceSID: mustActiveWindowsRuntimeProfile().serviceSID, tokenUserSID: "S-1-5-18"}
	if _, _, err := OpenWindowsProductionDesktopPipe(context.Background(), principal, WindowsRuntimeProcess{}); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("missing Runtime executable capability error = %v", err)
	}
}
