//go:build windows

package protectedlocal

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

func TestCanonicalWindowsLocalDevelopmentPolicyAcceptsExactExternalProjectAlias(t *testing.T) {
	projectRoot := t.TempDir()
	externalRoot := t.TempDir()
	host := filepath.Join(externalRoot, "electron.exe")
	alias := filepath.Join(projectRoot, "node_modules", "electron", "dist", "electron.exe")
	if err := os.MkdirAll(filepath.Dir(alias), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(host, []byte("electron fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(host, alias); err != nil {
		t.Fatalf("create exact project host alias: %v", err)
	}

	policy, err := canonicalWindowsLocalDevelopmentPolicy(LocalDevelopmentProcessPolicy{
		ProjectRoot: projectRoot, HostExecutablePath: host, ProjectHostAliasPath: alias,
	})
	if err != nil {
		t.Fatalf("exact external project alias must be admitted: %v", err)
	}
	if !strings.EqualFold(policy.HostExecutablePath, host) {
		t.Fatalf("host path = %q, want %q", policy.HostExecutablePath, host)
	}
	rogue := filepath.Join(externalRoot, "rogue.exe")
	if err := os.WriteFile(rogue, []byte("rogue"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := canonicalWindowsLocalDevelopmentPolicy(LocalDevelopmentProcessPolicy{
		ProjectRoot: projectRoot, HostExecutablePath: rogue, ProjectHostAliasPath: alias,
	}); err == nil {
		t.Fatal("unrelated external host must remain rejected")
	}
}

func TestWindowsLocalDevelopmentHostComparisonUsesFileIdentity(t *testing.T) {
	root := t.TempDir()
	left := filepath.Join(root, "left.exe")
	right := filepath.Join(root, "right.exe")
	rogue := filepath.Join(root, "rogue.exe")
	if err := os.WriteFile(left, []byte("host"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(left, right); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rogue, []byte("rogue"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !sameWindowsLocalDevelopmentHostFile(left, right) {
		t.Fatal("alternate names for the exact host file identity must match")
	}
	if sameWindowsLocalDevelopmentHostFile(left, rogue) {
		t.Fatal("unrelated host file identity must remain rejected")
	}
}

func TestCanonicalWindowsLocalDevelopmentPolicyAcceptsProjectDirectoryJunction(t *testing.T) {
	projectRoot := t.TempDir()
	storePackage := filepath.Join(t.TempDir(), "electron")
	host := filepath.Join(storePackage, "dist", "electron.exe")
	aliasParent := filepath.Join(projectRoot, "node_modules")
	aliasPackage := filepath.Join(aliasParent, "electron")
	aliasHost := filepath.Join(aliasPackage, "dist", "electron.exe")
	if err := os.MkdirAll(filepath.Dir(host), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(aliasParent, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(host, []byte("electron fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", aliasPackage, storePackage).CombinedOutput(); err != nil {
		t.Fatalf("create project Electron directory junction: %v: %s", err, output)
	}

	policy, err := canonicalWindowsLocalDevelopmentPolicy(LocalDevelopmentProcessPolicy{
		ProjectRoot: projectRoot, HostExecutablePath: host, ProjectHostAliasPath: aliasHost,
	})
	if err != nil {
		stage, _ := WindowsLocalDevelopmentPolicyStageFromError(err)
		t.Fatalf("project Electron directory junction must be admitted (stage=%s): %v", stage, err)
	}
	if !sameWindowsLocalDevelopmentHostFile(policy.HostExecutablePath, host) {
		t.Fatalf("canonical host path = %q, want exact file identity %q", policy.HostExecutablePath, host)
	}
}
