package remoteexecution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const ProviderHTTPDecideHostID = "remote.provider-http.decide.v1"

// DecideDispatchAudit carries only safe immutable composition identities.
type DecideDispatchAudit struct {
	AppID                string
	AccountID            string
	TraceID              string
	CapabilityContract   string
	ImplementationID     string
	DriverID             string
	DriverDialect        string
	ConnectorID          string
	Provider             string
	ProviderModelID      string
	RemoteModelCatalogID string
}

// DecideHost opens request-scoped credentials and transports one
// already-mapped text.decide request. It never selects a route, Connector,
// provider, model, Driver, retry, or fallback.
type DecideHost interface {
	ExecuteDecide(context.Context, connector.ConnectorRecord, capabilitydriver.CloudDecideTarget, *capabilitydriver.CloudDecideMappedRequest, DecideDispatchAudit) (capabilitydriver.CloudDecideTransportResponse, error)
}

// ProviderDecideHost transports provider decision dialects through nimillm.
// Credentials exist only in ExecuteDecide's request-scoped target.
type ProviderDecideHost struct {
	connectors    *connector.ConnectorStore
	transport     *nimillm.CloudProvider
	audit         auditSink
	allowLoopback bool
}

func NewProviderDecideHost(connectors *connector.ConnectorStore, transport *nimillm.CloudProvider, audit auditSink, allowLoopback bool) *ProviderDecideHost {
	return &ProviderDecideHost{connectors: connectors, transport: transport, audit: audit, allowLoopback: allowLoopback}
}

func (h *ProviderDecideHost) ExecuteDecide(
	ctx context.Context,
	connectorRecord connector.ConnectorRecord,
	target capabilitydriver.CloudDecideTarget,
	request *capabilitydriver.CloudDecideMappedRequest,
	audit DecideDispatchAudit,
) (capabilitydriver.CloudDecideTransportResponse, error) {
	if err := h.recordDecideDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED); err != nil {
		return capabilitydriver.CloudDecideTransportResponse{}, err
	}
	if h.transport == nil || request == nil || request.ProviderModelID() != target.ProviderModelID() {
		err := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudDecideTransportResponse{}, h.auditedDecideError(audit, "error", err)
	}
	remoteTarget, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, connectorRecord, target)
	if err != nil {
		return capabilitydriver.CloudDecideTransportResponse{}, h.auditedDecideError(audit, "error", err)
	}
	defer clearRequestScopedProviderTarget(remoteTarget)
	body, err := h.transport.DecideWithTarget(ctx, request.ProviderModelID(), request.Body(), remoteTarget)
	if err != nil {
		return capabilitydriver.CloudDecideTransportResponse{}, h.auditedDecideError(audit, dispatchExit(ctx, "error"), err)
	}
	if err := h.recordDecideDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED); err != nil {
		return capabilitydriver.CloudDecideTransportResponse{}, err
	}
	return capabilitydriver.CloudDecideTransportResponse{Body: body}, nil
}

func (h *ProviderDecideHost) recordDecideDispatch(audit DecideDispatchAudit, phase string, reason runtimev1.ReasonCode) error {
	if h == nil || h.audit == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	payload, err := structpb.NewStruct(map[string]any{
		"ai_config_route":          "cloud",
		"capability_contract":      audit.CapabilityContract,
		"implementation_id":        audit.ImplementationID,
		"driver_id":                audit.DriverID,
		"driver_dialect":           audit.DriverDialect,
		"connector_id":             audit.ConnectorID,
		"provider":                 audit.Provider,
		"provider_model_id":        audit.ProviderModelID,
		"remote_model_catalog_id":  audit.RemoteModelCatalogID,
		"remote_execution_host":    ProviderHTTPDecideHostID,
		"dispatch_phase":           phase,
		"cancel_semantics":         "best_effort_local_wait_and_transport",
		"provider_stop_guaranteed": false,
		"secret_material":          "absent",
	})
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	traceID := strings.TrimSpace(audit.TraceID)
	if traceID == "" {
		traceID = ulid.Make().String()
	}
	if err := h.audit.AppendEventChecked(&runtimev1.AuditEventRecord{
		AppId:         strings.TrimSpace(audit.AppID),
		SubjectUserId: strings.TrimSpace(audit.AccountID),
		Domain:        "runtime.ai",
		Operation:     "remote_execution_host.decide." + strings.TrimSpace(phase),
		ReasonCode:    reason,
		TraceId:       traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write remote decision audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}

func (h *ProviderDecideHost) auditedDecideError(audit DecideDispatchAudit, phase string, cause error) error {
	reason := runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	if errors.Is(cause, context.Canceled) {
		reason = runtimev1.ReasonCode_ACTION_EXECUTED
	} else if errors.Is(cause, context.DeadlineExceeded) {
		reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	} else if extracted, ok := grpcerr.ExtractReasonCode(cause); ok {
		reason = extracted
	}
	if err := h.recordDecideDispatch(audit, phase, reason); err != nil {
		return err
	}
	return cause
}
