package protectedlocal

const (
	// WindowsLocalDevelopmentTrustSetID binds a mutable project to the exact
	// Desktop-supervised Windows host admitted by the Windows verifier.
	WindowsLocalDevelopmentTrustSetID = "windows-local-development-supervised-v1"
	// MacOSLocalDevelopmentTrustSetID is reserved for the signed, notarized
	// Nimi Local App Host embedded in the production Desktop bundle. Generic
	// Electron, copied bundles, and project-built Tauri binaries do not belong
	// to this trust set.
	MacOSLocalDevelopmentTrustSetID = "nimi-local-development-host-macos-production-v1"
)

// LocalDevelopmentTrustSetID returns the one production trust set admitted
// for a platform. Unsupported platforms have no implicit fallback.
func LocalDevelopmentTrustSetID(os OperatingSystem) (string, bool) {
	switch os {
	case OSWindows:
		return WindowsLocalDevelopmentTrustSetID, true
	case OSMacOS:
		return MacOSLocalDevelopmentTrustSetID, true
	default:
		return "", false
	}
}

// IsLocalDevelopmentProcessTrustSet rejects cross-platform trust-set reuse.
func IsLocalDevelopmentProcessTrustSet(process ProcessTuple) bool {
	expected, admitted := LocalDevelopmentTrustSetID(process.OS)
	return admitted && process.ExecutableTrustSetID == expected
}
