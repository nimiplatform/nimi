package app

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
)

const desktopHostAppID = "nimi.desktop"

func isDesktopCoreLifecycleController(ctx context.Context) bool {
	meta, ok := envelope.MetadataFromContext(ctx)
	if !ok {
		return false
	}
	return strings.TrimSpace(meta.AppID) == desktopHostAppID &&
		strings.TrimSpace(meta.CallerKind) == "desktop-core"
}

// requireAppLifecycleSession enforces app-session credential validation for
// app-owned lifecycle callers. The desktop host is the product lifecycle
// controller for RuntimeAppService app targets; install/open still go through
// account-inventory and permission gates before mutating or launching anything.
func (s *Service) requireAppLifecycleSession(ctx context.Context, appID string) error {
	if connection, ok := protectedlocal.DesktopConnectionFromContext(ctx); ok {
		origin := connection.Origin()
		if origin.TransportClass == protectedlocal.TransportDesktopControl && origin.HasRole(protectedlocal.RoleLocalAppControl) {
			return nil
		}
	}
	if contextAppID := appIDFromContext(ctx); contextAppID != "" && contextAppID != appID {
		if isDesktopCoreLifecycleController(ctx) {
			return nil
		}
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if isTrustedInternalCaller(ctx, appID) || isDesktopCoreLifecycleController(ctx) {
		return nil
	}
	if s.sessionValidator == nil {
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	sessionID, sessionToken, _ := envelope.ParseSessionFromContext(ctx)
	if reasonCode, ok := s.sessionValidator.ValidateAppSession(appID, sessionID, sessionToken); !ok {
		return grpcerr.WithReasonCode(codes.Unauthenticated, reasonCode)
	}
	return nil
}
