package runtimeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const runtimeAgentAIProfileJSONLimit = 4 << 20

var runtimeAgentAIProfileForbiddenFields = map[string]struct{}{
	"RuntimeRouteBinding":          {},
	"selectedBindings":             {},
	"selected_source_records":      {},
	"selectedSourceRecords":        {},
	"install_evidence":             {},
	"installEvidence":              {},
	"materialization_evidence":     {},
	"materializationEvidence":      {},
	"workflow_binding_id":          {},
	"workflowBindingId":            {},
	"prepared_asset_id":            {},
	"preparedAssetId":              {},
	"backend_environment_evidence": {},
	"backendEnvironmentEvidence":   {},
	"provider_health":              {},
	"providerHealth":               {},
	"scheduler_state":              {},
	"schedulerState":               {},
	"credential_payload":           {},
	"credentialPayload":            {},
	"secret":                       {},
	"token":                        {},
	"apiKey":                       {},
	"api_key":                      {},
	"oauth":                        {},
	"endpoint":                     {},
	"localModelId":                 {},
	"goRuntimeLocalModelId":        {},
	"goRuntimeStatus":              {},
	"boundAssetId":                 {},
	"runtimeLocalRouteTarget":      {},
	"runtimeExecutionTraceId":      {},
	"providerHints":                {},
	"binding":                      {},
	"localProfileRef":              {},
	"localProfileRefs":             {},
}

type runtimeAgentPortableAIProfile struct {
	ProfileID    string                                              `json:"profileId"`
	Version      string                                              `json:"version,omitempty"`
	Revision     string                                              `json:"revision,omitempty"`
	Title        string                                              `json:"title"`
	Capabilities map[string]*runtimeAgentPortableAIProfileCapability `json:"capabilities"`
}

type runtimeAgentPortableAIProfileCapability struct {
	LogicalModelID  string                                  `json:"logicalModelId,omitempty"`
	TargetRef       *runtimeAgentPortableAIProfileTargetRef `json:"targetRef,omitempty"`
	Params          json.RawMessage                         `json:"params,omitempty"`
	ReadinessPolicy string                                  `json:"readinessPolicy,omitempty"`
	ContractState   string                                  `json:"contractState,omitempty"`
}

type runtimeAgentPortableAIProfileTargetRef struct {
	Kind                 string `json:"kind"`
	SourceProfileID      string `json:"sourceProfileId,omitempty"`
	SliceID              string `json:"sliceId,omitempty"`
	ConnectorID          string `json:"connectorId,omitempty"`
	RemoteModelCatalogID string `json:"remoteModelCatalogId,omitempty"`
	ProviderModelID      string `json:"providerModelId,omitempty"`
	Provider             string `json:"provider,omitempty"`
}

type runtimeAgentAIProfileProjection struct {
	before               *runtimev1.RuntimeAgentAIConfig
	after                *runtimev1.RuntimeAgentAIConfig
	outcome              runtimev1.RuntimeAgentAIProfileApplyOutcome
	blockingCapabilities []string
	reasonCodes          []string
	actionRefs           []string
	probeWarnings        []string
}

func (s *Service) PreviewRuntimeAgentAIProfile(
	ctx context.Context,
	req *runtimev1.PreviewRuntimeAgentAIProfileRequest,
) (*runtimev1.PreviewRuntimeAgentAIProfileResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "preview runtime agent ai profile request is required")
	}
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	if err := s.authorizeProtectedAIConfigIdentity(ctx, req.GetContext(), "runtime.agent.write"); err != nil {
		return nil, err
	}
	projection, err := s.prepareRuntimeAgentAIProfileProjection(
		ctx,
		req.GetContext(),
		req.GetProfileJson(),
		req.GetRuntimeDescriptorJson(),
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.PreviewRuntimeAgentAIProfileResponse{
		Before:               cloneRuntimeAgentAIConfig(projection.before),
		After:                cloneRuntimeAgentAIConfig(projection.after),
		Outcome:              projection.outcome,
		BaseRevision:         projection.before.GetRevision(),
		BlockingCapabilities: append([]string(nil), projection.blockingCapabilities...),
		ReasonCodes:          append([]string(nil), projection.reasonCodes...),
		ActionRefs:           append([]string(nil), projection.actionRefs...),
		ProbeWarnings:        append([]string(nil), projection.probeWarnings...),
	}, nil
}

