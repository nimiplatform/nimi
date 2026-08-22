package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type cloudMediaEffectiveInputs struct {
	implementation   *runtimev1.CapabilityImplementationIdentity
	rawTarget        *structpb.Struct
	target           capabilitydriver.CloudMediaTarget
	catalogTarget    *nimillm.RemoteTarget
	voiceTarget      *runtimeidentity.Target
	connector        connector.ConnectorRecord
	defaults         *structpb.Struct
	request          *runtimev1.SubmitScenarioJobRequest
	mapped           *capabilitydriver.CloudMediaMappedRequest
	driver           capabilitydriver.CloudMediaDriver
	traceID          string
	appID            string
	accountID        string
	resolvedAssembly *cloudResolvedAssembly
}

type cloudMediaRouteComposition struct {
	intent    executionintent.Intent
	driver    capabilitydriver.CloudMediaDriver
	target    capabilitydriver.CloudMediaTarget
	connector connector.ConnectorRecord
	binding   *connector.RemoteModelCatalogBinding
	appID     string
	accountID string
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r091
func (s *Service) resolveCloudMediaRouteComposition(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	capabilityContract string,
) (*cloudMediaRouteComposition, error) {
	if s == nil || head == nil || strings.TrimSpace(capabilityContract) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveCloudMediaConsumerIntent(ctx, head, capabilityContract)
	if err != nil {
		return nil, err
	}
	if !intent.IsAIConfigCloud() || intent.CapabilityContract != capabilityContract || s.cloudMediaDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	driver, target, err := s.cloudMediaDrivers.Resolve(
		capabilitydriver.IdentityFromProto(intent.CloudImplementation),
		intent.ProviderModelTarget,
		capabilityContract,
	)
	if err != nil {
		return nil, cloudMediaDriverError(capabilityContract, err)
	}
	if target.RemoteModelCatalogID() == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	accountID := scenarioTargetSubjectUserID(ctx, head)
	connectorRecord, binding, err := connector.ResolveExactAccountConnectorBinding(
		s.connStore,
		s.speechCatalog,
		accountID,
		connector.RemoteModelCatalogRef{
			ConnectorID:          intent.ConnectorRef,
			RemoteModelCatalogID: target.RemoteModelCatalogID(),
			ProviderModelID:      target.ProviderModelID(),
			Provider:             target.Provider(),
		},
	)
	if err != nil {
		return nil, err
	}
	if binding == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	return &cloudMediaRouteComposition{
		intent: intent, driver: driver, target: target,
		connector: connectorRecord, binding: binding,
		appID: strings.TrimSpace(head.GetAppId()), accountID: accountID,
	}, nil
}

func (input *cloudMediaEffectiveInputs) release() {
	if input == nil {
		return
	}
	input.implementation = nil
	input.rawTarget = nil
	input.target = capabilitydriver.CloudMediaTarget{}
	input.catalogTarget = nil
	input.voiceTarget = nil
	input.connector = connector.ConnectorRecord{}
	input.defaults = nil
	input.request = nil
	input.mapped = nil
	input.driver = nil
	input.resolvedAssembly = nil
}

func (input *cloudMediaEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	return input.target.ProviderModelID()
}

func (input *cloudMediaEffectiveInputs) streamMode() capabilitydriver.CloudMediaStreamMode {
	if input == nil || input.mapped == nil {
		return capabilitydriver.CloudMediaStreamNone
	}
	return input.mapped.StreamMode()
}

func (input *cloudMediaEffectiveInputs) dispatchAudit() remoteexecution.MediaDispatchAudit {
	if input == nil {
		return remoteexecution.MediaDispatchAudit{}
	}
	return remoteexecution.MediaDispatchAudit{
		AppID:                input.appID,
		AccountID:            input.accountID,
		TraceID:              input.traceID,
		CapabilityContract:   input.target.CapabilityContract(),
		ImplementationID:     input.implementation.GetImplementationId(),
		DriverID:             input.implementation.GetDriverId(),
		DriverDialect:        input.implementation.GetDriverDialect(),
		ConnectorID:          input.connector.ConnectorID,
		Provider:             input.target.Provider(),
		ProviderModelID:      input.target.ProviderModelID(),
		RemoteModelCatalogID: input.target.RemoteModelCatalogID(),
		Region:               input.target.Region(),
	}
}

// captureCloudMediaEffectiveInputs is the r006 fixation point for all admitted
// Cloud media modalities. The graph returned from this function is immutable,
// cloned, and credential-free. Connector secrets are opened only later by the
// Remote ExecutionHost dispatch.
func (s *Service) captureCloudMediaEffectiveInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	request *runtimev1.SubmitScenarioJobRequest,
	mode runtimev1.ExecutionMode,
) (*cloudMediaEffectiveInputs, error) {
	if s == nil || head == nil || request == nil || request.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if cloudVideoHasArtifactReference(request) || cloudImageHasArtifactReference(request) {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			Message: "Cloud media execution does not support Runtime Artifact references",
		})
	}
	capabilityContract := scenarioTargetCapability(request.GetScenarioType())
	composition, err := s.resolveCloudMediaRouteComposition(ctx, head, capabilityContract)
	if err != nil {
		return nil, err
	}
	intent := composition.intent
	driver := composition.driver
	target := composition.target
	accountID := composition.accountID
	connectorRecord := composition.connector
	binding := composition.binding

	// Catalog validation consumes only safe connector/config identities. It
	// performs no provider probe and carries no endpoint or credential.
	safeTarget := &nimillm.RemoteTarget{
		ProviderType:         target.Provider(),
		ProviderModelID:      target.ProviderModelID(),
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ConnectorID:          connectorRecord.ConnectorID,
	}
	applyRemoteModelCatalogBinding(safeTarget, binding)
	voiceTarget := &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID:          connectorRecord.ConnectorID,
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ProviderModelID:      target.ProviderModelID(),
		Provider:             target.Provider(),
	}}
	if !voiceTarget.Valid() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}

	effectiveRequest := cloneSubmitScenarioJobRequest(request)
	if effectiveRequest == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	effectiveRequest.Head = cloneScenarioHead(effectiveRequest.GetHead())
	effectiveRequest.Head.AppId = composition.appID
	effectiveRequest.Head.SubjectUserId = accountID
	effectiveRequest.ExecutionMode = mode
	if effectiveRequest.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		effectiveSpec, resolveErr := s.resolveSynthesizeSpeechSpecVoiceRefForTarget(
			ctx,
			head,
			voiceTarget,
			effectiveRequest.GetSpec().GetSpeechSynthesize(),
		)
		if resolveErr != nil {
			return nil, resolveErr
		}
		effectiveRequest.Spec.Spec = &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: effectiveSpec}
	}

	streamMode := capabilitydriver.CloudMediaStreamNone
	if mode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM {
		if effectiveRequest.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		native, streamErr := s.speechSynthesizeRouteSupportsNativeStreamTTS(ctx, target.ProviderModelID(), safeTarget, s.cloudTextProvider)
		if streamErr != nil {
			return nil, streamErr
		}
		streamMode = capabilitydriver.CloudMediaStreamSimulated
		if native {
			streamMode = capabilitydriver.CloudMediaStreamNative
		}
	}
	mapped, err := driver.MapRequest(target, effectiveRequest, intent.Defaults, streamMode)
	if err != nil {
		return nil, cloudMediaDriverError(capabilityContract, err)
	}
	effectiveRequest = mapped.Request()
	if err := validateSubmitScenarioAsyncJobRequest(effectiveRequest); err != nil {
		return nil, err
	}
	if err := s.validateScenarioCapability(ctx, effectiveRequest, target.ProviderModelID(), safeTarget, s.cloudTextProvider); err != nil {
		return nil, err
	}
	if effectiveRequest.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		if err := validateConnectorTTSModelSupport(
			ctx,
			s.logger,
			request,
			effectiveRequest.GetSpec().GetSpeechSynthesize(),
			target.ProviderModelID(),
			safeTarget,
			nil,
			s.speechCatalog,
		); err != nil {
			return nil, err
		}
	}
	if _, iteration, resolveErr := resolveMusicGenerateExtensionPayload(effectiveRequest); resolveErr != nil {
		return nil, resolveErr
	} else if supportErr := validateMusicGenerateIterationSupport(ctx, s, target.ProviderModelID(), safeTarget, s.cloudTextProvider, iteration); supportErr != nil {
		return nil, supportErr
	}

	implementation, _ := proto.Clone(intent.CloudImplementation).(*runtimev1.CapabilityImplementationIdentity)
	rawTarget, _ := proto.Clone(intent.ProviderModelTarget).(*structpb.Struct)
	defaults, _ := proto.Clone(intent.Defaults).(*structpb.Struct)
	effective := &cloudMediaEffectiveInputs{
		implementation: implementation,
		rawTarget:      rawTarget,
		target:         target,
		catalogTarget:  safeTarget,
		voiceTarget:    voiceTarget.Clone(),
		connector:      connectorRecord,
		defaults:       defaults,
		request:        effectiveRequest,
		mapped:         mapped,
		driver:         driver,
		traceID:        ulid.Make().String(),
		appID:          composition.appID,
		accountID:      accountID,
	}
	effective.resolvedAssembly, err = newCloudResolvedAssembly(
		cloudResolvedRequestMedia, capabilityContract, implementation, rawTarget, connectorRecord,
		defaults, effectiveRequest, mode, streamMode, effective.traceID, effective.appID, effective.accountID, nil,
	)
	if err != nil {
		effective.release()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "Cloud ResolvedAssembly capture failed"})
	}
	if err := s.auditCloudMediaCapture(effective); err != nil {
		effective.release()
		return nil, err
	}
	return effective, nil
}

