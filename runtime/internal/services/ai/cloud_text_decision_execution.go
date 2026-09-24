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
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
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

// cloudDecideEffectiveInputs is the immutable, credential-free Cloud
// text.decide composition captured before the immediate Job is published.
type cloudDecideEffectiveInputs struct {
	implementation   *runtimev1.CapabilityImplementationIdentity
	rawTarget        *structpb.Struct
	target           capabilitydriver.CloudDecideTarget
	connector        connector.ConnectorRecord
	defaults         *structpb.Struct
	request          *runtimev1.TextDecideScenarioSpec
	mapped           *capabilitydriver.CloudDecideMappedRequest
	driver           capabilitydriver.CloudDecideDriver
	traceID          string
	appID            string
	accountID        string
	resolvedAssembly *cloudResolvedAssembly
}

func (input *cloudDecideEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	return input.target.ProviderModelID()
}

func (input *cloudDecideEffectiveInputs) dispatchAudit() remoteexecution.DecideDispatchAudit {
	if input == nil {
		return remoteexecution.DecideDispatchAudit{}
	}
	return remoteexecution.DecideDispatchAudit{
		AppID:                input.appID,
		AccountID:            input.accountID,
		TraceID:              input.traceID,
		CapabilityContract:   aicapabilities.TextDecide,
		ImplementationID:     input.implementation.GetImplementationId(),
		DriverID:             input.implementation.GetDriverId(),
		DriverDialect:        input.implementation.GetDriverDialect(),
		ConnectorID:          input.connector.ConnectorID,
		Provider:             input.target.Provider(),
		ProviderModelID:      input.target.ProviderModelID(),
		RemoteModelCatalogID: input.target.RemoteModelCatalogID(),
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.typesafe-cloud-decision
// executeCloudTextDecision captures and runs one Cloud text.decide immediate
// Job through the exact committed Connector and provider-model target. It
// never retries through another provider, model, or route.
func (s *Service) executeCloudTextDecision(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.TextDecideScenarioSpec,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (textDecisionExecution, error) {
	effective, err := s.captureCloudDecideEffectiveInputs(ctx, head, spec)
	if err != nil {
		return textDecisionExecution{}, err
	}
	job, jobCtx, err := s.captureImmediateCloudScenarioJob(
		ctx, head, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_DECIDE,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), ignored, effective.resolvedAssembly,
	)
	if err != nil {
		return textDecisionExecution{}, err
	}
	result, err := s.runCapturedCloudDecideJob(jobCtx, job)
	if err != nil {
		return textDecisionExecution{}, err
	}
	return textDecisionExecution{
		result:        result.Result,
		usage:         result.Usage,
		job:           job,
		route:         runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		modelResolved: effective.modelResolved(),
	}, nil
}

// captureCloudDecideEffectiveInputs fixes the exact Connector, Driver target,
// mapped provider request and secret-free ResolvedAssembly before scheduling.
// Missing credentials, Connectors or targets fail here, before any dispatch.
func (s *Service) captureCloudDecideEffectiveInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.TextDecideScenarioSpec,
) (*cloudDecideEffectiveInputs, error) {
	if s == nil || head == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveCloudDecideConsumerIntent(ctx, head)
	if err != nil {
		return nil, err
	}
	if !intent.IsAIConfigCloud() || intent.CapabilityContract != aicapabilities.TextDecide || s.cloudDecideDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	driver, target, err := s.cloudDecideDrivers.Resolve(
		capabilitydriver.IdentityFromProto(intent.CloudImplementation),
		intent.ProviderModelTarget,
	)
	if err != nil {
		return nil, cloudDecideDriverError(err)
	}
	accountID := scenarioTargetSubjectUserID(ctx, head)
	connectorRecord, binding, err := connector.ResolveExactAccountConnectorBinding(s.connStore, s.speechCatalog, accountID, connector.RemoteModelCatalogRef{
		ConnectorID:          intent.ConnectorRef,
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ProviderModelID:      target.ProviderModelID(),
		Provider:             target.Provider(),
	})
	if err != nil {
		return nil, err
	}
	if binding == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	// Catalog admission consumes only Connector/config identities and performs
	// no provider probe or credential resolution.
	catalogTarget := &nimillm.RemoteTarget{
		ProviderType:         target.Provider(),
		ProviderModelID:      target.ProviderModelID(),
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ConnectorID:          connectorRecord.ConnectorID,
	}
	applyRemoteModelCatalogBinding(catalogTarget, binding)
	capturedSpec, _ := proto.Clone(spec).(*runtimev1.TextDecideScenarioSpec)
	appID := strings.TrimSpace(head.GetAppId())
	admission := &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: accountID},
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_DECIDE,
		Spec:          &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextDecide{TextDecide: capturedSpec}},
	}
	if err := s.validateScenarioCapability(ctx, admission, target.ProviderModelID(), catalogTarget, s.cloudTextProvider); err != nil {
		return nil, err
	}
	mapped, err := driver.MapRequest(target, capturedSpec, intent.Defaults)
	if err != nil {
		return nil, cloudDecideDriverError(err)
	}
	implementation, _ := proto.Clone(intent.CloudImplementation).(*runtimev1.CapabilityImplementationIdentity)
	rawTarget, _ := proto.Clone(intent.ProviderModelTarget).(*structpb.Struct)
	defaults, _ := proto.Clone(intent.Defaults).(*structpb.Struct)
	effective := &cloudDecideEffectiveInputs{
		implementation: implementation,
		rawTarget:      rawTarget,
		target:         target,
		connector:      connectorRecord,
		defaults:       defaults,
		request:        capturedSpec,
		mapped:         mapped,
		driver:         driver,
		traceID:        ulid.Make().String(),
		appID:          appID,
		accountID:      accountID,
	}
	effective.resolvedAssembly, err = newCloudResolvedAssembly(
		cloudResolvedRequestDecide, aicapabilities.TextDecide, implementation, rawTarget,
		connectorRecord, defaults, capturedSpec, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, capabilitydriver.CloudMediaStreamNone,
		effective.traceID, effective.appID, effective.accountID, nil,
	)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "Cloud ResolvedAssembly capture failed"})
	}
	if err := s.auditCloudDecideCapture(effective); err != nil {
		return nil, err
	}
	return effective, nil
}

