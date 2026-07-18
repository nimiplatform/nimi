//go:build !windows

package grpcserver

import (
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func resolveProtectedProductControlDataRootProposal(localappkernel.VerifiedLocalOSUserIdentity, *config.DevKernelCheckpointAcceptance) (string, error) {
	return "", fmt.Errorf("protected dev-kernel Product Control proposal requires Windows")
}
