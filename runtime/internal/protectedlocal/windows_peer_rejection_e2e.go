//go:build windows && nimi_runtime_e2e

package protectedlocal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

const windowsE2EPeerRejectionFileName = "last-peer-rejection.json"

type windowsE2EPeerRejection struct {
	Domain string `json:"domain"`
	Code   uint32 `json:"code"`
	Reason Reason `json:"reason"`
}

func reportWindowsE2EPeerRejection(err error) {
	if err == nil {
		return
	}
	rejection := windowsE2EPeerRejection{Domain: "protected_local", Reason: ReasonDesktopProcessVerificationUnavailable}
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
	profile := mustActiveWindowsRuntimeProfile()
	directoryName := "E2E-Diagnostics"
	if profile.id == "windows-e2e-virtual-v1" {
		directoryName = "E2E-Virtual-Diagnostics"
	}
	directory := filepath.Join(programData, "Nimi", "Runtime", directoryName)
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
	destination := filepath.Join(directory, windowsE2EPeerRejectionFileName)
	_ = os.Remove(destination)
	if os.Rename(temporaryPath, destination) == nil {
		keep = true
	}
}
