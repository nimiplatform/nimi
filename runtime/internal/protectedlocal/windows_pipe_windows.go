//go:build windows

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

const (
	windowsNoActiveConsoleSession = 0xffffffff
	windowsPipeClientAccess       = (windows.FILE_GENERIC_READ | windows.FILE_GENERIC_WRITE) &^ windows.FILE_APPEND_DATA
	windowsPipeBufferBytes        = 16 * 1024
	windowsPipeHandshakeTimeout   = 5 * time.Second
)

type windowsTokenStatistics struct {
	TokenID            windows.LUID
	AuthenticationID   windows.LUID
	ExpirationTime     int64
	TokenType          uint32
	ImpersonationLevel uint32
	DynamicCharged     uint32
	DynamicAvailable   uint32
	GroupCount         uint32
	PrivilegeCount     uint32
	ModifiedID         windows.LUID
}

type WindowsDesktopPipeInstance struct {
	handle   windows.Handle
	identity WindowsDesktopIdentity
	name     string
	stream   windowsDesktopPipeStream

	mu       sync.Mutex
	accepted bool
	closed   bool
}

type WindowsDesktopPipeConnection struct {
	instance  *WindowsDesktopPipeInstance
	clientPID uint32

	verificationMu       sync.Mutex
	verifiedClient       ProcessTuple
	verifiedClientHealth DesktopProcessLiveness
}

type windowsDesktopPipeStream interface {
	io.ReadWriteCloser
	SetReadDeadline(time.Time) error
	SetWriteDeadline(time.Time) error
}

type windowsDesktopPipeNetConn struct {
	instance *WindowsDesktopPipeInstance
	stream   windowsDesktopPipeStream
	address  windowsDesktopPipeAddress
}

type windowsDesktopPipeAddress string

func (address windowsDesktopPipeAddress) Network() string { return "windows-named-pipe" }
func (address windowsDesktopPipeAddress) String() string  { return string(address) }

func (connection *windowsDesktopPipeNetConn) Read(buffer []byte) (int, error) {
	return connection.stream.Read(buffer)
}

func (connection *windowsDesktopPipeNetConn) Write(buffer []byte) (int, error) {
	return connection.stream.Write(buffer)
}

func (connection *windowsDesktopPipeNetConn) Close() error {
	if connection == nil || connection.instance == nil {
		return nil
	}
	return connection.instance.Close()
}

func (connection *windowsDesktopPipeNetConn) LocalAddr() net.Addr  { return connection.address }
func (connection *windowsDesktopPipeNetConn) RemoteAddr() net.Addr { return connection.address }

func (connection *windowsDesktopPipeNetConn) SetDeadline(deadline time.Time) error {
	if err := connection.stream.SetReadDeadline(deadline); err != nil {
		return err
	}
	return connection.stream.SetWriteDeadline(deadline)
}

func (connection *windowsDesktopPipeNetConn) SetReadDeadline(deadline time.Time) error {
	return connection.stream.SetReadDeadline(deadline)
}

func (connection *windowsDesktopPipeNetConn) SetWriteDeadline(deadline time.Time) error {
	return connection.stream.SetWriteDeadline(deadline)
}

func ResolveWindowsActiveDesktopIdentity(ctx context.Context, principal WindowsServicePrincipal) (WindowsDesktopIdentity, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if err := ctx.Err(); err != nil {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageContext, "resolve active Windows desktop identity", err)
	}
	if principal.serviceSID != profile.serviceSID {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStagePrincipalCapability, "validate Runtime principal capability", fmt.Errorf("exact active service principal required"))
	}
	sessionID := windows.WTSGetActiveConsoleSessionId()
	return resolveWindowsActiveSessionIdentity(sessionID)
}

