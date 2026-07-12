//go:build windows && nimi_runtime_e2e && !nimi_runtime_e2e_virtual

package entrypoint

const (
	windowsE2EGRPCAddress = "127.0.0.1:46381"
	windowsE2EHTTPAddress = "127.0.0.1:46382"
	windowsE2ERuntimeID   = "nimi-runtime-windows-e2e-v1"
)
