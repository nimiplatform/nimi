package grpcserver

import (
	"context"
	"log/slog"
	"runtime"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappinstall"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
func composeVerifiedAppPackages(
	ctx context.Context,
	logger *slog.Logger,
	kernel *localappkernel.Kernel,
) (*publicappregistry.Client, *nimiappinstall.Coordinator) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" || kernel == nil {
		return nil, nil
	}
	if err := nimiappinstall.Recover(ctx, kernel); err != nil {
		logger.Error("public App package recovery failed; Catalog and install unavailable",
			"reason_code", runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE.String(), "error", err)
		return nil, nil
	}
	catalog := publicappregistry.NewCanonicalClient()
	coordinator, err := nimiappinstall.NewCoordinator(catalog, kernel)
	if err != nil {
		logger.Error("public App package coordinator unavailable",
			"reason_code", runtimev1.ReasonCode_APP_PACKAGE_INSTALL_UNAVAILABLE.String(), "error", err)
		return nil, nil
	}
	return catalog, coordinator
}
