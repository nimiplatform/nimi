//go:build darwin && cgo

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func runMacOSProtectedStateStatus(args []string) error {
	if len(args) != 0 {
		return fmt.Errorf("macOS protected state status accepts no arguments")
	}
	result, err := protectedlocal.VerifyMacOSProtectedState(context.Background())
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(result); err != nil {
		return fmt.Errorf("encode macOS protected state status result: %w", err)
	}
	return nil
}
