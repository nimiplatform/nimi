//go:build windows && !nimi_runtime_e2e

package protectedlocal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

const windowsProductionPeerRejectionFileName = "last-peer-rejection.json"

type windowsProductionPeerRejection struct {
	Domain string `json:"domain"`
	Code   uint32 `json:"code"`
	Reason Reason `json:"reason"`
}

// reportWindowsE2EPeerRejection retains the historical private hook name but
// now emits one bounded production diagnostic as well. The record contains no
// executable path, account identifier, SID, token, endpoint, or request data;
// it exists solely to distinguish fail-closed Windows peer-verification stages.
func reportWindowsE2EPeerRejection(err error) {
	if err == nil {
		return
	}
	rejection := windowsProductionPeerRejection{
		Domain: "protected_local",
		Reason: ReasonDesktopProcessVerificationUnavailable,
	}
	if code, ok := WindowsPipeStartupExitCode(err); ok {
		rejection.Domain = "windows_pipe"
		rejection.Code = code
	} else if code, ok := WindowsProcessTrustStartupExitCode(err); ok {
		rejection.Domain = "windows_process_trust"
		rejection.Code = code
	}
	var failure *Failure
	if errors.As(err, &failure) {
		rejection.Reason = failure.Reason()
	}
	encoded, encodeErr := json.Marshal(rejection)
	if encodeErr != nil {
		return
	}
	programData := os.Getenv("ProgramData")
	if programData == "" {
		return
	}
	directory := filepath.Join(programData, "Nimi", "Runtime", "Diagnostics")
	if os.MkdirAll(directory, 0o750) != nil {
		return
	}
	temporary, temporaryErr := os.CreateTemp(directory, ".peer-rejection-*.json")
	if temporaryErr != nil {
		return
	}
	temporaryPath := temporary.Name()
	keep := false
	defer func() {
		_ = temporary.Close()
		if !keep {
			_ = os.Remove(temporaryPath)
		}
	}()
	if _, writeErr := temporary.Write(encoded); writeErr != nil || temporary.Sync() != nil || temporary.Close() != nil {
		return
	}
	destination := filepath.Join(directory, windowsProductionPeerRejectionFileName)
	_ = os.Remove(destination)
	if os.Rename(temporaryPath, destination) == nil {
		keep = true
	}
}
