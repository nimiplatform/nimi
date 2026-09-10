//go:build darwin && cgo && !nimi_macos_local_development && !nimi_macos_source_local_development

package entrypoint

// @nimi-authority: rule.nimi.runtime.service-operations.r067
// The release linker fixes this value before code signing. It has no runtime
// setter and is never loaded from process environment or mutable configuration.
var macOSProtectedRealmBaseURL = "https://realm.nimi.ai"
