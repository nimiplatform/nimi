//go:build !darwin || !cgo || nimi_macos_source_local_development

package main

import "fmt"

func runMacOSProtectedStateReset([]string) error {
	return fmt.Errorf("macOS protected state reset is unavailable on this platform")
}
