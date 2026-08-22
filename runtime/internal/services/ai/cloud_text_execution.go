package ai

import (
	"context"
	"encoding/json"
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

type cloudTextEffectiveInputs struct {
	implementation   *runtimev1.CapabilityImplementationIdentity
	rawTarget        *structpb.Struct
	target           capabilitydriver.CloudTextTarget
	catalogTarget    *nimillm.RemoteTarget
	connector        connector.ConnectorRecord
	defaults         *structpb.Struct
	request          *runtimev1.TextGenerateScenarioSpec
	mapped           *capabilitydriver.CloudTextMappedRequest
	driver           capabilitydriver.CloudTextDriver
	traceID          string
	appID            string
	accountID        string
	cleanup          func()
	resolvedAssembly *cloudResolvedAssembly
}

func (input *cloudTextEffectiveInputs) release() {
	if input != nil && input.cleanup != nil {
		input.cleanup()
	}
}

func (input *cloudTextEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	return input.target.ProviderModelID()
}

func (input *cloudTextEffectiveInputs) dispatchAudit() remoteexecution.TextDispatchAudit {
	if input == nil {
		return remoteexecution.TextDispatchAudit{}
	}
	return remoteexecution.TextDispatchAudit{
		AppID:                input.appID,
		AccountID:            input.accountID,
		TraceID:              input.traceID,
		CapabilityContract:   capabilitydriver.LlamaCapabilityContract,
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

// captureCloudTextEffectiveInputs is the r006 fixation point. Every field is
// cloned before return, and the returned graph contains no credential payload.
func (s *Service) captureCloudTextEffectiveInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	request scenarioRequestLike,
	mode runtimev1.ExecutionMode,
) (*cloudTextEffectiveInputs, error) {
	stream := mode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM
	if s == nil || head == nil || request == nil || request.GetSpec().GetTextGenerate() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveCloudTextConsumerIntent(ctx, head)
	if err != nil {
		return nil, err
	}
	if !intent.IsAIConfigCloud() || intent.CapabilityContract != capabilitydriver.LlamaCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	if s.cloudTextDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	driver, target, err := s.cloudTextDrivers.Resolve(
		capabilitydriver.IdentityFromProto(intent.CloudImplementation),
		intent.ProviderModelTarget,
	)
	if err != nil {
		return nil, cloudTextDriverError(err)
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

	// Catalog identity, when the Driver target carries one, is validated only
	// against the captured connector/config snapshot. It performs no probe.
	safeRemoteTarget := &nimillm.RemoteTarget{
		ProviderType:         target.Provider(),
		ProviderModelID:      target.ProviderModelID(),
		RemoteModelCatalogID: target.RemoteModelCatalogID(),
		ConnectorID:          connectorRecord.ConnectorID,
	}
	if binding != nil {
		applyRemoteModelCatalogBinding(safeRemoteTarget, binding)
	}
	selectedProvider := s.cloudTextProvider
	if err := s.validateScenarioCapability(ctx, request, target.ProviderModelID(), safeRemoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	if err := validateReasoningRequest(request.GetSpec().GetTextGenerate(), target.ProviderModelID(), safeRemoteTarget, selectedProvider, mode); err != nil {
		return nil, err
	}
	resolved, err := s.resolveTextGenerateScenario(ctx, head, target.ProviderModelID(), safeRemoteTarget, selectedProvider, request.GetSpec().GetTextGenerate())
	if err != nil {
		return nil, err
	}
	fail := func(err error) (*cloudTextEffectiveInputs, error) {
		resolved.release()
		return nil, err
	}
	if err := s.validateTextGenerateInputParts(ctx, target.ProviderModelID(), safeRemoteTarget, selectedProvider, resolved.spec.GetInput()); err != nil {
		return fail(err)
	}
	mapped, err := driver.MapRequest(target, resolved.spec, intent.Defaults, stream)
	if err != nil {
		return fail(cloudTextDriverError(err))
	}
	implementation, _ := proto.Clone(intent.CloudImplementation).(*runtimev1.CapabilityImplementationIdentity)
	rawTarget, _ := proto.Clone(intent.ProviderModelTarget).(*structpb.Struct)
	defaults, _ := proto.Clone(intent.Defaults).(*structpb.Struct)
	effectiveRequest := mapped.Spec()
	effective := &cloudTextEffectiveInputs{
		implementation: implementation,
		rawTarget:      rawTarget,
		target:         target,
		catalogTarget:  safeRemoteTarget,
		connector:      connectorRecord,
		defaults:       defaults,
		request:        effectiveRequest,
		mapped:         mapped,
		driver:         driver,
		traceID:        ulid.Make().String(),
		appID:          strings.TrimSpace(head.GetAppId()),
		accountID:      accountID,
		cleanup:        resolved.release,
	}
	effective.resolvedAssembly, err = newCloudResolvedAssembly(
		cloudResolvedRequestText, capabilitydriver.LlamaCapabilityContract, implementation, rawTarget,
		connectorRecord, defaults, effectiveRequest, mode, capabilitydriver.CloudMediaStreamNone,
		effective.traceID, effective.appID, effective.accountID, nil,
	)
	if err != nil {
		return fail(grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "Cloud ResolvedAssembly capture failed"}))
	}
	if err := s.auditCloudTextCapture(effective, stream); err != nil {
		return fail(err)
	}
	return effective, nil
}

func (s *Service) cloudTextEffectiveInputsFromResolvedAssembly(assembly *cloudResolvedAssembly) (*cloudTextEffectiveInputs, error) {
	if s == nil || assembly == nil || assembly.RequestKind != cloudResolvedRequestText || s.cloudTextDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if err := validateCloudResolvedAssembly(assembly); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	implementation, err := assembly.implementationProto()
	if err != nil {
		return nil, cloudTextDriverError(err)
	}
	rawTarget, err := assembly.providerTargetProto()
	if err != nil {
		return nil, cloudTextDriverError(err)
	}
	defaults, err := assembly.defaultsProto()
	if err != nil {
		return nil, cloudTextDriverError(err)
	}
	request := &runtimev1.TextGenerateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request, request); err != nil {
		return nil, cloudTextDriverError(err)
	}
	driver, target, err := s.cloudTextDrivers.Resolve(capabilitydriver.IdentityFromProto(implementation), rawTarget)
	if err != nil {
		return nil, cloudTextDriverError(err)
	}
	mapped, err := driver.MapRequest(target, request, defaults, assembly.ExecutionMode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM)
	if err != nil {
		return nil, cloudTextDriverError(err)
	}
	clonedAssembly, err := cloneCloudResolvedAssembly(assembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	connectorRecord := connectorRecordWithCredentialCustody(cloneConnectorRecord(assembly.Connector), assembly.CredentialCustodyRef)
	return &cloudTextEffectiveInputs{
		implementation: implementation, rawTarget: rawTarget, target: target,
		catalogTarget: &nimillm.RemoteTarget{ProviderType: target.Provider(), ProviderModelID: target.ProviderModelID(), RemoteModelCatalogID: target.RemoteModelCatalogID(), ConnectorID: connectorRecord.ConnectorID},
		connector:     connectorRecord, defaults: defaults, request: mapped.Spec(), mapped: mapped, driver: driver,
		traceID: assembly.TraceID, appID: assembly.AppID, accountID: assembly.AccountID, resolvedAssembly: clonedAssembly,
	}, nil
}

func (s *Service) resolveCloudTextConsumerIntent(ctx context.Context, head *runtimev1.ScenarioRequestHead) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.LlamaCapabilityContract)
	return intent, err
}

