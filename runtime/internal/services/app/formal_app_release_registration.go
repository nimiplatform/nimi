package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

var errFormalAppReleaseUnavailable = errors.New("formal App release registration is unavailable")

// FormalAppRelease is canonical lifecycle-owner input for one installed,
// bundled, or platform App release. Protected transport contributes only the
// exact executable witness; it never supplies declaration coverage.
type FormalAppRelease struct {
	AppID                     string
	DisplayName               string
	SourceRef                 string
	InstallRoot               string
	ManifestRef               string
	ShellKind                 int32
	Declaration               []string
	ImmutableLineageID        string
	ProvenanceAttestationRefs []string
	ProvenanceRevision        uint64
	ExecutionProfileRef       string
	PayloadRootDigest         string
}

type FormalAppReleaseResolver interface {
	ResolveFormalAppRelease(context.Context, string) (FormalAppRelease, error)
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001
// @nimi-authority: rule.nimi.runtime.protected-session.r023
func (s *Service) registerFormalAppRelease(
	ctx context.Context,
	appID string,
	bindingSlot string,
	process protectedlocal.ProcessTuple,
) (localappkernel.Registration, error) {
	appID = strings.TrimSpace(appID)
	bindingSlot = strings.TrimSpace(bindingSlot)
	if s == nil || s.localAppKernel == nil || s.formalAppReleaseResolver == nil || appID == "" || bindingSlot == "" ||
		process.ExecutableDigest == (protectedlocal.Identifier{}) {
		return localappkernel.Registration{}, errFormalAppReleaseUnavailable
	}
	release, err := s.formalAppReleaseResolver.ResolveFormalAppRelease(ctx, appID)
	if err != nil {
		return localappkernel.Registration{}, fmt.Errorf("resolve formal App release: %w", err)
	}
	input, err := formalAppInstalledRegistrationInput(appID, release, process.ExecutableDigest)
	if err != nil {
		return localappkernel.Registration{}, err
	}
	input.BindingSlot = bindingSlot
	s.installedAppRegistrationMu.Lock()
	defer s.installedAppRegistrationMu.Unlock()
	current, currentErr := s.localAppKernel.Registrations().GetActiveByBindingSlot(ctx, bindingSlot)
	if currentErr == nil && sameFormalAppReleaseRegistration(current, input) {
		if current.HostExecutableDigest != input.HostExecutableDigest {
			return localappkernel.Registration{}, errLocalDevelopmentSessionRevoked
		}
		return current, nil
	}
	if currentErr != nil && !errors.Is(currentErr, localappkernel.ErrNotFound) {
		return localappkernel.Registration{}, fmt.Errorf("resolve current formal App release: %w", currentErr)
	}
	if currentErr == nil {
		input.ExistingRegistrationHandle = current.RegistrationHandle
	}
	registration, err := s.localAppKernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		return localappkernel.Registration{}, fmt.Errorf("register formal App release: %w", err)
	}
	s.invalidateLocalAppSessionsForRegistration(registration, false)
	return registration, nil
}

func sameFormalAppReleaseRegistration(
	current localappkernel.Registration,
	input localappkernel.RegisterInstalledInput,
) bool {
	if current.SourceClass != localappkernel.SourceClassVerified || current.AppID != input.AppID ||
		current.DisplayName != input.DisplayName || current.SourceRef != input.SourceRef ||
		filepath.Clean(current.ProjectRoot) != filepath.Clean(input.ProjectRoot) ||
		current.ManifestPath != input.ManifestPath || current.ShellKind != input.ShellKind ||
		current.ImmutableLineageID != input.ImmutableLineageID ||
		!sameStrings(current.ProvenanceAttestationRefs, input.ProvenanceAttestationRefs) ||
		current.ProvenanceRevision != input.ProvenanceRevision || current.ExecutionProfileRef != input.ExecutionProfileRef ||
		current.PayloadRootDigest != input.PayloadRootDigest ||
		len(current.RawDeclaration) != len(input.RawDeclaration) {
		return false
	}
	for index := range current.RawDeclaration {
		if current.RawDeclaration[index] != input.RawDeclaration[index] {
			return false
		}
	}
	return true
}

func formalAppInstalledRegistrationInput(
	requestedAppID string,
	release FormalAppRelease,
	executableDigest protectedlocal.Identifier,
) (localappkernel.RegisterInstalledInput, error) {
	if release.AppID != strings.TrimSpace(release.AppID) || release.AppID != requestedAppID ||
		release.DisplayName != strings.TrimSpace(release.DisplayName) || release.SourceRef != strings.TrimSpace(release.SourceRef) ||
		release.InstallRoot != strings.TrimSpace(release.InstallRoot) || release.ManifestRef != strings.TrimSpace(release.ManifestRef) ||
		release.ImmutableLineageID != strings.TrimSpace(release.ImmutableLineageID) ||
		release.ExecutionProfileRef != strings.TrimSpace(release.ExecutionProfileRef) ||
		release.PayloadRootDigest != strings.TrimSpace(release.PayloadRootDigest) ||
		release.AppID == "" || release.DisplayName == "" || release.SourceRef == "" || release.InstallRoot == "" ||
		release.ManifestRef == "" || release.ImmutableLineageID == "" || release.ProvenanceRevision == 0 ||
		release.ExecutionProfileRef == "" || release.PayloadRootDigest == "" || release.ShellKind <= 0 ||
		executableDigest == (protectedlocal.Identifier{}) {
		return localappkernel.RegisterInstalledInput{}, errFormalAppReleaseUnavailable
	}
	return localappkernel.RegisterInstalledInput{
		AppID:                     release.AppID,
		DisplayName:               release.DisplayName,
		SourceRef:                 release.SourceRef,
		ProjectRoot:               filepath.Clean(release.InstallRoot),
		ManifestPath:              release.ManifestRef,
		ShellKind:                 release.ShellKind,
		RawDeclaration:            append([]string(nil), release.Declaration...),
		SourceClass:               localappkernel.SourceClassVerified,
		ImmutableLineageID:        release.ImmutableLineageID,
		ProvenanceAttestationRefs: append([]string(nil), release.ProvenanceAttestationRefs...),
		ProvenanceRevision:        release.ProvenanceRevision,
		ExecutionProfileRef:       release.ExecutionProfileRef,
		HostExecutableDigest:      protectedExecutableDigestRef(executableDigest),
		PayloadRootDigest:         release.PayloadRootDigest,
	}, nil
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
