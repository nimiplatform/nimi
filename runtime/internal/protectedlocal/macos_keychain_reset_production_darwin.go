//go:build darwin && cgo && !nimi_macos_local_development

package protectedlocal

import "context"

func resetMacOSDevelopmentKeychainNamespace(context.Context) error {
	return nil
}
