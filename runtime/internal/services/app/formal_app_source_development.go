package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001
func (s *Service) registerSourceDevelopmentPlatformApp(ctx context.Context, appID, bindingSlot string, process protectedlocal.ProcessTuple) (localappkernel.Registration, error) {
	s.installedAppRegistrationMu.Lock()
	defer s.installedAppRegistrationMu.Unlock()
	// Read and register the current declaration in one owner turn so a caller
	// that started earlier cannot publish an older declaration after a newer one.
	source, err := s.formalAppReleaseResolver.ResolveFormalAppRelease(ctx, appID)
	if err != nil {
		return localappkernel.Registration{}, fmt.Errorf("resolve platform source manifest: %w", err)
	}
	if source.AppID != appID || source.SourceRef != "platform-app:"+appID ||
		!filepath.IsAbs(source.InstallRoot) || source.ManifestRef != filepath.Join(source.InstallRoot, "nimi.app.yaml") ||
		source.ImmutableLineageID != "" || len(source.ProvenanceAttestationRefs) != 0 || source.ProvenanceRevision != 0 ||
		source.ExecutionProfileRef != "" || source.PayloadRootDigest != "" {
		return localappkernel.Registration{}, errFormalAppReleaseUnavailable
	}
	// The first verified peer binds this Runtime composition to the native
	// Host bytes. An older connection cannot overwrite a newer witness. Native
	// Host upgrades are re-evaluated by the next source Runtime composition.
	if digest, bound := s.sourceDevelopmentHosts[bindingSlot]; bound && digest != process.ExecutableDigest {
		return localappkernel.Registration{}, errLocalDevelopmentSessionRevoked
	}
	current, currentErr := s.localAppKernel.Registrations().GetActiveByBindingSlot(ctx, bindingSlot)
	if currentErr != nil && !errors.Is(currentErr, localappkernel.ErrNotFound) {
		return localappkernel.Registration{}, currentErr
	}
	hostDigest := protectedExecutableDigestRef(process.ExecutableDigest)
	unchanged := currentErr == nil && current.IsPlatformSourceDevelopment() && current.AppID == appID &&
		current.DisplayName == source.DisplayName && current.ProjectRoot == source.InstallRoot &&
		current.ManifestPath == source.ManifestRef && current.HostExecutableDigest == hostDigest &&
		sameStrings(current.RawDeclaration, source.Declaration)
	registration := current
	if !unchanged {
		input := localappkernel.RegisterPlatformSourceInput{
			BindingSlot: bindingSlot, AppID: appID, DisplayName: source.DisplayName,
			ProjectRoot: source.InstallRoot, ManifestPath: source.ManifestRef,
			RawDeclaration: source.Declaration, HostExecutableDigest: hostDigest,
		}
		if currentErr == nil {
			input.ExistingRegistrationHandle = current.RegistrationHandle
		}
		var err error
		registration, err = s.localAppKernel.Registrations().RegisterPlatformSourceDevelopment(ctx, input)
		if err != nil {
			return localappkernel.Registration{}, err
		}
		s.invalidateLocalAppSessionsForRegistration(registration, false)
	}
	if s.sourceDevelopmentHosts == nil {
		s.sourceDevelopmentHosts = make(map[string]protectedlocal.Identifier)
	}
	s.sourceDevelopmentHosts[bindingSlot] = process.ExecutableDigest
	return registration, nil
}
