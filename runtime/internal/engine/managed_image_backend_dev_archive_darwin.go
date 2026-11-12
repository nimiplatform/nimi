//go:build darwin && arm64 && nimi_macos_source_local_development

package engine

import "os"

func managedImageBackendSourceDevelopmentArchive() string {
	return os.Getenv("NIMI_DEV_SDCPP_METAL_ARCHIVE")
}
