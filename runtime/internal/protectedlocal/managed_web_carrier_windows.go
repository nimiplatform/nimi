//go:build windows && !nimi_windows_source_local_development

package protectedlocal

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
)

// ResolveManagedWebCarrier resolves and verifies the shared NimiAppHost.exe
// sibling in the active service's admitted Windows product cohort. Production
// runtime startup caches the cohort verifier once and injects it via
// ManagedWebCarrierResolver so normal launches do not re-read identity JSON.
func ResolveManagedWebCarrier(ctx context.Context) (ManagedWebCarrier, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return ManagedWebCarrier{}, err
		}
	}
	if mustActiveWindowsRuntimeProfile().nonProduct || productrelease.PublicKey == "" {
		return ManagedWebCarrier{}, fmt.Errorf("Windows managed-web carrier requires admitted product trust")
	}
	serviceExecutable, err := os.Executable()
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("resolve Windows service executable: %w", err)
	}
	productRoot, err := productrelease.ValidateProductPath(serviceExecutable)
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("validate Windows product root: %w", err)
	}
	identityPath := filepath.Join(productRoot, productrelease.IdentityFile)
	if err := productrelease.ValidateAdministrativePath(identityPath); err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("validate Windows product identity path: %w", err)
	}
	raw, err := os.ReadFile(identityPath)
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("read Windows product identity: %w", err)
	}
	identity, err := productrelease.VerifyIdentity(raw, productrelease.PublicKey)
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("verify Windows product identity: %w", err)
	}
	expectedDigest := identity.Files[windowsManagedWebCarrierFilename]
	if expectedDigest == "" {
		return ManagedWebCarrier{}, fmt.Errorf("Windows product cohort does not include %s", windowsManagedWebCarrierFilename)
	}
	return resolveAdmittedWindowsManagedWebCarrier(ctx, productRoot, expectedDigest)
}
