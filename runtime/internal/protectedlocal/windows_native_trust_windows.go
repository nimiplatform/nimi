//go:build windows

package protectedlocal

import (
	"context"
	"encoding/hex"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
	"os"
	"path/filepath"
	"strings"
)

const windowsManagedWebCarrierFilename = "NimiAppHost.exe"

type windowsNativeExecutableTrustVerifier struct {
	productReleaseID      string
	productSourceRevision string
	productRoot           string
	managedWebHostDigest  string
}

// @nimi-authority: rule.nimi.runtime.service-operations.r054
// Production admission comes only from the sealed Platform product key and
// fixed administrative inventory. Source D2 retains its separate verifier.
func NewWindowsNativeExecutableTrustVerifier() (WindowsExecutableTrustVerifier, error) {
	if mustActiveWindowsRuntimeProfile().nonProduct || productrelease.PublicKey == "" {
		return nil, windowsExecutableTrustFailure("load Windows product policy", fmt.Errorf("product trust not configured"))
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, windowsExecutableTrustFailure("resolve service product", err)
	}
	digest, err := productrelease.FileSHA256(executable)
	if err != nil {
		return nil, err
	}
	identity, err := productrelease.VerifyInstalledExecutable(executable, digest, "runtime/nimi.exe", productrelease.PublicKey)
	if err != nil {
		return nil, windowsExecutableTrustFailure("admit service product", err)
	}
	productRoot, err := productrelease.ValidateProductPath(executable)
	if err != nil {
		return nil, windowsExecutableTrustFailure("resolve admitted product root", err)
	}
	return &windowsNativeExecutableTrustVerifier{
		productReleaseID:      identity.ReleaseID,
		productSourceRevision: identity.SourceRevision,
		productRoot:           filepath.Clean(productRoot),
		managedWebHostDigest:  identity.Files[windowsManagedWebCarrierFilename],
	}, nil
}

// ResolveManagedWebCarrier validates the single NimiAppHost.exe file under this
// Runtime cohort's already-admitted product root against the startup-cached
// Ed25519 inventory digest without re-scanning the full product tree.
func (verifier *windowsNativeExecutableTrustVerifier) ResolveManagedWebCarrier(ctx context.Context) (ManagedWebCarrier, error) {
	if verifier == nil || verifier.productRoot == "" || verifier.managedWebHostDigest == "" {
		return ManagedWebCarrier{}, fmt.Errorf("Windows product cohort does not include %s", windowsManagedWebCarrierFilename)
	}
	return resolveAdmittedWindowsManagedWebCarrier(ctx, verifier.productRoot, verifier.managedWebHostDigest)
}

func resolveAdmittedWindowsManagedWebCarrier(ctx context.Context, productRoot, expectedDigestHex string) (ManagedWebCarrier, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return ManagedWebCarrier{}, err
		}
	}
	productRoot = filepath.Clean(strings.TrimSpace(productRoot))
	if !filepath.IsAbs(productRoot) || len(expectedDigestHex) != 64 {
		return ManagedWebCarrier{}, fmt.Errorf("admitted Windows managed-web carrier configuration is incomplete")
	}
	hostPath := filepath.Join(productRoot, windowsManagedWebCarrierFilename)
	validatedRoot, err := productrelease.ValidateProductPath(hostPath)
	if err != nil || !strings.EqualFold(filepath.Clean(validatedRoot), productRoot) {
		return ManagedWebCarrier{}, fmt.Errorf("validate Windows managed-web carrier path: %w", err)
	}
	info, err := os.Lstat(hostPath)
	if err != nil || info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return ManagedWebCarrier{}, fmt.Errorf("Windows managed-web carrier must be a direct regular file")
	}
	observedHex, err := productrelease.FileSHA256(hostPath)
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("hash Windows managed-web carrier: %w", err)
	}
	if observedHex != expectedDigestHex {
		return ManagedWebCarrier{}, fmt.Errorf("Windows managed-web carrier digest mismatch")
	}
	rawDigest, err := hex.DecodeString(observedHex)
	if err != nil || len(rawDigest) != IdentifierBytes {
		return ManagedWebCarrier{}, fmt.Errorf("decode Windows managed-web carrier digest")
	}
	var digest Identifier
	copy(digest[:], rawDigest)
	if digest == (Identifier{}) {
		return ManagedWebCarrier{}, fmt.Errorf("Windows managed-web carrier digest is empty")
	}
	return ManagedWebCarrier{
		ExecutablePath:   hostPath,
		ExecutableDigest: digest,
	}, nil
}
func (verifier *windowsNativeExecutableTrustVerifier) VerifyWindowsExecutable(ctx context.Context, role WindowsExecutableRole, executable WindowsLockedExecutable) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", windowsExecutableTrustFailure("verify Windows executable", err)
	}
	if verifier == nil || executable == nil || executable.NativeHandle() == 0 {
		return "", windowsExecutableTrustFailure("verify Windows executable", fmt.Errorf("locked native executable required"))
	}
	evidence := executable.Evidence()
	expectedName, trustSetID, err := windowsExecutableRolePolicy(role)
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(filepath.Base(evidence.Path), expectedName) {
		return "", windowsExecutableTrustFailure("verify Windows executable role", fmt.Errorf("unexpected executable name"))
	}
	fileRole := "Nimi.exe"
	if role == WindowsExecutableRoleRuntime {
		fileRole = "runtime/nimi.exe"
	}
	identity, err := productrelease.VerifyInstalledExecutable(evidence.Path, hex.EncodeToString(evidence.Digest[:]), fileRole, productrelease.PublicKey)
	if err != nil {
		return "", windowsExecutableTrustFailure("verify admitted product role", err)
	}
	if identity.ReleaseID != verifier.productReleaseID || identity.SourceRevision != verifier.productSourceRevision {
		return "", windowsExecutableTrustFailure("verify product cohort", fmt.Errorf("peer belongs to another product release"))
	}
	return trustSetID, nil
}

func windowsExecutableRolePolicy(role WindowsExecutableRole) (string, string, error) {
	profile := mustActiveWindowsRuntimeProfile()
	switch role {
	case WindowsExecutableRoleRuntime:
		return profile.runtimeExecutableName, profile.runtimeTrustSetID, nil
	case WindowsExecutableRoleDesktop:
		return profile.desktopExecutableName, profile.desktopTrustSetID, nil
	default:
		return "", "", windowsExecutableTrustFailure("verify Windows executable role", fmt.Errorf("unsupported executable role"))
	}
}
