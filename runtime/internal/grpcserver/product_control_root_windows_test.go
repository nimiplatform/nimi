//go:build windows

package grpcserver

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

func TestResolveWindowsProfileImagePathAdmitsOnlySystemDriveExpansion(t *testing.T) {
	windowsDirectory, err := windows.GetSystemWindowsDirectory()
	if err != nil {
		t.Fatalf("system Windows directory: %v", err)
	}
	want := filepath.Join(filepath.VolumeName(windowsDirectory)+string(filepath.Separator), "Users", "tester")
	got, err := resolveWindowsProfileImagePath(`%SystemDrive%\Users\tester`, registry.EXPAND_SZ)
	if err != nil {
		t.Fatalf("resolve ProfileImagePath: %v", err)
	}
	if got != want {
		t.Fatalf("profile path = %q, want %q", got, want)
	}
	literal := filepath.Join(filepath.VolumeName(windowsDirectory)+string(filepath.Separator), "Users", "literal-profile")
	got, err = resolveWindowsProfileImagePath(literal, registry.EXPAND_SZ)
	if err != nil {
		t.Fatalf("resolve literal REG_EXPAND_SZ ProfileImagePath: %v", err)
	}
	if got != literal {
		t.Fatalf("literal profile path = %q, want %q", got, literal)
	}
	if _, err := resolveWindowsProfileImagePath(`%USERPROFILE%\nested`, registry.EXPAND_SZ); err == nil {
		t.Fatal("caller-environment expansion was accepted")
	}
	if _, err := resolveWindowsProfileImagePath(`relative\profile`, registry.SZ); err == nil {
		t.Fatal("relative profile mapping was accepted")
	}
	for _, shareRoot := range []string{`\\server\share`, `\\server\share\`} {
		if _, err := resolveWindowsProfileImagePath(shareRoot, registry.SZ); err == nil {
			t.Fatalf("UNC share-root profile mapping %q was accepted", shareRoot)
		}
	}
	uncProfile := `\\server\share\user`
	got, err = resolveWindowsProfileImagePath(uncProfile, registry.SZ)
	if err != nil {
		t.Fatalf("ordinary UNC profile subdirectory was rejected: %v", err)
	}
	if got != filepath.Clean(uncProfile) {
		t.Fatalf("UNC profile path = %q, want %q", got, filepath.Clean(uncProfile))
	}
}

func TestProtectedProductControlRootReadsCurrentWindowsProfileMapping(t *testing.T) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		t.Fatalf("resolve current Windows user SID: %v", err)
	}
	sid := user.User.Sid.String()
	if !strings.HasPrefix(sid, "S-1-5-21-") {
		t.Skipf("current token %s is not an interactive user account", sid)
	}
	identity, identityErr := localappkernel.ValidateVerifiedWindowsInteractiveUserSID(sid)
	if identityErr != nil {
		t.Fatalf("validate current Windows user SID: %v", identityErr)
	}
	profileRoot, err := resolveProtectedWindowsInteractiveUserProfileRoot(identity)
	if err != nil {
		t.Fatalf("resolve current Windows profile root: %v", err)
	}
	productControlRoot, err := ResolveProtectedProductControlRoot(identity)
	if err != nil {
		t.Fatalf("resolve fixed Product Control root: %v", err)
	}
	if productControlRoot != filepath.Join(profileRoot, ".nimi") {
		t.Fatalf("Product Control root = %q, want %q", productControlRoot, filepath.Join(profileRoot, ".nimi"))
	}
}
