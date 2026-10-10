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

type windowsNativeExecutableTrustVerifier struct {
	productReleaseID      string
	productSourceRevision string
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
	return &windowsNativeExecutableTrustVerifier{productReleaseID: identity.ReleaseID, productSourceRevision: identity.SourceRevision}, nil
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
