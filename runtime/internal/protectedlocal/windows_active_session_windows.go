//go:build windows

package protectedlocal

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	windowsWTSActiveSessionState = 0
	windowsWTSSessionInfoClass   = 24
)

type windowsWTSSessionInfo struct {
	State                   uint32
	SessionID               uint32
	IncomingBytes           uint32
	OutgoingBytes           uint32
	IncomingFrames          uint32
	OutgoingFrames          uint32
	IncomingCompressedBytes uint32
	OutgoingCompressedBytes uint32
	WinStationName          [32]uint16
	Domain                  [17]uint16
	UserName                [21]uint16
	ConnectTime             int64
	DisconnectTime          int64
	LastInputTime           int64
	LogonTime               int64
	CurrentTime             int64
}

type windowsLSAUnicodeString struct {
	Length        uint16
	MaximumLength uint16
	Buffer        *uint16
}

type windowsSecurityLogonSessionData struct {
	Size                  uint32
	LogonID               windows.LUID
	UserName              windowsLSAUnicodeString
	LogonDomain           windowsLSAUnicodeString
	AuthenticationPackage windowsLSAUnicodeString
	LogonType             uint32
	Session               uint32
	SID                   *windows.SID
	LogonTime             int64
}

type windowsLogonSessionIdentity struct {
	logonID   windows.LUID
	userSID   string
	logonType uint32
	sessionID uint32
	logonTime int64
}

var (
	windowsWTSAPI                     = windows.NewLazySystemDLL("wtsapi32.dll")
	windowsWTSQuerySessionInformation = windowsWTSAPI.NewProc("WTSQuerySessionInformationW")
	windowsWTSFreeMemory              = windowsWTSAPI.NewProc("WTSFreeMemory")
	windowsLSA                        = windows.NewLazySystemDLL("secur32.dll")
	windowsLSAGetLogonSessionData     = windowsLSA.NewProc("LsaGetLogonSessionData")
	windowsLSAFreeReturnBuffer        = windowsLSA.NewProc("LsaFreeReturnBuffer")
)

