package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type builtInAppSpec struct {
	displayName string
	domains     []string
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-010a
func builtInAppSpecFor(appID string) (builtInAppSpec, bool) {
	switch strings.TrimSpace(appID) {
	case "nimi.desktop":
		return builtInAppSpec{displayName: "Nimi Desktop", domains: []string{"realm.data", "runtime.consume", "agent.local", "agent.configure"}}, true
	case "nimi.avatar":
		return builtInAppSpec{displayName: "Nimi Avatar", domains: []string{"realm.data", "runtime.consume", "agent.local", "agent.configure"}}, true
	default:
		return builtInAppSpec{}, false
	}
}

// AuthorizeBuiltInAppIngress routes a fixed Nimi App through the same durable
// registration, declaration, Effective App Access Snapshot and session kernel
// as every protected App. The verified Desktop transport supplies only the
// immutable process/liveness witness; it never manufactures a per-call
// LocalAppCallerDecision.
func (s *Service) AuthorizeBuiltInAppIngress(
	ctx context.Context,
	appID string,
	runtimeBootEpoch protectedlocal.Identifier,
	ingress localappop.Ingress,
) (context.Context, error) {
	spec, ok := builtInAppSpecFor(appID)
	if !ok || runtimeBootEpoch == (protectedlocal.Identifier{}) {
		return nil, localAppIngressError(errLocalDevelopmentSessionRevoked)
	}
	binding, err := s.ensureBuiltInLocalAppBinding(ctx, strings.TrimSpace(appID), spec, runtimeBootEpoch)
	if err != nil {
		return nil, localAppIngressError(err)
	}
	binding.mu.Lock()
	defer binding.mu.Unlock()
	localCtx := protectedlocal.ContextWithLocalAppConnection(ctx, binding.connection)
	if binding.connection.BootstrapAllowed() {
		if _, err := s.OpenLocalAppSessionProjection(localCtx); err != nil {
			return nil, err
		}
	} else {
		_, _, admissionErr := s.admitLocalAppIngress(localCtx, ingress)
		if renewableBuiltInSessionError(admissionErr) {
			if _, err := s.RenewLocalAppSessionProjection(localCtx); err != nil {
				return nil, err
			}
		}
	}
	return s.AuthorizeLocalAppIngress(localCtx, ingress)
}

func (s *Service) ensureBuiltInLocalAppBinding(
	ctx context.Context,
	appID string,
	spec builtInAppSpec,
	runtimeBootEpoch protectedlocal.Identifier,
) (*builtInLocalAppBinding, error) {
	if s == nil || s.localAppKernel == nil {
		return nil, errLocalDevelopmentSessionRevoked
	}
	desktop, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || desktop == nil || !desktop.VerifiedDesktopTransport() {
		return nil, errLocalDevelopmentSessionRevoked
	}
	process, ok := desktop.ClientProcess()
	if !ok {
		// Direct macOS transport currently retains only a minimal peer identity;
		// it cannot fabricate the executable digest required by formal App
		// registration and therefore remains fail-closed.
		return nil, errLocalDevelopmentSessionRevoked
	}
	registration, err := s.ensureBuiltInRegistration(ctx, appID, spec, process)
	if err != nil {
		return nil, err
	}
	s.invalidateLocalAppSessionsForRegistration(registration, false)
	key := builtInLocalAppConnectionKey{desktop: desktop, appID: appID}
	s.builtInLocalAppMu.Lock()
	if current := s.builtInLocalApps[key]; current != nil && current.connection != nil && current.connection.Live() {
		s.builtInLocalAppMu.Unlock()
		return current, nil
	}
	connectionID, ok := protectedlocal.VerifiedDesktopConnectionIDFromContext(ctx)
	if !ok {
		s.builtInLocalAppMu.Unlock()
		return nil, errLocalDevelopmentSessionRevoked
	}
	launchID := builtInLaunchIdentifier(connectionID, runtimeBootEpoch, appID)
	connection, err := protectedlocal.EstablishBuiltInLocalAppConnection(
		appID, launchID, runtimeBootEpoch, process, desktop.Done(),
	)
	if err != nil {
		s.builtInLocalAppMu.Unlock()
		return nil, err
	}
	binding := &builtInLocalAppBinding{connection: connection}
	s.builtInLocalApps[key] = binding
	s.builtInLocalAppMu.Unlock()
	go func() {
		<-desktop.Done()
		s.builtInLocalAppMu.Lock()
		if s.builtInLocalApps[key] == binding {
			delete(s.builtInLocalApps, key)
		}
		s.builtInLocalAppMu.Unlock()
	}()
	return binding, nil
}

func (s *Service) ensureBuiltInRegistration(
	ctx context.Context,
	appID string,
	spec builtInAppSpec,
	process protectedlocal.ProcessTuple,
) (localappkernel.Registration, error) {
	root := strings.TrimSpace(process.CanonicalExecutablePath)
	if root == "" {
		root = strings.TrimSpace(process.CanonicalExecutableIdentity)
	}
	if root == "" {
		return localappkernel.Registration{}, errLocalDevelopmentSessionRevoked
	}
	digest := builtInProcessDigest(appID, process)
	return s.localAppKernel.Registrations().RegisterBuiltIn(ctx, localappkernel.RegisterBuiltInInput{
		AppID: appID, DisplayName: spec.displayName,
		SourceRef: "platform-app:" + appID, ProjectRoot: filepath.Clean(root),
		ManifestPath: "platform-app-identity:" + appID, ShellKind: 1,
		RawDeclaration: append([]string(nil), spec.domains...), SourceDigest: digest,
		HostExecutableDigest: builtInIdentifierRef(process.ExecutableDigest),
		PayloadRootDigest:    digest,
	})
}

func builtInProcessDigest(appID string, process protectedlocal.ProcessTuple) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte("nimi.builtin-app-source.v1\x00"))
	_, _ = hash.Write([]byte(appID))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write([]byte(process.CanonicalExecutableIdentity))
	_, _ = hash.Write(process.ExecutableDigest[:])
	return "bias_v1_" + base64.RawURLEncoding.EncodeToString(hash.Sum(nil))
}

