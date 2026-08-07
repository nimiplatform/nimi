//go:build windows && nimi_windows_source_local_development

package daemon

// Source D2 consumes no installed or machine-wide Platform resource projection.
func protectedPlatformAppResourceBindings() (string, string, error) {
	return "", "", nil
}
