package remoteexecution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
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

const ProviderHTTPMediaHostID = "remote.provider-http.media.v1"

// MediaDispatchAudit carries only safe immutable composition identities.
type MediaDispatchAudit struct {
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

// MediaHost is the Remote ExecutionHost seam consumed by Runtime AI. Drivers
// map and normalize; the Host only opens request-scoped credentials, transports
// one exact request, privately polls remote tasks, forwards streams, and makes
// best-effort cancellation attempts.
type MediaHost interface {
	ExecuteMedia(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudMediaMappedRequest, MediaDispatchAudit) (capabilitydriver.CloudMediaTransportResponse, error)
	StreamSpeech(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudMediaMappedRequest, func(capabilitydriver.CloudMediaStreamChunk) error, MediaDispatchAudit) (capabilitydriver.CloudMediaTransportResponse, error)
	ExecuteVoiceWorkflow(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudVoiceWorkflowMappedRequest, MediaDispatchAudit) (capabilitydriver.CloudVoiceWorkflowTransportResponse, error)
	DeleteVoiceAsset(context.Context, connector.ConnectorRecord, capabilitydriver.CloudMediaTarget, *capabilitydriver.CloudVoiceDeleteMappedRequest, MediaDispatchAudit) error
}

// ProviderMediaHost transports existing nimillm provider dialects. Its
// transport is configured without provider credentials; each dispatch opens
// exactly one Runtime-resolved current-account Connector secret and clears it before return.
type ProviderMediaHost struct {
	connectors    *connector.ConnectorStore
	transport     *nimillm.CloudProvider
	audit         auditSink
	allowLoopback bool
}

func NewProviderMediaHost(connectors *connector.ConnectorStore, transport *nimillm.CloudProvider, audit auditSink, allowLoopback bool) *ProviderMediaHost {
	return &ProviderMediaHost{connectors: connectors, transport: transport, audit: audit, allowLoopback: allowLoopback}
}

func (h *ProviderMediaHost) ExecuteMedia(
	ctx context.Context,
	connectorRecord connector.ConnectorRecord,
	target capabilitydriver.CloudMediaTarget,
	request *capabilitydriver.CloudMediaMappedRequest,
	audit MediaDispatchAudit,
) (capabilitydriver.CloudMediaTransportResponse, error) {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudMediaTransportResponse{}, err
	}
	if h == nil || h.transport == nil || request == nil || request.StreamMode() != capabilitydriver.CloudMediaStreamNone {
		err := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, "error", err)
	}
	remoteTarget, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, connectorRecord, target)
	if err != nil {
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, "error", err)
	}
	defer clearRequestScopedProviderTarget(remoteTarget)
	pollState := &privateMediaPollState{}
	result, err := h.transport.ExecuteMediaAdapter(
		ctx,
		request.Adapter(),
		strings.TrimSpace(audit.TraceID),
		request.Request(),
		request.ProviderModelID(),
		remoteTarget,
		pollState,
	)
	if err != nil {
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), err)
	}
	if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		closeNimiArtifactBodies(result.ArtifactBodies)
		return capabilitydriver.CloudMediaTransportResponse{}, err
	}
	bodies, err := cloudArtifactBodiesFromNimi(result.ArtifactBodies)
	if err != nil {
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, "error", err)
	}
	return capabilitydriver.CloudMediaTransportResponse{
		Artifacts:      result.Artifacts,
		ArtifactBodies: bodies,
		Usage:          result.Usage,
		FinishReason:   runtimev1.FinishReason_FINISH_REASON_STOP,
	}, nil
}

func cloudArtifactBodiesFromNimi(values map[string]*nimillm.MediaArtifactBody) (map[string]*capabilitydriver.ArtifactBody, error) {
	if len(values) == 0 {
		return nil, nil
	}
	out := make(map[string]*capabilitydriver.ArtifactBody, len(values))
	for artifactID, body := range values {
		if strings.TrimSpace(artifactID) == "" || body == nil || (len(body.Bytes) == 0) == (body.Stream == nil) {
			closeNimiArtifactBodies(values)
			capabilitydriver.CloseArtifactBodies(out)
			return nil, fmt.Errorf("provider artifact body handoff is invalid")
		}
		var (
			converted *capabilitydriver.ArtifactBody
			err       error
		)
		if body.Stream != nil {
			converted, err = capabilitydriver.NewIncrementalArtifactBody(body.Stream)
			body.Stream = nil
		} else {
			converted, err = capabilitydriver.NewBoundedArtifactBody(body.Bytes)
		}
		if err != nil {
			closeNimiArtifactBodies(values)
			capabilitydriver.CloseArtifactBodies(out)
			return nil, err
		}
		out[artifactID] = converted
	}
	return out, nil
}

func closeNimiArtifactBodies(values map[string]*nimillm.MediaArtifactBody) {
	for _, body := range values {
		if body != nil && body.Stream != nil {
			_ = body.Stream.Close()
			body.Stream = nil
		}
	}
}

