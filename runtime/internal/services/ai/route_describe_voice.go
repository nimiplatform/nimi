package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const (
	voiceCloneRouteDescribeExtensionNamespace  = "nimi.scenario.voice_clone.route_describe"
	voiceDesignRouteDescribeExtensionNamespace = "nimi.scenario.voice_design.route_describe"
)

type voiceWorkflowRouteDescribeProbe struct {
	version            string
	resolvedBindingRef string
}

type voiceWorkflowTtsV2vRouteDescribeMetadataPayload struct {
	WorkflowType                   string   `json:"workflowType"`
	RequiresTargetSynthesisBinding bool     `json:"requiresTargetSynthesisBinding"`
	TextPromptMode                 string   `json:"textPromptMode"`
	SupportsLanguageHints          bool     `json:"supportsLanguageHints"`
	SupportsPreferredName          bool     `json:"supportsPreferredName"`
	ReferenceAudioURIInput         bool     `json:"referenceAudioUriInput"`
	ReferenceAudioBytesInput       bool     `json:"referenceAudioBytesInput"`
	AllowedReferenceAudioMimeTypes []string `json:"allowedReferenceAudioMimeTypes"`
	ProviderExtensionNamespace     string   `json:"providerExtensionNamespace,omitempty"`
	ProviderExtensionSchemaVersion string   `json:"providerExtensionSchemaVersion,omitempty"`
}

type voiceWorkflowTtsT2vRouteDescribeMetadataPayload struct {
	WorkflowType                   string `json:"workflowType"`
	RequiresTargetSynthesisBinding bool   `json:"requiresTargetSynthesisBinding"`
	InstructionTextMode            string `json:"instructionTextMode"`
	PreviewTextMode                string `json:"previewTextMode"`
	SupportsLanguage               bool   `json:"supportsLanguage"`
	SupportsPreferredName          bool   `json:"supportsPreferredName"`
	ProviderExtensionNamespace     string `json:"providerExtensionNamespace,omitempty"`
	ProviderExtensionSchemaVersion string `json:"providerExtensionSchemaVersion,omitempty"`
}

type voiceWorkflowRouteDescribeResultPayload struct {
	Capability         string `json:"capability"`
	MetadataVersion    string `json:"metadataVersion"`
	ResolvedBindingRef string `json:"resolvedBindingRef"`
	MetadataKind       string `json:"metadataKind"`
	Metadata           any    `json:"metadata"`
}

func voiceWorkflowRouteDescribeExtensionNamespace(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		return voiceCloneRouteDescribeExtensionNamespace
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return voiceDesignRouteDescribeExtensionNamespace
	default:
		return ""
	}
}

func voiceWorkflowRouteDescribeProbeFromExtensions(
	scenarioType runtimev1.ScenarioType,
	extensions []*runtimev1.ScenarioExtension,
) (*voiceWorkflowRouteDescribeProbe, bool, error) {
	namespace := voiceWorkflowRouteDescribeExtensionNamespace(scenarioType)
	if namespace == "" {
		return nil, false, nil
	}
	for _, item := range extensions {
		if strings.TrimSpace(item.GetNamespace()) != namespace {
			continue
		}
		payload := nimillm.StructToMap(item.GetPayload())
		version := strings.TrimSpace(stringValue(payload["version"]))
		resolvedBindingRef := strings.TrimSpace(stringValue(payload["resolvedBindingRef"]))
		if version != "v1" || resolvedBindingRef == "" {
			return nil, true, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &voiceWorkflowRouteDescribeProbe{
			version:            version,
			resolvedBindingRef: resolvedBindingRef,
		}, true, nil
	}
	return nil, false, nil
}

func voiceWorkflowCapabilityFromScenarioType(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		return aicapabilities.VoiceWorkflowTTSV2V
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return aicapabilities.VoiceWorkflowTTST2V
	default:
		return ""
	}
}

func (s *Service) writeVoiceWorkflowRouteDescribeHeader(
	ctx context.Context,
	scenarioType runtimev1.ScenarioType,
	probe *voiceWorkflowRouteDescribeProbe,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	if probe == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	metadataPayload, err := s.describeVoiceWorkflowRouteMetadata(ctx, scenarioType, modelResolved, remoteTarget, selected, probe)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(metadataPayload)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	encoded := base64.StdEncoding.EncodeToString(raw)
	if setErr := grpc.SetHeader(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set voice workflow route describe header failed", "error", setErr)
	}
	return nil
}

