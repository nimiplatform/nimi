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

type cloudVoiceWorkflowEffectiveInputs struct {
	implementation   *runtimev1.CapabilityImplementationIdentity
	rawTarget        *structpb.Struct
	target           capabilitydriver.CloudMediaTarget
	catalogTarget    *nimillm.RemoteTarget
	voiceTarget      *runtimeidentity.Target
	connector        connector.ConnectorRecord
	defaults         *structpb.Struct
	request          *runtimev1.SubmitScenarioJobRequest
	mapped           *capabilitydriver.CloudVoiceWorkflowMappedRequest
	driver           capabilitydriver.CloudMediaDriver
	resolution       catalog.ResolveVoiceWorkflowResult
	traceID          string
	appID            string
	accountID        string
	resolvedAssembly *cloudResolvedAssembly
}

func (input *cloudVoiceWorkflowEffectiveInputs) release() {
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
	input.resolution = catalog.ResolveVoiceWorkflowResult{}
	input.resolvedAssembly = nil
}

func (input *cloudVoiceWorkflowEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	return input.target.ProviderModelID()
}

func (input *cloudVoiceWorkflowEffectiveInputs) dispatchAudit() remoteexecution.MediaDispatchAudit {
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

func (s *Service) captureCloudVoiceWorkflowEffectiveInputs(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
) (*cloudVoiceWorkflowEffectiveInputs, error) {
	if s == nil || req == nil || req.GetHead() == nil || req.GetSpec() == nil || s.cloudMediaDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	capabilityContract := scenarioTargetCapability(req.GetScenarioType())
	intent, err := scenarioExecutionIntentFromContext(ctx, capabilityContract)
	if err != nil {
		return nil, err
	}
	if !intent.IsAIConfigCloud() {
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
	accountID := scenarioTargetSubjectUserID(ctx, req.GetHead())
	if target.RemoteModelCatalogID() == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	connectorRecord, binding, err := connector.ResolveCurrentAccountConnectorBinding(s.connStore, s.speechCatalog, accountID, connector.RemoteModelCatalogRef{
		ConnectorID:          intent.ConnectorRef,
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ProviderModelID:      target.ProviderModelID(),
		Provider:             target.Provider(),
	})
	if err != nil {
		return nil, err
	}
	safeTarget := &nimillm.RemoteTarget{
		ProviderType:         target.Provider(),
		ProviderModelID:      target.ProviderModelID(),
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ConnectorID:          connectorRecord.ConnectorID,
	}
	if binding == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
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
	if err := s.validateScenarioCapability(ctx, req, target.ProviderModelID(), safeTarget, s.cloudTextProvider); err != nil {
		return nil, err
	}
	workflowType := workflowTypeFromScenarioSpec(req.GetSpec())
	resolution, err := s.resolveVoiceWorkflow(ctx, target.Provider(), target.ProviderModelID(), workflowType)
	if err != nil {
		return nil, voiceWorkflowResolutionError(err)
	}
	extensionPayload, err := resolveVoiceWorkflowExtensionPayload(req, resolution.Provider)
	if err != nil {
		return nil, err
	}
	var extensions *structpb.Struct
	if len(extensionPayload) > 0 {
		extensions, err = structpb.NewStruct(extensionPayload)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID, err, grpcerr.ReasonOptions{})
		}
	}
	effectiveRequest := s.normalizeVoiceWorkflowRequestTargetModelID(ctx, req, resolution)
	effectiveRequest = cloneSubmitScenarioJobRequest(effectiveRequest)
	if effectiveRequest == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	effectiveRequest.Head = cloneScenarioHead(effectiveRequest.GetHead())
	effectiveRequest.Head.SubjectUserId = accountID
	effectiveRequest.ExecutionMode = runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
	normalizeVoiceWorkflowPreferredName(effectiveRequest)
	if err := validateVoiceWorkflowRequestAgainstMetadata(effectiveRequest, resolution); err != nil {
		return nil, err
	}
	mapped, err := driver.MapVoiceWorkflowRequest(target, effectiveRequest, intent.Defaults, capabilitydriver.CloudVoiceWorkflowConfig{
		WorkflowType:    resolution.WorkflowType,
		WorkflowModelID: resolution.WorkflowModelID,
		CatalogModelID:  resolution.ModelID,
		APIModelID:      resolution.APIModelID,
		Extensions:      extensions,
	})
	if err != nil {
		return nil, cloudMediaDriverError(capabilityContract, err)
	}
	implementation, _ := proto.Clone(intent.CloudImplementation).(*runtimev1.CapabilityImplementationIdentity)
	rawTarget, _ := proto.Clone(intent.ProviderModelTarget).(*structpb.Struct)
	defaults, _ := proto.Clone(intent.Defaults).(*structpb.Struct)
	effective := &cloudVoiceWorkflowEffectiveInputs{
		implementation: implementation,
		rawTarget:      rawTarget,
		target:         target,
		catalogTarget:  safeTarget,
		voiceTarget:    voiceTarget,
		connector:      connectorRecord,
		defaults:       defaults,
		request:        effectiveRequest,
		mapped:         mapped,
		driver:         driver,
		resolution:     resolution,
		traceID:        ulid.Make().String(),
		appID:          strings.TrimSpace(req.GetHead().GetAppId()),
		accountID:      accountID,
	}
	voiceCapture := &cloudVoiceWorkflowCapture{
		Provider: resolution.Provider, ModelID: resolution.ModelID, APIModelID: resolution.APIModelID,
		WorkflowType: resolution.WorkflowType, WorkflowModelID: resolution.WorkflowModelID,
		WorkflowFamily: resolution.WorkflowFamily, OutputPersistence: resolution.OutputPersistence,
		HandlePolicyID: resolution.HandlePolicyID, HandlePolicyPersistence: resolution.HandlePolicyPersistence,
		HandlePolicyScope: resolution.HandlePolicyScope, HandlePolicyDefaultTTL: resolution.HandlePolicyDefaultTTL,
		HandlePolicyDeleteSemantics:   resolution.HandlePolicyDeleteSemantics,
		RuntimeReconciliationRequired: resolution.RuntimeReconciliationRequired,
	}
	if extensions != nil {
		voiceCapture.Extensions, err = (protojson.MarshalOptions{UseProtoNames: true}).Marshal(extensions)
		if err != nil {
			effective.release()
			return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
		}
	}
	effective.resolvedAssembly, err = newCloudResolvedAssembly(
		cloudResolvedRequestVoiceWorkflow, capabilityContract, implementation, rawTarget, connectorRecord,
		defaults, effectiveRequest, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, capabilitydriver.CloudMediaStreamNone,
		effective.traceID, effective.appID, effective.accountID, voiceCapture,
	)
	if err != nil {
		effective.release()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "Cloud voice ResolvedAssembly capture failed"})
	}
	if err := s.auditCloudVoiceWorkflowCapture(effective); err != nil {
		effective.release()
		return nil, err
	}
	return effective, nil
}

