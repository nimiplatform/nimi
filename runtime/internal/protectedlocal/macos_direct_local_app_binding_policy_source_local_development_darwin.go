//go:build darwin && cgo && nimi_macos_source_local_development

package protectedlocal

func macOSDirectLocalAppBindingCodePolicy() (macOSCodePolicy, error) {
	return macOSCodePolicy{}, nil
}
