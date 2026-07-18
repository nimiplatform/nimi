package protectedlocal

import (
	"context"
	"fmt"
	"strings"
)

const (
	windowsLogonTypeInteractive             uint32 = 2
	windowsLogonTypeRemoteInteractive       uint32 = 10
	windowsLogonTypeCachedInteractive       uint32 = 11
	windowsLogonTypeCachedRemoteInteractive uint32 = 12
)

func windowsInteractiveLogonType(logonType uint32) bool {
	return logonType == windowsLogonTypeInteractive ||
		logonType == windowsLogonTypeRemoteInteractive ||
		logonType == windowsLogonTypeCachedInteractive ||
		logonType == windowsLogonTypeCachedRemoteInteractive
}

const WindowsProductionDesktopPipeName = `\\.\pipe\nimi-runtime-protected-v1`
const WindowsProductionLocalAppPipeName = `\\.\pipe\nimi-runtime-local-app-v1`

const (
	WindowsExecutableRoleDesktop  WindowsExecutableRole = "nimi_desktop"
	WindowsExecutableRoleRuntime  WindowsExecutableRole = "nimi_runtime_service"
	WindowsExecutableRoleLocalApp WindowsExecutableRole = "nimi_local_app"

	WindowsDesktopProductionTrustSetID = "nimi-desktop-production-v1"
	WindowsRuntimeProductionTrustSetID = "nimi-runtime-production-v1"

	windowsDesktopE2ETrustSetID = "nimi-desktop-e2e-fixture-v1"
)

type WindowsExecutableRole string

// WindowsExecutableEvidence is collected from one locked executable file
// object. The verifier runs while that handle denies replacement, so digest,
// file identity, Authenticode, and release-record checks share one object.
type WindowsExecutableEvidence struct {
	PID                   uint32
	CreationMarker        string
	Path                  string
	CanonicalFileIdentity string
	Digest                Identifier
}

// WindowsLockedExecutable exposes the exact HFILE held against write/delete
// replacement for the duration of one trust-verifier call. NativeHandle is a
// borrowed Windows handle and must not be closed or retained by the verifier.
type WindowsLockedExecutable interface {
	Evidence() WindowsExecutableEvidence
	NativeHandle() uintptr
}

type WindowsExecutableTrustVerifier interface {
	VerifyWindowsExecutable(context.Context, WindowsExecutableRole, WindowsLockedExecutable) (string, error)
}

// WindowsRuntimeProcess is an opaque capability minted only after the current
// service principal and locked Runtime executable pass production validation.
// A production pipe cannot be created from a principal capability alone.
type WindowsRuntimeProcess struct {
	principalSID string
	tuple        ProcessTuple
}

func (process WindowsRuntimeProcess) ProcessTuple() ProcessTuple { return process.tuple }

func (process WindowsRuntimeProcess) validate() error {
	profile := mustActiveWindowsRuntimeProfile()
	if process.principalSID != profile.serviceSID || process.tuple.OS != OSWindows ||
		process.tuple.SecurityPrincipal != profile.serviceSID ||
		process.tuple.ExecutableTrustSetID != profile.runtimeTrustSetID {
		return fmt.Errorf("verified protected Runtime process capability required")
	}
	return process.tuple.validate()
}

// WindowsDesktopIdentity is the service bootstrap capability for the active
// Windows terminal session. It deliberately contains no user token, logon SID,
// or AuthenticationId: those are bound from the real connected process before
// its pipe handle can become a NetConn.
type WindowsDesktopIdentity struct {
	userSID      string
	sessionID    uint32
	wtsLogonTime int64
	accountScope string
}

func (identity WindowsDesktopIdentity) UserSID() string   { return identity.userSID }
func (identity WindowsDesktopIdentity) SessionID() uint32 { return identity.sessionID }
func (identity WindowsDesktopIdentity) AccountPartition() string {
	return identity.accountScope
}

func (identity WindowsDesktopIdentity) validate() error {
	if !strings.HasPrefix(identity.userSID, "S-1-") || identity.sessionID == 0 || identity.wtsLogonTime <= 0 || identity.accountScope == "" {
		return fmt.Errorf("active Windows desktop identity is incomplete")
	}
	expectedScope := windowsActiveSessionAccountScope(identity.userSID, identity.sessionID, identity.wtsLogonTime)
	if identity.accountScope != expectedScope {
		return fmt.Errorf("active Windows desktop account partition is inconsistent")
	}
	return nil
}

type windowsConnectedLogonIdentity struct {
	userSID      string
	logonSID     string
	logonLUID    string
	sessionID    uint32
	wtsLogonTime int64
	lsaLogonTime int64
	logonType    uint32
	accountScope string
}

func (identity windowsConnectedLogonIdentity) validate() error {
	if !strings.HasPrefix(identity.userSID, "S-1-") ||
		!strings.HasPrefix(identity.logonSID, "S-1-5-5-") ||
		identity.logonLUID == "" ||
		identity.sessionID == 0 || identity.wtsLogonTime <= 0 || identity.lsaLogonTime <= 0 ||
		identity.lsaLogonTime > identity.wtsLogonTime || !windowsInteractiveLogonType(identity.logonType) {
		return fmt.Errorf("exact connected Windows logon identity is incomplete")
	}
	if identity.accountScope != windowsActiveSessionAccountScope(identity.userSID, identity.sessionID, identity.wtsLogonTime) {
		return fmt.Errorf("connected Windows account partition is inconsistent")
	}
	return nil
}

func (identity windowsConnectedLogonIdentity) matchesActiveSession(active WindowsDesktopIdentity) bool {
	if identity.validate() != nil || active.validate() != nil {
		return false
	}
	return identity.userSID == active.userSID &&
		identity.sessionID == active.sessionID &&
		identity.wtsLogonTime == active.wtsLogonTime &&
		identity.accountScope == active.accountScope
}

func (identity windowsConnectedLogonIdentity) sameLogon(observed windowsConnectedLogonIdentity) bool {
	return identity.validate() == nil && observed.validate() == nil &&
		identity.userSID == observed.userSID && identity.logonSID == observed.logonSID &&
		identity.logonLUID == observed.logonLUID &&
		identity.sessionID == observed.sessionID && identity.wtsLogonTime == observed.wtsLogonTime &&
		identity.lsaLogonTime == observed.lsaLogonTime && identity.logonType == observed.logonType &&
		identity.accountScope == observed.accountScope
}

func windowsActiveSessionAccountScope(userSID string, sessionID uint32, wtsLogonTime int64) string {
	return fmt.Sprintf("windows:%s:wts:%08x:%016x", strings.ToLower(userSID), sessionID, uint64(wtsLogonTime))
}
