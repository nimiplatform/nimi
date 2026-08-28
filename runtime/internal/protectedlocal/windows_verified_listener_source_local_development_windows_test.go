//go:build windows && nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"os"
	"path/filepath"
	"testing"
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
