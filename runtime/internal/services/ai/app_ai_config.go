package ai

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

type appAIConfigCaller struct {
	accountNamespace string
	appID            string
	managesAppOwners bool
}

// GetAppAIConfig reads the complete current App-owned AIConfig. Protected Local
// App calls carry no owner and derive it from the admitted operation decision.
// First-party protected callers retain an exact consistency assertion. Account
// and App identity always come from Runtime-attached caller truth.
func (s *Service) GetAppAIConfig(ctx context.Context, req *runtimev1.GetAppAIConfigRequest) (*runtimev1.GetAppAIConfigResponse, error) {
	caller, err := authenticatedAppAIConfigCaller(ctx)
	if err != nil {
		return nil, err
	}
	owner, err := s.appAIConfigOwnerForCaller(
		ctx,
		caller,
		req.GetOwner(),
		accountservice.LocalAppOperationAppAIConfigRead,
	)
	if err != nil {
		return nil, err
	}
	if s == nil || s.aiConfigStore == nil {
		return nil, appAIConfigPersistenceError(fmt.Errorf("AIConfig store is unavailable"))
	}
	config, found, err := s.aiConfigStore.Get(ctx, caller.accountNamespace, owner)
	if err != nil {
		return nil, appAIConfigPersistenceError(err)
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}
	if _, localApp := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); localApp {
		config = portableLocalAppAIConfigProjection(config)
	}
	return &runtimev1.GetAppAIConfigResponse{Config: config}, nil
}

// OverwriteAppAIConfig atomically replaces the complete App-owned AIConfig for
// an authenticated Nimi owner surface. Protected Local Apps are read-only and
// cannot reach this method through their closed operation contract.
func (s *Service) OverwriteAppAIConfig(ctx context.Context, req *runtimev1.OverwriteAppAIConfigRequest) (*runtimev1.OverwriteAppAIConfigResponse, error) {
	caller, err := authenticatedAppAIConfigCaller(ctx)
	if err != nil {
		return nil, err
	}
	if req == nil || req.GetConfig() == nil {
		return nil, invalidAppAIConfigError()
	}
	if _, localApp := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); localApp {
		return nil, unauthorizedAppAIConfigCallerError()
	}
	owner, err := s.appAIConfigOwnerForCaller(
		ctx,
		caller,
		req.GetConfig().GetOwner(),
		accountservice.LocalAppOperationAppAIConfigRead,
	)
	if err != nil {
		return nil, err
	}
	input, ok := proto.Clone(req.GetConfig()).(*runtimev1.AIConfig)
	if !ok || input == nil {
		return nil, invalidAppAIConfigError()
	}
	input.Owner = owner
	canonical, err := aiconfig.Canonicalize(input)
	if err != nil {
		return nil, invalidAppAIConfigError()
	}
	if s == nil || s.aiConfigStore == nil {
		return nil, appAIConfigPersistenceError(fmt.Errorf("AIConfig store is unavailable"))
	}
	if err := s.aiConfigStore.Overwrite(ctx, caller.accountNamespace, canonical); err != nil {
		return nil, appAIConfigPersistenceError(err)
	}
	return &runtimev1.OverwriteAppAIConfigResponse{Config: canonical}, nil
}

func portableLocalAppAIConfigProjection(config *runtimev1.AIConfig) *runtimev1.AIConfig {
	projected, _ := proto.Clone(config).(*runtimev1.AIConfig)
	return projected
}

func (s *Service) appAIConfigOwnerForCaller(
	ctx context.Context,
	caller appAIConfigCaller,
	asserted *runtimev1.AIConfigOwner,
	expectedLocalOperation accountservice.LocalAppOperation,
) (*runtimev1.AIConfigOwner, error) {
	if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
		if decision.Operation != expectedLocalOperation ||
			decision.AccountID != caller.accountNamespace || decision.AppID != caller.appID {
			return nil, unauthorizedAppAIConfigCallerError()
		}
		// The protected Local App carrier is intentionally owner-free. Accepting
		// even a matching caller assertion would expose a second identity input.
		if asserted != nil {
			return nil, invalidAppAIConfigError()
		}
		return derivedAppAIConfigOwner(caller.appID), nil
	}

	requestedAppID, err := exactAppAIConfigOwner(asserted)
	if err != nil {
		return nil, invalidAppAIConfigError()
	}
	if requestedAppID == caller.appID {
		return asserted, nil
	}
	if !caller.managesAppOwners || s == nil || s.appOwnerRegistry == nil {
		return nil, unauthorizedAppAIConfigCallerError()
	}
	registration, err := s.appOwnerRegistry.GetActiveByAppID(ctx, requestedAppID)
	if err != nil || registration.AppID != requestedAppID {
		return nil, unauthorizedAppAIConfigCallerError()
	}
	return asserted, nil
}

func derivedAppAIConfigOwner(appID string) *runtimev1.AIConfigOwner {
	return &runtimev1.AIConfigOwner{
		Owner: &runtimev1.AIConfigOwner_App{
			App: &runtimev1.AIConfigAppOwner{AppId: appID},
		},
	}
}

func authenticatedAppAIConfigCaller(ctx context.Context) (appAIConfigCaller, error) {
	var caller appAIConfigCaller
	bound := false

	if attached, exists := protectedprincipal.AttachedToContext(ctx); exists {
		principal, valid := protectedprincipal.FromContext(ctx)
		if !valid || principal != attached {
			return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
		}
		candidate, valid := exactAppAIConfigCaller(principal.AccountID, principal.AppID)
		if !valid {
			return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
		}
		caller = candidate
		caller.managesAppOwners = principal.IsDesktopAccountProduct()
		bound = true
	}

	if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
		candidate, valid := exactAppAIConfigCaller(decision.AccountID, decision.AppID)
		if !valid {
			return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
		}
		if bound && candidate != caller {
			return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
		}
		caller = candidate
		bound = true
	}

	if !bound {
		return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
	}
	return caller, nil
}

func exactAppAIConfigCaller(accountNamespace string, appID string) (appAIConfigCaller, bool) {
	if !exactNonEmptyCallerIdentity(accountNamespace) || !exactNonEmptyCallerIdentity(appID) {
		return appAIConfigCaller{}, false
	}
	return appAIConfigCaller{accountNamespace: accountNamespace, appID: appID}, true
}

func exactAppAIConfigOwner(owner *runtimev1.AIConfigOwner) (string, error) {
	if owner == nil {
		return "", fmt.Errorf("AIConfig owner is required")
	}
	typed, ok := owner.GetOwner().(*runtimev1.AIConfigOwner_App)
	if !ok || typed.App == nil || !exactNonEmptyCallerIdentity(typed.App.GetAppId()) {
		return "", fmt.Errorf("AIConfig owner must be one exact App")
	}
	return typed.App.GetAppId(), nil
}

func exactNonEmptyCallerIdentity(value string) bool {
	if value == "" || strings.TrimSpace(value) != value {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func invalidAppAIConfigError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)
}

func unauthorizedAppAIConfigCallerError() error {
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}

func appAIConfigPersistenceError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.Internal,
		runtimev1.ReasonCode_AI_CONFIG_PERSISTENCE_UNAVAILABLE,
		cause,
		grpcerr.ReasonOptions{},
	)
}
