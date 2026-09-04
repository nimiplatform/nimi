package protectedlocal

// WindowsProductionSignerSPKISHA256 is injected by the production build from
// the installer signing policy. It is a public-key identity, never a
// credential or caller-controlled configuration value. An empty or malformed
// value keeps native admission closed.
var WindowsProductionSignerSPKISHA256 string

func activeWindowsSignerSPKISHA256() string {
	return WindowsProductionSignerSPKISHA256
}
