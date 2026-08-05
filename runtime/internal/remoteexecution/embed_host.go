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

const ProviderHTTPEmbedHostID = "remote.provider-http.embed.v1"

// EmbedDispatchAudit carries only safe immutable composition identities.
type EmbedDispatchAudit struct {
	AppID                string
	AccountID            string
	TraceID              string
	CapabilityContract   string
	ImplementationID     string
	DriverID             string
	DriverDialect        string
	ConnectorGrantID     string
	Provider             string
	ProviderModelID      string
	RemoteModelCatalogID string
	Region               string
}

// EmbedHost opens request-scoped credentials and transports one already-mapped
// embedding request. It never selects a route, grant, provider, model, Driver,
// or fallback.
type EmbedHost interface {
	ExecuteEmbed(context.Context, connector.ConnectorGrantSnapshot, capabilitydriver.CloudEmbedTarget, *capabilitydriver.CloudEmbedMappedRequest, EmbedDispatchAudit) (capabilitydriver.CloudEmbedTransportResponse, error)
}

// ProviderEmbedHost transports provider embedding dialects through nimillm.
// Credentials exist only in ExecuteEmbed's request-scoped target.
type ProviderEmbedHost struct {
	connectors    *connector.ConnectorStore
	transport     *nimillm.CloudProvider
	audit         auditSink
	allowLoopback bool
}

func NewProviderEmbedHost(connectors *connector.ConnectorStore, transport *nimillm.CloudProvider, audit auditSink, allowLoopback bool) *ProviderEmbedHost {
	return &ProviderEmbedHost{connectors: connectors, transport: transport, audit: audit, allowLoopback: allowLoopback}
}

func (h *ProviderEmbedHost) ExecuteEmbed(
	ctx context.Context,
	grant connector.ConnectorGrantSnapshot,
	target capabilitydriver.CloudEmbedTarget,
	request *capabilitydriver.CloudEmbedMappedRequest,
	audit EmbedDispatchAudit,
) (capabilitydriver.CloudEmbedTransportResponse, error) {
	if err := h.recordEmbedDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED); err != nil {
		return capabilitydriver.CloudEmbedTransportResponse{}, err
	}
	if h == nil || h.transport == nil || request == nil || request.ProviderModelID() != target.ProviderModelID() {
		err := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudEmbedTransportResponse{}, h.auditedEmbedError(audit, "error", err)
	}
	remoteTarget, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, grant, target)
	if err != nil {
		return capabilitydriver.CloudEmbedTransportResponse{}, h.auditedEmbedError(audit, "error", err)
	}
	defer clearRequestScopedProviderTarget(remoteTarget)
	vectors, usage, err := h.transport.EmbedWithTarget(ctx, request.ProviderModelID(), request.Inputs(), remoteTarget)
	if err != nil {
		return capabilitydriver.CloudEmbedTransportResponse{}, h.auditedEmbedError(audit, dispatchExit(ctx, "error"), err)
	}
	if err := h.recordEmbedDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED); err != nil {
		return capabilitydriver.CloudEmbedTransportResponse{}, err
	}
	return capabilitydriver.CloudEmbedTransportResponse{Vectors: vectors, Usage: usage}, nil
}

func (h *ProviderEmbedHost) recordEmbedDispatch(audit EmbedDispatchAudit, phase string, reason runtimev1.ReasonCode) error {
	if h == nil || h.audit == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	payload, err := structpb.NewStruct(map[string]any{
		"ai_config_route":          "cloud",
		"capability_contract":      audit.CapabilityContract,
		"implementation_id":        audit.ImplementationID,
		"driver_id":                audit.DriverID,
		"driver_dialect":           audit.DriverDialect,
		"connector_grant_id":       audit.ConnectorGrantID,
		"provider":                 audit.Provider,
		"provider_model_id":        audit.ProviderModelID,
		"remote_model_catalog_id":  audit.RemoteModelCatalogID,
		"provider_region":          audit.Region,
		"remote_execution_host":    ProviderHTTPEmbedHostID,
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
		Operation:     "remote_execution_host.embed." + strings.TrimSpace(phase),
		ReasonCode:    reason,
		TraceId:       traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write remote embedding audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}

func (h *ProviderEmbedHost) auditedEmbedError(audit EmbedDispatchAudit, phase string, cause error) error {
	reason := runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	if errors.Is(cause, context.Canceled) {
		reason = runtimev1.ReasonCode_ACTION_EXECUTED
	} else if errors.Is(cause, context.DeadlineExceeded) {
		reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	} else if extracted, ok := grpcerr.ExtractReasonCode(cause); ok {
		reason = extracted
	}
	if err := h.recordEmbedDispatch(audit, phase, reason); err != nil {
		return err
	}
	return cause
}
