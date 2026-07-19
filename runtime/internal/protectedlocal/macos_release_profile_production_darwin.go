//go:build darwin && cgo && !nimi_macos_local_development

package protectedlocal

const (
	macOSReleaseEnvironment        = "production"
	macOSReleaseIdentityClass      = "developer_id_application"
	macOSReleaseSignatureAlgorithm = "ed25519"
	macOSReleaseSignerPolicy       = "nimi-production-release-signing-policy"
)

// Stable production release-root inputs are injected only by the guarded
// production build. The production verifier never embeds the local
// development root.
var (
	MacOSPlatformReleaseRootKeyID        string
	MacOSPlatformReleaseRootPublicKeyB64 string
)

func macOSReleaseRootInputs() (string, string) {
	return MacOSPlatformReleaseRootKeyID, MacOSPlatformReleaseRootPublicKeyB64
}
