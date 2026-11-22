//go:build darwin && cgo && !nimi_macos_source_local_development

package protectedlocal

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
)

// ResolveManagedWebCarrier verifies the fixed Nimi Local App Host.app bundle
// seal against the active product macOS signing policy and returns its live
// executable path and SHA-256 digest.
func ResolveManagedWebCarrier(ctx context.Context) (ManagedWebCarrier, error) {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return ManagedWebCarrier{}, err
		}
	}
	host := filepath.Clean(MacOSLocalAppHostPath)
	if host == "" || !filepath.IsAbs(host) {
		return ManagedWebCarrier{}, fmt.Errorf("macOS managed-web carrier path is not configured")
	}
	canonical, err := filepath.EvalSymlinks(host)
	if err != nil || canonical != host {
		return ManagedWebCarrier{}, fmt.Errorf("macOS managed-web carrier path must be canonical")
	}
	info, err := os.Lstat(host)
	if err != nil || info == nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return ManagedWebCarrier{}, fmt.Errorf("macOS managed-web carrier must be a direct regular file")
	}
	policy, err := macOSLocalAppHostCodePolicy()
	if err != nil {
		return ManagedWebCarrier{}, err
	}
	bundlePath := filepath.Dir(filepath.Dir(filepath.Dir(host)))
	if err := verifyMacOSOuterBundleSeal(
		bundlePath,
		policy.directRequirement,
		policy.teamID,
		policy.signingIdentifier,
		policy.requireTrustedAnchor,
		policy.requireNotarization,
		policy.requireAdHoc,
	); err != nil {
		return ManagedWebCarrier{}, err
	}
	raw, err := os.ReadFile(host)
	if err != nil {
		return ManagedWebCarrier{}, fmt.Errorf("read macOS managed-web carrier: %w", err)
	}
	sum := sha256.Sum256(raw)
	var digest Identifier
	copy(digest[:], sum[:])
	if digest == (Identifier{}) {
		return ManagedWebCarrier{}, fmt.Errorf("macOS managed-web carrier digest is empty")
	}
	return ManagedWebCarrier{
		ExecutablePath:   host,
		ExecutableDigest: digest,
	}, nil
}