func builtInIdentifierRef(value protectedlocal.Identifier) string {
	return "bii_v1_" + base64.RawURLEncoding.EncodeToString(value[:])
}

func builtInLaunchIdentifier(connectionID, runtimeBootEpoch protectedlocal.Identifier, appID string) protectedlocal.Identifier {
	hash := sha256.New()
	_, _ = hash.Write([]byte("nimi.builtin-app-launch.v1\x00"))
	_, _ = hash.Write(connectionID[:])
	_, _ = hash.Write(runtimeBootEpoch[:])
	_, _ = hash.Write([]byte(appID))
	var result protectedlocal.Identifier
	copy(result[:], hash.Sum(nil))
	return result
}

func renewableBuiltInSessionError(err error) bool {
	return errors.Is(err, errLocalDevelopmentSessionRevoked) ||
		errors.Is(err, errLocalAppAccountGenerationChanged) ||
		errors.Is(err, errLocalAppRegistrationGenerationChanged) ||
		errors.Is(err, localappop.ErrSessionInvalid) ||
		errors.Is(err, localappop.ErrSnapshotStale) ||
		errors.Is(err, localappop.ErrSnapshotMissing)
}

func (s *Service) builtInRegistrationForConnection(ctx context.Context, connection *protectedlocal.LocalAppConnection) (localappkernel.Registration, error) {
	appID, ok := connection.BuiltInAppID()
	if !ok || s == nil || s.localAppKernel == nil {
		return localappkernel.Registration{}, fmt.Errorf("built-in App connection is unavailable")
	}
	registration, err := s.localAppKernel.Registrations().GetActiveByAppID(ctx, appID)
	if err != nil {
		return localappkernel.Registration{}, fmt.Errorf("resolve built-in App registration: %w", err)
	}
	if registration.SourceClass != localappkernel.SourceClassInstalled {
		return localappkernel.Registration{}, fmt.Errorf("resolve built-in App registration: source class is not installed")
	}
	return registration, nil
}
