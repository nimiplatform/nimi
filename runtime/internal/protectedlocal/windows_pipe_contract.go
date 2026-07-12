package protectedlocal

import (
	"context"
	"fmt"
	"strings"
)

const WindowsProductionDesktopPipeName = `\\.\pipe\nimi-runtime-protected-v1`
const WindowsProductionInstalledPipeName = `\\.\pipe\nimi-runtime-installed-v1`

const (
	WindowsExecutableRoleDesktop   WindowsExecutableRole = "nimi_desktop"
	WindowsExecutableRoleRuntime   WindowsExecutableRole = "nimi_runtime_service"
	WindowsExecutableRoleInstalled WindowsExecutableRole = "nimi_installed_app"

	WindowsDesktopProductionTrustSetID = "nimi-desktop-production-v1"
	WindowsRuntimeProductionTrustSetID = "nimi-runtime-production-v1"
	WindowsInstalledReleaseTrustSetID  = "windows-platform-release-authenticode-v1"
	// WindowsLocalDevelopmentTrustSetID is never accepted by production
	// installed admission. It denotes an exact Desktop-supervised mutable host
	// whose project authorization and process path are revalidated separately.
	WindowsLocalDevelopmentTrustSetID = "windows-local-development-supervised-v1"

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

// WindowsDesktopIdentity is an opaque capability for the active interactive
// account and Windows terminal logon instance. Restricted-service bootstrap
// uses WTS session metadata; tokenBound identities are minted only after a
// connected native process token is opened by PID.
type WindowsDesktopIdentity struct {
	userSID      string
	logonSID     string
	logonLUID    string
	sessionID    uint32
	accountScope string
	tokenBound   bool
}

func (identity WindowsDesktopIdentity) UserSID() string      { return identity.userSID }
func (identity WindowsDesktopIdentity) LogonSID() string     { return identity.logonSID }
func (identity WindowsDesktopIdentity) LogonSession() string { return identity.logonLUID }
func (identity WindowsDesktopIdentity) SessionID() uint32    { return identity.sessionID }
func (identity WindowsDesktopIdentity) AccountPartition() string {
	return identity.accountScope
}

func (identity WindowsDesktopIdentity) validate() error {
	if !strings.HasPrefix(identity.userSID, "S-1-") || identity.logonLUID == "" || identity.sessionID == 0 || identity.accountScope == "" {
		return fmt.Errorf("active Windows desktop identity is incomplete")
	}
	expectedScope := fmt.Sprintf("windows:%s:%s", strings.ToLower(identity.userSID), identity.logonLUID)
	if identity.accountScope != expectedScope {
		return fmt.Errorf("active Windows desktop account partition is inconsistent")
	}
	if identity.tokenBound {
		if !strings.HasPrefix(identity.logonSID, "S-1-5-5-") || strings.HasPrefix(identity.logonLUID, "wts:") {
			return fmt.Errorf("token-bound Windows desktop identity is incomplete")
		}
	} else if identity.logonSID != "" || !strings.HasPrefix(identity.logonLUID, "wts:") {
		return fmt.Errorf("WTS-bound Windows desktop identity is incomplete")
	}
	return nil
}

func (identity WindowsDesktopIdentity) matchesObservedToken(observed WindowsDesktopIdentity) bool {
	if identity.validate() != nil || observed.validate() != nil || !observed.tokenBound {
		return false
	}
	if identity.userSID != observed.userSID || identity.sessionID != observed.sessionID {
		return false
	}
	if !identity.tokenBound {
		return true
	}
	return identity.logonSID == observed.logonSID &&
		identity.logonLUID == observed.logonLUID &&
		identity.accountScope == observed.accountScope
}
