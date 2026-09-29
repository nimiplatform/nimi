package account

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// @nimi-authority: rule.nimi.runtime.protected-session.r021
// emitAudit writes an owner-attributed audit event for account session
// operations. Payloads must never carry credential, token, or session
// material; only non-secret correlation identifiers are allowed.
func (s *Service) auditEvent(ctx context.Context, operation string, subjectUserID string, reasonCode runtimev1.ReasonCode, payload map[string]any) *runtimev1.AuditEventRecord {
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
	return &runtimev1.AuditEventRecord{
		Domain:        "runtime.account",
		Timestamp:     timestamppb.New(s.now().UTC()),
		Operation:     operation,
		SubjectUserId: strings.TrimSpace(subjectUserID),
		ReasonCode:    reasonCode,
		TraceId:       traceID,
		Payload:       payloadStruct,
	}
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

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r001
func (s *Service) commitRecorded(ctx context.Context, operation, subject string, payload map[string]any, commit func() error) (bool, error) {
	if s.auditStore == nil {
		return false, auditlog.ErrUnrecorded
	}
	committed, err := s.auditStore.CommitRecorded(s.auditEvent(ctx, operation, subject, runtimev1.ReasonCode_ACTION_EXECUTED, payload), commit)
	if committed {
		s.setAuditDiagnostic(err)
	}
	return committed, err
}

func (s *Service) setAuditDiagnostic(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auditDiagnostic = auditlog.CommittedDiagnostic(err)
	if err != nil {
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_ACCOUNT_STATUS, s.stateReason)
	}
}

func (s *Service) emitAudit(ctx context.Context, operation, subject string, reason runtimev1.ReasonCode, payload map[string]any) {
	var err error
	if s.auditStore == nil {
		err = auditlog.ErrUnrecorded
	} else {
		event := s.auditEvent(ctx, operation, subject, reason, payload)
		if reason == runtimev1.ReasonCode_ACTION_EXECUTED {
			err = s.auditStore.AppendEventChecked(event)
		} else {
			err = s.auditStore.AppendRefusal(event)
		}
	}
	if err != nil {
		s.logger.Error("account audit result unrecorded", "operation", operation, "error", err)
		if reason == runtimev1.ReasonCode_ACTION_EXECUTED {
			s.setAuditDiagnostic(err)
		}
	}
}
