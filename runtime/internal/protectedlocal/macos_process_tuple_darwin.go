//go:build darwin && cgo

package protectedlocal

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
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
