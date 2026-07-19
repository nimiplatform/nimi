//go:build darwin && cgo

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func runMacOSProtectedStateReset(args []string) error {
	if len(args) != 0 {
		return fmt.Errorf("macOS protected state reset accepts no arguments")
	}
	result, err := protectedlocal.ResetMacOSProtectedState(context.Background())
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(result); err != nil {
		return fmt.Errorf("encode macOS protected state reset result: %w", err)
	}
	return nil
}