func normalizeVoiceWorkflowPreferredName(req *runtimev1.SubmitScenarioJobRequest) {
	if req == nil || req.GetSpec() == nil || req.GetSpec().GetVoiceCreate() == nil {
		return
	}
	creation := req.GetSpec().GetVoiceCreate()
	preferredName := resolveVoiceWorkflowPreferredName(req)
	switch source := creation.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		if source.ReferenceAudio != nil && strings.TrimSpace(source.ReferenceAudio.GetPreferredName()) == "" {
			source.ReferenceAudio.PreferredName = preferredName
		}
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		if source.TextDescription != nil && strings.TrimSpace(source.TextDescription.GetPreferredName()) == "" {
			source.TextDescription.PreferredName = preferredName
		}
	}
}

func (s *Service) cloudVoiceWorkflowEffectiveInputsFromResolvedAssembly(assembly *cloudResolvedAssembly) (*cloudVoiceWorkflowEffectiveInputs, error) {
	if s == nil || assembly == nil || assembly.RequestKind != cloudResolvedRequestVoiceWorkflow || s.cloudMediaDrivers == nil {
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
	var extensions *structpb.Struct
	if len(assembly.VoiceWorkflow.Extensions) > 0 {
		extensions = &structpb.Struct{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.VoiceWorkflow.Extensions, extensions); err != nil {
			return nil, cloudMediaDriverError(assembly.CapabilityContract, err)
		}
	}
	resolution := assembly.VoiceWorkflow.resolution()
	mapped, err := driver.MapVoiceWorkflowRequest(target, request, defaults, capabilitydriver.CloudVoiceWorkflowConfig{
		WorkflowType: resolution.WorkflowType, WorkflowModelID: resolution.WorkflowModelID,
		CatalogModelID: resolution.ModelID, APIModelID: resolution.APIModelID, Extensions: extensions,
	})
	if err != nil {
		return nil, cloudMediaDriverError(assembly.CapabilityContract, err)
	}
	clonedAssembly, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	connectorRecord := connectorRecordWithCredentialCustody(cloneConnectorRecord(assembly.Connector), assembly.CredentialCustodyRef)
	return &cloudVoiceWorkflowEffectiveInputs{
		implementation: implementation, rawTarget: rawTarget, target: target,
		catalogTarget: &nimillm.RemoteTarget{ProviderType: target.Provider(), ProviderModelID: target.ProviderModelID(), RemoteModelCatalogID: target.RemoteModelCatalogID(), ConnectorID: connectorRecord.ConnectorID},
		voiceTarget:   &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{ConnectorID: connectorRecord.ConnectorID, RemoteModelCatalogID: target.RemoteModelCatalogID(), ProviderModelID: target.ProviderModelID(), Provider: target.Provider()}},
		connector:     connectorRecord, defaults: defaults, request: request, mapped: mapped, driver: driver,
		resolution: resolution, traceID: assembly.TraceID, appID: assembly.AppID, accountID: assembly.AccountID,
		resolvedAssembly: clonedAssembly,
	}, nil
}