func cloudTextDriverError(err error) error {
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

func (s *Service) executeCapturedCloudText(ctx context.Context, effective *cloudTextEffectiveInputs) (capabilitydriver.CloudTextResult, error) {
	if s == nil || effective == nil || effective.driver == nil || s.remoteTextHost == nil {
		return capabilitydriver.CloudTextResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	transportResponse, err := s.remoteTextHost.ExecuteText(ctx, effective.connector, effective.target, effective.mapped, effective.dispatchAudit())
	if err != nil {
		return capabilitydriver.CloudTextResult{}, effective.driver.NormalizeReason(err)
	}
	result, err := effective.driver.NormalizeResponse(transportResponse)
	if err != nil {
		return capabilitydriver.CloudTextResult{}, cloudTextDriverError(err)
	}
	return result, nil
}

func (s *Service) streamCapturedCloudText(ctx context.Context, effective *cloudTextEffectiveInputs, onDelta func(string) error) (capabilitydriver.CloudTextResult, error) {
	if s == nil || effective == nil || effective.driver == nil || s.remoteTextHost == nil || onDelta == nil {
		return capabilitydriver.CloudTextResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	transportResponse, err := s.remoteTextHost.StreamText(ctx, effective.connector, effective.target, effective.mapped, func(raw string) error {
		delta, normalizeErr := effective.driver.NormalizeStreamDelta(raw)
		if normalizeErr != nil {
			return cloudTextDriverError(normalizeErr)
		}
		if delta == "" {
			return nil
		}
		return onDelta(delta)
	}, effective.dispatchAudit())
	if err != nil {
		return capabilitydriver.CloudTextResult{}, effective.driver.NormalizeReason(err)
	}
	result, err := effective.driver.NormalizeResponse(transportResponse)
	if err != nil {
		return capabilitydriver.CloudTextResult{}, cloudTextDriverError(err)
	}
	return result, nil
}

func (s *Service) auditCloudTextCapture(effective *cloudTextEffectiveInputs, stream bool) error {
	if s == nil || s.audit == nil || effective == nil {
		return nil
	}
	request, err := protoMessageMap(effective.request)
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
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
		"capability_contract":   capabilitydriver.LlamaCapabilityContract,
		"implementation_id":     effective.implementation.GetImplementationId(),
		"driver_id":             effective.implementation.GetDriverId(),
		"driver_dialect":        effective.implementation.GetDriverDialect(),
		"provider_model_target": target,
		"connector_id":          effective.connector.ConnectorID,
		"defaults":              defaults,
		"request":               request,
		"stream":                stream,
		"remote_execution_host": remoteexecution.ProviderHTTPTextHostID,
		"remote_dispatch_state": "captured",
	})
	if err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{})
	}
	if err := s.audit.AppendEventChecked(&runtimev1.AuditEventRecord{
		AppId:         effective.appID,
		SubjectUserId: effective.accountID,
		Domain:        "runtime.ai",
		Operation:     "cloud.composition.capture",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       effective.traceID,
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	}); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, fmt.Errorf("write cloud composition audit: %w", err), grpcerr.ReasonOptions{})
	}
	return nil
}

func protoMessageMap(message proto.Message) (map[string]any, error) {
	if message == nil {
		return map[string]any{}, nil
	}
	raw, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(message)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}
