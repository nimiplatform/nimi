//go:build !windows

package protectedlocal

import "context"

func OpenWindowsRuntimeSecurityState(context.Context, WindowsServicePrincipal, WindowsRuntimeProcess, WindowsProtectedStateRoot) (*WindowsRuntimeSecurityState, error) {
	return nil, windowsUnsupported("open Windows Runtime security state")
}
