package auth

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/protobuf/types/known/structpb"
)

// emitAudit writes an audit event for auth operations (K-AUTHSVC-007).
func (s *Service) emitAudit(ctx context.Context, operation string, appID string, subjectUserID string, reasonCode runtimev1.ReasonCode) {
	s.emitAuditWithPayload(ctx, operation, appID, subjectUserID, reasonCode, nil)
}

func (s *Service) emitAuditWithPayload(ctx context.Context, operation string, appID string, subjectUserID string, reasonCode runtimev1.ReasonCode, payload map[string]any) {
	if s.auditStore == nil {
		return
	}
	var payloadStruct *structpb.Struct
	if len(payload) > 0 {
		built, err := structpb.NewStruct(payload)
		if err != nil {
			if s.logger != nil {
				s.logger.Warn("auth audit payload serialization failed", "operation", operation, "error", err)
			}
		} else {
			payloadStruct = built
		}
	}
	traceID := strings.TrimSpace(envelope.ParseTraceIDFromContext(ctx))
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		Domain:        "runtime.auth",
		Operation:     operation,
		AppId:         appID,
		SubjectUserId: subjectUserID,
		ReasonCode:    reasonCode,
		TraceId:       traceID,
		Payload:       payloadStruct,
	})
}
