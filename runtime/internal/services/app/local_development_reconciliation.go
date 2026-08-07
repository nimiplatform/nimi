package app

import (
	"context"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

// Registration is already canonical in the kernel; startup never reconciles a
// second authorization or consent store into it.
func (s *Service) ReconcileLocalDevelopmentKernel(context.Context) error {
	if s == nil || s.localAppKernel == nil {
		return localappkernel.ErrNotFound
	}
	return nil
}
