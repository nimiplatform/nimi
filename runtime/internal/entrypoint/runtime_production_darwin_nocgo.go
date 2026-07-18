//go:build darwin && !cgo

package entrypoint

import (
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func runProductionDaemon(string) error {
	return fmt.Errorf("%s: macOS production Runtime requires the native cgo security carrier", protectedlocal.ReasonProtectedLocalTransportUnsupported)
}
