//go:build !darwin || !cgo || nimi_macos_source_local_development

package main

import "fmt"

func runMacOSProtectedStateStatus(args []string) error {
	if len(args) != 0 {
		return fmt.Errorf("macOS protected state status accepts no arguments")
	}
	return fmt.Errorf("macOS protected state status requires the native Darwin cgo release binary")
}