func resolveWindowsActiveSessionIdentity(sessionID uint32) (WindowsDesktopIdentity, error) {
	if sessionID == windowsNoActiveConsoleSession || sessionID == 0 {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveSession, "resolve active console session", fmt.Errorf("active interactive session unavailable"))
	}
	if err := windowsWTSQuerySessionInformation.Find(); err != nil {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveSessionInfo, "load Windows active-session query primitive", err)
	}
	if err := windowsWTSFreeMemory.Find(); err != nil {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveSessionInfo, "load Windows active-session memory primitive", err)
	}
	var buffer unsafe.Pointer
	var bufferBytes uint32
	success, _, callErr := windowsWTSQuerySessionInformation.Call(
		0,
		uintptr(sessionID),
		windowsWTSSessionInfoClass,
		uintptr(unsafe.Pointer(&buffer)),
		uintptr(unsafe.Pointer(&bufferBytes)),
	)
	if success == 0 {
		stage := WindowsPipeStageActiveSessionInfo
		if errors.Is(callErr, windows.ERROR_ACCESS_DENIED) {
			stage = WindowsPipeStageActiveSessionInfoAccess
		}
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(stage, "query Windows active-session information", callErr)
	}
	if buffer == nil {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveSessionInfo, "query Windows active-session information", fmt.Errorf("missing session information"))
	}
	defer func() { _, _, _ = windowsWTSFreeMemory.Call(uintptr(buffer)) }()
	if bufferBytes < uint32(unsafe.Sizeof(windowsWTSSessionInfo{})) {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveSessionInfo, "query Windows active-session information", fmt.Errorf("short session information"))
	}
	info := (*windowsWTSSessionInfo)(buffer)
	if info.State != windowsWTSActiveSessionState || info.SessionID != sessionID {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveSessionInfo, "validate Windows active-session information", fmt.Errorf("session state or identifier mismatch"))
	}
	userName := strings.TrimSpace(windows.UTF16ToString(info.UserName[:]))
	domain := strings.TrimSpace(windows.UTF16ToString(info.Domain[:]))
	if userName == "" || domain == "" {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveSessionInfo, "validate Windows active-session account", fmt.Errorf("domain-qualified account required"))
	}
	accountName := domain + `\` + userName
	userSID, _, _, err := windows.LookupSID("", accountName)
	if err != nil || userSID == nil {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveAccountSID, "resolve Windows active-session account SID", err)
	}
	userSIDValue := userSID.String()
	profile := mustActiveWindowsRuntimeProfile()
	switch userSIDValue {
	case "", WindowsServiceHostSID, "S-1-5-19", "S-1-5-20", profile.serviceSID:
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveAccountSID, "validate Windows active-session account SID", fmt.Errorf("interactive account SID required"))
	}
	if info.LogonTime <= 0 {
		return WindowsDesktopIdentity{}, windowsPipeOperationFailure(WindowsPipeStageActiveSessionMarker, "validate Windows active-session logon marker", fmt.Errorf("positive WTS logon time required"))
	}
	accountScope := windowsActiveSessionAccountScope(userSIDValue, sessionID, info.LogonTime)
	return WindowsDesktopIdentity{
		userSID:      userSIDValue,
		sessionID:    sessionID,
		wtsLogonTime: info.LogonTime,
		accountScope: accountScope,
	}, nil
}

func windowsLogonLUIDString(logonID windows.LUID) string {
	return fmt.Sprintf("%08x:%08x", uint32(logonID.HighPart), logonID.LowPart)
}

func readWindowsLogonSessionIdentity(logonID windows.LUID) (windowsLogonSessionIdentity, error) {
	if logonID == (windows.LUID{}) {
		return windowsLogonSessionIdentity{}, fmt.Errorf("non-empty logon identifier required")
	}
	for _, primitive := range []*windows.LazyProc{windowsLSAGetLogonSessionData, windowsLSAFreeReturnBuffer} {
		if err := primitive.Find(); err != nil {
			return windowsLogonSessionIdentity{}, err
		}
	}
	var dataPointer unsafe.Pointer
	status, _, _ := windowsLSAGetLogonSessionData.Call(
		uintptr(unsafe.Pointer(&logonID)),
		uintptr(unsafe.Pointer(&dataPointer)),
	)
	if status != uintptr(windows.STATUS_SUCCESS) {
		return windowsLogonSessionIdentity{}, windows.NTStatus(uint32(status)).Errno()
	}
	if dataPointer == nil {
		return windowsLogonSessionIdentity{}, fmt.Errorf("LSA returned no logon-session data")
	}
	defer func() { _, _, _ = windowsLSAFreeReturnBuffer.Call(uintptr(dataPointer)) }()
	data := (*windowsSecurityLogonSessionData)(dataPointer)
	minimumDataSize := uint32(unsafe.Offsetof(windowsSecurityLogonSessionData{}.LogonTime) + unsafe.Sizeof(windowsSecurityLogonSessionData{}.LogonTime))
	if data.Size < minimumDataSize || data.SID == nil {
		return windowsLogonSessionIdentity{}, fmt.Errorf("LSA returned incomplete logon-session data")
	}
	return windowsLogonSessionIdentity{
		logonID:   data.LogonID,
		userSID:   data.SID.String(),
		logonType: data.LogonType,
		sessionID: data.Session,
		logonTime: data.LogonTime,
	}, nil
}

func revalidateWindowsActiveSessionIdentity(ctx context.Context, expected WindowsDesktopIdentity) error {
	if err := ctx.Err(); err != nil {
		return windowsPipeOperationFailure(WindowsPipeStageContext, "revalidate Windows active session", err)
	}
	if err := expected.validate(); err != nil {
		return windowsPipeOperationFailure(WindowsPipeStageActiveSessionMarker, "revalidate Windows active session", err)
	}
	activeSessionID := windows.WTSGetActiveConsoleSessionId()
	if activeSessionID == windowsNoActiveConsoleSession || activeSessionID != expected.sessionID {
		return windowsPipeOperationFailure(WindowsPipeStageActiveSessionMarker, "revalidate Windows active session", fmt.Errorf("active console session changed"))
	}
	observed, err := resolveWindowsActiveSessionIdentity(activeSessionID)
	if err != nil {
		return err
	}
	if observed.userSID != expected.userSID || observed.sessionID != expected.sessionID ||
		observed.wtsLogonTime != expected.wtsLogonTime ||
		observed.accountScope != expected.accountScope {
		return windowsPipeOperationFailure(WindowsPipeStageActiveSessionMarker, "revalidate Windows active session", fmt.Errorf("active account, terminal session, or WTS logon time changed"))
	}
	return nil
}
