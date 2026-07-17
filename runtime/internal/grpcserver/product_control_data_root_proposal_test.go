package grpcserver

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestCheckpointProductControlDataRootProposalPreservesWindowsManagedPythonPathBudget(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows MAX_PATH budget")
	}
	profileRoot := filepath.Join(`C:\Users`, strings.Repeat("u", 32))
	acceptance := &config.DevKernelCheckpointAcceptance{
		TrialID:            "dev-kernel-checkpoint",
		RuntimeCandidateID: "dev-kernel-runtime-0123456789abcdef0123456789abcdef",
		AcceptanceRoundID:  "dev-kernel-round-0123456789abcdef0123456789abcdef",
		PrimaryAccountID:   "account-primary",
		SecondaryAccountID: "account-secondary",
		LocalAgentRef:      "local-agent:runtime-0123456789abcdef0123456789abcdef",
		RuntimeSourceRef:   "runtime-source",
		AgentDisplayName:   "Zhiyu acceptance agent",
	}
	proposal, err := checkpointProductControlDataRootProposal(profileRoot, acceptance)
	if err != nil {
		t.Fatal(err)
	}
	criticalStdlibPath := filepath.Join(
		proposal,
		"environments", "speech", "_python-installations",
		"cpython-3.12.13-windows-x86_64-none",
		"Lib", "importlib", "resources", "__init__.py",
	)
	if len(criticalStdlibPath) > 259 {
		t.Fatalf("checkpoint proposal exhausts Windows managed-Python path budget: length=%d path=%s", len(criticalStdlibPath), criticalStdlibPath)
	}
}

func TestCheckpointProductControlDataRootProposalIsCandidateBound(t *testing.T) {
	profileRoot := filepath.Join(t.TempDir(), "verified-user")
	acceptance := &config.DevKernelCheckpointAcceptance{
		TrialID:            "dev-kernel-checkpoint",
		RuntimeCandidateID: "dev-kernel-runtime-0123456789abcdef0123456789abcdef",
		AcceptanceRoundID:  "dev-kernel-round-0123456789abcdef0123456789abcdef",
		PrimaryAccountID:   "account-primary",
		SecondaryAccountID: "account-secondary",
		LocalAgentRef:      "local-agent:runtime-0123456789abcdef0123456789abcdef",
		RuntimeSourceRef:   "runtime-source",
		AgentDisplayName:   "Zhiyu acceptance agent",
	}
	proposal, err := checkpointProductControlDataRootProposal(profileRoot, acceptance)
	if err != nil {
		t.Fatalf("checkpoint proposal: %v", err)
	}
	want := filepath.Join(profileRoot, "AppData", "Local", "Nimi", acceptance.TrialID, acceptance.RuntimeCandidateID, "Nimi")
	if proposal != want {
		t.Fatalf("proposal = %q, want %q", proposal, want)
	}

	acceptance.RuntimeCandidateID = "dev-kernel-runtime-invalid"
	if _, err := checkpointProductControlDataRootProposal(profileRoot, acceptance); err == nil {
		t.Fatal("invalid candidate identity was accepted")
	}
}

func TestCheckpointProductControlDataRootProposalPrefersSignedDevelopmentBinding(t *testing.T) {
	acceptance := &config.DevKernelCheckpointAcceptance{
		TrialID:                "dev-kernel-checkpoint",
		RuntimeCandidateID:     "dev-kernel-runtime-0123456789abcdef0123456789abcdef",
		AcceptanceRoundID:      "dev-kernel-round-0123456789abcdef0123456789abcdef",
		DevelopmentDataRootRef: filepath.Join(t.TempDir(), "existing-development-data"),
		PrimaryAccountID:       "account-primary",
		SecondaryAccountID:     "account-secondary",
		LocalAgentRef:          "local-agent:runtime-0123456789abcdef0123456789abcdef",
		RuntimeSourceRef:       "runtime-source",
		AgentDisplayName:       "Zhiyu acceptance agent",
	}
	proposal, err := checkpointProductControlDataRootProposal("not-an-authority", acceptance)
	if err != nil {
		t.Fatalf("signed development proposal: %v", err)
	}
	if proposal != acceptance.DevelopmentDataRootRef {
		t.Fatalf("proposal = %q, want signed binding %q", proposal, acceptance.DevelopmentDataRootRef)
	}
}
