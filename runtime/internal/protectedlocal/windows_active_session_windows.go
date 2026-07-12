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

var (
	windowsWTSAPI                     = windows.NewLazySystemDLL("wtsapi32.dll")
	windowsWTSQuerySessionInformation = windowsWTSAPI.NewProc("WTSQuerySessionInformationW")
	windowsWTSFreeMemory              = windowsWTSAPI.NewProc("WTSFreeMemory")
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
	defer windowsWTSFreeMemory.Call(uintptr(buffer))
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
	logonMarker := fmt.Sprintf("wts:%08x:%016x", sessionID, uint64(info.LogonTime))
	accountScope := fmt.Sprintf("windows:%s:%s", strings.ToLower(userSIDValue), logonMarker)
	return WindowsDesktopIdentity{
		userSID:      userSIDValue,
		logonLUID:    logonMarker,
		sessionID:    sessionID,
		accountScope: accountScope,
		tokenBound:   false,
	}, nil
}

func revalidateWindowsActiveSessionIdentity(ctx context.Context, expected WindowsDesktopIdentity) error {
	if err := ctx.Err(); err != nil {
		return windowsPipeOperationFailure(WindowsPipeStageContext, "revalidate Windows active session", err)
	}
	if err := expected.validate(); err != nil || expected.tokenBound {
		return windowsPipeOperationFailure(WindowsPipeStageActiveSessionMarker, "revalidate Windows active session", fmt.Errorf("WTS bootstrap identity required: %w", err))
	}
	activeSessionID := windows.WTSGetActiveConsoleSessionId()
	if activeSessionID == windowsNoActiveConsoleSession || activeSessionID != expected.sessionID {
		return windowsPipeOperationFailure(WindowsPipeStageActiveSessionMarker, "revalidate Windows active session", fmt.Errorf("active console session changed"))
	}
	observed, err := resolveWindowsActiveSessionIdentity(activeSessionID)
	if err != nil {
		return err
	}
	if observed.userSID != expected.userSID ||
		observed.sessionID != expected.sessionID ||
		observed.logonLUID != expected.logonLUID ||
		observed.accountScope != expected.accountScope {
		return windowsPipeOperationFailure(WindowsPipeStageActiveSessionMarker, "revalidate Windows active session", fmt.Errorf("active account or WTS logon marker changed"))
	}
	return nil
}
