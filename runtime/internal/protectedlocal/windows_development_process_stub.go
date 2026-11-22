//go:build !windows

package protectedlocal

func NewWindowsLocalDevelopmentProcessVerifier(WindowsDesktopIdentity) (LocalDevelopmentProcessVerifier, error) {
	return nil, windowsUnsupported("create Windows local-development process verifier")
}

func NewWindowsLocalDevelopmentProcessVerifierWithCarrierResolver(WindowsDesktopIdentity, ManagedWebCarrierResolver) (LocalDevelopmentProcessVerifier, error) {
	return nil, windowsUnsupported("create Windows local-development process verifier")
}
