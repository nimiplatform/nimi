//go:build windows && nimi_runtime_e2e

package protectedlocal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsE2EPeerRejectionReportsOnlyStableStageAndReason(t *testing.T) {
	programData := t.TempDir()
	t.Setenv("ProgramData", programData)
	directoryName := "E2E-Diagnostics"
	if mustActiveWindowsRuntimeProfile().id == "windows-e2e-virtual-v1" {
		directoryName = "E2E-Virtual-Diagnostics"
	}
	directory := filepath.Join(programData, "Nimi", "Runtime", directoryName)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	reportWindowsE2EPeerRejection(windowsPipeOperationFailure(
		WindowsPipeStageActiveLogonDataAccess,
		"private operation",
		errors.New("private native detail"),
	))
	path := filepath.Join(directory, windowsE2EPeerRejectionFileName)
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private") {
		t.Fatalf("peer rejection leaked native detail: %s", encoded)
	}
	var rejection windowsE2EPeerRejection
	if err := json.Unmarshal(encoded, &rejection); err != nil {
		t.Fatal(err)
	}
	wantCode := WindowsPipeStartupExitCodeBase + uint32(WindowsPipeStageActiveLogonDataAccess)
	if rejection.Domain != "windows_pipe" || rejection.Code != wantCode || rejection.Reason != ReasonDesktopProcessVerificationUnavailable {
		t.Fatalf("peer rejection = %#v", rejection)
	}
}