func (s *Service) ApplyRuntimeAgentAIProfile(
	ctx context.Context,
	req *runtimev1.ApplyRuntimeAgentAIProfileRequest,
) (*runtimev1.ApplyRuntimeAgentAIProfileResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "apply runtime agent ai profile request is required")
	}
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	if err := s.authorizeProtectedAIConfigIdentity(ctx, req.GetContext(), "runtime.agent.write"); err != nil {
		return nil, err
	}
	current, err := s.committedRuntimeAgentAIConfigForContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	if current.GetRevision() != req.GetExpectedRevision() {
		return &runtimev1.ApplyRuntimeAgentAIProfileResponse{
			Outcome:       runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_STALE_BASE,
			ReasonCodes:   []string{"stale_base"},
			ProbeWarnings: nil,
		}, nil
	}
	projection, err := s.prepareRuntimeAgentAIProfileProjection(
		ctx,
		req.GetContext(),
		req.GetProfileJson(),
		req.GetRuntimeDescriptorJson(),
	)
	if err != nil {
		return nil, err
	}
	response := &runtimev1.ApplyRuntimeAgentAIProfileResponse{
		Outcome:              projection.outcome,
		BlockingCapabilities: append([]string(nil), projection.blockingCapabilities...),
		ReasonCodes:          append([]string(nil), projection.reasonCodes...),
		ActionRefs:           append([]string(nil), projection.actionRefs...),
		ProbeWarnings:        append([]string(nil), projection.probeWarnings...),
	}
	if projection.outcome != runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY ||
		projection.after == nil {
		return response, nil
	}
	committed, err := s.upsertRuntimeAgentAIConfig(
		req.GetContext(),
		req.GetExpectedRevision(),
		projection.after.GetIntents(),
		projection.after.GetProfileOrigin(),
	)
	if err != nil {
		if reason, ok := grpcerr.ExtractReasonCode(err); ok {
			switch reason {
			case runtimev1.ReasonCode_AGENT_AI_CONFIG_REVISION_CONFLICT:
				response.Outcome = runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_STALE_BASE
				response.ReasonCodes = []string{"stale_base"}
				return response, nil
			case runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE:
				response.Outcome = runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG
				response.ReasonCodes = []string{"target_unavailable"}
				return response, nil
			case runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_INVALID,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH,
				runtimev1.ReasonCode_AGENT_AI_CONFIG_MODEL_TARGET_MISMATCH:
				response.Outcome = runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_INVALID_PROFILE
				response.ReasonCodes = []string{"profile_materialization_invalid"}
				return response, nil
			}
		}
		return nil, err
	}
	response.Config = committed
	return response, nil
}

