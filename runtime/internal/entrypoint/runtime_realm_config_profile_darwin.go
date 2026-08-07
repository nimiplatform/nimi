//go:build darwin && cgo && !nimi_macos_source_local_development

package entrypoint

func loadMacOSProtectedRealmBaseURL() (string, error) {
	return macOSProtectedRealmBaseURL, nil
}
