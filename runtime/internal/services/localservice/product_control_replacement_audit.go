package localservice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	productControlAuditDomain    = "runtime.product_control"
	productControlAuditOperation = "data_root.replace"
)

// dataRootReplacementEvent is the owner-attributed result of one data-root
// replacement request. It carries Runtime-minted activation identities only,
// never the user-selected filesystem paths.
func dataRootReplacementEvent(ctx context.Context, reason runtimev1.ReasonCode, fields map[string]any) *runtimev1.AuditEventRecord {
	payload, err := structpb.NewStruct(fields)
	if err != nil {
		payload = nil
	}
	traceID := strings.TrimSpace(envelope.ParseTraceIDFromContext(ctx))
	return &runtimev1.AuditEventRecord{
		AppId:      envelope.ProtectedDesktopAppID,
		Domain:     productControlAuditDomain,
		Operation:  productControlAuditOperation,
		ReasonCode: reason,
		TraceId:    traceID,
		RequestId:  traceID,
		Timestamp:  timestamppb.New(time.Now().UTC()),
		Payload:    payload,
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		SurfaceId:  "runtime.product_control",
	}
}

// commitRecordedDataRootReplacement writes the activation record inside the
// audit transaction that records it (auditlog.CommitRecorded): an
// unrecordable replacement is never activated and a failed write leaves no
// record. committed reports whether the activation record was written; when it
// is true and err is non-nil only the audit commit failed after activation.
func (s *Service) commitRecordedDataRootReplacement(ctx context.Context, previousActivationID string, nextActivationID string, write func() error) (bool, error) {
	if s.auditStore == nil {
		return false, fmt.Errorf("%w: runtime audit store is unavailable", auditlog.ErrUnrecorded)
	}
	return s.auditStore.CommitRecorded(dataRootReplacementEvent(ctx, runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"disposition":                   productControlActivationReplacedReason,
		"previous_root_activation_id":   previousActivationID,
		"root_activation_id":            nextActivationID,
		"restart_required_for_new_root": true,
	}), write)
}

// recordDataRootReplacementRefusal records a replacement the owner declined.
// It never changes the owner's result; an unrecordable refusal is logged.
func (s *Service) recordDataRootReplacementRefusal(ctx context.Context, disposition string, cause error) {
	if s == nil || s.auditStore == nil {
		return
	}
	fields := map[string]any{"disposition": disposition}
	if cause != nil && errors.Is(cause, auditlog.ErrUnrecorded) {
		fields["audit_disposition"] = "unrecorded"
	}
	if err := s.auditStore.AppendRefusal(dataRootReplacementEvent(ctx, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, fields)); err != nil && s.logger != nil {
		s.logger.Error("data-root replacement refusal was not recorded", "disposition", disposition, "audit_disposition", "unrecorded", "error", err)
	}
}
