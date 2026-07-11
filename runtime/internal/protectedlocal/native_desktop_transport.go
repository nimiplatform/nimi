package protectedlocal

import "net"

// nativeDesktopConnectionCarrier is deliberately package-private so ordinary
// listeners cannot manufacture a protected gRPC transport capability.
type nativeDesktopConnectionCarrier interface {
	nativeDesktopConnection() *Connection
}

// NativeDesktopConnectionFromNetConn returns the protected-local authority
// bound by an OS-verified native listener. It rejects ordinary net.Conn values
// and any carrier without a live authority object.
func NativeDesktopConnectionFromNetConn(raw net.Conn) (*Connection, bool) {
	carrier, ok := raw.(nativeDesktopConnectionCarrier)
	if !ok || carrier == nil {
		return nil, false
	}
	connection := carrier.nativeDesktopConnection()
	return connection, connection != nil
}
