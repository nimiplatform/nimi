// Package remoteexecution owns Remote ExecutionHost lifecycle and transport.
// It consumes an already-authorized immutable composition and never selects a
// route, grant, implementation, provider, model, or fallback.
package remoteexecution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const ProviderHTTPTextHostID = "remote.provider-http.text.v1"

// TextDispatchAudit carries only safe immutable composition identities.
type TextDispatchAudit struct {
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

// TextHost is the Remote ExecutionHost seam consumed by Runtime AI. Drivers
// map and normalize; the Host only resolves request-scoped credentials and
// transports one exact request.
type TextHost interface {
	ExecuteText(context.Context, connector.ConnectorGrantSnapshot, capabilitydriver.CloudTextTarget, *capabilitydriver.CloudTextMappedRequest, TextDispatchAudit) (capabilitydriver.CloudTextTransportResponse, error)
	StreamText(context.Context, connector.ConnectorGrantSnapshot, capabilitydriver.CloudTextTarget, *capabilitydriver.CloudTextMappedRequest, func(string) error, TextDispatchAudit) (capabilitydriver.CloudTextTransportResponse, error)
}

type auditSink interface {
	AppendEventChecked(*runtimev1.AuditEventRecord) error
}

// ProviderTextHost transports existing provider dialects through nimillm while
// keeping credentials confined to one method invocation.
type ProviderTextHost struct {
	connectors    *connector.ConnectorStore
	transport     *nimillm.CloudProvider
	audit         auditSink
	allowLoopback bool
}

func NewProviderTextHost(connectors *connector.ConnectorStore, transport *nimillm.CloudProvider, audit auditSink, allowLoopback bool) *ProviderTextHost {
	return &ProviderTextHost{connectors: connectors, transport: transport, audit: audit, allowLoopback: allowLoopback}
}

func (h *ProviderTextHost) ExecuteText(
	ctx context.Context,
	grant connector.ConnectorGrantSnapshot,
	target capabilitydriver.CloudTextTarget,
	request *capabilitydriver.CloudTextMappedRequest,
	audit TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	remoteTarget, err := h.requestScopedTarget(ctx, grant, target)
	if err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, "error", err)
	}
	// Remove all reachable credential references as soon as transport returns.
	defer func() {
		remoteTarget.APIKey = ""
		remoteTarget.Headers = nil
	}()
	if h.transport == nil || request == nil {
		err = grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, "error", err)
	}
	spec := request.Spec()
	text, toolCalls, usage, finish, err := h.transport.GenerateTextScenarioWithTarget(
		ctx,
		request.ProviderModelID(),
		spec,
		nimillm.ComposeInputText(spec.GetSystemPrompt(), spec.GetInput()),
		remoteTarget,
	)
	if err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), err)
	}
	if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	return capabilitydriver.CloudTextTransportResponse{
		Text: text, ToolCalls: toolCalls, Usage: usage, FinishReason: finish,
	}, nil
}

func (h *ProviderTextHost) StreamText(
	ctx context.Context,
	grant connector.ConnectorGrantSnapshot,
	target capabilitydriver.CloudTextTarget,
	request *capabilitydriver.CloudTextMappedRequest,
	onDelta func(string) error,
	audit TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	remoteTarget, err := h.requestScopedTarget(ctx, grant, target)
	if err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, "error", err)
	}
	defer func() {
		remoteTarget.APIKey = ""
		remoteTarget.Headers = nil
	}()
	if h.transport == nil || request == nil || !request.Stream() || onDelta == nil {
		err = grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, "error", err)
	}
	usage, finish, err := h.transport.StreamGenerateTextScenarioWithTarget(
		ctx,
		request.ProviderModelID(),
		request.Spec(),
		onDelta,
		remoteTarget,
	)
	if err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), err)
	}
	if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	return capabilitydriver.CloudTextTransportResponse{Usage: usage, FinishReason: finish, Streamed: true}, nil
}

// requestScopedTarget is the only credential opening point. The grant and
// connector records are immutable snapshots; only the sealed payload is read
// at dispatch time, and it is never returned outside the transport carrier.
func (h *ProviderTextHost) requestScopedTarget(ctx context.Context, grant connector.ConnectorGrantSnapshot, target capabilitydriver.CloudTextTarget) (*nimillm.RemoteTarget, error) {
	if h == nil || h.connectors == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	grantRecord := grant.Grant
	connectorRecord := grant.Connector
	ownerConsistent := connectorRecord.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER && connectorRecord.OwnerID == grantRecord.AccountID
	if grantRecord.GrantID == "" || grantRecord.AccountID == "" || grantRecord.ConnectorID == "" ||
		grantRecord.ConnectorID != connectorRecord.ConnectorID || !ownerConsistent ||
		connectorRecord.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED ||
		connectorRecord.Provider != target.Provider() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_GRANT_SELECTION_REQUIRED)
	}
	secretPayload, err := h.connectors.LoadSecretPayload(connectorRecord.ConnectorID)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "connector credential custody is unavailable"})
	}
	credential := connector.ResolveCredential(connectorRecord, secretPayload)
	// Drop the sealed representation before any transport object is formed.
	secretPayload = ""
	if credential.APIKey == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	endpoint := strings.TrimSpace(connectorRecord.Endpoint)
	if endpoint == "" {
		endpoint = connector.ResolveEndpoint(connectorRecord.Provider, "")
	}
	if err := endpointsec.ValidateEndpoint(ctx, endpoint, h.allowLoopback); err != nil {
		credential.APIKey = ""
		credential.Headers = nil
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{Message: "connector endpoint is not allowed"})
	}
	return &nimillm.RemoteTarget{
		ProviderType:         target.Provider(),
		ProviderModelID:      target.ProviderModelID(),
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ConnectorID:          connectorRecord.ConnectorID,
		Endpoint:             endpoint,
		APIKey:               credential.APIKey,
		Headers:              credential.Headers,
		AllowLoopback:        h.allowLoopback,
	}, nil
}

func (h *ProviderTextHost) recordDispatch(audit TextDispatchAudit, phase string, reason runtimev1.ReasonCode, providerStopGuaranteed bool) error {
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
		"remote_execution_host":    ProviderHTTPTextHostID,
		"dispatch_phase":           phase,
		"cancel_semantics":         "best_effort_local_wait_and_transport",
		"provider_stop_guaranteed": providerStopGuaranteed,
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
		Operation:     "remote_execution_host." + strings.TrimSpace(phase),
		ReasonCode:    reason,
		TraceId:       traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write remote execution audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}

func (h *ProviderTextHost) auditedError(audit TextDispatchAudit, phase string, cause error) error {
	if err := h.recordDispatch(audit, phase, reasonCode(cause), false); err != nil {
		return err
	}
	return cause
}

func dispatchExit(ctx context.Context, defaultPhase string) string {
	if ctx != nil && ctx.Err() != nil {
		return "canceled"
	}
	return defaultPhase
}

func reasonCode(err error) runtimev1.ReasonCode {
	if errors.Is(err, context.Canceled) {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		return reason
	}
	return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
}
