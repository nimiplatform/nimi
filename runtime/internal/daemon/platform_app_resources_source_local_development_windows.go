//go:build windows && nimi_windows_source_local_development

package daemon

func protectedPlatformAppResourceBindings() (string, error) {
	return sourceLocalDevelopmentPlatformAppResources()
}