func inspectWindowsDesktopToken(token windows.Token, active WindowsDesktopIdentity) (windowsConnectedLogonIdentity, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if err := active.validate(); err != nil {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopIdentity, "validate active Windows session before token inspection", err)
	}
	user, err := token.GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopUser, "read active desktop user SID", err)
	}
	userSID := user.User.Sid.String()
	switch userSID {
	case "", "S-1-5-18", "S-1-5-19", "S-1-5-20":
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopUser, "validate active desktop user SID", fmt.Errorf("service identities are forbidden"))
	}
	if userSID == profile.serviceSID {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopUser, "validate active desktop user SID", fmt.Errorf("service identities are forbidden"))
	}
	sessionID, err := readWindowsTokenUint32(token, windows.TokenSessionId)
	if err != nil {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopSession, "read active desktop session", err)
	}
	if sessionID == 0 || sessionID != active.sessionID || userSID != active.userSID {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopSession, "validate active desktop session", fmt.Errorf("token account or terminal session mismatch"))
	}
	tokenType, err := readWindowsTokenUint32(token, windows.TokenType)
	if err != nil || tokenType != windowsTokenPrimary {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopTokenType, "validate active desktop token type", err)
	}
	groups, err := readWindowsTokenGroups(token, windows.TokenGroups)
	if err != nil {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopGroups, "read active desktop token groups", err)
	}
	if !containsEnabledSID(groups, windowsInteractiveLogonSID) && !containsEnabledSID(groups, windowsRemoteInteractiveLogonSID) {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopInteractiveGroup, "validate active desktop logon class", fmt.Errorf("interactive logon SID required"))
	}
	logonSID := ""
	for _, group := range groups {
		if group.Attributes&windows.SE_GROUP_LOGON_ID != windows.SE_GROUP_LOGON_ID {
			continue
		}
		if logonSID != "" || !strings.HasPrefix(group.SID, "S-1-5-5-") {
			return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopLogonSID, "validate active desktop logon SID", fmt.Errorf("exact single logon SID required"))
		}
		logonSID = group.SID
	}
	if logonSID == "" {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopLogonSID, "validate active desktop logon SID", fmt.Errorf("logon SID is absent"))
	}
	authenticationID, err := windowsTokenAuthenticationID(token)
	if err != nil {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageDesktopLogonLUID, "read active desktop AuthenticationId", err)
	}
	lsaIdentity, err := readWindowsLogonSessionIdentity(authenticationID)
	if err != nil {
		stage := WindowsPipeStageActiveLogonData
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			stage = WindowsPipeStageActiveLogonDataAccess
		}
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(stage, "read connected process LSA logon session", err)
	}
	observed, err := correlateWindowsConnectedLogon(active, userSID, sessionID, logonSID, authenticationID, lsaIdentity)
	if err != nil {
		return windowsConnectedLogonIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveLogonCorrelation, "correlate connected process to active Windows session", err)
	}
	return observed, nil
}

func correlateWindowsConnectedLogon(active WindowsDesktopIdentity, userSID string, sessionID uint32, logonSID string, authenticationID windows.LUID, lsaIdentity windowsLogonSessionIdentity) (windowsConnectedLogonIdentity, error) {
	if err := active.validate(); err != nil {
		return windowsConnectedLogonIdentity{}, err
	}
	if !strings.HasPrefix(logonSID, "S-1-5-5-") || authenticationID == (windows.LUID{}) ||
		lsaIdentity.logonID != authenticationID || userSID != active.userSID || lsaIdentity.userSID != userSID ||
		sessionID != active.sessionID || lsaIdentity.sessionID != sessionID || !windowsInteractiveLogonType(lsaIdentity.logonType) ||
		lsaIdentity.logonTime <= 0 || lsaIdentity.logonTime > active.wtsLogonTime {
		return windowsConnectedLogonIdentity{}, fmt.Errorf("token AuthenticationId must resolve to the active account, terminal session, pre-session interactive logon, and exact LSA record")
	}
	observed := windowsConnectedLogonIdentity{
		userSID:      userSID,
		logonSID:     logonSID,
		logonLUID:    windowsLogonLUIDString(authenticationID),
		sessionID:    sessionID,
		wtsLogonTime: active.wtsLogonTime,
		lsaLogonTime: lsaIdentity.logonTime,
		logonType:    lsaIdentity.logonType,
		accountScope: active.accountScope,
	}
	if err := observed.validate(); err != nil {
		return windowsConnectedLogonIdentity{}, err
	}
	if !observed.matchesActiveSession(active) {
		return windowsConnectedLogonIdentity{}, fmt.Errorf("connected process does not match the active WTS session")
	}
	return observed, nil
}

