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
)

type appAIConfigCaller struct {
	accountNamespace string
	appID            string
}

// GetAppAIConfig reads the complete current App-owned AIConfig. Request owner
// is only a consistency assertion: account and App identity always come from
// Runtime-attached caller truth.
func (s *Service) GetAppAIConfig(ctx context.Context, req *runtimev1.GetAppAIConfigRequest) (*runtimev1.GetAppAIConfigResponse, error) {
	caller, err := authenticatedAppAIConfigCaller(ctx)
	if err != nil {
		return nil, err
	}
	owner := req.GetOwner()
	requestedAppID, err := exactAppAIConfigOwner(owner)
	if err != nil {
		return nil, invalidAppAIConfigError()
	}
	if requestedAppID != caller.appID {
		return nil, unauthorizedAppAIConfigCallerError()
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
	return &runtimev1.GetAppAIConfigResponse{Config: config}, nil
}

// OverwriteAppAIConfig atomically replaces the complete App-owned AIConfig.
// It deliberately exposes no revision, partial mutation, readiness, or
// machine-local binding surface.
func (s *Service) OverwriteAppAIConfig(ctx context.Context, req *runtimev1.OverwriteAppAIConfigRequest) (*runtimev1.OverwriteAppAIConfigResponse, error) {
	caller, err := authenticatedAppAIConfigCaller(ctx)
	if err != nil {
		return nil, err
	}
	if req == nil || req.GetConfig() == nil {
		return nil, invalidAppAIConfigError()
	}
	requestedAppID, err := exactAppAIConfigOwner(req.GetConfig().GetOwner())
	if err != nil {
		return nil, invalidAppAIConfigError()
	}
	if requestedAppID != caller.appID {
		return nil, unauthorizedAppAIConfigCallerError()
	}
	canonical, err := aiconfig.Canonicalize(req.GetConfig())
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
