//go:build !windows

package protectedlocal

import (
	"context"
	"net"
)

func OpenWindowsVerifiedInstalledListener(context.Context, *WindowsRuntimeSecurityState, WindowsExecutableTrustVerifier) (net.Listener, error) {
	return nil, windowsUnsupported("open Windows verified installed listener")
}
