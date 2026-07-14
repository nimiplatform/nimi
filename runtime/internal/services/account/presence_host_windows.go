//go:build windows

package account

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode/utf16"
	"unsafe"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"golang.org/x/sys/windows"
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
	output, exitCode, err := requestWindowsHelloPresence(ctx, windowsPresencePromptMessage(request))
	method := runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_OS_CREDENTIAL
	if err == nil && strings.EqualFold(strings.TrimSpace(output), "Verified") {
		return hostPresenceResult{Outcome: hostPresenceVerified, Method: method}, nil
	}
	switch exitCode {
	case windowsHelloExitRejected:
		return hostPresenceResult{Outcome: hostPresenceRejected, Method: method}, nil
	case windowsHelloExitUnavailable:
		return hostPresenceResult{Outcome: hostPresenceUnavailable}, nil
	}
	if ctx.Err() != nil {
		return hostPresenceResult{Outcome: hostPresenceRejected, Method: method}, nil
	}
	return hostPresenceResult{Outcome: hostPresenceUnavailable}, err
}

func requestWindowsHelloPresence(ctx context.Context, prompt string) (string, uint32, error) {
	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == ^uint32(0) {
		return "", windowsHelloExitUnavailable, fmt.Errorf("no active interactive Windows session")
	}

	var userToken windows.Token
	if err := windows.WTSQueryUserToken(sessionID, &userToken); err != nil {
		return "", windowsHelloExitUnavailable, fmt.Errorf("query active Windows session token: %w", err)
	}
	defer userToken.Close()

	var environment *uint16
	if err := windows.CreateEnvironmentBlock(&environment, userToken, false); err != nil {
		return "", windowsHelloExitUnavailable, fmt.Errorf("create active-session environment: %w", err)
	}
	defer windows.DestroyEnvironmentBlock(environment)

	pipeSecurity := windows.SecurityAttributes{
		Length:        uint32(unsafe.Sizeof(windows.SecurityAttributes{})),
		InheritHandle: 1,
	}
	var readHandle windows.Handle
	var writeHandle windows.Handle
	if err := windows.CreatePipe(&readHandle, &writeHandle, &pipeSecurity, 0); err != nil {
		return "", windowsHelloExitUnavailable, fmt.Errorf("create presence result pipe: %w", err)
	}
	readFile := os.NewFile(uintptr(readHandle), "nimi-presence-result")
	if readFile == nil {
		_ = windows.CloseHandle(readHandle)
		_ = windows.CloseHandle(writeHandle)
		return "", windowsHelloExitUnavailable, fmt.Errorf("open presence result pipe")
	}
	defer readFile.Close()
	defer func() {
		if writeHandle != 0 {
			_ = windows.CloseHandle(writeHandle)
		}
	}()
	if err := windows.SetHandleInformation(readHandle, windows.HANDLE_FLAG_INHERIT, 0); err != nil {
		return "", windowsHelloExitUnavailable, fmt.Errorf("protect presence result pipe: %w", err)
	}

	systemDirectory, err := windows.GetSystemDirectory()
	if err != nil {
		return "", windowsHelloExitUnavailable, fmt.Errorf("resolve Windows system directory: %w", err)
	}
	powershellPath := systemDirectory + `\WindowsPowerShell\v1.0\powershell.exe`
	applicationName, err := windows.UTF16PtrFromString(powershellPath)
	if err != nil {
		return "", windowsHelloExitUnavailable, err
	}
	commandLine, err := windows.UTF16PtrFromString(windows.ComposeCommandLine([]string{
		powershellPath,
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-STA",
		"-EncodedCommand",
		encodePowerShellCommand(windowsHelloPresenceScript(prompt)),
	}))
	if err != nil {
		return "", windowsHelloExitUnavailable, err
	}
	desktop, err := windows.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return "", windowsHelloExitUnavailable, err
	}
	startup := windows.StartupInfo{
		Cb:         uint32(unsafe.Sizeof(windows.StartupInfo{})),
		Desktop:    desktop,
		Flags:      windows.STARTF_USESTDHANDLES | windows.STARTF_USESHOWWINDOW,
		ShowWindow: windows.SW_HIDE,
		StdInput:   windows.InvalidHandle,
		StdOutput:  writeHandle,
		StdErr:     writeHandle,
	}
	var process windows.ProcessInformation
	if err := windows.CreateProcessAsUser(
		userToken,
		applicationName,
		commandLine,
		nil,
		nil,
		true,
		windows.CREATE_UNICODE_ENVIRONMENT,
		environment,
		nil,
		&startup,
		&process,
	); err != nil {
		return "", windowsHelloExitUnavailable, fmt.Errorf("start presence verifier in active Windows session: %w", err)
	}
	_ = windows.CloseHandle(process.Thread)
	defer windows.CloseHandle(process.Process)
	_ = windows.CloseHandle(writeHandle)
	writeHandle = 0

	outputResult := make(chan struct {
		bytes []byte
		err   error
	}, 1)
	go func() {
		bytes, readErr := io.ReadAll(io.LimitReader(readFile, 64*1024))
		outputResult <- struct {
			bytes []byte
			err   error
		}{bytes: bytes, err: readErr}
	}()
	waitResult := make(chan error, 1)
	go func() {
		_, waitErr := windows.WaitForSingleObject(process.Process, windows.INFINITE)
		waitResult <- waitErr
	}()

	select {
	case waitErr := <-waitResult:
		if waitErr != nil {
			return "", windowsHelloExitUnavailable, fmt.Errorf("wait for presence verifier: %w", waitErr)
		}
	case <-ctx.Done():
		_ = windows.TerminateProcess(process.Process, windowsHelloExitRejected)
		<-waitResult
		return "", windowsHelloExitRejected, ctx.Err()
	}

	output := <-outputResult
	if output.err != nil {
		return "", windowsHelloExitUnavailable, fmt.Errorf("read presence verifier result: %w", output.err)
	}
	var exitCode uint32
	if err := windows.GetExitCodeProcess(process.Process, &exitCode); err != nil {
		return "", windowsHelloExitUnavailable, fmt.Errorf("read presence verifier exit code: %w", err)
	}
	return strings.TrimSpace(string(output.bytes)), exitCode, nil
}

