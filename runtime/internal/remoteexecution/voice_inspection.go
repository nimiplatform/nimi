package remoteexecution

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (h *ProviderMediaHost) InspectVoiceAsset(ctx context.Context, record connector.ConnectorRecord, target capabilitydriver.CloudMediaTarget, request *capabilitydriver.CloudVoiceInspectionMappedRequest, audit MediaDispatchAudit) (capabilitydriver.CloudVoiceWorkflowTransportResponse, bool, error) {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, false, err
	}
	if request == nil || request.Provider() != target.Provider() || target.CapabilityContract() != "voice.create" {
		err := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, false, h.auditedError(audit, "error", err)
	}
	remote, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, record, target)
	if err != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, false, h.auditedError(audit, "error", err)
	}
	defer clearRequestScopedProviderTarget(remote)
	result, found, err := nimillm.InspectProviderVoiceAdapter(ctx, request.Adapter(), request.Provider(), request.ProviderVoiceRef(), nimillm.MediaAdapterConfig{
		BaseURL: remote.Endpoint, APIKey: remote.APIKey, Headers: cloneRemoteHeaders(remote.Headers), AllowLoopbackEndpoint: remote.AllowLoopback,
	})
	if err != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, false, h.auditedError(audit, dispatchExit(ctx, "error"), err)
	}
	if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, false, err
	}
	response := capabilitydriver.CloudVoiceWorkflowTransportResponse{ProviderVoiceRef: result.ProviderVoiceRef}
	if !result.ExpiresAt.IsZero() {
		response.ExpiresAt = timestamppb.New(result.ExpiresAt)
	}
	return response, found, nil
}
