package app

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

func (s *Service) ReadLocalAppStorageJson(ctx context.Context, req *runtimev1.ReadLocalAppStorageJsonRequest) (*runtimev1.ReadLocalAppStorageJsonResponse, error) {
	decision, err := s.localAppStorageDecision(ctx, accountservice.LocalAppOperationStorageJSONRead, appstorage.LocalAppJSONReadCapability)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, localAppStorageFailure(appstorage.ErrLocalAppJSONPathInvalid)
	}
	s.localAppStorageMu.RLock()
	document, readErr := appstorage.ReadLocalAppJSON(s.appStorageDataRoot, decision.LocalAppPrincipalID, req.GetRelativePath())
	s.localAppStorageMu.RUnlock()
	if readErr != nil {
		return nil, localAppStorageFailure(readErr)
	}
	return &runtimev1.ReadLocalAppStorageJsonResponse{
		JsonValue:  append([]byte(nil), document.JSONValue...),
		SizeBytes:  document.SizeBytes,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) WriteLocalAppStorageJson(ctx context.Context, req *runtimev1.WriteLocalAppStorageJsonRequest) (*runtimev1.WriteLocalAppStorageJsonResponse, error) {
	decision, err := s.localAppStorageDecision(ctx, accountservice.LocalAppOperationStorageJSONWrite, appstorage.LocalAppJSONWriteCapability)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.localAppStorageMu.Lock()
	document, writeErr := appstorage.WriteLocalAppJSON(s.appStorageDataRoot, decision.LocalAppPrincipalID, req.GetRelativePath(), req.GetJsonValue())
	s.localAppStorageMu.Unlock()
	if writeErr != nil {
		return nil, localAppStorageFailure(writeErr)
	}
	return &runtimev1.WriteLocalAppStorageJsonResponse{
		JsonValue:  append([]byte(nil), document.JSONValue...),
		SizeBytes:  document.SizeBytes,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RemoveLocalAppStorageJson(ctx context.Context, req *runtimev1.RemoveLocalAppStorageJsonRequest) (*runtimev1.RemoveLocalAppStorageJsonResponse, error) {
	decision, err := s.localAppStorageDecision(ctx, accountservice.LocalAppOperationStorageJSONRemove, appstorage.LocalAppJSONWriteCapability)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, localAppStorageFailure(appstorage.ErrLocalAppJSONPathInvalid)
	}
	s.localAppStorageMu.Lock()
	removed, removeErr := appstorage.RemoveLocalAppJSON(s.appStorageDataRoot, decision.LocalAppPrincipalID, req.GetRelativePath())
	s.localAppStorageMu.Unlock()
	if removeErr != nil {
		return nil, localAppStorageFailure(removeErr)
	}
	return &runtimev1.RemoveLocalAppStorageJsonResponse{Removed: removed, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) localAppStorageDecision(ctx context.Context, operation accountservice.LocalAppOperation, capability string) (accountservice.LocalAppCallerDecision, error) {
	if s == nil || strings.TrimSpace(s.appStorageDataRoot) == "" {
		return accountservice.LocalAppCallerDecision{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.Operation != operation || decision.PermissionScope != capability ||
		strings.TrimSpace(decision.LocalAppPrincipalID) == "" || decision.LocalAppPrincipalID != strings.TrimSpace(decision.LocalAppPrincipalID) ||
		decision.ExpiresAt.IsZero() || !s.now().UTC().Before(decision.ExpiresAt.UTC()) {
		return accountservice.LocalAppCallerDecision{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	return decision, nil
}

func localAppStorageFailure(err error) error {
	switch {
	case errors.Is(err, appstorage.ErrLocalAppJSONPathInvalid):
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID)
	case errors.Is(err, appstorage.ErrLocalAppJSONNotFound):
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_STORAGE_ENTRY_NOT_FOUND)
	case errors.Is(err, appstorage.ErrLocalAppJSONQuota):
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_APP_STORAGE_QUOTA_EXCEEDED)
	case errors.Is(err, appstorage.ErrLocalAppJSONValueInvalid):
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	default:
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_APP_STORAGE_UNAVAILABLE)
	}
}
