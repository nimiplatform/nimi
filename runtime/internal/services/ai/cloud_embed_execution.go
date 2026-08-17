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
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type cloudEmbedEffectiveInputs struct {
	implementation   *runtimev1.CapabilityImplementationIdentity
	rawTarget        *structpb.Struct
	target           capabilitydriver.CloudEmbedTarget
	catalogTarget    *nimillm.RemoteTarget
	connector        connector.ConnectorRecord
	defaults         *structpb.Struct
	request          *runtimev1.TextEmbedScenarioSpec
	mapped           *capabilitydriver.CloudEmbedMappedRequest
	driver           capabilitydriver.CloudEmbedDriver
	traceID          string
	appID            string
	accountID        string
	resolvedAssembly *cloudResolvedAssembly
}

func (input *cloudEmbedEffectiveInputs) release() {
	if input == nil {
		return
	}
	input.implementation = nil
	input.rawTarget = nil
	input.target = capabilitydriver.CloudEmbedTarget{}
	input.catalogTarget = nil
	input.connector = connector.ConnectorRecord{}
	input.defaults = nil
	input.request = nil
	input.mapped = nil
	input.driver = nil
	input.resolvedAssembly = nil
}

func (input *cloudEmbedEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	return input.target.ProviderModelID()
}

func (input *cloudEmbedEffectiveInputs) dispatchAudit() remoteexecution.EmbedDispatchAudit {
	if input == nil {
		return remoteexecution.EmbedDispatchAudit{}
	}
	return remoteexecution.EmbedDispatchAudit{
		AppID:                input.appID,
		AccountID:            input.accountID,
		TraceID:              input.traceID,
		CapabilityContract:   capabilitydriver.TextEmbedCapabilityContract,
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

// captureCloudEmbedEffectiveInputs fixes an immutable, credential-free cloud
// embedding composition before scheduling or dispatch.
func (s *Service) captureCloudEmbedEffectiveInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	request scenarioRequestLike,
) (*cloudEmbedEffectiveInputs, error) {
	if s == nil || head == nil || request == nil || request.GetSpec().GetTextEmbed() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveCloudEmbedConsumerIntent(ctx, head)
	if err != nil {
		return nil, err
	}
	if !intent.IsAIConfigCloud() || intent.CapabilityContract != capabilitydriver.TextEmbedCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	if s.cloudEmbedDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	driver, target, err := s.cloudEmbedDrivers.Resolve(
		capabilitydriver.IdentityFromProto(intent.CloudImplementation),
		intent.ProviderModelTarget,
	)
	if err != nil {
		return nil, cloudEmbedDriverError(err)
	}
	accountID := scenarioTargetSubjectUserID(ctx, head)
	connectorRecord, binding, err := connector.ResolveCurrentAccountConnectorBinding(s.connStore, s.speechCatalog, accountID, connector.RemoteModelCatalogRef{
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ProviderModelID:      target.ProviderModelID(),
		Provider:             target.Provider(),
	})
	if err != nil {
		return nil, err
	}

	// Catalog admission consumes only connector/config identities and performs
	// no provider probe or credential resolution.
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
	if err := s.validateScenarioCapability(ctx, request, target.ProviderModelID(), safeTarget, s.cloudTextProvider); err != nil {
		return nil, err
	}
	mapped, err := driver.MapRequest(target, request.GetSpec().GetTextEmbed(), intent.Defaults)
	if err != nil {
		return nil, cloudEmbedDriverError(err)
	}

	implementation, _ := proto.Clone(intent.CloudImplementation).(*runtimev1.CapabilityImplementationIdentity)
	rawTarget, _ := proto.Clone(intent.ProviderModelTarget).(*structpb.Struct)
	defaults, _ := proto.Clone(intent.Defaults).(*structpb.Struct)
	effectiveRequest := &runtimev1.TextEmbedScenarioSpec{Inputs: mapped.Inputs()}
	effective := &cloudEmbedEffectiveInputs{
		implementation: implementation,
		rawTarget:      rawTarget,
		target:         target,
		catalogTarget:  safeTarget,
		connector:      connectorRecord,
		defaults:       defaults,
		request:        effectiveRequest,
		mapped:         mapped,
		driver:         driver,
		traceID:        ulid.Make().String(),
		appID:          strings.TrimSpace(head.GetAppId()),
		accountID:      accountID,
	}
	effective.resolvedAssembly, err = newCloudResolvedAssembly(
		cloudResolvedRequestEmbed, capabilitydriver.TextEmbedCapabilityContract, implementation, rawTarget,
		connectorRecord, defaults, effectiveRequest, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, capabilitydriver.CloudMediaStreamNone,
		effective.traceID, effective.appID, effective.accountID, nil,
	)
	if err != nil {
		effective.release()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "Cloud ResolvedAssembly capture failed"})
	}
	if err := s.auditCloudEmbedCapture(effective); err != nil {
		effective.release()
		return nil, err
	}
	return effective, nil
}

