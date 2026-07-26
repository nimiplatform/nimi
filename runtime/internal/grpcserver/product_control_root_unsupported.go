//go:build !windows && (!darwin || !cgo)

package grpcserver

import (
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func ResolveProtectedProductControlRoot(localappkernel.VerifiedLocalOSUserIdentity) (string, error) {
	return "", fmt.Errorf("protected Product Control root resolution is unsupported on this platform")
}
