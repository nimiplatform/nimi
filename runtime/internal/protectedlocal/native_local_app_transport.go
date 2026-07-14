package protectedlocal

import "net"

type nativeLocalAppConnectionCarrier interface {
	nativeLocalAppConnection() *LocalAppConnection
}

func NativeLocalAppConnectionFromNetConn(raw net.Conn) (*LocalAppConnection, bool) {
	carrier, ok := raw.(nativeLocalAppConnectionCarrier)
	if !ok || carrier == nil {
		return nil, false
	}
	connection := carrier.nativeLocalAppConnection()
	return connection, connection != nil && connection.Live()
}