func (h *ProviderMediaHost) DeleteVoiceAsset(
	ctx context.Context,
	connectorRecord connector.ConnectorRecord,
	target capabilitydriver.CloudMediaTarget,
	request *capabilitydriver.CloudVoiceDeleteMappedRequest,
	audit MediaDispatchAudit,
) error {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return err
	}
	if request == nil || request.Provider() != target.Provider() || request.ProviderVoiceRef() == "" {
		return h.auditedError(audit, "error", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID))
	}
	remoteTarget, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, connectorRecord, target)
	if err != nil {
		return h.auditedError(audit, "error", err)
	}
	defer clearRequestScopedProviderTarget(remoteTarget)
	if err := nimillm.DeleteProviderVoiceAdapter(ctx, request.Adapter(), request.Provider(), request.ProviderVoiceRef(), nimillm.MediaAdapterConfig{
		BaseURL:               remoteTarget.Endpoint,
		APIKey:                remoteTarget.APIKey,
		Headers:               cloneRemoteHeaders(remoteTarget.Headers),
		AllowLoopbackEndpoint: remoteTarget.AllowLoopback,
	}); err != nil {
		return h.auditedError(audit, dispatchExit(ctx, "error"), err)
	}
	return h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false)
}

func (h *ProviderMediaHost) ExecuteVoiceWorkflow(
	ctx context.Context,
	connectorRecord connector.ConnectorRecord,
	target capabilitydriver.CloudMediaTarget,
	request *capabilitydriver.CloudVoiceWorkflowMappedRequest,
	audit MediaDispatchAudit,
) (capabilitydriver.CloudVoiceWorkflowTransportResponse, error) {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, err
	}
	if request == nil || request.Adapter() == "" || request.Provider() != target.Provider() ||
		target.CapabilityContract() != "voice.create" {
		err := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, h.auditedError(audit, "error", err)
	}
	remoteTarget, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, connectorRecord, target)
	if err != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, h.auditedError(audit, "error", err)
	}
	defer clearRequestScopedProviderTarget(remoteTarget)
	result, err := nimillm.ExecuteVoiceWorkflowAdapter(ctx, request.Adapter(), nimillm.VoiceWorkflowRequest{
		Provider:        request.Provider(),
		WorkflowType:    request.WorkflowType(),
		WorkflowModelID: request.WorkflowModelID(),
		ModelID:         request.ModelID(),
		Payload:         request.Payload(),
		ExtPayload:      request.Extensions(),
	}, nimillm.MediaAdapterConfig{
		BaseURL:               remoteTarget.Endpoint,
		APIKey:                remoteTarget.APIKey,
		Headers:               cloneRemoteHeaders(remoteTarget.Headers),
		AllowLoopbackEndpoint: remoteTarget.AllowLoopback,
	})
	if err != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), err)
	}
	metadata, metadataErr := structpb.NewStruct(result.Metadata)
	if metadataErr != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, h.auditedError(audit, "error", grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, metadataErr, grpcerr.ReasonOptions{}))
	}
	if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudVoiceWorkflowTransportResponse{}, err
	}
	return capabilitydriver.CloudVoiceWorkflowTransportResponse{
		ProviderVoiceRef: result.ProviderVoiceRef,
		Metadata:         metadata,
	}, nil
}

