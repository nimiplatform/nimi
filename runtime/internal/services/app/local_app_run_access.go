package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.app-surface.run-access-scope-projection
func (s *Service) GetLocalDevelopmentRunAccess(ctx context.Context, req *runtimev1.GetLocalDevelopmentRunAccessRequest) (*runtimev1.GetLocalDevelopmentRunAccessResponse, error) {
	if err := requireProtectedLocalDevelopmentDesktop(ctx); err != nil {
		return nil, err
	}
	if s == nil || s.localAppKernel == nil || req == nil {
		return nil, localDevelopmentFailure(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	handle, handleOK := localDevelopmentIdentifierFromBytes(req.GetRegistrationHandle())
	runID, runOK := localDevelopmentIdentifierFromBytes(req.GetSupervisorRunId())
	if !handleOK || !runOK {
		return nil, localDevelopmentFailure(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_LAUNCH_LEASE_REQUIRED)
	}
	owner, _ := protectedlocal.DesktopConnectionFromContext(ctx)
	// A pending launch has no session baseline. The existing exact-connection
	// run binding permits only that empty observation; session availability
	// below independently requires the owner captured with the verified launch.
	if !owner.HasBoundRevocationHook(runID) {
		return nil, installedLaunchMismatch()
	}
	registrationHandle := localDevelopmentRegistrationHandleRef(handle)
	registration, err := s.localAppKernel.Registrations().GetByHandle(ctx, registrationHandle)
	if err != nil {
		return &runtimev1.GetLocalDevelopmentRunAccessResponse{ReasonCode: runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE}, nil
	}
	if registration.SourceClass != localappkernel.SourceClassLocalDevelopment {
		return nil, installedLaunchMismatch()
	}
	s.localAppSessionMu.RLock()
	owned, foreign := false, false
	for _, session := range s.localAppSessions {
		if session.registrationHandle != registrationHandle || session.supervisorRunID != runID {
			continue
		}
		if session.desktopOwner == owner {
			owned = true
		} else if session.desktopOwner != nil && session.desktopOwner.VerifiedDesktopTransport() {
			foreign = true
		}
	}
	s.localAppSessionMu.RUnlock()
	if foreign && !owned {
		return nil, installedLaunchMismatch()
	}
	available, scopeRef, reason := s.localAppRunAccess(ctx, owner, func(session localAppRuntimeSession) bool {
		return session.registrationHandle == registrationHandle && session.supervisorRunID == runID
	})
	return &runtimev1.GetLocalDevelopmentRunAccessResponse{Available: available, ReasonCode: reason, ExecutionScopeRef: scopeRef}, nil
}

// This reads the existing session owner and validates Base admission. It does
// not create/renew sessions, advance work, or derive access from process liveness.
func (s *Service) localAppRunAccess(ctx context.Context, owner *protectedlocal.Connection, matches func(localAppRuntimeSession) bool) (bool, string, runtimev1.ReasonCode) {
	s.localAppSessionMu.RLock()
	candidates := make([]*protectedlocal.LocalAppConnection, 0)
	for connection, session := range s.localAppSessions {
		if session.desktopOwner == owner && matches(session) {
			candidates = append(candidates, connection)
		}
	}
	s.localAppSessionMu.RUnlock()
	currentRef := ""
	uncertain := false
	for _, connection := range candidates {
		_, session, err := s.admitLocalAppIngress(protectedlocal.ContextWithLocalAppConnection(ctx, connection), localappop.IngressStorageJSONRead)
		if err != nil {
			if !errors.Is(err, errLocalDevelopmentSessionRevoked) && !errors.Is(err, errLocalAppAccountGenerationChanged) &&
				!errors.Is(err, errLocalAppRegistrationGenerationChanged) && !errors.Is(err, localappop.ErrSessionInvalid) && !errors.Is(err, localappop.ErrSnapshotStale) {
				uncertain = true
			}
			continue
		}
		if session.desktopOwner != owner || !matches(session) {
			continue
		}
		ref := localAppExecutionScopeRef(session)
		if currentRef != "" && currentRef != ref {
			return false, "", runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE
		}
		currentRef = ref
	}
	if uncertain {
		return false, "", runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE
	}
	if currentRef == "" || !owner.VerifiedDesktopTransport() {
		return false, "", runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED
	}
	return true, currentRef, runtimev1.ReasonCode_ACTION_EXECUTED
}

// The projection is not a bearer or session selector. Its only input is the
// already-admitted session fence. Routine renewal preserves that fence; a new
// session produces a different reference without retaining another ledger.
// @nimi-authority: rule.nimi.runtime.app-surface.run-access-scope-projection
func localAppExecutionScopeRef(session localAppRuntimeSession) string {
	mac := hmac.New(sha256.New, session.handle.SessionProof[:])
	_, _ = mac.Write([]byte("nimi.runtime.host-execution-scope/v1\x00"))
	_, _ = mac.Write(session.handle.SessionID[:])
	_, _ = mac.Write(session.launchCorrelation[:])
	var generation [8]byte
	binary.BigEndian.PutUint64(generation[:], session.runtimeGeneration)
	_, _ = mac.Write(generation[:])
	return "execution_scope_" + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
