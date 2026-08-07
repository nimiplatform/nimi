//go:build darwin && cgo && !nimi_macos_source_local_development

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func runMacOSProtectedStateProvision(args []string) error {
	if len(args) != 0 {
		return fmt.Errorf("macOS protected state provisioning accepts no arguments")
	}
	result, err := protectedlocal.ProvisionMacOSProtectedState(context.Background())
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(result); err != nil {
		return fmt.Errorf("encode macOS protected state provisioning result: %w", err)
	}
	return nil
}
