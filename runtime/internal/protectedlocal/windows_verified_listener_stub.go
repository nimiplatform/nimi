//go:build !windows

package protectedlocal

import (
	"context"
	"net"
)

func OpenWindowsVerifiedDesktopListener(context.Context, *WindowsRuntimeSecurityState, WindowsExecutableTrustVerifier) (net.Listener, error) {
	return nil, windowsUnsupported("open verified Windows Desktop listener")
}
