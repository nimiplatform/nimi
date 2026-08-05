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
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type cloudEmbedEffectiveInputs struct {
	implementation *runtimev1.CapabilityImplementationIdentity
	rawTarget      *structpb.Struct
	target         capabilitydriver.CloudEmbedTarget
	catalogTarget  *nimillm.RemoteTarget
	grant          connector.ConnectorGrantSnapshot
	defaults       *structpb.Struct
	request        *runtimev1.TextEmbedScenarioSpec
	mapped         *capabilitydriver.CloudEmbedMappedRequest
	driver         capabilitydriver.CloudEmbedDriver
	traceID        string
	appID          string
	accountID      string
}

func (input *cloudEmbedEffectiveInputs) release() {
	if input == nil {
		return
	}
	input.implementation = nil
	input.rawTarget = nil
	input.target = capabilitydriver.CloudEmbedTarget{}
	input.catalogTarget = nil
	input.grant = connector.ConnectorGrantSnapshot{}
	input.defaults = nil
	input.request = nil
	input.mapped = nil
	input.driver = nil
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
		ConnectorGrantID:     input.grant.Grant.GrantID,
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
	grantID := intent.GrantID()
	accountID := scenarioTargetSubjectUserID(ctx, head)
	if grantID == "" || grantID != intent.ConnectorGrantID || accountID == "" || s.connStore == nil {
		return nil, connectorGrantExecutionError(connector.ErrConnectorGrantSelectionRequired)
	}
	grant, err := s.connStore.ValidateGrantBinding(accountID, grantID)
	if err != nil {
		return nil, connectorGrantExecutionError(err)
	}
	if grant.Connector.Provider != target.Provider() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}

	// Catalog admission consumes only connector/config identities and performs
	// no provider probe or credential resolution.
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
	effectiveRequest, _ := proto.Clone(request.GetSpec().GetTextEmbed()).(*runtimev1.TextEmbedScenarioSpec)
	effective := &cloudEmbedEffectiveInputs{
		implementation: implementation,
		rawTarget:      rawTarget,
		target:         target,
		catalogTarget:  safeTarget,
		grant:          grant,
		defaults:       defaults,
		request:        effectiveRequest,
		mapped:         mapped,
		driver:         driver,
		traceID:        ulid.Make().String(),
		appID:          strings.TrimSpace(head.GetAppId()),
		accountID:      accountID,
	}
	if err := s.auditCloudEmbedCapture(effective); err != nil {
		effective.release()
		return nil, err
	}
	return effective, nil
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
	response, err := s.remoteEmbedHost.ExecuteEmbed(ctx, effective.grant, effective.target, effective.mapped, effective.dispatchAudit())
	if err != nil {
		return capabilitydriver.CloudEmbedResult{}, effective.driver.NormalizeReason(err)
	}
	result, err := effective.driver.NormalizeResponse(effective.mapped, response)
	if err != nil {
		return capabilitydriver.CloudEmbedResult{}, cloudEmbedDriverError(err)
	}
	return result, nil
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
		"connector_grant_id":    effective.grant.Grant.GrantID,
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