func (s *Service) prepareRuntimeAgentAIProfileProjection(
	ctx context.Context,
	requestContext *runtimev1.AgentRequestContext,
	profileJSON []byte,
	descriptorJSON []byte,
) (*runtimeAgentAIProfileProjection, error) {
	before, err := s.committedRuntimeAgentAIConfigForContext(requestContext)
	if err != nil {
		return nil, err
	}
	projection := &runtimeAgentAIProfileProjection{
		before:  before,
		outcome: runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_INVALID_PROFILE,
	}
	profile, warnings := parseRuntimeAgentPortableAIProfile(profileJSON)
	if profile == nil {
		projection.reasonCodes = []string{"invalid_profile"}
		projection.probeWarnings = warnings
		return projection, nil
	}
	s.localAppRouteOptionsMu.RLock()
	preparer := s.profileDescriptorPreparer
	s.localAppRouteOptionsMu.RUnlock()
	if preparer == nil {
		projection.outcome = runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_FAILED
		projection.reasonCodes = []string{"runtime_profile_preparer_unavailable"}
		return projection, nil
	}
	prepared, err := preparer.PrepareProfileRuntimeDescriptorForAIConfig(ctx, descriptorJSON)
	if err != nil {
		if status.Code(err) == codes.InvalidArgument {
			projection.reasonCodes = []string{"invalid_runtime_descriptor"}
			projection.probeWarnings = []string{"runtime_descriptor_rejected"}
			return projection, nil
		}
		return nil, err
	}
	if prepared == nil || strings.TrimSpace(prepared.ProfileID) != profile.ProfileID {
		projection.reasonCodes = []string{"profile_descriptor_mismatch"}
		return projection, nil
	}

	intents := make([]*runtimev1.RuntimeAgentAIConfigIntent, 0, len(prepared.SliceResults))
	seenCapabilities := make(map[string]struct{}, len(prepared.SliceResults))
	blockingOutcome := runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY
	for _, slice := range prepared.SliceResults {
		capability := strings.TrimSpace(slice.Capability)
		if capability == "" || !isAdmittedRuntimeAgentAIConfigCapability(capability) {
			projection.reasonCodes = []string{"profile_capability_invalid"}
			return projection, nil
		}
		if _, duplicate := seenCapabilities[capability]; duplicate {
			projection.reasonCodes = []string{"profile_capability_ambiguous"}
			return projection, nil
		}
		seenCapabilities[capability] = struct{}{}
		switch strings.TrimSpace(slice.Outcome) {
		case "optional_omitted":
			continue
		case "setup_required_no_live_config":
			blockingOutcome = mergeRuntimeAgentAIProfileBlockingOutcome(
				blockingOutcome,
				runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG,
			)
			addRuntimeAgentAIProfileBlocker(projection, capability, slice.SliceID, slice.ReasonCodes)
			continue
		case "unsupported_no_live_config":
			blockingOutcome = mergeRuntimeAgentAIProfileBlockingOutcome(
				blockingOutcome,
				runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_UNSUPPORTED_NO_LIVE_CONFIG,
			)
			addRuntimeAgentAIProfileBlocker(projection, capability, slice.SliceID, slice.ReasonCodes)
			continue
		case "failed_no_live_config":
			blockingOutcome = mergeRuntimeAgentAIProfileBlockingOutcome(
				blockingOutcome,
				runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_FAILED,
			)
			addRuntimeAgentAIProfileBlocker(projection, capability, slice.SliceID, slice.ReasonCodes)
			continue
		case "ready":
		default:
			projection.reasonCodes = []string{"profile_prepare_outcome_invalid"}
			return projection, nil
		}
		intent, materializeReason, err := s.materializeRuntimeAgentAIProfileIntent(ctx, profile, slice)
		if err != nil {
			return nil, err
		}
		if materializeReason != "" {
			if materializeReason == "connector_route_unavailable" || materializeReason == "connector_route_ambiguous" {
				blockingOutcome = mergeRuntimeAgentAIProfileBlockingOutcome(
					blockingOutcome,
					runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG,
				)
				addRuntimeAgentAIProfileBlocker(projection, capability, slice.SliceID, []string{materializeReason})
				continue
			}
			projection.reasonCodes = []string{materializeReason}
			return projection, nil
		}
		intents = append(intents, intent)
	}
	if blockingOutcome != runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY {
		projection.outcome = blockingOutcome
		projection.blockingCapabilities = uniqueSortedRuntimeAgentAIProfileStrings(projection.blockingCapabilities)
		projection.reasonCodes = uniqueSortedRuntimeAgentAIProfileStrings(projection.reasonCodes)
		projection.actionRefs = uniqueSortedRuntimeAgentAIProfileStrings(projection.actionRefs)
		return projection, nil
	}
	normalized, err := normalizeRuntimeAgentAIConfigIntents(intents)
	if err != nil {
		projection.reasonCodes = []string{"profile_ai_config_invalid"}
		return projection, nil
	}
	if err := s.validateRuntimeAgentAIConfigLocalTargets(ctx, before, normalized); err != nil {
		if reason, ok := grpcerr.ExtractReasonCode(err); ok &&
			reason == runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE {
			projection.outcome = runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG
			projection.reasonCodes = []string{"target_unavailable"}
			return projection, nil
		}
		projection.reasonCodes = []string{"profile_materialization_invalid"}
		return projection, nil
	}
	appliedAt := timestamppb.New(time.Now().UTC())
	projection.after = &runtimev1.RuntimeAgentAIConfig{
		AgentInstanceId: requestContext.GetLocalAgentRef(),
		Revision:        before.GetRevision() + 1,
		Intents:         normalized,
		UpdatedAt:       appliedAt,
		UpdatedByAppId:  strings.TrimSpace(requestContext.GetAppId()),
		ProfileOrigin: &runtimev1.RuntimeAgentAIProfileOrigin{
			ProfileId: profile.ProfileID,
			Title:     profile.Title,
			AppliedAt: appliedAt,
		},
	}
	projection.outcome = runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY
	return projection, nil
}