func OpenWindowsProductionDesktopPipe(ctx context.Context, principal WindowsServicePrincipal, process WindowsRuntimeProcess) (*WindowsDesktopPipeInstance, WindowsDesktopIdentity, error) {
	if err := process.validate(); err != nil {
		return nil, WindowsDesktopIdentity{}, windowsPipeStageFailure(WindowsPipeStageProcessCapability, principalFailure("bind Windows desktop pipe to verified Runtime executable", err))
	}
	if process.principalSID != principal.serviceSID {
		return nil, WindowsDesktopIdentity{}, windowsPipeStageFailure(WindowsPipeStageProcessBinding, principalFailure("bind Windows desktop pipe to verified Runtime executable", fmt.Errorf("service principal capability mismatch")))
	}
	identity, err := ResolveWindowsActiveDesktopIdentity(ctx, principal)
	if err != nil {
		return nil, WindowsDesktopIdentity{}, err
	}
	instance, err := createWindowsDesktopPipeInstance(ctx, mustActiveWindowsRuntimeProfile().desktopPipeName, principal, identity, true)
	if err != nil {
		return nil, WindowsDesktopIdentity{}, err
	}
	return instance, identity, nil
}

const (
	windowsDesktopPipeMaxInstances  = 1
	windowsLocalAppPipeMaxInstances = windows.PIPE_UNLIMITED_INSTANCES
)

func createWindowsDesktopPipeInstance(ctx context.Context, name string, principal WindowsServicePrincipal, identity WindowsDesktopIdentity, firstInstance bool) (*WindowsDesktopPipeInstance, error) {
	return createWindowsPipeInstance(ctx, name, principal, identity, firstInstance, windowsDesktopPipeMaxInstances)
}

func createWindowsLocalAppPipeInstance(ctx context.Context, name string, principal WindowsServicePrincipal, identity WindowsDesktopIdentity, firstInstance bool) (*WindowsDesktopPipeInstance, error) {
	return createWindowsPipeInstance(ctx, name, principal, identity, firstInstance, windowsLocalAppPipeMaxInstances)
}