func cloneRemoteHeaders(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func (h *ProviderMediaHost) StreamSpeech(
	ctx context.Context,
	connectorRecord connector.ConnectorRecord,
	target capabilitydriver.CloudMediaTarget,
	request *capabilitydriver.CloudMediaMappedRequest,
	onChunk func(capabilitydriver.CloudMediaStreamChunk) error,
	audit MediaDispatchAudit,
) (capabilitydriver.CloudMediaTransportResponse, error) {
	if err := h.recordDispatch(audit, "dispatch", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudMediaTransportResponse{}, err
	}
	if h == nil || h.transport == nil || request == nil || onChunk == nil ||
		target.CapabilityContract() != "audio.synthesize" || request.StreamMode() == capabilitydriver.CloudMediaStreamNone {
		err := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, "error", err)
	}
	remoteTarget, err := requestScopedProviderTarget(ctx, h.connectors, h.allowLoopback, audit.AccountID, connectorRecord, target)
	if err != nil {
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, "error", err)
	}
	defer clearRequestScopedProviderTarget(remoteTarget)
	mapped := request.Request()
	spec := mapped.GetSpec().GetSpeechSynthesize()
	if spec == nil {
		err = grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, "error", err)
	}
	backend, backendModelID := h.transport.ResolveSpeechBackendForAdapter(request.Adapter(), request.ProviderModelID(), remoteTarget)
	if backend == nil {
		err = grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, "error", err)
	}
	if strings.TrimSpace(backendModelID) == "" {
		backendModelID = request.ProviderModelID()
	}
	extensions := nimillm.ScenarioExtensionPayloadForType(mapped.GetScenarioType(), mapped.GetExtensions())
	if request.StreamMode() == capabilitydriver.CloudMediaStreamNative {
		usage, finish, streamErr := backend.StreamSynthesizeSpeech(ctx, backendModelID, spec, extensions, func(chunk nimillm.SpeechStreamChunk) error {
			mimeType := strings.TrimSpace(chunk.MIMEType)
			if mimeType == "" && len(chunk.Bytes) > 0 {
				mimeType = nimillm.ResolveSpeechArtifactMIME(spec, chunk.Bytes)
			}
			return onChunk(capabilitydriver.CloudMediaStreamChunk{
				Bytes:         append([]byte(nil), chunk.Bytes...),
				MIMEType:      mimeType,
				SampleRateHz:  chunk.SampleRateHz,
				FailureReason: chunk.FailureReason,
			})
		})
		if streamErr != nil {
			return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), streamErr)
		}
		if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
			return capabilitydriver.CloudMediaTransportResponse{}, err
		}
		return capabilitydriver.CloudMediaTransportResponse{Usage: usage, FinishReason: finish, Streamed: true}, nil
	}
	payload, usage, synthErr := backend.SynthesizeSpeech(ctx, backendModelID, spec, extensions)
	if synthErr != nil {
		return capabilitydriver.CloudMediaTransportResponse{}, h.auditedError(audit, dispatchExit(ctx, "error"), synthErr)
	}
	artifact := nimillm.BinaryArtifact(nimillm.ResolveSpeechArtifactMIME(spec, payload), payload, map[string]any{
		"adapter":     request.Adapter(),
		"stream_mode": string(capabilitydriver.CloudMediaStreamSimulated),
	})
	nimillm.ApplySpeechSpecMetadata(artifact, spec)
	if err := h.recordDispatch(audit, "complete", runtimev1.ReasonCode_ACTION_EXECUTED, false); err != nil {
		return capabilitydriver.CloudMediaTransportResponse{}, err
	}
	return capabilitydriver.CloudMediaTransportResponse{
		Artifacts:    []*runtimev1.ScenarioArtifact{artifact},
		Usage:        usage,
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
	}, nil
}

// privateMediaPollState receives provider task identifiers and retry timing
// entirely inside the Host. Public Runtime job state sees only Runtime events
// and terminal semantics, never provider polling state.
type privateMediaPollState struct {
	mu            sync.Mutex
	providerJobID string
	retryCount    int32
	nextPollAt    *timestamppb.Timestamp
	lastError     string
}

func (s *privateMediaPollState) UpdatePollState(providerPrivateID string, providerJobID string, retryCount int32, nextPollAt *timestamppb.Timestamp, lastError string) {
	_ = providerPrivateID
	if s == nil {
		return
	}
	s.mu.Lock()
	s.providerJobID = strings.TrimSpace(providerJobID)
	s.retryCount = retryCount
	if nextPollAt != nil {
		s.nextPollAt = timestamppb.New(nextPollAt.AsTime())
	} else {
		s.nextPollAt = nil
	}
	s.lastError = strings.TrimSpace(lastError)
	s.mu.Unlock()
}

func (h *ProviderMediaHost) recordDispatch(audit MediaDispatchAudit, phase string, reason runtimev1.ReasonCode, providerStopGuaranteed bool) error {
	if h == nil || h.audit == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	payload, err := structpb.NewStruct(map[string]any{
		"ai_config_route":          "cloud",
		"capability_contract":      strings.TrimSpace(audit.CapabilityContract),
		"implementation_id":        strings.TrimSpace(audit.ImplementationID),
		"driver_id":                strings.TrimSpace(audit.DriverID),
		"driver_dialect":           strings.TrimSpace(audit.DriverDialect),
		"connector_id":             strings.TrimSpace(audit.ConnectorID),
		"provider":                 strings.TrimSpace(audit.Provider),
		"provider_model_id":        strings.TrimSpace(audit.ProviderModelID),
		"remote_model_catalog_id":  strings.TrimSpace(audit.RemoteModelCatalogID),
		"provider_region":          strings.TrimSpace(audit.Region),
		"remote_execution_host":    ProviderHTTPMediaHostID,
		"dispatch_phase":           strings.TrimSpace(phase),
		"polling_visibility":       "remote_host_private",
		"cancel_semantics":         "best_effort_transport_and_local_wait_provider_stop_not_guaranteed",
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
		Operation:     "remote_execution_host.media." + strings.TrimSpace(phase),
		ReasonCode:    reason,
		TraceId:       traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write remote media execution audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}

func (h *ProviderMediaHost) auditedError(audit MediaDispatchAudit, phase string, cause error) error {
	if err := h.recordDispatch(audit, phase, mediaReasonCode(cause), false); err != nil {
		return err
	}
	return cause
}

func mediaReasonCode(err error) runtimev1.ReasonCode {
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