func (s *Service) cloudEmbedEffectiveInputsFromResolvedAssembly(assembly *cloudResolvedAssembly) (*cloudEmbedEffectiveInputs, error) {
	if s == nil || assembly == nil || assembly.RequestKind != cloudResolvedRequestEmbed || s.cloudEmbedDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if err := validateCloudResolvedAssembly(assembly); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	implementation, err := assembly.implementationProto()
	if err != nil {
		return nil, cloudEmbedDriverError(err)
	}
	rawTarget, err := assembly.providerTargetProto()
	if err != nil {
		return nil, cloudEmbedDriverError(err)
	}
	defaults, err := assembly.defaultsProto()
	if err != nil {
		return nil, cloudEmbedDriverError(err)
	}
	request := &runtimev1.TextEmbedScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request, request); err != nil {
		return nil, cloudEmbedDriverError(err)
	}
	driver, target, err := s.cloudEmbedDrivers.Resolve(capabilitydriver.IdentityFromProto(implementation), rawTarget)
	if err != nil {
		return nil, cloudEmbedDriverError(err)
	}
	mapped, err := driver.MapRequest(target, request, defaults)
	if err != nil {
		return nil, cloudEmbedDriverError(err)
	}
	clonedAssembly, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	connectorRecord := connectorRecordWithCredentialCustody(cloneConnectorRecord(assembly.Connector), assembly.CredentialCustodyRef)
	return &cloudEmbedEffectiveInputs{
		implementation: implementation, rawTarget: rawTarget, target: target,
		catalogTarget: &nimillm.RemoteTarget{ProviderType: target.Provider(), ProviderModelID: target.ProviderModelID(), RemoteModelCatalogID: target.RemoteModelCatalogID(), ConnectorID: connectorRecord.ConnectorID},
		connector:     connectorRecord, defaults: defaults, request: request, mapped: mapped, driver: driver,
		traceID: assembly.TraceID, appID: assembly.AppID, accountID: assembly.AccountID, resolvedAssembly: clonedAssembly,
	}, nil
}

func (s *Service) resolveCloudEmbedConsumerIntent(ctx context.Context, head *runtimev1.ScenarioRequestHead) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.TextEmbedCapabilityContract)
	return intent, err
}