func createWindowsPipeInstance(ctx context.Context, name string, principal WindowsServicePrincipal, identity WindowsDesktopIdentity, firstInstance bool, maxInstances uint32) (*WindowsDesktopPipeInstance, error) {
	profile := mustActiveWindowsRuntimeProfile()
	if err := ctx.Err(); err != nil {
		return nil, windowsPipeOperationFailure(WindowsPipeStageContext, "create Windows desktop pipe", err)
	}
	if principal.serviceSID != profile.serviceSID {
		return nil, windowsPipeOperationFailure(WindowsPipeStagePrincipalCapability, "validate pipe service principal", fmt.Errorf("exact active service principal required"))
	}
	if err := identity.validate(); err != nil {
		return nil, windowsPipeOperationFailure(WindowsPipeStageDesktopIdentity, "validate pipe desktop identity", err)
	}
	if !strings.HasPrefix(name, `\\.\pipe\`) || strings.ContainsRune(name, '\x00') {
		return nil, windowsPipeOperationFailure(WindowsPipeStageEndpointName, "validate pipe endpoint name", fmt.Errorf("local named-pipe path required"))
	}
	if maxInstances == 0 || maxInstances > windows.PIPE_UNLIMITED_INSTANCES {
		return nil, windowsPipeOperationFailure(WindowsPipeStageCreateInvalidParameter, "validate pipe instance limit", fmt.Errorf("invalid named-pipe instance limit"))
	}
	securityDescriptor, err := windowsDesktopPipeSecurityDescriptor(identity.userSID)
	if err != nil {
		return nil, err
	}
	namePointer, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, windowsPipeOperationFailure(WindowsPipeStageEndpointEncode, "encode pipe endpoint name", err)
	}
	securityAttributes := windows.SecurityAttributes{
		Length:             uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		SecurityDescriptor: securityDescriptor,
		InheritHandle:      0,
	}
	openMode := uint32(windows.PIPE_ACCESS_DUPLEX | windows.FILE_FLAG_OVERLAPPED | windows.FILE_FLAG_WRITE_THROUGH | windows.WRITE_DAC)
	if firstInstance {
		openMode |= windows.FILE_FLAG_FIRST_PIPE_INSTANCE
	}
	pipeMode := uint32(windows.PIPE_TYPE_BYTE | windows.PIPE_READMODE_BYTE | windows.PIPE_WAIT | windows.PIPE_REJECT_REMOTE_CLIENTS)
	handle, err := windows.CreateNamedPipe(
		namePointer,
		openMode,
		pipeMode,
		maxInstances,
		windowsPipeBufferBytes,
		windowsPipeBufferBytes,
		0,
		&securityAttributes,
	)
	if err != nil {
		stage := WindowsPipeStageCreate
		switch {
		case errors.Is(err, windows.ERROR_ACCESS_DENIED):
			stage = WindowsPipeStageCreateAccess
		case errors.Is(err, windows.ERROR_PIPE_BUSY), errors.Is(err, windows.ERROR_ALREADY_EXISTS):
			stage = WindowsPipeStageCreateConflict
		case errors.Is(err, windows.ERROR_INVALID_PARAMETER):
			stage = WindowsPipeStageCreateInvalidParameter
		}
		return nil, windowsPipeOperationFailure(stage, "create fixed Windows desktop pipe", err)
	}
	instance := &WindowsDesktopPipeInstance{handle: handle, identity: identity, name: name}
	if err := validateWindowsDesktopPipeACL(handle, identity.userSID); err != nil {
		_ = instance.Close()
		return nil, err
	}
	return instance, nil
}

func (instance *WindowsDesktopPipeInstance) Accept(ctx context.Context) (*WindowsDesktopPipeConnection, error) {
	if instance == nil {
		return nil, windowsPipeFailure("accept Windows desktop pipe", fmt.Errorf("pipe instance is nil"))
	}
	instance.mu.Lock()
	if instance.closed || instance.accepted {
		instance.mu.Unlock()
		return nil, windowsPipeFailure("accept Windows desktop pipe", fmt.Errorf("pipe instance is closed or already accepted"))
	}
	instance.accepted = true
	instance.mu.Unlock()

	acceptCtx, cancel := context.WithTimeout(ctx, windowsPipeHandshakeTimeout)
	defer cancel()
	if err := connectWindowsDesktopPipe(acceptCtx, instance.handle); err != nil {
		_ = instance.Close()
		return nil, err
	}
	var clientPID uint32
	if err := windows.GetNamedPipeClientProcessId(instance.handle, &clientPID); err != nil || clientPID == 0 {
		_ = instance.Close()
		return nil, windowsPipeOperationFailure(WindowsPipeStageClientPID, "bind Windows pipe client process", err)
	}
	return &WindowsDesktopPipeConnection{instance: instance, clientPID: clientPID}, nil
}

func connectWindowsDesktopPipe(ctx context.Context, handle windows.Handle) error {
	event, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return windowsPipeFailure("create Windows pipe connect event", err)
	}
	defer func() { _ = windows.CloseHandle(event) }()
	overlapped := windows.Overlapped{HEvent: event}
	err = windows.ConnectNamedPipe(handle, &overlapped)
	switch {
	case err == nil, errors.Is(err, windows.ERROR_PIPE_CONNECTED):
		return nil
	case !errors.Is(err, windows.ERROR_IO_PENDING):
		return windowsPipeFailure("connect Windows desktop pipe", err)
	}

	for {
		waitResult, waitErr := windows.WaitForSingleObject(event, 50)
		switch waitResult {
		case windows.WAIT_OBJECT_0:
			var transferred uint32
			if err := windows.GetOverlappedResult(handle, &overlapped, &transferred, false); err != nil && !errors.Is(err, windows.ERROR_PIPE_CONNECTED) {
				return windowsPipeFailure("complete Windows desktop pipe connect", err)
			}
			return nil
		case uint32(windows.WAIT_TIMEOUT):
			select {
			case <-ctx.Done():
				cancelErr := windows.CancelIoEx(handle, &overlapped)
				if cancelErr != nil && !errors.Is(cancelErr, windows.ERROR_NOT_FOUND) {
					return windowsPipeFailure("cancel Windows desktop pipe connect", cancelErr)
				}
				_, _ = windows.WaitForSingleObject(event, windows.INFINITE)
				var transferred uint32
				_ = windows.GetOverlappedResult(handle, &overlapped, &transferred, false)
				return windowsPipeFailure("accept Windows desktop pipe", ctx.Err())
			default:
			}
		default:
			if waitErr == nil {
				waitErr = fmt.Errorf("unexpected wait result %d", waitResult)
			}
			return windowsPipeFailure("wait for Windows desktop pipe connection", waitErr)
		}
	}
}

func (connection *WindowsDesktopPipeConnection) ClientProcessID() uint32 {
	if connection == nil {
		return 0
	}
	return connection.clientPID
}

// NetConn transfers the connected overlapped pipe handle into the IOCP-backed
// stream used by gRPC. It is a one-way ownership transfer: the native instance
// remains the single close authority and a handle can never be wrapped twice.
func (connection *WindowsDesktopPipeConnection) NetConn() (net.Conn, error) {
	if connection == nil || connection.instance == nil {
		return nil, windowsPipeFailure("open Windows desktop pipe stream", fmt.Errorf("connected pipe capability required"))
	}
	connection.verificationMu.Lock()
	defer connection.verificationMu.Unlock()
	if err := connection.verifiedClient.validate(); err != nil || connection.verifiedClientHealth == nil {
		return nil, windowsPipeFailure("open Windows desktop pipe stream", fmt.Errorf("verified desktop process capability required"))
	}
	select {
	case <-connection.verifiedClientHealth.Revoked():
		return nil, windowsPipeFailure("open Windows desktop pipe stream", fmt.Errorf("verified desktop process is no longer live"))
	default:
	}
	instance := connection.instance
	instance.mu.Lock()
	defer instance.mu.Unlock()
	if instance.closed || !instance.accepted || instance.stream != nil || instance.handle == 0 || instance.handle == windows.InvalidHandle {
		return nil, windowsPipeFailure("open Windows desktop pipe stream", fmt.Errorf("connected pipe handle is unavailable or already transferred"))
	}
	opened, err := winio.NewOpenFile(instance.handle)
	if err != nil {
		return nil, windowsPipeFailure("bind Windows desktop pipe to IO completion port", err)
	}
	stream, ok := opened.(windowsDesktopPipeStream)
	if !ok {
		_ = opened.Close()
		instance.closed = true
		instance.handle = 0
		return nil, windowsPipeFailure("bind Windows desktop pipe stream deadlines", fmt.Errorf("IOCP stream lacks deadline support"))
	}
	instance.stream = stream
	instance.handle = 0
	address := windowsDesktopPipeAddress(instance.name)
	return &windowsDesktopPipeNetConn{instance: instance, stream: stream, address: address}, nil
}

func (connection *WindowsDesktopPipeConnection) Close() error {
	if connection == nil || connection.instance == nil {
		return nil
	}
	return connection.instance.Close()
}

func (instance *WindowsDesktopPipeInstance) Close() error {
	if instance == nil {
		return nil
	}
	instance.mu.Lock()
	if instance.closed {
		instance.mu.Unlock()
		return nil
	}
	instance.closed = true
	handle := instance.handle
	stream := instance.stream
	instance.handle = 0
	instance.stream = nil
	instance.mu.Unlock()
	if stream != nil {
		return stream.Close()
	}
	if handle == 0 || handle == windows.InvalidHandle {
		return nil
	}
	disconnectErr := windows.DisconnectNamedPipe(handle)
	if errors.Is(disconnectErr, windows.ERROR_PIPE_NOT_CONNECTED) {
		disconnectErr = nil
	}
	closeErr := windows.CloseHandle(handle)
	return errors.Join(disconnectErr, closeErr)
}

var _ net.Conn = (*windowsDesktopPipeNetConn)(nil)

func windowsDesktopPipeSecurityDescriptor(userSID string) (*windows.SECURITY_DESCRIPTOR, error) {
	if _, err := windows.StringToSid(userSID); err != nil || !strings.HasPrefix(userSID, "S-1-") || strings.HasPrefix(userSID, "S-1-5-5-") {
		return nil, windowsPipeOperationFailure(WindowsPipeStageDescriptorSID, "parse active desktop account SID", err)
	}
	sddl := fmt.Sprintf("D:P(A;;GA;;;%s)(A;;0x%08x;;;%s)", mustActiveWindowsRuntimeProfile().serviceSID, uint32(windowsPipeClientAccess), userSID)
	descriptor, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return nil, windowsPipeOperationFailure(WindowsPipeStageDescriptorBuild, "build service-owned pipe DACL", err)
	}
	return descriptor, nil
}

func validateWindowsDesktopPipeACL(handle windows.Handle, userSID string) error {
	descriptor, err := windows.GetSecurityInfo(handle, windows.SE_KERNEL_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		stage := WindowsPipeStageACLRead
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			stage = WindowsPipeStageACLReadAccess
		}
		return windowsPipeOperationFailure(stage, "read Windows desktop pipe DACL", err)
	}
	control, _, err := descriptor.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return windowsPipeOperationFailure(WindowsPipeStageACLControl, "validate protected Windows desktop pipe DACL", err)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return windowsPipeOperationFailure(WindowsPipeStageACLEntries, "read Windows desktop pipe DACL entries", err)
	}
	return validateWindowsDesktopPipeDACL(dacl, userSID)
}

func validateWindowsDesktopPipeDACL(dacl *windows.ACL, userSID string) error {
	profile := mustActiveWindowsRuntimeProfile()
	if dacl == nil || dacl.AceCount != 2 {
		return windowsPipeOperationFailure(WindowsPipeStageACLEntries, "validate Windows desktop pipe DACL entries", fmt.Errorf("exact closed two-entry DACL required"))
	}
	serviceAllowed := false
	userAllowed := false
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return windowsPipeOperationFailure(WindowsPipeStageACLEntries, "read Windows desktop pipe DACL entry", err)
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Header.AceFlags != 0 {
			return windowsPipeOperationFailure(WindowsPipeStageACLEntries, "validate Windows desktop pipe DACL entry", fmt.Errorf("unflagged allow ACE required"))
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart)).String()
		mask := uint32(ace.Mask)
		switch sid {
		case profile.serviceSID:
			if mask != windows.GENERIC_ALL && mask != windowsFileAllAccess {
				return windowsPipeOperationFailure(WindowsPipeStageACLServiceACE, "validate Windows desktop pipe service ACE", fmt.Errorf("full service access required"))
			}
			serviceAllowed = true
		case userSID:
			if mask != uint32(windowsPipeClientAccess) {
				return windowsPipeOperationFailure(WindowsPipeStageACLClientACE, "validate Windows desktop pipe client ACE", fmt.Errorf("connect-only client access required"))
			}
			userAllowed = true
		default:
			return windowsPipeOperationFailure(WindowsPipeStageACLPrincipals, "validate Windows desktop pipe DACL entry", fmt.Errorf("unexpected allowed principal"))
		}
	}
	if !serviceAllowed || !userAllowed {
		return windowsPipeOperationFailure(WindowsPipeStageACLPrincipals, "validate Windows desktop pipe DACL entries", fmt.Errorf("required service and desktop ACEs are absent"))
	}
	return nil
}

func windowsPipeAccessEntry(sid *windows.SID, access uint32) windows.EXPLICIT_ACCESS {
	return windows.EXPLICIT_ACCESS{
		AccessPermissions: windows.ACCESS_MASK(access),
		AccessMode:        windows.SET_ACCESS,
		Inheritance:       windows.NO_INHERITANCE,
		Trustee: windows.TRUSTEE{
			TrusteeForm:  windows.TRUSTEE_IS_SID,
			TrusteeType:  windows.TRUSTEE_IS_UNKNOWN,
			TrusteeValue: windows.TrusteeValueFromSID(sid),
		},
	}
}

func windowsPipeOperationFailure(stage WindowsPipeFailureStage, operation string, cause error) error {
	return windowsPipeStageFailure(stage, windowsPipeFailure(operation, cause))
}