func (s *Service) cloudMediaEffectiveInputsFromResolvedAssembly(assembly *cloudResolvedAssembly) (*cloudMediaEffectiveInputs, error) {
	if s == nil || assembly == nil || assembly.RequestKind != cloudResolvedRequestMedia || s.cloudMediaDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if err := validateCloudResolvedAssembly(assembly); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	implementation, err := assembly.implementationProto()
	if err != nil {
		return nil, cloudMediaDriverError(assembly.CapabilityContract, err)
	}
	rawTarget, err := assembly.providerTargetProto()
	if err != nil {
		return nil, cloudMediaDriverError(assembly.CapabilityContract, err)
	}
	defaults, err := assembly.defaultsProto()
	if err != nil {
		return nil, cloudMediaDriverError(assembly.CapabilityContract, err)
	}
	request := &runtimev1.SubmitScenarioJobRequest{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request, request); err != nil {
		return nil, cloudMediaDriverError(assembly.CapabilityContract, err)
	}
	driver, target, err := s.cloudMediaDrivers.Resolve(capabilitydriver.IdentityFromProto(implementation), rawTarget, assembly.CapabilityContract)
	if err != nil {
		return nil, cloudMediaDriverError(assembly.CapabilityContract, err)
	}
	mapped, err := driver.MapRequest(target, request, defaults, assembly.MediaStreamMode)
	if err != nil {
		return nil, cloudMediaDriverError(assembly.CapabilityContract, err)
	}
	connectorRecord := connectorRecordWithCredentialCustody(cloneConnectorRecord(assembly.Connector), assembly.CredentialCustodyRef)
	safeTarget := &nimillm.RemoteTarget{
		ProviderType: target.Provider(), ProviderModelID: target.ProviderModelID(),
		RemoteModelCatalogID: target.RemoteModelCatalogID(), ConnectorID: connectorRecord.ConnectorID,
	}
	voiceTarget := &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID: connectorRecord.ConnectorID, RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ProviderModelID: target.ProviderModelID(), Provider: target.Provider(),
	}}
	clonedAssembly, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	return &cloudMediaEffectiveInputs{
		implementation: implementation, rawTarget: rawTarget, target: target, catalogTarget: safeTarget,
		voiceTarget: voiceTarget, connector: connectorRecord, defaults: defaults, request: mapped.Request(),
		mapped: mapped, driver: driver, traceID: assembly.TraceID, appID: assembly.AppID,
		accountID: assembly.AccountID, resolvedAssembly: clonedAssembly,
	}, nil
}