func (s *Service) materializeRuntimeAgentAIProfileIntent(
	ctx context.Context,
	profile *runtimeAgentPortableAIProfile,
	slice localservice.ProfileRuntimeDescriptorPrepareSliceResult,
) (*runtimev1.RuntimeAgentAIConfigIntent, string, error) {
	capability := strings.TrimSpace(slice.Capability)
	authored := profile.Capabilities[capability]
	if authored == nil || authored.TargetRef == nil {
		return nil, "profile_slice_unresolved", nil
	}
	if authored.ReadinessPolicy != "" && authored.ReadinessPolicy != strings.TrimSpace(slice.ReadinessPolicy) {
		return nil, "profile_readiness_policy_mismatch", nil
	}
	if authored.ContractState != "" && authored.ContractState != "declared" {
		return nil, "profile_contract_state_mismatch", nil
	}
	params, ok := runtimeAgentAIProfileParams(authored.Params)
	if !ok {
		return nil, "profile_params_invalid", nil
	}
	switch strings.TrimSpace(slice.ExecutionMode) {
	case "local":
		target := authored.TargetRef
		if target.Kind != "profile-slice" ||
			strings.TrimSpace(target.SourceProfileID) != profile.ProfileID ||
			strings.TrimSpace(target.SliceID) != strings.TrimSpace(slice.SliceID) {
			return nil, "profile_slice_target_mismatch", nil
		}
		if slice.TargetRef == nil {
			return nil, "profile_slice_target_mismatch", nil
		}
		logicalModelID := strings.TrimSpace(slice.LogicalModelID)
		if logicalModelID == "" {
			return nil, "profile_logical_model_unresolved", nil
		}
		if authoredModel := strings.TrimSpace(authored.LogicalModelID); authoredModel != "" && authoredModel != logicalModelID {
			return nil, "profile_model_target_mismatch", nil
		}
		components, err := runtimeAgentAIProfileComponentSelections(slice.SelectedComponents)
		if err != nil {
			return nil, "profile_component_materialization_invalid", nil
		}
		return &runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  capability,
			ModelId:     logicalModelID,
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
					LocalRuntime: proto.Clone(slice.TargetRef).(*runtimev1.RuntimeDurableLocalTargetRef),
				},
			},
			SelectedParams:     params,
			SelectedComponents: components,
		}, "", nil
	case "cloud_connector":
		return s.materializeRuntimeAgentAIProfileCloudIntent(ctx, authored, slice, params)
	default:
		return nil, "profile_execution_mode_invalid", nil
	}
}

