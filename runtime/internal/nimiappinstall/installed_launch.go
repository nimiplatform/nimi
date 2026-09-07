package nimiappinstall

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiappnative"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

var ErrInstalledLaunch = errors.New("verified installed App launch is unavailable")

// VerifiedInstalledLaunch is host-private material resolved by Runtime. It is
// not a renderer DTO or an input accepting a caller's executable/arguments.
type VerifiedInstalledLaunch struct {
	Release          localappkernel.CommittedRelease
	Registration     localappkernel.Registration
	Target           publicappregistry.ResolvedApprovedTarget
	RuntimeEntry     string
	WorkingDirectory string
	ExecutableDigest protectedlocal.Identifier
}

// WithVerifiedInstalledLaunch serializes security bind with uninstall
// reservation. Prepare and bind both perform this full verification; the
// callback may only record/bind the exact launch while that reservation is held.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (coordinator *Coordinator) WithVerifiedInstalledLaunch(ctx context.Context, handle string, bind func(VerifiedInstalledLaunch) error) error {
	if ctx == nil || coordinator == nil || bind == nil || handle == "" || runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		return ErrInstalledLaunch
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	coordinator.launchMu.Lock()
	defer coordinator.launchMu.Unlock()
	if coordinator.isClosing() || coordinator.registry == nil {
		return ErrInstalledLaunch
	}
	registration, err := coordinator.kernel.Registrations().GetByHandle(ctx, handle)
	if err != nil || registration.State != localappkernel.RegistrationStateActive || registration.SourceClass != localappkernel.SourceClassVerified ||
		registration.SourceGeneration == 0 || registration.DeclarationGeneration == 0 || !registration.ImmutablePackageFactsComplete() {
		return errors.Join(ErrInstalledLaunch, err)
	}
	release, err := coordinator.lifecycle.GetCommittedRelease(ctx, registration.AppID, localappkernel.SourceClassVerified)
	if err != nil || release.RegistrationHandle != handle || release.ReleaseRef != registration.ImmutableLineageID ||
		release.ImmutableLineageID != registration.ImmutableLineageID || release.HostExecutableDigest != registration.HostExecutableDigest ||
		release.PayloadRootDigest != registration.PayloadRootDigest || release.ExecutionProfileRef != registration.ExecutionProfileRef {
		return errors.Join(ErrInstalledLaunch, err)
	}
	job, err := coordinator.lifecycle.GetActiveJob(ctx, registration.AppID, localappkernel.SourceClassVerified)
	if err == nil && !terminalPackagePhase(job.Phase) {
		return localappkernel.ErrPackageJobActive
	}
	if err != nil && !errors.Is(err, localappkernel.ErrPackageJobNotFound) {
		return err
	}
	selector, err := publicSelector(release.ReleaseRef)
	if err != nil {
		return errors.Join(ErrInstalledLaunch, err)
	}
	resolved, err := coordinator.registry.RevalidateInstalled(ctx, selector)
	if err != nil {
		return err
	}
	if resolved.AppID != release.AppID || resolved.Version != release.Version || resolved.Selector != selector ||
		resolved.DescriptorID != selector.DescriptorID() || resolved.Target.TargetID != selector.TargetID() ||
		resolved.Target.OS != "windows" || resolved.Target.Arch != "x86_64" {
		return ErrInstalledLaunch
	}
	relative, err := filepath.Rel(filepath.Join(coordinator.packagesPath, packageReleaseDirectory), registration.ProjectRoot)
	if err != nil || !runtimeOwnedChild(relative) || registration.ProjectRoot != filepath.Join(coordinator.packagesPath, packageReleaseDirectory, relative) ||
		registration.ManifestPath != filepath.Join(registration.ProjectRoot, "nimi.app.yaml") {
		return errors.Join(ErrInstalledLaunch, err)
	}
	info, err := coordinator.packagesRoot.Lstat(filepath.Join(packageReleaseDirectory, relative))
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.Join(ErrInstalledLaunch, err)
	}
	encoded := strings.TrimPrefix(release.HostExecutableDigest, "bii_v1_")
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	var digest protectedlocal.Identifier
	if err != nil || len(raw) != len(digest) {
		return errors.Join(ErrInstalledLaunch, err)
	}
	copy(digest[:], raw)
	if protectedlocal.ExecutableDigestRef(digest) != release.HostExecutableDigest {
		return ErrInstalledLaunch
	}
	materialized, err := nimiapppackage.VerifyMaterialized(ctx, registration.ProjectRoot, packageExpectation(resolved), release.PayloadRootDigest, [32]byte(digest))
	if err != nil {
		return fmt.Errorf("verify installed App payload: %w", err)
	}
	expected := coordinator.registrationInput(resolved, release.ReleaseRef, relative, materialized)
	if !sameInstalledRegistration(registration, expected) {
		return ErrInstalledLaunch
	}
	if _, err := nimiappnative.VerifyWindowsRuntimeEntry(ctx, materialized.RuntimeEntryPath, nativeExpectation(resolved), materialized.HostExecutableSHA256); err != nil {
		return err
	}
	return bind(VerifiedInstalledLaunch{Release: release, Registration: registration, Target: resolved,
		RuntimeEntry: materialized.RuntimeEntryPath, WorkingDirectory: filepath.Dir(materialized.RuntimeEntryPath), ExecutableDigest: digest})
}
