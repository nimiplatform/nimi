package connector

import (
	"context"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
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

func connectorViolatesOAuthManagedUserBoundary(rec ConnectorRecord) bool {
	return normalizeAuthKind(rec.AuthKind) == runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED &&
		rec.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER
}

func connectorVisibleToCaller(rec ConnectorRecord, ownerID string, hasOwner bool) bool {
	if connectorViolatesOAuthManagedUserBoundary(rec) {
		return false
	}
	if rec.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
		return true
	}
	if rec.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
		return true
	}
	return hasOwner && rec.OwnerID == ownerID
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
		ConnectorId:         r.ConnectorID,
		Kind:                r.Kind,
		OwnerType:           r.OwnerType,
		OwnerId:             r.OwnerID,
		Provider:            r.Provider,
		Endpoint:            r.Endpoint,
		Label:               r.Label,
		Status:              r.Status,
		LocalCategory:       r.LocalCategory,
		HasCredential:       r.HasCredential,
		AuthKind:            normalizeAuthKind(r.AuthKind),
		ProviderAuthProfile: r.ProviderAuthProfile,
		CreatedAt:           timestamppb.New(time.UnixMilli(r.CreatedAt)),
		UpdatedAt:           timestamppb.New(time.UnixMilli(r.UpdatedAt)),
	}
}

// emitAudit writes an audit event for connector operations.
func (s *Service) emitAudit(ctx context.Context, operation string, reasonCode runtimev1.ReasonCode, payload map[string]any) {
	if s.audit == nil {
		return
	}
	var payloadStruct *structpb.Struct
	if len(payload) > 0 {
		built, err := structpb.NewStruct(payload)
		if err != nil {
			if s.logger != nil {
				s.logger.Warn("connector audit payload serialization failed", "operation", operation, "error", err)
			}
		} else {
			payloadStruct = built
		}
	}
	traceID := strings.TrimSpace(envelope.ParseTraceIDFromContext(ctx))
	subjectUserID, _ := subjectUserIDFromContext(ctx)
	s.audit.AppendEvent(&runtimev1.AuditEventRecord{
		Domain:        "runtime.connector",
		Operation:     operation,
		SubjectUserId: subjectUserID,
		ReasonCode:    reasonCode,
		TraceId:       traceID,
		Payload:       payloadStruct,
	})
}
