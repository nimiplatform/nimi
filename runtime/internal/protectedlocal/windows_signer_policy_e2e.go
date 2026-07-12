//go:build nimi_runtime_e2e

package protectedlocal

// WindowsRuntimeSignerCertSHA256 is injected only into the separately tagged
// non-product E2E binary. The production binary does not contain this selector.
var WindowsRuntimeSignerCertSHA256 string

func activeWindowsSignerCertSHA256() string {
	return WindowsRuntimeSignerCertSHA256
}
