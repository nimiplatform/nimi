//go:build !windows

package protectedlocal

import "context"

func VerifyWindowsProductionRuntimeProcess(context.Context, WindowsServicePrincipal, WindowsExecutableTrustVerifier) (WindowsRuntimeProcess, error) {
	return WindowsRuntimeProcess{}, windowsUnsupported("verify Windows Runtime process")
}

func VerifyWindowsProductionPipeServer(context.Context, uintptr, WindowsExecutableTrustVerifier) (WindowsRuntimeProcess, error) {
	return WindowsRuntimeProcess{}, windowsUnsupported("verify Windows pipe server process")
}

func (*WindowsDesktopPipeConnection) VerifyClientProcess(context.Context, WindowsExecutableTrustVerifier) (ProcessTuple, DesktopProcessLiveness, error) {
	return ProcessTuple{}, nil, windowsUnsupported("verify Windows desktop process")
}

func NewWindowsInstalledProcessVerifier(WindowsDesktopIdentity, WindowsExecutableTrustVerifier) (InstalledProcessVerifier, error) {
	return nil, windowsUnsupported("create Windows installed process verifier")
}
