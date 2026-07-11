//go:build !windows

package entrypoint

import (
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func runProductionDaemon(string) error {
	return fmt.Errorf(
		"%s: this platform has no admitted production Runtime service bootstrap",
		protectedlocal.ReasonProtectedLocalRuntimePrincipalRequired,
	)
}
