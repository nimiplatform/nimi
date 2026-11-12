//go:build !(darwin && arm64 && nimi_macos_source_local_development)

package engine

func managedImageBackendSourceDevelopmentArchive() string {
	return ""
}