func (s *Service) normalizeVoiceWorkflowRequestTargetModelID(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	resolution catalog.ResolveVoiceWorkflowResult,
) *runtimev1.SubmitScenarioJobRequest {
	if s == nil || s.speechCatalog == nil || req == nil || req.GetSpec() == nil {
		return req
	}
	provider := strings.TrimSpace(resolution.Provider)
	if provider == "" {
		return req
	}
	subjectUserID := scenarioTargetSubjectUserID(ctx, req.GetHead())
	normalize := func(value string) string {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return ""
		}
		resolved := strings.TrimSpace(s.speechCatalog.ResolveAPIModelIDForSubject(subjectUserID, provider, trimmed))
		if resolved == "" {
			return trimmed
		}
		return resolved
	}
	creation := req.GetSpec().GetVoiceCreate()
	if creation == nil {
		return req
	}
	current := strings.TrimSpace(creation.GetTargetModelId())
	normalized := normalize(current)
	if normalized == "" || normalized == current {
		return req
	}
	cloned := cloneSubmitScenarioJobRequest(req)
	if cloned == nil || cloned.GetSpec().GetVoiceCreate() == nil {
		return req
	}
	cloned.GetSpec().GetVoiceCreate().TargetModelId = normalized
	return cloned
}

func voiceWorkflowResolutionError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, catalog.ErrModelNotFound):
		return grpcerr.WrapWithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, err, grpcerr.ReasonOptions{Message: "voice workflow catalog model could not be resolved"})
	case errors.Is(err, catalog.ErrVoiceWorkflowUnsupported):
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED, err, grpcerr.ReasonOptions{Message: "voice workflow is not supported"})
	default:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "voice workflow catalog metadata could not be read"})
	}
}

func (s *Service) executeCapturedCloudVoiceWorkflow(ctx context.Context, effective *cloudVoiceWorkflowEffectiveInputs) (capabilitydriver.CloudVoiceWorkflowResult, error) {
	if s == nil || effective == nil || effective.driver == nil || s.remoteMediaHost == nil {
		return capabilitydriver.CloudVoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	response, err := s.remoteMediaHost.ExecuteVoiceWorkflow(ctx, effective.connector, effective.target, effective.mapped, effective.dispatchAudit())
	if err != nil {
		return capabilitydriver.CloudVoiceWorkflowResult{}, effective.driver.NormalizeReason(effective.target, err)
	}
	result, err := effective.driver.NormalizeVoiceWorkflowResponse(response)
	if err != nil {
		return capabilitydriver.CloudVoiceWorkflowResult{}, cloudMediaDriverError(effective.target.CapabilityContract(), err)
	}
	if result.Usage == nil {
		result.Usage = estimateVoiceWorkflowUsage(effective.request)
	}
	return result, nil
}

func (s *Service) auditCloudVoiceWorkflowCapture(effective *cloudVoiceWorkflowEffectiveInputs) error {
	if s == nil || s.audit == nil || effective == nil {
		return nil
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(effective.request)
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	digest := sha256.Sum256(raw)
	payload, err := structpb.NewStruct(map[string]any{
		"ai_config_route":       "cloud",
		"capability_contract":   effective.target.CapabilityContract(),
		"implementation_id":     effective.implementation.GetImplementationId(),
		"driver_id":             effective.implementation.GetDriverId(),
		"driver_dialect":        effective.implementation.GetDriverDialect(),
		"provider_model_target": effective.rawTarget.AsMap(),
		"connector_id":          effective.connector.ConnectorID,
		"request_sha256":        "sha256:" + hex.EncodeToString(digest[:]),
		"request_size_bytes":    len(raw),
		"creation_source":       effective.resolution.WorkflowType,
		"workflow_model_id":     effective.resolution.WorkflowModelID,
		"remote_execution_host": remoteexecution.ProviderHTTPMediaHostID,
		"remote_dispatch_state": "captured",
		"secret_material":       "absent",
	})
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	if err := s.audit.AppendEventChecked(&runtimev1.AuditEventRecord{
		AppId: effective.appID, SubjectUserId: effective.accountID, Domain: "runtime.ai",
		Operation: "cloud.voice_workflow.composition.capture", ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId: effective.traceID, Timestamp: timestamppb.New(time.Now().UTC()), Payload: payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write cloud voice workflow composition audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}