func runtimeAgentAIProfileComponentSelections(
	values []localservice.ProfileRuntimeDescriptorPreparedComponentSelection,
) ([]*runtimev1.RuntimeAgentAIConfigComponentSelection, error) {
	out := make([]*runtimev1.RuntimeAgentAIConfigComponentSelection, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value.OccurrenceID) == "" ||
			value.Order < 0 ||
			strings.TrimSpace(value.Role) == "" ||
			strings.TrimSpace(value.ComponentKind) == "" ||
			strings.TrimSpace(value.LogicalModelID) == "" ||
			value.TargetRef == nil {
			return nil, fmt.Errorf("prepared profile component selection is incomplete")
		}
		var options *structpb.Struct
		if len(value.Options) > 0 {
			var err error
			options, err = structpb.NewStruct(value.Options)
			if err != nil {
				return nil, fmt.Errorf("prepared profile component options: %w", err)
			}
		}
		out = append(out, &runtimev1.RuntimeAgentAIConfigComponentSelection{
			OccurrenceId:   strings.TrimSpace(value.OccurrenceID),
			Order:          uint32(value.Order),
			Role:           strings.TrimSpace(value.Role),
			ComponentKind:  strings.TrimSpace(value.ComponentKind),
			LogicalModelId: strings.TrimSpace(value.LogicalModelID),
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
					LocalRuntime: proto.Clone(value.TargetRef).(*runtimev1.RuntimeDurableLocalTargetRef),
				},
			},
			Required: value.Required,
			Weight:   strings.TrimSpace(value.Weight),
			Options:  options,
		})
	}
	return out, nil
}

func (s *Service) materializeRuntimeAgentAIProfileCloudIntent(
	ctx context.Context,
	authored *runtimeAgentPortableAIProfileCapability,
	slice localservice.ProfileRuntimeDescriptorPrepareSliceResult,
	params *structpb.Struct,
) (*runtimev1.RuntimeAgentAIConfigIntent, string, error) {
	target := authored.TargetRef
	if target == nil || target.Kind != "cloud-connector" {
		return nil, "profile_cloud_target_invalid", nil
	}
	provider := strings.TrimSpace(slice.Provider)
	providerModelID := strings.TrimSpace(slice.ProviderModelID)
	connectorSelector := strings.TrimSpace(slice.ConnectorSelector)
	if provider == "" || providerModelID == "" ||
		(strings.TrimSpace(target.Provider) != "" && strings.TrimSpace(target.Provider) != provider) ||
		strings.TrimSpace(target.ProviderModelID) != providerModelID ||
		(connectorSelector != "" && strings.TrimSpace(target.ConnectorID) != connectorSelector) {
		return nil, "profile_cloud_target_mismatch", nil
	}
	if authoredModel := strings.TrimSpace(authored.LogicalModelID); authoredModel != "" && authoredModel != providerModelID {
		return nil, "profile_model_target_mismatch", nil
	}
	candidates, err := s.localAppCloudRouteCandidates(ctx)
	if err != nil {
		return nil, "", err
	}
	matches := make([]localAppCloudRouteCandidate, 0, 1)
	for _, candidate := range candidates {
		cloud := candidate.targetRef.GetCloud()
		if cloud == nil ||
			strings.TrimSpace(candidate.option.GetCapability()) != strings.TrimSpace(slice.Capability) ||
			strings.TrimSpace(cloud.GetProvider()) != provider ||
			strings.TrimSpace(cloud.GetProviderModelId()) != providerModelID ||
			strings.TrimSpace(cloud.GetConnectorId()) != strings.TrimSpace(target.ConnectorID) ||
			strings.TrimSpace(cloud.GetRemoteModelCatalogId()) != strings.TrimSpace(target.RemoteModelCatalogID) {
			continue
		}
		matches = append(matches, candidate)
	}
	if len(matches) == 0 {
		return nil, "connector_route_unavailable", nil
	}
	if len(matches) != 1 {
		return nil, "connector_route_ambiguous", nil
	}
	selected := matches[0].targetRef
	return &runtimev1.RuntimeAgentAIConfigIntent{
		Capability:     strings.TrimSpace(slice.Capability),
		ModelId:        providerModelID,
		RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorId:    strings.TrimSpace(selected.GetCloud().GetConnectorId()),
		Provider:       provider,
		TargetRef:      proto.Clone(selected).(*runtimev1.RuntimeDurableTargetRef),
		SelectedParams: params,
	}, "", nil
}

