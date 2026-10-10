//go:build windows

package main

import (
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
	"golang.org/x/sys/windows"
)

// The actual Windows writer uses the same argument tool as SCM CreateService.
// The shared closed grammar additionally rejects malformed/noncanonical input.
func runtimeServiceCommand(executable string) (string, error) {
	canonical, err := productrelease.RuntimeServiceCommand(executable)
	if err != nil {
		return "", err
	}
	encoded := windows.EscapeArg(executable) + " " + windows.EscapeArg("serve")
	if encoded != canonical {
		return "", fmt.Errorf("noncanonical service command")
	}
	return encoded, nil
}
func runtimeServiceExecutable(command string) (string, error) {
	args, err := windows.DecomposeCommandLine(command)
	if err != nil || len(args) != 2 || args[1] != "serve" {
		return "", fmt.Errorf("unadmitted service arguments")
	}
	executable, err := productrelease.ParseRuntimeServiceCommand(command)
	if err != nil || executable != args[0] {
		return "", fmt.Errorf("unadmitted service command")
	}
	return executable, nil
}
