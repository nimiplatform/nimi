package protectedlocal

const (
	// WindowsLocalDevelopmentTrustSetID binds a mutable project to the exact
	// Desktop-supervised Windows host admitted by the Windows verifier.
	WindowsLocalDevelopmentTrustSetID = "windows-local-development-supervised-v1"
)

// LocalDevelopmentTrustSetID returns the one production trust set admitted
// for a platform. Unsupported platforms have no implicit fallback.
func LocalDevelopmentTrustSetID(os OperatingSystem) (string, bool) {
	switch os {
	case OSWindows:
		return WindowsLocalDevelopmentTrustSetID, true
	default:
		return "", false
	}
}

// IsLocalDevelopmentProcessTrustSet rejects cross-platform trust-set reuse.
func IsLocalDevelopmentProcessTrustSet(process ProcessTuple) bool {
	expected, admitted := LocalDevelopmentTrustSetID(process.OS)
	return admitted && process.ExecutableTrustSetID == expected
}