func parseRuntimeAgentPortableAIProfile(raw []byte) (*runtimeAgentPortableAIProfile, []string) {
	if len(raw) == 0 || len(raw) > runtimeAgentAIProfileJSONLimit {
		return nil, []string{"profile_json_invalid"}
	}
	var generic any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&generic); err != nil {
		return nil, []string{"profile_json_invalid"}
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, []string{"profile_json_trailing_data"}
	}
	if runtimeAgentAIProfileContainsForbiddenField(generic) {
		return nil, []string{"profile_contains_private_field"}
	}
	var profile runtimeAgentPortableAIProfile
	if err := json.Unmarshal(raw, &profile); err != nil {
		return nil, []string{"profile_json_invalid"}
	}
	profile.ProfileID = strings.TrimSpace(profile.ProfileID)
	profile.Title = strings.TrimSpace(profile.Title)
	if profile.ProfileID == "" || profile.Title == "" || len(profile.Capabilities) == 0 {
		return nil, []string{"profile_required_field_missing"}
	}
	for capability, intent := range profile.Capabilities {
		if strings.TrimSpace(capability) == "" || capability != strings.TrimSpace(capability) || intent == nil {
			return nil, []string{"profile_capability_invalid"}
		}
		intent.LogicalModelID = strings.TrimSpace(intent.LogicalModelID)
		intent.ReadinessPolicy = strings.TrimSpace(intent.ReadinessPolicy)
		intent.ContractState = strings.TrimSpace(intent.ContractState)
		if intent.ReadinessPolicy != "" && intent.ReadinessPolicy != "required" && intent.ReadinessPolicy != "optional" {
			return nil, []string{"profile_readiness_policy_invalid"}
		}
		if intent.ContractState != "" && intent.ContractState != "declared" &&
			intent.ContractState != "proposed" && intent.ContractState != "unsupported" {
			return nil, []string{"profile_contract_state_invalid"}
		}
	}
	return &profile, nil
}

func runtimeAgentAIProfileContainsForbiddenField(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if _, forbidden := runtimeAgentAIProfileForbiddenFields[key]; forbidden {
				return true
			}
			if runtimeAgentAIProfileContainsForbiddenField(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if runtimeAgentAIProfileContainsForbiddenField(child) {
				return true
			}
		}
	}
	return false
}

func runtimeAgentAIProfileParams(raw json.RawMessage) (*structpb.Struct, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, true
	}
	var params map[string]any
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.UseNumber()
	if err := decoder.Decode(&params); err != nil {
		return nil, false
	}
	normalized := normalizeRuntimeAgentAIProfileJSONNumbers(params).(map[string]any)
	out, err := structpb.NewStruct(normalized)
	return out, err == nil
}

func normalizeRuntimeAgentAIProfileJSONNumbers(value any) any {
	switch typed := value.(type) {
	case json.Number:
		if integer, err := typed.Int64(); err == nil {
			return integer
		}
		if decimal, err := typed.Float64(); err == nil {
			return decimal
		}
		return typed.String()
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			out[key] = normalizeRuntimeAgentAIProfileJSONNumbers(child)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for index, child := range typed {
			out[index] = normalizeRuntimeAgentAIProfileJSONNumbers(child)
		}
		return out
	default:
		return value
	}
}

func addRuntimeAgentAIProfileBlocker(
	projection *runtimeAgentAIProfileProjection,
	capability string,
	sliceID string,
	reasons []string,
) {
	projection.blockingCapabilities = append(projection.blockingCapabilities, strings.TrimSpace(capability))
	projection.actionRefs = append(projection.actionRefs, "setup:"+strings.TrimSpace(sliceID))
	projection.reasonCodes = append(projection.reasonCodes, reasons...)
}

func uniqueSortedRuntimeAgentAIProfileStrings(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			set[trimmed] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func mergeRuntimeAgentAIProfileBlockingOutcome(
	current runtimev1.RuntimeAgentAIProfileApplyOutcome,
	next runtimev1.RuntimeAgentAIProfileApplyOutcome,
) runtimev1.RuntimeAgentAIProfileApplyOutcome {
	rank := func(outcome runtimev1.RuntimeAgentAIProfileApplyOutcome) int {
		switch outcome {
		case runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_UNSUPPORTED_NO_LIVE_CONFIG:
			return 3
		case runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG:
			return 2
		case runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_FAILED:
			return 1
		default:
			return 0
		}
	}
	if rank(next) > rank(current) {
		return next
	}
	return current
}
