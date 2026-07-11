//go:build !windows

package protectedlocal

func NewWindowsNativeExecutableTrustVerifier() (WindowsExecutableTrustVerifier, error) {
	return nil, windowsUnsupported("construct Windows executable trust verifier")
}
