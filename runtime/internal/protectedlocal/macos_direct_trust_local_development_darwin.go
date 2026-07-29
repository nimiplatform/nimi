//go:build darwin && cgo && nimi_macos_local_development

package protectedlocal

const (
	macOSDirectTrustRequiresAdHoc         = true
	macOSDirectTrustRequiresTrustedAnchor = false
	macOSDirectTrustRequiresNotarization  = false
)
