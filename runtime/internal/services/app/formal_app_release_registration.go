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
	AppID             string
	DisplayName       string
	SourceRef         string
	InstallRoot       string
	ManifestRef       string
	ShellKind         int32
	Declaration       []string
	SourceDigest      string
	PayloadRootDigest string
}

type FormalAppReleaseResolver interface {
	ResolveFormalAppRelease(context.Context, string) (FormalAppRelease, error)
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-appacc-001
// @nimi-authority: rule.nimi.runtime.protected-session.r023
func (s *Service) registerFormalAppRelease(
	ctx context.Context,
	appID string,
	process protectedlocal.ProcessTuple,
) (localappkernel.Registration, error) {
	appID = strings.TrimSpace(appID)
	if s == nil || s.localAppKernel == nil || s.formalAppReleaseResolver == nil || appID == "" ||
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
	s.installedAppRegistrationMu.Lock()
	defer s.installedAppRegistrationMu.Unlock()
	registration, err := s.localAppKernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		return localappkernel.Registration{}, fmt.Errorf("register formal App release: %w", err)
	}
	s.invalidateLocalAppSessionsForRegistration(registration, false)
	return registration, nil
}

func formalAppInstalledRegistrationInput(
	requestedAppID string,
	release FormalAppRelease,
	executableDigest protectedlocal.Identifier,
) (localappkernel.RegisterInstalledInput, error) {
	if release.AppID != strings.TrimSpace(release.AppID) || release.AppID != requestedAppID ||
		release.DisplayName != strings.TrimSpace(release.DisplayName) || release.SourceRef != strings.TrimSpace(release.SourceRef) ||
		release.InstallRoot != strings.TrimSpace(release.InstallRoot) || release.ManifestRef != strings.TrimSpace(release.ManifestRef) ||
		release.SourceDigest != strings.TrimSpace(release.SourceDigest) || release.PayloadRootDigest != strings.TrimSpace(release.PayloadRootDigest) ||
		release.AppID == "" || release.DisplayName == "" || release.SourceRef == "" || release.InstallRoot == "" ||
		release.ManifestRef == "" || release.SourceDigest == "" || release.PayloadRootDigest == "" || release.ShellKind <= 0 ||
		executableDigest == (protectedlocal.Identifier{}) {
		return localappkernel.RegisterInstalledInput{}, errFormalAppReleaseUnavailable
	}
	return localappkernel.RegisterInstalledInput{
		AppID:                release.AppID,
		DisplayName:          release.DisplayName,
		SourceRef:            release.SourceRef,
		ProjectRoot:          filepath.Clean(release.InstallRoot),
		ManifestPath:         release.ManifestRef,
		ShellKind:            release.ShellKind,
		RawDeclaration:       append([]string(nil), release.Declaration...),
		SourceDigest:         release.SourceDigest,
		HostExecutableDigest: protectedExecutableDigestRef(executableDigest),
		PayloadRootDigest:    release.PayloadRootDigest,
	}, nil
}
