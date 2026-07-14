//go:build !windows

package protectedlocal

import (
	"context"
	"net"
)

func OpenWindowsVerifiedLocalAppListener(context.Context, *WindowsRuntimeSecurityState) (net.Listener, error) {
	return nil, windowsUnsupported("open Windows verified local-app listener")
}
