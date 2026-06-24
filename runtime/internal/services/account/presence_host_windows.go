//go:build windows

package account

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"unicode/utf16"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	windowsHelloExitVerified    = 0
	windowsHelloExitRejected    = 10
	windowsHelloExitUnavailable = 20
)

type windowsHostPresenceProvider struct{}

func newPlatformHostPresenceProvider() hostPresenceProvider {
	return windowsHostPresenceProvider{}
}

func (windowsHostPresenceProvider) RequestHostPresence(ctx context.Context, request hostPresenceRequest) (hostPresenceResult, error) {
	output, err := requestWindowsHelloPresence(ctx, windowsPresencePromptMessage(request))
	method := runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL
	if err == nil && strings.EqualFold(strings.TrimSpace(output), "Verified") {
		return hostPresenceResult{Outcome: hostPresenceVerified, Method: method}, nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		switch exitErr.ExitCode() {
		case windowsHelloExitRejected:
			return hostPresenceResult{Outcome: hostPresenceRejected, Method: method}, nil
		case windowsHelloExitUnavailable:
			return hostPresenceResult{Outcome: hostPresenceUnavailable}, nil
		}
	}
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return hostPresenceResult{Outcome: hostPresenceRejected, Method: method}, nil
	}
	return hostPresenceResult{Outcome: hostPresenceUnavailable}, err
}

func requestWindowsHelloPresence(ctx context.Context, prompt string) (string, error) {
	script := windowsHelloPresenceScript()
	cmd := exec.CommandContext(ctx,
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-STA",
		"-EncodedCommand",
		encodePowerShellCommand(script),
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Env = append(cmd.Environ(), "NIMI_PRESENCE_PROMPT="+prompt)
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

func windowsHelloPresenceScript() string {
	return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$verifierType = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$availabilityType = [Windows.Security.Credentials.UI.UserConsentVerifierAvailability,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$resultType = [Windows.Security.Credentials.UI.UserConsentVerificationResult,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]

function Await-WinRtAsyncOperation($operation, [Type] $type) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
    } |
    Select-Object -First 1
  if ($null -eq $asTask) {
    [Console]::Out.Write('Unavailable:AsTaskMissing')
    exit 20
  }
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  return $task.GetAwaiter().GetResult()
}

$availability = Await-WinRtAsyncOperation ($verifierType::CheckAvailabilityAsync()) $availabilityType
if ($availability.ToString() -ne 'Available') {
  [Console]::Out.Write('Unavailable:' + $availability.ToString())
  exit 20
}

$prompt = [Environment]::GetEnvironmentVariable('NIMI_PRESENCE_PROMPT')
if ([string]::IsNullOrWhiteSpace($prompt)) {
  $prompt = 'Confirm this is you before showing protected Nimi information.'
}

$result = Await-WinRtAsyncOperation ($verifierType::RequestVerificationAsync($prompt)) $resultType
[Console]::Out.Write($result.ToString())
switch ($result.ToString()) {
  'Verified' { exit 0 }
  'Canceled' { exit 10 }
  'RetriesExhausted' { exit 10 }
  default { exit 20 }
}
`
}

func encodePowerShellCommand(script string) string {
	encoded := utf16.Encode([]rune(script))
	bytes := make([]byte, 0, len(encoded)*2)
	for _, value := range encoded {
		bytes = append(bytes, byte(value), byte(value>>8))
	}
	return base64.StdEncoding.EncodeToString(bytes)
}

func windowsPresencePromptMessage(request hostPresenceRequest) string {
	displayName := strings.TrimSpace(request.DisplayName)
	if displayName == "" {
		displayName = strings.TrimSpace(request.AccountID)
	}
	if displayName == "" {
		return "Confirm this is you before showing protected Nimi information."
	}
	return fmt.Sprintf("Confirm this is %s before showing protected Nimi information.", displayName)
}
