//go:build darwin && cgo && !nimi_macos_local_development

package protectedlocal

const (
	macOSDirectTrustRequiresAdHoc         = false
	macOSDirectTrustRequiresTrustedAnchor = true
	macOSDirectTrustRequiresNotarization  = true
)
