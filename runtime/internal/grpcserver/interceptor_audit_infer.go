package grpcserver

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func reasonCodeFromError(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	if st.Code() == codes.OK {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	if value, exists := runtimev1.ReasonCode_value[st.Message()]; exists {
		return runtimev1.ReasonCode(value)
	}
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
}

func inferReasonCodeFromResponse(resp any) (runtimev1.ReasonCode, bool) {
	if resp == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED, false
	}

	type ackResponse interface {
		GetAck() *runtimev1.Ack
	}
	type reasonCodeResponse interface {
		GetReasonCode() runtimev1.ReasonCode
	}

	if item, ok := resp.(ackResponse); ok && item.GetAck() != nil {
		return item.GetAck().GetReasonCode(), true
	}
	if item, ok := resp.(reasonCodeResponse); ok {
		return item.GetReasonCode(), true
	}

	switch value := resp.(type) {
	case *runtimev1.Ack:
		return value.GetReasonCode(), true
	case *runtimev1.InstallAppResponse:
		return reasonCodeFromAppInstallJob(value.GetJob())
	case *runtimev1.GetAppInstallJobResponse:
		return reasonCodeFromAppInstallJob(value.GetJob())
	case *runtimev1.UninstallAppResponse:
		return reasonCodeFromAppInstallJob(value.GetJob())
	case *runtimev1.UpdateAppResponse:
		return reasonCodeFromAppInstallJob(value.GetJob())
	case *runtimev1.HealthRepairAppResponse:
		return reasonCodeFromAppInstallJob(value.GetJob())
	case *runtimev1.PullModelResponse:
		return value.GetReasonCode(), true
	case *runtimev1.CheckModelHealthResponse:
		return value.GetReasonCode(), true
	case *runtimev1.OpenSessionResponse:
		return value.GetReasonCode(), true
	case *runtimev1.RefreshSessionResponse:
		return value.GetReasonCode(), true
	case *runtimev1.OpenExternalPrincipalSessionResponse:
		return value.GetReasonCode(), true
	case *runtimev1.RegisterAppResponse:
		return value.GetReasonCode(), true
	case *runtimev1.RegisterExternalPrincipalResponse:
		return value.GetReasonCode(), true
	default:
		return runtimev1.ReasonCode_ACTION_EXECUTED, false
	}
}

func reasonCodeFromAppInstallJob(job *runtimev1.AppInstallJob) (runtimev1.ReasonCode, bool) {
	if job == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED, false
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return job.GetReasonCode(), true
	}
	switch job.GetState() {
	case runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_FAILED:
		return runtimev1.ReasonCode_APP_INSTALL_INTERNAL, true
	case runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_CANCELLED:
		return runtimev1.ReasonCode_APP_LIFECYCLE_JOB_CANCELLED, true
	default:
		return runtimev1.ReasonCode_ACTION_EXECUTED, true
	}
}

func inferUsage(resp any) (*runtimev1.UsageStats, bool) {
	type usageResponse interface {
		GetUsage() *runtimev1.UsageStats
	}
	item, ok := resp.(usageResponse)
	if !ok {
		return nil, false
	}
	if item.GetUsage() == nil {
		return nil, false
	}
	return cloneUsage(item.GetUsage()), true
}

func inferModelResolved(resp any) (string, bool) {
	type modelResolvedResponse interface {
		GetModelResolved() string
	}
	item, ok := resp.(modelResolvedResponse)
	if !ok {
		return "", false
	}
	modelID := strings.TrimSpace(item.GetModelResolved())
	if modelID == "" {
		return "", false
	}
	return modelID, true
}

// aiExecutionAuditContext carries the K-AUDIT-018 AI execution audit fields that
// originate from the interceptor context (envelope metadata and gRPC result)
// rather than the request body.
type aiExecutionAuditContext struct {
	Provider      string // K-AUDIT-018 provider identity (x-nimi-provider-type), distinct from provider_endpoint
	RequestSource string // K-AUDIT-018 request_source: the caller-kind origin category
	ClientID      string // K-AUDIT-018 client_id == app_instance_id (x-nimi-app-instance-id)
	GRPCCode      string // K-AUDIT-018 grpc_code, populated on failure only
}

