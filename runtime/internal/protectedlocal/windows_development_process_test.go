//go:build windows

package protectedlocal

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsLocalDevelopmentProcessVerifierBindsCurrentHostPathWithoutProductionSigning(t *testing.T) {
	profile := mustActiveWindowsRuntimeProfile()
	principal := WindowsServicePrincipal{serviceSID: profile.serviceSID, tokenUserSID: profile.serviceHostSID}
	identity, err := ResolveWindowsActiveDesktopIdentity(context.Background(), principal)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := NewWindowsLocalDevelopmentProcessVerifier(identity)
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	projectRoot := filepath.Dir(executable)
	process, liveness, err := verifier.VerifyLocalDevelopmentProcess(context.Background(), uint32(os.Getpid()), LocalDevelopmentProcessPolicy{
		ProjectRoot: projectRoot, HostExecutablePath: executable,
	})
	if err != nil {
		t.Fatalf("verify local-development process: %v", err)
	}
	t.Cleanup(func() { _ = liveness.Close() })
	if process.PID != uint32(os.Getpid()) || process.CanonicalExecutablePath != filepath.Clean(executable) || process.ExecutableTrustSetID != WindowsLocalDevelopmentTrustSetID || process.ExecutableDigest == (Identifier{}) {
		t.Fatalf("unexpected local-development process tuple: %+v", process)
	}

	if _, _, err := verifier.VerifyLocalDevelopmentProcess(context.Background(), uint32(os.Getpid()), LocalDevelopmentProcessPolicy{
		ProjectRoot: t.TempDir(), HostExecutablePath: executable,
	}); err == nil {
		t.Fatal("host executable outside the approved project root must fail closed")
	}
}
