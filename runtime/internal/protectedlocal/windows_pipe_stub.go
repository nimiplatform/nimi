//go:build !windows

package protectedlocal

import (
	"context"
	"net"
)

type WindowsDesktopPipeInstance struct{}
type WindowsDesktopPipeConnection struct{}

func ResolveWindowsActiveDesktopIdentity(context.Context, WindowsServicePrincipal) (WindowsDesktopIdentity, error) {
	return WindowsDesktopIdentity{}, windowsUnsupported("resolve active Windows desktop identity")
}

func OpenWindowsProductionDesktopPipe(context.Context, WindowsServicePrincipal, WindowsRuntimeProcess) (*WindowsDesktopPipeInstance, WindowsDesktopIdentity, error) {
	return nil, WindowsDesktopIdentity{}, windowsUnsupported("open Windows production desktop pipe")
}

func (*WindowsDesktopPipeInstance) Accept(context.Context) (*WindowsDesktopPipeConnection, error) {
	return nil, windowsUnsupported("accept Windows production desktop pipe")
}

func (*WindowsDesktopPipeInstance) Close() error { return nil }

func (*WindowsDesktopPipeConnection) ClientProcessID() uint32 { return 0 }

func (*WindowsDesktopPipeConnection) NetConn() (net.Conn, error) {
	return nil, windowsUnsupported("open Windows desktop pipe stream")
}

func (*WindowsDesktopPipeConnection) Close() error { return nil }
