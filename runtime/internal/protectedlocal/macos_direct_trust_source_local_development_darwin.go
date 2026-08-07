//go:build darwin && cgo && nimi_macos_source_local_development

package protectedlocal

const (
	macOSDirectTrustRequiresAdHoc         = false
	macOSDirectTrustRequiresTrustedAnchor = false
	macOSDirectTrustRequiresNotarization  = false
)
