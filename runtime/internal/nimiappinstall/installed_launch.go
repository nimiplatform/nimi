package nimiappinstall

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
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
	expected         nimiapppackage.Expected
}

// Installation owns these inputs. They prevent a changed manifest from
// selecting another entrypoint without requiring a full payload scan at launch.
type installedLaunchConfig struct {
	Expected    nimiapppackage.Expected
	DisplayName string
}

// VerifyHost checks the exact installed executable's digest and native posture.
// Prepare invokes it once; bind independently verifies the actual child image
// against the committed digest before Desktop resumes that child.
func (launch InstalledLaunch) VerifyHost(ctx context.Context) error {
	verifier, err := nativeVerifierForExpected(launch.expected)
	if err != nil {
		return err
	}
	return verifier.Verify(ctx, launch.RuntimeEntry, [32]byte(launch.ExecutableDigest))
}

// WithInstalledLaunch checks current installation and policy facts. Only the
// final state comparison and callback share the package-mutation reservation;
// Registry I/O and native inspection do not block launches of other Apps.
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040c
func (coordinator *Coordinator) WithInstalledLaunch(ctx context.Context, handle string, bind func(InstalledLaunch) error) error {
	return coordinator.withInstalledLaunch(ctx, handle, false, bind)
}

func (coordinator *Coordinator) PrepareInstalledLaunch(ctx context.Context, handle string, prepare func(InstalledLaunch) error) error {
	return coordinator.withInstalledLaunch(ctx, handle, true, prepare)
}

func (coordinator *Coordinator) withInstalledLaunch(ctx context.Context, handle string, verifyHost bool, bind func(InstalledLaunch) error) error {
	_, expectedOS, expectedArch, platformErr := publicappregistry.CurrentPlatformTarget()
	if ctx == nil || coordinator == nil || bind == nil || handle == "" || platformErr != nil {
		return ErrInstalledLaunch
	}
	coordinator.operations.RLock()
	defer coordinator.operations.RUnlock()
	started := time.Now()
	defer func() {
		if coordinator.logger != nil {
			coordinator.logger.Info("installed App launch state checked", "duration_ms", time.Since(started).Milliseconds())
		}
	}()
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
	rawConfig, err := coordinator.lifecycle.ReadLaunchConfig(ctx, handle, release.ReleaseRef)
	if err != nil {
		return fmt.Errorf("read installed App launch configuration: %w", errors.Join(ErrInstalledLaunch, err))
	}
	var config installedLaunchConfig
	if err := jsonstrict.Decode(rawConfig, &config); err != nil {
		return errors.Join(ErrInstalledLaunch, err)
	}
	packageExpected := config.Expected
	if packageExpected.AppID != release.AppID || packageExpected.Version != release.Version || packageExpected.OS != expectedOS || packageExpected.Arch != expectedArch ||
		packageExpected.ExecutionProfileRef != release.ExecutionProfileRef || config.DisplayName != registration.DisplayName || !equalTextList(packageExpected.AppAccess, registration.RawDeclaration) {
		return ErrInstalledLaunch
	}
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
		if !reflect.DeepEqual(packageExpected, packageExpectation(resolved)) {
			return ErrInstalledLaunch
		}
	} else {
		if !strings.HasPrefix(release.ReleaseRef, localPackageLineageBase) {
			return ErrInstalledLaunch
		}
	}
	entry, err := nimiapppackage.ResolveInstalledRuntimeEntry(registration.ProjectRoot, packageExpected)
	if err != nil {
		return fmt.Errorf("resolve installed App entry: %w", err)
	}
	launch := InstalledLaunch{Release: release, Registration: registration, RuntimeEntry: entry, WorkingDirectory: filepath.Dir(entry), ExecutableDigest: digest, expected: packageExpected}
	if verifyHost {
		nativeStarted := time.Now()
		err := launch.VerifyHost(ctx)
		if coordinator.logger != nil {
			coordinator.logger.Info("installed App Host verified", "app_id", registration.AppID, "duration_ms", time.Since(nativeStarted).Milliseconds(), "error", err)
		}
		if err != nil {
			return err
		}
	}
	coordinator.launchMu.Lock()
	defer coordinator.launchMu.Unlock()
	current, err := coordinator.kernel.Registrations().GetByHandle(ctx, handle)
	if err != nil || !reflect.DeepEqual(current, registration) {
		return errors.Join(ErrInstalledLaunch, err)
	}
	currentRelease, err := coordinator.lifecycle.GetCommittedRelease(ctx, registration.AppID, registration.SourceClass)
	if err != nil || !reflect.DeepEqual(currentRelease, release) {
		return errors.Join(ErrInstalledLaunch, err)
	}
	job, err = coordinator.lifecycle.GetActiveJob(ctx, registration.AppID, registration.SourceClass)
	if err == nil && !terminalPackagePhase(job.Phase) {
		return localappkernel.ErrPackageJobActive
	}
	if err != nil && !errors.Is(err, localappkernel.ErrPackageJobNotFound) {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return bind(launch)
}

func immutablePackageSource(source localappkernel.SourceClass) bool {
	return source == localappkernel.SourceClassVerified || source == localappkernel.SourceClassUserImported
}