func cloudEmbedDriverError(err error) error {
	var driverErr *capabilitydriver.CloudInvocationError
	if !errors.As(err, &driverErr) {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	switch driverErr.Kind {
	case capabilitydriver.CloudInvocationFailureTarget:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, err, grpcerr.ReasonOptions{})
	case capabilitydriver.CloudInvocationFailureRequest:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	case capabilitydriver.CloudInvocationFailureResponse:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
}

func (s *Service) executeCapturedCloudEmbed(ctx context.Context, effective *cloudEmbedEffectiveInputs) (capabilitydriver.CloudEmbedResult, error) {
	if s == nil || effective == nil || effective.driver == nil || s.remoteEmbedHost == nil {
		return capabilitydriver.CloudEmbedResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	response, err := s.remoteEmbedHost.ExecuteEmbed(ctx, effective.connector, effective.target, effective.mapped, effective.dispatchAudit())
	if err != nil {
		return capabilitydriver.CloudEmbedResult{}, effective.driver.NormalizeReason(err)
	}
	result, err := effective.driver.NormalizeResponse(effective.mapped, response)
	if err != nil {
		return capabilitydriver.CloudEmbedResult{}, cloudEmbedDriverError(err)
	}
	return result, nil
}

func (s *Service) executeCapturedCloudEmbedJob(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	effective *cloudEmbedEffectiveInputs,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (capabilitydriver.CloudEmbedResult, *runtimev1.ScenarioJob, error) {
	if s == nil || head == nil || effective == nil || effective.resolvedAssembly == nil {
		return capabilitydriver.CloudEmbedResult{}, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	job, jobCtx, err := s.captureImmediateCloudScenarioJob(
		ctx, head, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), ignored, effective.resolvedAssembly,
	)
	if err != nil {
		return capabilitydriver.CloudEmbedResult{}, nil, err
	}
	jobID := job.GetJobId()
	defer s.finishScenarioJobExecution(jobID)
	if err := s.queueImmediateScenarioJob(jobID); err != nil {
		return capabilitydriver.CloudEmbedResult{}, job, err
	}
	release, acquireResult, err := s.scheduler.Acquire(jobCtx, head.GetAppId())
	if err != nil {
		executionErr := schedulerAcquireError(err)
		s.finishCloudScenarioJobFailure(jobCtx, jobID, executionErr)
		return capabilitydriver.CloudEmbedResult{}, job, executionErr
	}
	defer release()
	s.attachQueueWaitUnary(jobCtx, acquireResult)
	if err := s.startImmediateScenarioJob(jobID); err != nil {
		return capabilitydriver.CloudEmbedResult{}, job, err
	}
	assembly, ok := s.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok {
		err := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return capabilitydriver.CloudEmbedResult{}, job, err
	}
	executionEffective, err := s.cloudEmbedEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return capabilitydriver.CloudEmbedResult{}, job, err
	}
	defer executionEffective.release()
	requestCtx, cancel, err := withTimeout(jobCtx, head.GetTimeoutMs(), defaultEmbedTimeout)
	if err != nil {
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return capabilitydriver.CloudEmbedResult{}, job, err
	}
	defer cancel()
	result, err := s.executeCapturedCloudEmbed(requestCtx, executionEffective)
	if err != nil {
		s.finishCloudScenarioJobFailure(requestCtx, jobID, err)
		return capabilitydriver.CloudEmbedResult{}, job, err
	}
	if err := s.completeImmediateScenarioJob(jobID, nil, result.Usage); err != nil {
		s.finishCloudScenarioJobFailure(requestCtx, jobID, err)
		return capabilitydriver.CloudEmbedResult{}, job, err
	}
	return result, job, nil
}

func (s *Service) auditCloudEmbedCapture(effective *cloudEmbedEffectiveInputs) error {
	if s == nil || s.audit == nil || effective == nil || effective.request == nil {
		return nil
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(effective.request)
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	digest := sha256.Sum256(raw)
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
		"capability_contract":   capabilitydriver.TextEmbedCapabilityContract,
		"implementation_id":     effective.implementation.GetImplementationId(),
		"driver_id":             effective.implementation.GetDriverId(),
		"driver_dialect":        effective.implementation.GetDriverDialect(),
		"provider_model_target": target,
		"connector_id":          effective.connector.ConnectorID,
		"defaults":              defaults,
		"request_sha256":        "sha256:" + hex.EncodeToString(digest[:]),
		"request_size_bytes":    len(raw),
		"input_count":           len(effective.request.GetInputs()),
		"remote_execution_host": remoteexecution.ProviderHTTPEmbedHostID,
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
		Operation:     "cloud.embed.composition.capture",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       effective.traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write cloud embedding composition audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}
