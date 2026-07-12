//go:build windows && !nimi_runtime_e2e

package entrypoint

import (
	"context"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func loadWindowsProtectedRuntimeConfig(string) (config.Config, error) {
	return config.Load()
}

func prepareWindowsRuntimeFixture(context.Context, *protectedlocal.WindowsRuntimeSecurityState) error {
	return nil
}