func cloudVideoHasArtifactReference(request *runtimev1.SubmitScenarioJobRequest) bool {
	if request == nil || request.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE {
		return false
	}
	for _, item := range request.GetSpec().GetVideoGenerate().GetContent() {
		if item != nil && item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			return true
		}
	}
	return false
}

func cloudImageHasArtifactReference(request *runtimev1.SubmitScenarioJobRequest) bool {
	return request != nil &&
		request.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE &&
		strings.TrimSpace(request.GetSpec().GetImageGenerate().GetReferenceImageArtifactId()) != ""
}

func (s *Service) speechSynthesizeRouteSupportsNativeStreamTTS(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	_ provider,
) (bool, error) {
	if s == nil || s.speechCatalog == nil || remoteTarget == nil {
		return false, nil
	}
	model, err := s.speechCatalog.ResolveModelEntryForSubject(
		catalogSubjectUserIDFromContext(ctx),
		strings.TrimSpace(remoteTarget.ProviderType),
		strings.TrimSpace(modelResolved),
	)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return false, nil
		}
		return false, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{
			Message: "speech streaming route catalog metadata could not be read",
		})
	}
	return model.VoiceRequestOptions != nil && model.VoiceRequestOptions.SupportsNativeStreamTTS, nil
}

func (s *Service) resolveCloudMediaConsumerIntent(ctx context.Context, head *runtimev1.ScenarioRequestHead, capabilityContract string) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilityContract)
	return intent, err
}