// addAIExecutionAuditPayload enriches the audit payload with the AI execution
// fields (K-AUDIT-018) and returns the resolved request_id. Per K-AUDIT-003 the
// baseline request_id equals trace_id, so when the request carries no explicit
// request_id the trace_id is used. The caller sets the returned request_id on the
// top-level AuditEventRecord.request_id field; the payload entry is a compat
// mirror. Non-AI paths are left unchanged and return "".
func addAIExecutionAuditPayload(payload map[string]any, req any, traceID string, execCtx aiExecutionAuditContext) string {
	if payload == nil {
		return ""
	}
	details, ok := inferAIExecutionAuditDetails(req)
	if !ok {
		return ""
	}
	requestID := details.RequestID
	if requestID == "" {
		requestID = strings.TrimSpace(traceID)
	}
	payload["ai_execution"] = true
	payload["trace_id"] = strings.TrimSpace(traceID)
	if requestID != "" {
		payload["request_id"] = requestID
	}
	if details.IdempotencyKey != "" {
		payload["idempotency_key"] = details.IdempotencyKey
	}
	payload["scenario_type"] = details.ScenarioType
	payload["execution_mode"] = details.ExecutionMode
	payload["route_policy"] = details.RoutePolicy
	payload["fallback_policy"] = details.FallbackPolicy
	payload["connector_id"] = details.ConnectorID
	// K-AUDIT-018 fields sourced from interceptor context. provider is the
	// provider identity (provider_endpoint is the separate network endpoint and
	// is already recorded elsewhere in the payload).
	payload["provider"] = strings.TrimSpace(execCtx.Provider)
	payload["request_source"] = strings.TrimSpace(execCtx.RequestSource)
	payload["client_id"] = strings.TrimSpace(execCtx.ClientID)
	if grpcCode := strings.TrimSpace(execCtx.GRPCCode); grpcCode != "" {
		payload["grpc_code"] = grpcCode
	}
	payload["extension_count"] = len(details.ExtensionNamespaces)
	if len(details.ExtensionNamespaces) > 0 {
		namespaces := make([]any, 0, len(details.ExtensionNamespaces))
		for _, namespace := range details.ExtensionNamespaces {
			namespaces = append(namespaces, namespace)
		}
		payload["extension_namespaces"] = namespaces
	}
	return requestID
}

type aiExecutionAuditDetails struct {
	RequestID           string
	IdempotencyKey      string
	ScenarioType        string
	ExecutionMode       string
	RoutePolicy         string
	FallbackPolicy      string
	ConnectorID         string
	ExtensionNamespaces []string
}

func inferAIExecutionAuditDetails(req any) (aiExecutionAuditDetails, bool) {
	switch value := req.(type) {
	case *runtimev1.ExecuteScenarioRequest:
		return aiExecutionAuditDetailsFromScenario(value.GetHead(), value.GetScenarioType(), value.GetExecutionMode(), value.GetExtensions(), "", ""), true
	case *runtimev1.StreamScenarioRequest:
		return aiExecutionAuditDetailsFromScenario(value.GetHead(), value.GetScenarioType(), value.GetExecutionMode(), value.GetExtensions(), "", ""), true
	case *runtimev1.SubmitScenarioJobRequest:
		return aiExecutionAuditDetailsFromScenario(value.GetHead(), value.GetScenarioType(), value.GetExecutionMode(), value.GetExtensions(), value.GetRequestId(), value.GetIdempotencyKey()), true
	default:
		return aiExecutionAuditDetails{}, false
	}
}

func aiExecutionAuditDetailsFromScenario(head *runtimev1.ScenarioRequestHead, scenarioType runtimev1.ScenarioType, executionMode runtimev1.ExecutionMode, extensions []*runtimev1.ScenarioExtension, requestID string, idempotencyKey string) aiExecutionAuditDetails {
	details := aiExecutionAuditDetails{
		RequestID:           strings.TrimSpace(requestID),
		IdempotencyKey:      strings.TrimSpace(idempotencyKey),
		ScenarioType:        scenarioType.String(),
		ExecutionMode:       executionMode.String(),
		ExtensionNamespaces: make([]string, 0, len(extensions)),
	}
	if head != nil {
		details.RoutePolicy = head.GetRoutePolicy().String()
		details.FallbackPolicy = head.GetFallback().String()
		details.ConnectorID = strings.TrimSpace(head.GetConnectorId())
	}
	for _, extension := range extensions {
		namespace := strings.TrimSpace(extension.GetNamespace())
		if namespace == "" {
			continue
		}
		details.ExtensionNamespaces = append(details.ExtensionNamespaces, namespace)
	}
	return details
}