func (s *Service) resolveCloudDecideConsumerIntent(ctx context.Context, head *runtimev1.ScenarioRequestHead) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, aicapabilities.TextDecide)
	return intent, err
}

// cloudDecideEffectiveInputsFromResolvedAssembly rebuilds the execution
// inputs only from the durable Job capture, never from current configuration.
func (s *Service) cloudDecideEffectiveInputsFromResolvedAssembly(assembly *cloudResolvedAssembly) (*cloudDecideEffectiveInputs, error) {
	if s == nil || assembly == nil || assembly.RequestKind != cloudResolvedRequestDecide || s.cloudDecideDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if err := validateCloudResolvedAssembly(assembly); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	implementation, err := assembly.implementationProto()
	if err != nil {
		return nil, cloudDecideDriverError(err)
	}
	rawTarget, err := assembly.providerTargetProto()
	if err != nil {
		return nil, cloudDecideDriverError(err)
	}
	defaults, err := assembly.defaultsProto()
	if err != nil {
		return nil, cloudDecideDriverError(err)
	}
	request := &runtimev1.TextDecideScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request, request); err != nil {
		return nil, cloudDecideDriverError(err)
	}
	driver, target, err := s.cloudDecideDrivers.Resolve(capabilitydriver.IdentityFromProto(implementation), rawTarget)
	if err != nil {
		return nil, cloudDecideDriverError(err)
	}
	mapped, err := driver.MapRequest(target, request, defaults)
	if err != nil {
		return nil, cloudDecideDriverError(err)
	}
	clonedAssembly, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	return &cloudDecideEffectiveInputs{
		implementation: implementation, rawTarget: rawTarget, target: target,
		connector: connectorRecordWithCredentialCustody(cloneConnectorRecord(assembly.Connector), assembly.CredentialCustodyRef),
		defaults:  defaults, request: request, mapped: mapped, driver: driver,
		traceID: assembly.TraceID, appID: assembly.AppID, accountID: assembly.AccountID, resolvedAssembly: clonedAssembly,
	}, nil
}

func cloudDecideDriverError(err error) error {
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
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "provider decision output is invalid"})
	default:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
}

