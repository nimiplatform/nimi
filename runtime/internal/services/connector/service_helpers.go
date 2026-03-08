package connector

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func (s *Service) internalProviderError(operation string, err error) error {
	if err != nil {
		s.logger.Error("connector service internal error", "operation", operation, "error", err)
	} else {
		s.logger.Error("connector service internal error", "operation", operation)
	}
	return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
		ActionHint: "retry_or_check_runtime_logs",
	})
}

func subjectUserIDFromContext(ctx context.Context) (string, bool) {
	identity := authn.IdentityFromContext(ctx)
	if identity == nil {
		return "", false
	}
	subject := strings.TrimSpace(identity.SubjectUserID)
	if subject == "" {
		return "", false
	}
	return subject, true
}

func requireSubjectUserID(ctx context.Context) (string, error) {
	subject, ok := subjectUserIDFromContext(ctx)
	if !ok {
		return "", grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	return subject, nil
}

func defaultManagedConnectorLabel(provider string) string {
	trimmed := strings.TrimSpace(provider)
	if trimmed == "" {
		return "Managed Connector"
	}
	if len(trimmed) == 1 {
		return "Managed " + strings.ToUpper(trimmed)
	}
	return "Managed " + strings.ToUpper(trimmed[:1]) + trimmed[1:]
}

func recordToProto(r ConnectorRecord) *runtimev1.Connector {
	return &runtimev1.Connector{
		ConnectorId:   r.ConnectorID,
		Kind:          r.Kind,
		OwnerType:     r.OwnerType,
		OwnerId:       r.OwnerID,
		Provider:      r.Provider,
		Endpoint:      r.Endpoint,
		Label:         r.Label,
		Status:        r.Status,
		LocalCategory: r.LocalCategory,
		HasCredential: r.HasCredential,
		CreatedAt:     r.CreatedAt,
		UpdatedAt:     r.UpdatedAt,
	}
}
