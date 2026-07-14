//go:build !windows

package grpcserver

import (
	"fmt"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func resolveProtectedProductControlDataRootProposal(string, *config.DevKernelCheckpointAcceptance) (string, error) {
	return "", fmt.Errorf("protected dev-kernel Product Control proposal requires Windows")
}
