//go:build darwin && cgo && !nimi_macos_source_local_development

package entrypoint

func loadMacOSProtectedRealmEndpoints() (string, string, error) {
	return macOSProtectedRealmBaseURL, protectedRealmRealtimeURL(macOSProtectedRealmBaseURL), nil
}
