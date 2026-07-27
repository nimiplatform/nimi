package protectedlocal

// WindowsProductionSignerCertSHA256 is injected by the production build from
// the installer signing policy. It is a public certificate identity, never a
// credential or caller-controlled configuration value. An empty or malformed
// value keeps native admission closed.
var WindowsProductionSignerCertSHA256 string

func activeWindowsSignerCertSHA256() string {
	return WindowsProductionSignerCertSHA256
}