func startWindowsProcessInActiveSession(applicationPath string, args []string) error {
	sessionID := windows.WTSGetActiveConsoleSessionId()
	if sessionID == ^uint32(0) {
		return fmt.Errorf("no active interactive Windows session")
	}

	var userToken windows.Token
	if err := windows.WTSQueryUserToken(sessionID, &userToken); err != nil {
		return fmt.Errorf("query active Windows session token: %w", err)
	}
	defer userToken.Close()

	var environment *uint16
	if err := windows.CreateEnvironmentBlock(&environment, userToken, false); err != nil {
		return fmt.Errorf("create active-session environment: %w", err)
	}
	defer windows.DestroyEnvironmentBlock(environment)

	applicationName, err := windows.UTF16PtrFromString(applicationPath)
	if err != nil {
		return fmt.Errorf("encode active-session application: %w", err)
	}
	commandArgs := append([]string{applicationPath}, args...)
	commandLine, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(commandArgs))
	if err != nil {
		return fmt.Errorf("encode active-session command: %w", err)
	}
	desktop, err := windows.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return fmt.Errorf("encode active-session desktop: %w", err)
	}
	startup := windows.StartupInfo{
		Cb:      uint32(unsafe.Sizeof(windows.StartupInfo{})),
		Desktop: desktop,
	}
	var process windows.ProcessInformation
	if err := windows.CreateProcessAsUser(
		userToken,
		applicationName,
		commandLine,
		nil,
		nil,
		false,
		windows.CREATE_UNICODE_ENVIRONMENT,
		environment,
		nil,
		&startup,
		&process,
	); err != nil {
		return fmt.Errorf("start process in active Windows session: %w", err)
	}
	_ = windows.CloseHandle(process.Thread)
	_ = windows.CloseHandle(process.Process)
	return nil
}

func windowsHelloPresenceScript(prompt string) string {
	promptBase64 := base64.StdEncoding.EncodeToString([]byte(prompt))
	return fmt.Sprintf(`
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

$prompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%s'))
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
`, promptBase64)
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