func (s *Service) describeVoiceWorkflowRouteMetadata(
	ctx context.Context,
	scenarioType runtimev1.ScenarioType,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	probe *voiceWorkflowRouteDescribeProbe,
) (*voiceWorkflowRouteDescribeResultPayload, error) {
	if probe == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	workflowType := workflowTypeFromScenarioType(scenarioType)
	capability := voiceWorkflowCapabilityFromScenarioType(scenarioType)
	if workflowType == "" || capability == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
	providerType := voiceWorkflowCatalogProviderType(modelResolved, remoteTarget, selected)
	resolution, err := s.resolveVoiceWorkflow(ctx, providerType, modelResolved, workflowType)
	if err != nil {
		switch {
		case errors.Is(err, catalog.ErrModelNotFound):
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		case errors.Is(err, catalog.ErrVoiceWorkflowUnsupported):
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
		default:
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		}
	}
	metadataPayload, err := buildVoiceWorkflowRouteDescribeMetadata(resolution)
	if err != nil {
		return nil, err
	}

	return &voiceWorkflowRouteDescribeResultPayload{
		Capability:         capability,
		MetadataVersion:    "v1",
		ResolvedBindingRef: probe.resolvedBindingRef,
		MetadataKind:       capability,
		Metadata:           metadataPayload,
	}, nil
}

func buildVoiceWorkflowRouteDescribeMetadata(resolution catalog.ResolveVoiceWorkflowResult) (any, error) {
	options := resolution.RequestOptions
	if options == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	switch strings.ToLower(strings.TrimSpace(resolution.WorkflowType)) {
	case "tts_v2v":
		if options.SupportsLanguageHints == nil || options.SupportsPreferredName == nil || options.ReferenceAudioURIInput == nil || options.ReferenceAudioBytesInput == nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		}
		payload := voiceWorkflowTtsV2vRouteDescribeMetadataPayload{
			WorkflowType:                   "tts_v2v",
			RequiresTargetSynthesisBinding: resolution.RequiresTargetSynthesisBinding,
			TextPromptMode:                 strings.TrimSpace(options.TextPromptMode),
			SupportsLanguageHints:          *options.SupportsLanguageHints,
			SupportsPreferredName:          *options.SupportsPreferredName,
			ReferenceAudioURIInput:         *options.ReferenceAudioURIInput,
			ReferenceAudioBytesInput:       *options.ReferenceAudioBytesInput,
			AllowedReferenceAudioMimeTypes: append([]string(nil), options.AllowedReferenceAudioMimeTypes...),
		}
		if payload.TextPromptMode == "" || len(payload.AllowedReferenceAudioMimeTypes) == 0 {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		}
		if options.ProviderExtensions != nil {
			payload.ProviderExtensionNamespace = strings.TrimSpace(options.ProviderExtensions.Namespace)
			payload.ProviderExtensionSchemaVersion = strings.TrimSpace(options.ProviderExtensions.SchemaVersion)
		}
		return payload, nil
	case "tts_t2v":
		if options.SupportsLanguage == nil || options.SupportsPreferredName == nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		}
		payload := voiceWorkflowTtsT2vRouteDescribeMetadataPayload{
			WorkflowType:                   "tts_t2v",
			RequiresTargetSynthesisBinding: resolution.RequiresTargetSynthesisBinding,
			InstructionTextMode:            strings.TrimSpace(options.InstructionTextMode),
			PreviewTextMode:                strings.TrimSpace(options.PreviewTextMode),
			SupportsLanguage:               *options.SupportsLanguage,
			SupportsPreferredName:          *options.SupportsPreferredName,
		}
		if payload.InstructionTextMode == "" || payload.PreviewTextMode == "" {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
		}
		if options.ProviderExtensions != nil {
			payload.ProviderExtensionNamespace = strings.TrimSpace(options.ProviderExtensions.Namespace)
			payload.ProviderExtensionSchemaVersion = strings.TrimSpace(options.ProviderExtensions.SchemaVersion)
		}
		return payload, nil
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
}

func executeVoiceWorkflowRouteDescribeScenario(
	ctx context.Context,
	s *Service,
	req *runtimev1.ExecuteScenarioRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
	probe *voiceWorkflowRouteDescribeProbe,
) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateVoiceWorkflowSpec(req.GetScenarioType(), req.GetSpec()); err != nil {
		return nil, err
	}

	remoteTarget, err := s.prepareScenarioRequest(ctx, req.GetHead(), req.GetScenarioType())
	if err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("execute_scenario_voice_workflow_route_describe", req.GetHead().GetAppId(), acquireResult)

	selectedProvider, routeDecision, modelResolved, _, err := s.selector.resolveProviderWithTarget(
		ctx,
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
	)
	if err != nil {
		return nil, err
	}
	if err := s.validateScenarioCapability(ctx, req.GetScenarioType(), modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	if err := s.writeVoiceWorkflowRouteDescribeHeader(
		ctx,
		req.GetScenarioType(),
		probe,
		modelResolved,
		remoteTarget,
		selectedProvider,
	); err != nil {
		return nil, err
	}

	return &runtimev1.ExecuteScenarioResponse{
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		RouteDecision:     routeDecision,
		ModelResolved:     modelResolved,
		TraceId:           ulid.Make().String(),
		IgnoredExtensions: ignored,
	}, nil
}
