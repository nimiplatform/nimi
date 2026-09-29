package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// emitAudit writes an audit event for auth operations (K-AUTHSVC-007).
func (s *Service) emitAudit(ctx context.Context, operation string, appID string, subjectUserID string, reasonCode runtimev1.ReasonCode) {
	s.emitAuditWithPayload(ctx, operation, appID, subjectUserID, reasonCode, nil)
}

func (s *Service) emitAuditWithPayload(ctx context.Context, operation string, appID string, subjectUserID string, reasonCode runtimev1.ReasonCode, payload map[string]any) {
	if s.auditStore == nil {
		return
	}
	s.auditStore.AppendEvent(s.authAuditEvent(ctx, operation, appID, subjectUserID, reasonCode, runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED, payload))
}

func (s *Service) authAuditEvent(ctx context.Context, operation string, appID string, subjectUserID string, reasonCode runtimev1.ReasonCode, callerKind runtimev1.CallerKind, payload map[string]any) *runtimev1.AuditEventRecord {
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
	return &runtimev1.AuditEventRecord{
		Domain:        "runtime.auth",
		Operation:     operation,
		AppId:         appID,
		SubjectUserId: subjectUserID,
		ReasonCode:    reasonCode,
		TraceId:       traceID,
		RequestId:     traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payloadStruct,
		CallerKind:    callerKind,
	}
}

// @nimi-authority: rule.nimi.runtime.app-surface.r086
// recordSessionEstablished durably records a session method's success. The
// session already exists in process memory, so a nil error is the owner's
// permission to hand it out; any error obliges the caller to revoke it and
// fail closed rather than complete an unaudited session.
func (s *Service) recordSessionEstablished(ctx context.Context, operation string, appID string, subjectUserID string, payload map[string]any) error {
	if s == nil || s.auditStore == nil {
		return errors.New("runtime audit store is unavailable")
	}
	return s.auditStore.AppendEventChecked(s.authAuditEvent(ctx, operation, appID, subjectUserID, runtimev1.ReasonCode_ACTION_EXECUTED, sessionCallerKind(appID), payload))
}

// recordSessionRefusal records the typed refusal a session method returns.
// It never changes that refusal; an unrecordable refusal is logged.
func (s *Service) recordSessionRefusal(ctx context.Context, operation string, appID string, cause error, payload map[string]any) {
	if s == nil || s.auditStore == nil || cause == nil {
		return
	}
	fields := make(map[string]any, len(payload)+1)
	for key, value := range payload {
		fields[key] = value
	}
	reason, typed := grpcerr.ExtractReasonCode(cause)
	if !typed {
		reason = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	fields["grpc_code"] = status.Code(cause).String()
	if err := s.auditStore.AppendRefusal(s.authAuditEvent(ctx, operation, appID, "", reason, sessionCallerKind(appID), fields)); err != nil && s.logger != nil {
		s.logger.Error("auth session refusal was not recorded", "operation", operation, "audit_disposition", "unrecorded", "error", err)
	}
}

func sessionCallerKind(appID string) runtimev1.CallerKind {
	if appID == envelope.ProtectedDesktopAppID {
		return runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE
	}
	return runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP
}

// sessionReference is a one-way correlation handle for a session identifier;
// it never carries the identifier, its proof, or any bearer material.
func sessionReference(kind string, identifier []byte) string {
	digest := sha256.Sum256(append([]byte(kind+"\x00"), identifier...))
	return kind + "_" + hex.EncodeToString(digest[:12])
}
