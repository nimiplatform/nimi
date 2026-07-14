//go:build windows

package grpcserver

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
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
}

func TestProtectedProductControlProposalDoesNotRequireProfileDirectoryAccess(t *testing.T) {
	acceptance := validProductControlProposalAcceptance()
	profileRoot := filepath.Join(`C:\Users`, "profile-that-must-not-be-probed")
	got, err := resolveProtectedProductControlDataRootProposalFromProfileMapping(profileRoot, registry.SZ, acceptance)
	if err != nil {
		t.Fatalf("derive proposal from OS profile mapping without filesystem access: %v", err)
	}
	for _, component := range []string{profileRoot, "dev-kernel-checkpoint", acceptance.TrialID, acceptance.RuntimeCandidateID, "Nimi"} {
		if !strings.Contains(strings.ToLower(got), strings.ToLower(component)) {
			t.Fatalf("proposal %q does not contain %q", got, component)
		}
	}
}

func TestProtectedProductControlProposalReadsCurrentWindowsProfileMapping(t *testing.T) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		t.Fatalf("resolve current Windows user SID: %v", err)
	}
	sid := user.User.Sid.String()
	if !strings.HasPrefix(sid, "S-1-5-21-") {
		t.Skipf("current token %s is not an interactive user account", sid)
	}
	got, err := resolveProtectedProductControlDataRootProposal(sid, validProductControlProposalAcceptance())
	if err != nil {
		t.Fatalf("derive proposal from the current HKLM ProfileList mapping: %v", err)
	}
	if !strings.Contains(strings.ToLower(got), `\appdata\local\nimi\dev-kernel-checkpoint\`) {
		t.Fatalf("current Windows profile proposal has an unexpected shape: %q", got)
	}
}

func validProductControlProposalAcceptance() *config.DevKernelCheckpointAcceptance {
	return &config.DevKernelCheckpointAcceptance{
		TrialID:            "dev-kernel-checkpoint",
		RuntimeCandidateID: "dev-kernel-runtime-0123456789abcdef0123456789abcdef",
		AcceptanceRoundID:  "dev-kernel-round-0123456789abcdef0123456789abcdef",
		PrimaryAccountID:   "account-primary",
		SecondaryAccountID: "account-secondary",
		LocalAgentRef:      "local-agent:runtime-0123456789abcdef0123456789abcdef",
		RuntimeSourceRef:   "runtime-source",
		AgentDisplayName:   "Zhiyu acceptance agent",
	}
}
