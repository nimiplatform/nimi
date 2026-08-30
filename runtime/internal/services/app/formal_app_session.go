package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type formalAppSessionContextKey struct{}

// AuthorizeFormalAppIngress routes a Platform-supervised App through the same
// durable registration, declaration, Effective App Access Snapshot and
// session kernel as every protected App. The verified transport supplies only
// the immutable process/liveness witness; declaration coverage comes from the
// canonical formal release resolver.
func (s *Service) AuthorizeFormalAppIngress(
	ctx context.Context,
	appID string,
	bindingSlot string,
	runtimeBootEpoch protectedlocal.Identifier,
	ingress localappop.Ingress,
) (context.Context, error) {
	appID = strings.TrimSpace(appID)
	bindingSlot = strings.TrimSpace(bindingSlot)
	if appID == "" || bindingSlot == "" || runtimeBootEpoch == (protectedlocal.Identifier{}) {
		return nil, localAppIngressError(errLocalDevelopmentSessionRevoked)
	}
	binding, err := s.ensureFormalAppBinding(ctx, appID, bindingSlot, runtimeBootEpoch)
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
		if renewableFormalAppSessionError(admissionErr) {
			if _, err := s.RenewLocalAppSessionProjection(localCtx); err != nil {
				return nil, err
			}
		}
	}
	return s.AuthorizeLocalAppIngress(localCtx, ingress)
}

// BindFormalAppSession supplies the same installed LocalAppConnection to the
// request-empty AuthService Open/Renew handlers. The release keeps session
// rotation serialized with formal App operation admission on this binding.
func (s *Service) BindFormalAppSession(
	ctx context.Context,
	appID string,
	bindingSlot string,
	runtimeBootEpoch protectedlocal.Identifier,
) (context.Context, func(), error) {
	appID = strings.TrimSpace(appID)
	bindingSlot = strings.TrimSpace(bindingSlot)
	if appID == "" || bindingSlot == "" || runtimeBootEpoch == (protectedlocal.Identifier{}) {
		return nil, nil, localAppIngressError(errLocalDevelopmentSessionRevoked)
	}
	binding, err := s.ensureFormalAppBinding(ctx, appID, bindingSlot, runtimeBootEpoch)
	if err != nil {
		if s != nil && s.logger != nil {
			s.logger.Warn("bind formal App session failed", "app_id", appID, "error", err)
		}
		return nil, nil, localAppIngressError(err)
	}
	binding.mu.Lock()
	localCtx := protectedlocal.ContextWithLocalAppConnection(ctx, binding.connection)
	localCtx = context.WithValue(localCtx, formalAppSessionContextKey{}, true)
	return localCtx, binding.mu.Unlock, nil
}

func formalAppSessionFromContext(ctx context.Context) bool {
	formal, _ := ctx.Value(formalAppSessionContextKey{}).(bool)
	return formal
}

func (s *Service) ensureFormalAppBinding(
	ctx context.Context,
	appID string,
	bindingSlot string,
	runtimeBootEpoch protectedlocal.Identifier,
) (*formalAppBinding, error) {
	if s == nil || s.localAppKernel == nil {
		return nil, errLocalDevelopmentSessionRevoked
	}
	desktop, ok := protectedlocal.DesktopConnectionFromContext(ctx)
	if !ok || desktop == nil || !desktop.VerifiedDesktopTransport() {
		return nil, errLocalDevelopmentSessionRevoked
	}
	process, ok := desktop.ClientProcess()
	if !ok {
		// Formal App registration requires an immutable process tuple verified
		// by the native transport; incomplete direct peers remain fail-closed.
		return nil, errLocalDevelopmentSessionRevoked
	}
	registration, err := s.registerFormalAppRelease(ctx, appID, bindingSlot, process)
	if err != nil {
		return nil, err
	}
	key := formalAppConnectionKey{desktop: desktop, appID: appID, bindingSlot: bindingSlot}
	s.formalAppMu.Lock()
	if current := s.formalApps[key]; current != nil && current.connection != nil && current.connection.Live() {
		s.formalAppMu.Unlock()
		return current, nil
	}
	connectionID, ok := protectedlocal.VerifiedDesktopConnectionIDFromContext(ctx)
	if !ok {
		s.formalAppMu.Unlock()
		return nil, errLocalDevelopmentSessionRevoked
	}
	launchID := formalAppLaunchIdentifier(connectionID, runtimeBootEpoch, appID, bindingSlot)
	connection, err := protectedlocal.EstablishInstalledAppConnection(
		registration.RegistrationHandle, launchID, runtimeBootEpoch, process, desktop.Done(),
	)
	if err != nil {
		s.formalAppMu.Unlock()
		return nil, err
	}
	binding := &formalAppBinding{connection: connection}
	s.formalApps[key] = binding
	s.formalAppMu.Unlock()
	go func() {
		<-desktop.Done()
		s.formalAppMu.Lock()
		if s.formalApps[key] == binding {
			delete(s.formalApps, key)
		}
		s.formalAppMu.Unlock()
	}()
	return binding, nil
}

func protectedExecutableDigestRef(value protectedlocal.Identifier) string {
	return "bii_v1_" + base64.RawURLEncoding.EncodeToString(value[:])
}

func formalAppLaunchIdentifier(connectionID, runtimeBootEpoch protectedlocal.Identifier, appID string, bindingSlot string) protectedlocal.Identifier {
	hash := sha256.New()
	_, _ = hash.Write([]byte("nimi.formal-app-launch.v1\x00"))
	_, _ = hash.Write(connectionID[:])
	_, _ = hash.Write(runtimeBootEpoch[:])
	_, _ = hash.Write([]byte(appID))
	_, _ = hash.Write([]byte("\x00" + bindingSlot))
	var result protectedlocal.Identifier
	copy(result[:], hash.Sum(nil))
	return result
}

func renewableFormalAppSessionError(err error) bool {
	return errors.Is(err, errLocalDevelopmentSessionRevoked) ||
		errors.Is(err, errLocalAppAccountGenerationChanged) ||
		errors.Is(err, errLocalAppRegistrationGenerationChanged) ||
		errors.Is(err, localappop.ErrSessionInvalid) ||
		errors.Is(err, localappop.ErrSnapshotStale) ||
		errors.Is(err, localappop.ErrSnapshotMissing)
}
