//go:build darwin && cgo

package protectedlocal

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	macOSDesktopSignedTrustSetID = "macos-desktop-signed-code-v1"
	macOSDesktopSourceTrustSetID = "macos-desktop-source-executable-v1"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-010a
// macOSDesktopProcessTuple projects only evidence already verified from the
// connected Unix-socket peer, its process-start snapshot, and its executable.
// No request metadata participates in the formal App admission tuple.
func macOSDesktopProcessTuple(
	snapshot macOSProcessSnapshot,
	audit macOSAuditIdentity,
	code macOSCodeIdentity,
	executablePath string,
	trustSetID string,
) (ProcessTuple, error) {
	path := strings.TrimSpace(executablePath)
	identity := path
	var digest Identifier
	if code.cdhash != "" && code.signingIdentifier != "" {
		identity = fmt.Sprintf("macos-code:%s:%s", code.signingIdentifier, code.cdhash)
		digest = sha256.Sum256([]byte(strings.Join([]string{
			code.teamID,
			code.signingIdentifier,
			code.cdhash,
		}, "\x00")))
	} else {
		file, err := os.Open(path)
		if err != nil {
			return ProcessTuple{}, fmt.Errorf("open verified macOS Desktop executable: %w", err)
		}
		hash := sha256.New()
		_, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return ProcessTuple{}, fmt.Errorf("hash verified macOS Desktop executable: %w", copyErr)
		}
		if closeErr != nil {
			return ProcessTuple{}, fmt.Errorf("close verified macOS Desktop executable: %w", closeErr)
		}
		copy(digest[:], hash.Sum(nil))
	}
	tuple := ProcessTuple{
		OS:                          OSMacOS,
		PID:                         snapshot.pid,
		CreationMarker:              fmt.Sprintf("macos-start:%d:%d:pidversion:%d", snapshot.startSeconds, snapshot.startMicros, audit.pidVersion),
		OSLoginSession:              fmt.Sprintf("macos-audit-session:%d", audit.auditSession),
		SecurityPrincipal:           fmt.Sprintf("macos-uid:%d", audit.euid),
		CanonicalExecutableIdentity: identity,
		CanonicalExecutablePath:     path,
		ExecutableDigest:            digest,
		ExecutableTrustSetID:        trustSetID,
	}
	if err := tuple.validate(); err != nil {
		return ProcessTuple{}, fmt.Errorf("validate verified macOS Desktop process tuple: %w", err)
	}
	return tuple, nil
}

// The installed App supervisor is a separate native image with its own signing
// identifier and fixed location beside the Runtime. Sharing an audit session
// with Home is necessary but never sufficient to acquire either authority.
func verifyMacOSControlPeer(audit macOSAuditIdentity, homePath string) (DesktopPeerIdentity, ProcessTuple, bool, error) {
	path := filepath.Join(filepath.Dir(MacOSRuntimeExecutablePath), "nimi-app-supervisor")
	identifier := ""
	if MacOSDesktopApplicationPath != "" {
		path = filepath.Join(MacOSDesktopApplicationPath, "Contents", "Helpers", "nimi-app-supervisor")
		identifier = strings.Replace(MacOSDesktopSigningIdentifier, "apps.nimi.desktop", "app-supervisor", 1)
	}
	initial, err := inspectMacOSProcess(audit.pid)
	if err != nil {
		return DesktopPeerIdentity{}, ProcessTuple{}, false, err
	}
	if initial.executablePath != path {
		peer, process, err := verifyConnectedMacOSDesktop(audit, homePath)
		return peer, process, false, err
	}
	var policy macOSCodePolicy
	if identifier != "" {
		policy, err = newMacOSCodePolicy(identifier)
		if err != nil {
			return DesktopPeerIdentity{}, ProcessTuple{}, true, err
		}
	}
	code, err := verifyMacOSProcessIdentity(initial, &audit, policy, path, 0, false)
	if err != nil {
		return DesktopPeerIdentity{}, ProcessTuple{}, true, err
	}
	process, err := macOSDesktopProcessTuple(initial, audit, code, path, "macos-installed-app-supervisor-v1")
	if err != nil {
		return DesktopPeerIdentity{}, ProcessTuple{}, true, err
	}
	return DesktopPeerIdentity{OS: OSMacOS, PID: audit.pid, UID: audit.euid, AuditSession: audit.auditSession}, process, true, nil
}