func cloudMediaDriverError(capabilityContract string, err error) error {
	var driverErr *capabilitydriver.CloudInvocationError
	if !errors.As(err, &driverErr) {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	switch driverErr.Kind {
	case capabilitydriver.CloudInvocationFailureTarget:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, err, grpcerr.ReasonOptions{})
	case capabilitydriver.CloudInvocationFailureRequest:
		reason := runtimev1.ReasonCode_AI_INPUT_INVALID
		switch {
		case capabilityContract == "voice.create":
			reason = runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID
		case capabilityContract == "audio.synthesize":
			reason = runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED
		}
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, reason, err, grpcerr.ReasonOptions{})
	case capabilitydriver.CloudInvocationFailureResponse:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
}

func (s *Service) executeCapturedCloudMedia(ctx context.Context, effective *cloudMediaEffectiveInputs) (capabilitydriver.CloudMediaResult, error) {
	if s == nil || effective == nil || effective.driver == nil || s.remoteMediaHost == nil {
		return capabilitydriver.CloudMediaResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	response, err := s.remoteMediaHost.ExecuteMedia(ctx, effective.connector, effective.target, effective.mapped, effective.dispatchAudit())
	if err != nil {
		return capabilitydriver.CloudMediaResult{}, effective.driver.NormalizeReason(effective.target, err)
	}
	result, err := effective.driver.NormalizeResponse(response)
	if err != nil {
		return capabilitydriver.CloudMediaResult{}, cloudMediaDriverError(effective.target.CapabilityContract(), err)
	}
	return result, nil
}

func (s *Service) streamCapturedCloudSpeech(
	ctx context.Context,
	effective *cloudMediaEffectiveInputs,
	onChunk func(capabilitydriver.CloudMediaStreamChunk) error,
) (capabilitydriver.CloudMediaResult, error) {
	if s == nil || effective == nil || effective.driver == nil || s.remoteMediaHost == nil || onChunk == nil {
		return capabilitydriver.CloudMediaResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	response, err := s.remoteMediaHost.StreamSpeech(ctx, effective.connector, effective.target, effective.mapped, func(raw capabilitydriver.CloudMediaStreamChunk) error {
		chunk, normalizeErr := effective.driver.NormalizeStreamChunk(raw)
		if normalizeErr != nil {
			if _, ok := grpcerr.ExtractReasonCode(normalizeErr); ok {
				return normalizeErr
			}
			return cloudMediaDriverError(effective.target.CapabilityContract(), normalizeErr)
		}
		if len(chunk.Bytes) == 0 {
			return nil
		}
		return onChunk(chunk)
	}, effective.dispatchAudit())
	if err != nil {
		return capabilitydriver.CloudMediaResult{}, effective.driver.NormalizeReason(effective.target, err)
	}
	result, err := effective.driver.NormalizeResponse(response)
	if err != nil {
		return capabilitydriver.CloudMediaResult{}, cloudMediaDriverError(effective.target.CapabilityContract(), err)
	}
	return result, nil
}

func (s *Service) auditCloudMediaCapture(effective *cloudMediaEffectiveInputs) error {
	if s == nil || s.audit == nil || effective == nil || effective.request == nil {
		return nil
	}
	requestRaw, err := proto.MarshalOptions{Deterministic: true}.Marshal(effective.request)
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	requestDigest := sha256.Sum256(requestRaw)
	defaults := map[string]any{}
	if effective.defaults != nil {
		defaults = effective.defaults.AsMap()
	}
	target := map[string]any{}
	if effective.rawTarget != nil {
		target = effective.rawTarget.AsMap()
	}
	payload, err := structpb.NewStruct(map[string]any{
		"ai_config_route":       "cloud",
		"capability_contract":   effective.target.CapabilityContract(),
		"implementation_id":     effective.implementation.GetImplementationId(),
		"driver_id":             effective.implementation.GetDriverId(),
		"driver_dialect":        effective.implementation.GetDriverDialect(),
		"provider_model_target": target,
		"connector_id":          effective.connector.ConnectorID,
		"defaults":              defaults,
		"request_sha256":        "sha256:" + hex.EncodeToString(requestDigest[:]),
		"request_size_bytes":    len(requestRaw),
		"scenario_type":         effective.request.GetScenarioType().String(),
		"stream_mode":           string(effective.streamMode()),
		"detached_polling":      effective.mapped.DetachedPolling(),
		"remote_execution_host": remoteexecution.ProviderHTTPMediaHostID,
		"remote_dispatch_state": "captured",
		"secret_material":       "absent",
	})
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	if err := s.audit.AppendEventChecked(&runtimev1.AuditEventRecord{
		AppId:         effective.appID,
		SubjectUserId: effective.accountID,
		Domain:        "runtime.ai",
		Operation:     "cloud.media.composition.capture",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       effective.traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write cloud media composition audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}
