package integration

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const auditDomain = "runtime.integration"

// @nimi-authority: rule.nimi.runtime.rpc-foundations.r001
// operationAudit is the one owner-attributed result record of a sensitive
// Integration mutation. A committed mutation records its result in the same
// Runtime persistence transaction as its rows; an owner refusal records its
// typed reason once. Payloads carry references only: never credentials,
// endpoints, inputs, results, or session material.
type operationAudit struct {
	service   *Service
	ctx       context.Context
	operation string
	decision  accountservice.LocalAppCallerDecision
	bound     bool
	payload   map[string]any
	recorded  bool
}

func (s *Service) beginAudit(ctx context.Context, operation string) *operationAudit {
	return &operationAudit{service: s, ctx: ctx, operation: operation, payload: map[string]any{}}
}

func (a *operationAudit) bind(d accountservice.LocalAppCallerDecision) {
	a.decision = d
	a.bound = true
}

func (a *operationAudit) set(key string, value any) {
	a.payload[key] = value
}

func (a *operationAudit) event(reason runtimev1.ReasonCode, extra map[string]any) *runtimev1.AuditEventRecord {
	fields := make(map[string]any, len(a.payload)+len(extra))
	for key, value := range a.payload {
		fields[key] = value
	}
	for key, value := range extra {
		fields[key] = value
	}
	callerKind := runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED
	if a.bound {
		fields["trust_class"] = string(a.decision.TrustClass)
		callerKind = runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP
		if a.decision.AppID == envelope.ProtectedDesktopAppID {
			callerKind = runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE
		}
	}
	payload, err := structpb.NewStruct(fields)
	if err != nil {
		payload, _ = structpb.NewStruct(map[string]any{"payload_encode_error": "integration audit payload is not encodable"})
	}
	traceID := strings.TrimSpace(envelope.ParseTraceIDFromContext(a.ctx))
	return &runtimev1.AuditEventRecord{
		AppId:         a.decision.AppID,
		SubjectUserId: a.decision.AccountID,
		Domain:        auditDomain,
		Operation:     a.operation,
		ReasonCode:    reason,
		TraceId:       traceID,
		RequestId:     traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
		CallerKind:    callerKind,
		CallerId:      a.decision.RegisteredAppSubject,
		SurfaceId:     "runtime.integration",
	}
}

// commitTx records the successful result inside the owner's transaction.
func (a *operationAudit) commitTx(ctx context.Context, tx *sql.Tx) error {
	return a.service.audit.AppendEventTx(ctx, tx, a.event(runtimev1.ReasonCode_ACTION_EXECUTED, nil))
}

// committed marks the result recorded once its owner transaction committed.
func (a *operationAudit) committed() {
	a.recorded = true
}

// recordBeforeEffect durably records the successful result of an in-memory
// effect that has not been applied yet. The caller applies the effect only
// when this returns nil, so an unrecordable mutation never takes effect.
func (a *operationAudit) recordBeforeEffect() error {
	if err := a.service.audit.AppendEventChecked(a.event(runtimev1.ReasonCode_ACTION_EXECUTED, nil)); err != nil {
		return a.service.auditUnavailable(err)
	}
	a.recorded = true
	return nil
}

// finish records the owner refusal for a mutation that did not commit. It
// runs deferred and never changes the owner's result.
func (a *operationAudit) finish(err error) {
	if a.recorded || err == nil {
		return
	}
	a.recorded = true
	a.recordFailure(a.operation, err)
}

// recordFailure records a typed failure of a follow-up effect.
func (a *operationAudit) recordFailure(operation string, err error) {
	reason, extra := auditFailure(err)
	event := a.event(reason, extra)
	event.Operation = operation
	if writeErr := a.service.audit.AppendRefusal(event); writeErr != nil {
		a.service.logger.Error("Integration refusal was not recorded",
			"operation", operation, "audit_disposition", "unrecorded", "error", writeErr)
	}
}

// notAccepted records an owner refusal of a provider completion that returns
// a normal not-accepted response rather than an error.
func (a *operationAudit) notAccepted() *runtimev1.CompleteIntegrationProviderResponse {
	a.finish(failure(codes.FailedPrecondition, "INTEGRATION_COMPLETION_NOT_ACCEPTED"))
	return &runtimev1.CompleteIntegrationProviderResponse{Accepted: false}
}

// completion finishes the provider completion record: an accepted result was
// recorded with its terminal fact, a refused one is recorded here.
func (a *operationAudit) completion(accepted bool) *runtimev1.CompleteIntegrationProviderResponse {
	if !accepted {
		return a.notAccepted()
	}
	a.committed()
	return &runtimev1.CompleteIntegrationProviderResponse{Accepted: true}
}

// auditUnavailable is the typed failure of a mutation refused because its
// result could not be recorded before the effect.
func (s *Service) auditUnavailable(cause error) error {
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE, cause, grpcerr.ReasonOptions{
		Message:  "INTEGRATION_AUDIT_UNAVAILABLE",
		Metadata: map[string]string{"integration_reason": "INTEGRATION_AUDIT_UNAVAILABLE"},
	})
}

// auditFailure extracts only typed, bounded facts from an owner error; free
// error text never enters the record.
func auditFailure(err error) (runtimev1.ReasonCode, map[string]any) {
	extra := map[string]any{}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		extra["grpc_code"] = codes.Canceled.String()
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, extra
	}
	st, ok := status.FromError(err)
	if !ok {
		extra["grpc_code"] = codes.Internal.String()
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, extra
	}
	extra["grpc_code"] = st.Code().String()
	reason, typed := grpcerr.ExtractReasonCode(err)
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok && boundedReason(metadata["integration_reason"]) {
		extra["integration_reason"] = metadata["integration_reason"]
	} else if boundedReason(st.Message()) {
		extra["integration_reason"] = st.Message()
	}
	if !typed {
		reason = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	return reason, extra
}

func boundedReason(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, char := range value {
		if (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '_' {
			return false
		}
	}
	return true
}
