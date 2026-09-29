package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const developmentAuditDomain = "runtime.development"

// developerModeAuditEvent is the owner-attributed result of one Desktop
// developer-mode request. It carries only the requested and committed mode.
func developerModeAuditEvent(ctx context.Context, reason runtimev1.ReasonCode, fields map[string]any) *runtimev1.AuditEventRecord {
	payload, err := structpb.NewStruct(fields)
	if err != nil {
		payload = nil
	}
	traceID := strings.TrimSpace(envelope.ParseTraceIDFromContext(ctx))
	return &runtimev1.AuditEventRecord{
		AppId:      envelope.ProtectedDesktopAppID,
		Domain:     developmentAuditDomain,
		Operation:  "developer_mode.set",
		ReasonCode: reason,
		TraceId:    traceID,
		RequestId:  traceID,
		Timestamp:  timestamppb.New(time.Now().UTC()),
		Payload:    payload,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		SurfaceId:  "runtime.development",
	}
}

// commitDeveloperMode writes the mode inside the audit transaction that
// records it (auditlog.CommitRecorded). An unrecordable change therefore never
// happens and a failed write leaves no record.
func (s *Service) commitDeveloperMode(ctx context.Context, enabled bool) (localDevelopmentMode, bool, error) {
	return s.localDevelopment.SetDeveloperModeCommitted(ctx, enabled, func(next localDevelopmentMode, write func() error) (bool, error) {
		if s.audit == nil {
			return false, fmt.Errorf("%w: runtime audit store is unavailable", auditlog.ErrUnrecorded)
		}
		return s.audit.CommitRecorded(developerModeAuditEvent(ctx, runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
			"enabled":  next.Enabled,
			"revision": float64(next.Revision),
		}), write)
	})
}

// recordDeveloperModeRefusal records the typed refusal of a developer-mode
// request that did not change the mode; it never alters that refusal.
func (s *Service) recordDeveloperModeRefusal(ctx context.Context, req *runtimev1.SetDeveloperModeRequest, cause error) {
	if s == nil || s.audit == nil || cause == nil {
		return
	}
	reason, typed := grpcerr.ExtractReasonCode(cause)
	if !typed {
		reason = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	fields := map[string]any{"grpc_code": status.Code(cause).String()}
	if req != nil {
		fields["enabled"] = req.GetEnabled()
	}
	if err := s.audit.AppendRefusal(developerModeAuditEvent(ctx, reason, fields)); err != nil {
		s.ownerLogger().Error("developer-mode refusal was not recorded", "audit_disposition", "unrecorded", "error", err)
	}
}

// developerModeAuditFailure is the typed failure of a mode change refused
// because its result could not be recorded before the write.
func developerModeAuditFailure(cause error) error {
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, cause, grpcerr.ReasonOptions{
		Message:  "developer mode change could not be recorded",
		Metadata: map[string]string{"audit_disposition": "unrecorded"},
	})
}

func isUnrecordedAudit(err error) bool {
	return errors.Is(err, auditlog.ErrUnrecorded)
}

func (s *Service) ownerLogger() *slog.Logger {
	if s != nil && s.logger != nil {
		return s.logger
	}
	return slog.Default()
}
