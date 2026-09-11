package nimiappinstall

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

var ErrInstalledLaunch = errors.New("installed App launch is unavailable")

// InstalledLaunch is host-private material resolved by Runtime. It is
// not a renderer DTO or an input accepting a caller's executable/arguments.
type InstalledLaunch struct {
	Release          localappkernel.CommittedRelease
	Registration     localappkernel.Registration
	RuntimeEntry     string
	WorkingDirectory string
	ExecutableDigest protectedlocal.Identifier
}

// WithInstalledLaunch serializes security bind with uninstall
// reservation. Prepare and bind both perform this full verification; the
// callback may only record/bind the exact launch while that reservation is held.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (coordinator *Coordinator) WithInstalledLaunch(ctx context.Context, handle string, bind func(InstalledLaunch) error) error {
	_, expectedOS, expectedArch, platformErr := publicappregistry.CurrentPlatformTarget()
	if ctx == nil || coordinator == nil || bind == nil || handle == "" || platformErr != nil {
		return ErrInstalledLaunch
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	coordinator.launchMu.Lock()
	defer coordinator.launchMu.Unlock()
	if coordinator.isClosing() {
		return ErrInstalledLaunch
	}
	registration, err := coordinator.kernel.Registrations().GetByHandle(ctx, handle)
	if err != nil || registration.State != localappkernel.RegistrationStateActive || !immutablePackageSource(registration.SourceClass) ||
		registration.SourceGeneration == 0 || registration.DeclarationGeneration == 0 || !registration.ImmutablePackageFactsComplete() {
		return errors.Join(ErrInstalledLaunch, err)
	}
	release, err := coordinator.lifecycle.GetCommittedRelease(ctx, registration.AppID, registration.SourceClass)
	if err != nil || release.RegistrationHandle != handle || release.ReleaseRef != registration.ImmutableLineageID ||
		release.ImmutableLineageID != registration.ImmutableLineageID || release.HostExecutableDigest != registration.HostExecutableDigest ||
		release.PayloadRootDigest != registration.PayloadRootDigest || release.ExecutionProfileRef != registration.ExecutionProfileRef {
		return errors.Join(ErrInstalledLaunch, err)
	}
	job, err := coordinator.lifecycle.GetActiveJob(ctx, registration.AppID, registration.SourceClass)
	if err == nil && !terminalPackagePhase(job.Phase) {
		return localappkernel.ErrPackageJobActive
	}
	if err != nil && !errors.Is(err, localappkernel.ErrPackageJobNotFound) {
		return err
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
	var packageExpected nimiapppackage.Expected
	var expectedRegistration func(nimiapppackage.Materialized) localappkernel.RegisterInstalledInput
	if registration.SourceClass == localappkernel.SourceClassVerified {
		if coordinator.registry == nil {
			return ErrInstalledLaunch
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
			resolved.Target.OS != expectedOS || resolved.Target.Arch != expectedArch {
			return ErrInstalledLaunch
		}
		packageExpected = packageExpectation(resolved)
		expectedRegistration = func(materialized nimiapppackage.Materialized) localappkernel.RegisterInstalledInput {
			return coordinator.registrationInput(resolved, release.ReleaseRef, relative, materialized)
		}
	} else {
		if !strings.HasPrefix(release.ReleaseRef, localPackageLineageBase) {
			return ErrInstalledLaunch
		}
		metadata, err := nimiapppackage.ReadInstalledLocalMetadata(registration.ProjectRoot, expectedOS, expectedArch)
		if err != nil || metadata.Expected.AppID != release.AppID || metadata.Expected.Version != release.Version {
			return errors.Join(ErrInstalledLaunch, err)
		}
		packageExpected = metadata.Expected
		expectedRegistration = func(materialized nimiapppackage.Materialized) localappkernel.RegisterInstalledInput {
			return coordinator.localRegistrationInput(metadata, release.ReleaseRef, relative, materialized)
		}
	}
	materialized, err := nimiapppackage.VerifyMaterialized(ctx, registration.ProjectRoot, packageExpected, release.PayloadRootDigest, [32]byte(digest))
	if err != nil {
		return fmt.Errorf("verify installed App payload: %w", err)
	}
	expected := expectedRegistration(materialized)

	// This revision is Runtime-owned lifecycle state, not a package fact. The
	// package-derived fields must still match after an update advances it.
	expected.ProvenanceRevision = registration.ProvenanceRevision
	if !sameInstalledRegistration(registration, expected) {
		return ErrInstalledLaunch
	}
	verifier, err := nativeVerifierForExpected(packageExpected)
	if err != nil {
		return err
	}
	if err := verifier.Verify(ctx, materialized.RuntimeEntryPath, materialized.HostExecutableSHA256); err != nil {
		return err
	}
	return bind(InstalledLaunch{Release: release, Registration: registration,
		RuntimeEntry: materialized.RuntimeEntryPath, WorkingDirectory: filepath.Dir(materialized.RuntimeEntryPath), ExecutableDigest: digest})
}

func immutablePackageSource(source localappkernel.SourceClass) bool {
	return source == localappkernel.SourceClassVerified || source == localappkernel.SourceClassUserImported
}
