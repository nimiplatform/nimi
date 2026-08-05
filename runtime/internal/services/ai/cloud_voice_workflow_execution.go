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
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type cloudVoiceWorkflowEffectiveInputs struct {
	implementation *runtimev1.CapabilityImplementationIdentity
	rawTarget      *structpb.Struct
	target         capabilitydriver.CloudMediaTarget
	catalogTarget  *nimillm.RemoteTarget
	voiceTarget    *runtimeidentity.Target
	grant          connector.ConnectorGrantSnapshot
	defaults       *structpb.Struct
	request        *runtimev1.SubmitScenarioJobRequest
	mapped         *capabilitydriver.CloudVoiceWorkflowMappedRequest
	driver         capabilitydriver.CloudMediaDriver
	resolution     catalog.ResolveVoiceWorkflowResult
	traceID        string
	appID          string
	accountID      string
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
	input.grant = connector.ConnectorGrantSnapshot{}
	input.defaults = nil
	input.request = nil
	input.mapped = nil
	input.driver = nil
	input.resolution = catalog.ResolveVoiceWorkflowResult{}
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
		ConnectorGrantID:     input.grant.Grant.GrantID,
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
	grantID := intent.GrantID()
	if accountID == "" || grantID == "" || s.connStore == nil {
		return nil, connectorGrantExecutionError(connector.ErrConnectorGrantSelectionRequired)
	}
	grant, err := s.connStore.ValidateGrantBinding(accountID, grantID)
	if err != nil {
		return nil, connectorGrantExecutionError(err)
	}
	if grant.Connector.Provider != target.Provider() || target.RemoteModelCatalogID() == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	safeTarget := &nimillm.RemoteTarget{
		ProviderType:         target.Provider(),
		ProviderModelID:      target.ProviderModelID(),
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ConnectorID:          grant.Connector.ConnectorID,
	}
	binding, err := connector.ResolveRemoteModelCatalogBinding(s.speechCatalog, accountID, grant.Connector, connector.RemoteModelCatalogRef{
		ConnectorID:          grant.Connector.ConnectorID,
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ProviderModelID:      target.ProviderModelID(),
		Provider:             target.Provider(),
	})
	if err != nil {
		return nil, err
	}
	applyRemoteModelCatalogBinding(safeTarget, &binding)
	voiceTarget := &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID:          grant.Connector.ConnectorID,
		ConnectorGrantID:     grant.Grant.GrantID,
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
	workflowType := workflowTypeFromScenarioType(req.GetScenarioType())
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
		grant:          grant,
		defaults:       defaults,
		request:        effectiveRequest,
		mapped:         mapped,
		driver:         driver,
		resolution:     resolution,
		traceID:        ulid.Make().String(),
		appID:          strings.TrimSpace(req.GetHead().GetAppId()),
		accountID:      accountID,
	}
	if err := s.auditCloudVoiceWorkflowCapture(effective); err != nil {
		effective.release()
		return nil, err
	}
	return effective, nil
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
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		current := strings.TrimSpace(req.GetSpec().GetVoiceClone().GetTargetModelId())
		normalized := normalize(current)
		if normalized == "" || normalized == current {
			return req
		}
		cloned := cloneSubmitScenarioJobRequest(req)
		if cloned == nil || cloned.GetSpec().GetVoiceClone() == nil {
			return req
		}
		cloned.GetSpec().GetVoiceClone().TargetModelId = normalized
		return cloned
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		current := strings.TrimSpace(req.GetSpec().GetVoiceDesign().GetTargetModelId())
		normalized := normalize(current)
		if normalized == "" || normalized == current {
			return req
		}
		cloned := cloneSubmitScenarioJobRequest(req)
		if cloned == nil || cloned.GetSpec().GetVoiceDesign() == nil {
			return req
		}
		cloned.GetSpec().GetVoiceDesign().TargetModelId = normalized
		return cloned
	default:
		return req
	}
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
	response, err := s.remoteMediaHost.ExecuteVoiceWorkflow(ctx, effective.grant, effective.target, effective.mapped, effective.dispatchAudit())
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
		"connector_grant_id":    effective.grant.Grant.GrantID,
		"request_sha256":        "sha256:" + hex.EncodeToString(digest[:]),
		"request_size_bytes":    len(raw),
		"workflow_type":         effective.resolution.WorkflowType,
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