func (s *Service) executeCapturedCloudDecide(ctx context.Context, effective *cloudDecideEffectiveInputs) (capabilitydriver.CloudDecideResult, error) {
	if s == nil || effective == nil || effective.driver == nil || s.remoteDecideHost == nil {
		return capabilitydriver.CloudDecideResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	response, err := s.remoteDecideHost.ExecuteDecide(ctx, effective.connector, effective.target, effective.mapped, effective.dispatchAudit())
	if err != nil {
		return capabilitydriver.CloudDecideResult{}, effective.driver.NormalizeReason(err)
	}
	result, err := effective.driver.NormalizeResponse(effective.mapped, response)
	if err != nil {
		return capabilitydriver.CloudDecideResult{}, cloudDecideDriverError(err)
	}
	return result, nil
}

// runCapturedCloudDecideJob executes the published immediate Job. The typed
// result is validated against the captured request before the Job completes;
// cancellation or timeout observed before completion publishes no success.
func (s *Service) runCapturedCloudDecideJob(jobCtx context.Context, job *runtimev1.ScenarioJob) (capabilitydriver.CloudDecideResult, error) {
	head := job.GetHead()
	jobID := job.GetJobId()
	defer s.finishScenarioJobExecution(jobID)
	if err := s.queueImmediateScenarioJob(jobID); err != nil {
		return capabilitydriver.CloudDecideResult{}, err
	}
	release, acquireResult, err := s.scheduler.Acquire(jobCtx, head.GetAppId())
	if err != nil {
		executionErr := schedulerAcquireError(err)
		s.finishCloudScenarioJobFailure(jobCtx, jobID, executionErr)
		return capabilitydriver.CloudDecideResult{}, executionErr
	}
	defer release()
	s.attachQueueWaitUnary(jobCtx, acquireResult)
	if err := s.startImmediateScenarioJob(jobID); err != nil {
		return capabilitydriver.CloudDecideResult{}, err
	}
	assembly, ok := s.scenarioJobs.cloudResolvedAssembly(jobID)
	if !ok {
		err := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return capabilitydriver.CloudDecideResult{}, err
	}
	executionEffective, err := s.cloudDecideEffectiveInputsFromResolvedAssembly(assembly)
	if err != nil {
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return capabilitydriver.CloudDecideResult{}, err
	}
	requestCtx, cancel, err := withTimeout(jobCtx, head.GetTimeoutMs(), defaultDecideTimeout)
	if err != nil {
		s.finishCloudScenarioJobFailure(jobCtx, jobID, err)
		return capabilitydriver.CloudDecideResult{}, err
	}
	defer cancel()
	result, err := s.executeCapturedCloudDecide(requestCtx, executionEffective)
	if err != nil {
		s.logCloudDecideTransportFailure(requestCtx, jobID, err)
		s.finishCloudScenarioJobFailure(requestCtx, jobID, err)
		return capabilitydriver.CloudDecideResult{}, err
	}
	if err := validateTextDecisionResult(executionEffective.request, result.Result); err != nil {
		s.finishCloudScenarioJobFailure(requestCtx, jobID, err)
		return capabilitydriver.CloudDecideResult{}, err
	}
	if ctxErr := requestCtx.Err(); ctxErr != nil {
		if scenarioDeadlineElapsed(requestCtx) {
			ctxErr = context.DeadlineExceeded
		}
		err := executionEffective.driver.NormalizeReason(ctxErr)
		s.finishCloudScenarioJobFailure(requestCtx, jobID, err)
		return capabilitydriver.CloudDecideResult{}, err
	}
	if err := s.completeImmediateScenarioJob(jobID, nil, result.Usage); err != nil {
		s.finishCloudScenarioJobFailure(requestCtx, jobID, err)
		return capabilitydriver.CloudDecideResult{}, err
	}
	return result, nil
}

// logCloudDecideTransportFailure records how a live call's provider request
// failed before the provider returned any status, so a later occurrence can be
// told apart. Only the failure class is kept, never addresses, URLs, or
// provider text.
func (s *Service) logCloudDecideTransportFailure(ctx context.Context, jobID string, err error) {
	if s.logger == nil || ctx.Err() != nil {
		return
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		return
	}
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok && metadata["provider_http_status"] != "" {
		return
	}
	s.logger.Warn("cloud decision request failed before a provider status", "job_id", jobID, "failure_class", nimillm.ProviderRequestFailureClass(err))
}

func (s *Service) auditCloudDecideCapture(effective *cloudDecideEffectiveInputs) error {
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
		"capability_contract":   aicapabilities.TextDecide,
		"implementation_id":     effective.implementation.GetImplementationId(),
		"driver_id":             effective.implementation.GetDriverId(),
		"driver_dialect":        effective.implementation.GetDriverDialect(),
		"wire_dialect":          effective.mapped.Dialect(),
		"provider_model_target": target,
		"connector_id":          effective.connector.ConnectorID,
		"defaults":              defaults,
		"request_sha256":        "sha256:" + hex.EncodeToString(digest[:]),
		"request_size_bytes":    len(raw),
		"question_count":        len(effective.request.GetQuestions()),
		"remote_execution_host": remoteexecution.ProviderHTTPDecideHostID,
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
		Operation:     "cloud.decide.composition.capture",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       effective.traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write cloud decision composition audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}
