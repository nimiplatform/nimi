// Package remoteexecution owns Remote ExecutionHost lifecycle and transport.
// It consumes an already-authorized immutable composition and never selects a
// route, implementation, provider, model, or fallback.
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
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
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
	ConnectorID          string
	Provider             string
	ProviderModelID      string
	RemoteModelCatalogID string
	Region               string
}

// TextHost is the Remote ExecutionHost seam consumed by Runtime AI. Drivers
// map and normalize; the Host only resolves request-scoped credentials and
// transports one exact request.
type TextHost interface {
	ExecuteText(context.Context, connector.ConnectorRecord, capabilitydriver.CloudTextTarget, *capabilitydriver.CloudTextMappedRequest, TextDispatchAudit) (capabilitydriver.CloudTextTransportResponse, error)
	StreamText(context.Context, connector.ConnectorRecord, capabilitydriver.CloudTextTarget, *capabilitydriver.CloudTextMappedRequest, func(textbehavior.OrderedDelta) error, TextDispatchAudit) (capabilitydriver.CloudTextTransportResponse, error)
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
	connectorRecord connector.ConnectorRecord,
	target capabilitydriver.CloudTextTarget,
	request *capabilitydriver.CloudTextMappedRequest,
	audit TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	remoteTarget, err := h.requestScopedTarget(ctx, audit.AccountID, connectorRecord, target)
	if err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, "error", err)
	}
	// Remove all reachable credential references as soon as transport returns.
	defer clearRequestScopedProviderTarget(remoteTarget)
	if h.transport == nil || request == nil {
		err = grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, "error", err)
	}
	spec := request.Spec()
	if invocation, serialized := request.TextBehavior(); invocation != nil {
		result, err := h.transport.ExecuteTextBehaviorWithTarget(ctx, request.ProviderModelID(), remoteTarget, invocation, serialized, nil)
		if err != nil {
			return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), err)
		}
		if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
			return capabilitydriver.CloudTextTransportResponse{}, err
		}
		return capabilitydriver.CloudTextTransportResponse{Items: result.Items, Usage: result.Usage, FinishReason: result.FinishReason}, nil
	}
	text, toolCalls, usage, finish, err := h.transport.GenerateTextScenarioWithTarget(
		ctx,
		request.ProviderModelID(),
		spec,
		nimillm.ComposeInputText(spec.GetSystemPrompt(), spec.GetInput()),
		remoteTarget,
		request.WireDirectives(),
	)
	if err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), err)
	}
	if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	return capabilitydriver.CloudTextTransportResponse{
		Items: primitiveCloudTextItems(text, toolCalls), Usage: usage, FinishReason: finish,
	}, nil
}

func (h *ProviderTextHost) StreamText(
	ctx context.Context,
	connectorRecord connector.ConnectorRecord,
	target capabilitydriver.CloudTextTarget,
	request *capabilitydriver.CloudTextMappedRequest,
	onDelta func(textbehavior.OrderedDelta) error,
	audit TextDispatchAudit,
) (capabilitydriver.CloudTextTransportResponse, error) {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	remoteTarget, err := h.requestScopedTarget(ctx, audit.AccountID, connectorRecord, target)
	if err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, "error", err)
	}
	defer clearRequestScopedProviderTarget(remoteTarget)
	if h.transport == nil || request == nil || !request.Stream() || onDelta == nil {
		err = grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, "error", err)
	}
	if invocation, serialized := request.TextBehavior(); invocation != nil {
		result, err := h.transport.ExecuteTextBehaviorWithTarget(ctx, request.ProviderModelID(), remoteTarget, invocation, serialized, onDelta)
		if err != nil {
			return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), err)
		}
		if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
			return capabilitydriver.CloudTextTransportResponse{}, err
		}
		return capabilitydriver.CloudTextTransportResponse{Items: result.Items, Usage: result.Usage, FinishReason: result.FinishReason}, nil
	}
	var text strings.Builder
	usage, finish, err := h.transport.StreamGenerateTextScenarioWithTarget(
		ctx,
		request.ProviderModelID(),
		request.Spec(),
		func(part string) error {
			text.WriteString(part)
			return onDelta(textbehavior.OrderedDelta{Kind: textbehavior.OrderedItemText, Text: part})
		},
		remoteTarget,
		request.WireDirectives(),
	)
	if err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), err)
	}
	if text.Len() > 0 {
		if err := onDelta(textbehavior.OrderedDelta{Kind: textbehavior.OrderedItemText, ItemCompleted: true}); err != nil {
			return capabilitydriver.CloudTextTransportResponse{}, err
		}
	}
	if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudTextTransportResponse{}, err
	}
	return capabilitydriver.CloudTextTransportResponse{Items: primitiveCloudTextItems(text.String(), nil), Usage: usage, FinishReason: finish}, nil
}

func primitiveCloudTextItems(text string, calls []*runtimev1.ToolCall) []textbehavior.OrderedItem {
	items := make([]textbehavior.OrderedItem, 0, len(calls)+1)
	if text != "" {
		items = append(items, textbehavior.OrderedItem{Kind: textbehavior.OrderedItemText, Text: text})
	}
	for _, call := range calls {
		items = append(items, textbehavior.OrderedItem{Kind: textbehavior.OrderedItemToolCall, ToolCall: call})
	}
	return items
}

// requestScopedTarget is the only credential opening point. The Connector
// record is an immutable current-account snapshot; only the sealed payload is
// read at dispatch time and it never leaves the transport carrier.
func (h *ProviderTextHost) requestScopedTarget(ctx context.Context, accountID string, connectorRecord connector.ConnectorRecord, target capabilitydriver.CloudTextTarget) (*nimillm.RemoteTarget, error) {
	if h == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, accountID, connectorRecord, target)
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
		"connector_id":             audit.ConnectorID,
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
