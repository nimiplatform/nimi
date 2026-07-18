//go:build !darwin || !cgo

package main

import "fmt"

func runMacOSProtectedStateProvision(args []string) error {
	if len(args) != 0 {
		return fmt.Errorf("macOS protected state provisioning accepts no arguments")
	}
	return fmt.Errorf("macOS protected state provisioning requires the native Darwin cgo release binary")
}
