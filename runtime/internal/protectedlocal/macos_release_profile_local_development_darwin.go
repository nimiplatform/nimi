//go:build darwin && cgo && nimi_macos_local_development

package protectedlocal

const (
	macOSReleaseEnvironment        = "local_development"
	macOSReleaseIdentityClass      = "local_ca"
	macOSReleaseSignatureAlgorithm = "ecdsa_p256_sha256"
	macOSReleaseSignerPolicy       = "nimi-macos-local-development-signing-policy"
)

// These values are injected by the development candidate builder from the
// public half of the provisioned System Keychain record-signing identity.
// No production release root is linked into this build profile.
var (
	MacOSLocalDevelopmentReleaseRootKeyID        string
	MacOSLocalDevelopmentReleaseRootPublicKeyB64 string
)

func macOSReleaseRootInputs() (string, string) {
	return MacOSLocalDevelopmentReleaseRootKeyID, MacOSLocalDevelopmentReleaseRootPublicKeyB64
}
