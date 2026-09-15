package account

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.protected-session.r021
// emitAudit writes an owner-attributed audit event for account session
// operations. Payloads must never carry credential, token, or session
// material; only non-secret correlation identifiers are allowed.
func (s *Service) emitAudit(ctx context.Context, operation string, subjectUserID string, reasonCode runtimev1.ReasonCode, payload map[string]any) {
	if s.auditStore == nil {
		return
	}
	var payloadStruct *structpb.Struct
	if len(payload) > 0 {
		built, err := structpb.NewStruct(payload)
		if err != nil {
			if s.logger != nil {
				s.logger.Warn("account audit payload serialization failed", "operation", operation, "error", err)
			}
		} else {
			payloadStruct = built
		}
	}
	traceID := strings.TrimSpace(envelope.ParseTraceIDFromContext(ctx))
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		Domain:        "runtime.account",
		Operation:     operation,
		SubjectUserId: strings.TrimSpace(subjectUserID),
		ReasonCode:    reasonCode,
		TraceId:       traceID,
		Payload:       payloadStruct,
	})
}

// attemptID may only come from a Runtime-owned login attempt that was found
// in the service, never directly from an unvalidated request field.
func (s *Service) emitRejectedAudit(ctx context.Context, operation, subjectUserID string, reason runtimev1.ReasonCode, accountReason runtimev1.AccountReasonCode, attemptID string) {
	payload := map[string]any{"account_reason_code": accountReason.String()}
	if attemptID != "" {
		payload["login_attempt_id"] = attemptID
	}
	s.emitAudit(ctx, operation, subjectUserID, reason, payload)
}
