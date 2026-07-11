package protectedlocal

import "net"

type nativeInstalledConnectionCarrier interface {
	nativeInstalledConnection() *InstalledLaunchConnection
}

func NativeInstalledConnectionFromNetConn(raw net.Conn) (*InstalledLaunchConnection, bool) {
	carrier, ok := raw.(nativeInstalledConnectionCarrier)
	if !ok || carrier == nil {
		return nil, false
	}
	connection := carrier.nativeInstalledConnection()
	return connection, connection != nil && connection.Live()
}
