//go:build !darwin || !cgo

package main

import "fmt"

func runMacOSProtectedStateReset([]string) error {
	return fmt.Errorf("macOS protected state reset is unavailable on this platform")
}
