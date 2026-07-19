//go:build !darwin || !nimi_macos_local_development

package protectedlocal

func activeMacOSLocalDevelopmentTrustSetID() string {
	return MacOSLocalDevelopmentTrustSetID
}
