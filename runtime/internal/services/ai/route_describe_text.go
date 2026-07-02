package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const (
	textGenerateRouteDescribeExtensionNamespace = "nimi.scenario.text_generate.route_describe"
	textEmbedRouteDescribeExtensionNamespace    = "nimi.scenario.text_embed.route_describe"
	routeDescribeResponseHeaderKey              = "x-nimi-route-describe-result"
)

type textGenerateRouteDescribeProbe struct {
	version            string
	resolvedBindingRef string
}

type textEmbedRouteDescribeProbe = textGenerateRouteDescribeProbe

type textGenerateRouteDescribeMetadataPayload struct {
	SupportsThinking         bool   `json:"supportsThinking"`
	TraceModeSupport         string `json:"traceModeSupport"`
	SupportsImageInput       bool   `json:"supportsImageInput"`
	SupportsAudioInput       bool   `json:"supportsAudioInput"`
	SupportsVideoInput       bool   `json:"supportsVideoInput"`
	SupportsArtifactRefInput bool   `json:"supportsArtifactRefInput"`
}

type textEmbedRouteDescribeMetadataPayload struct {
	Dimensions          int  `json:"dimensions,omitempty"`
	MaxInputsPerRequest int  `json:"maxInputsPerRequest"`
	SupportsBatch       bool `json:"supportsBatch"`
}

type runtimeRouteDescribeResultPayload struct {
	Capability         string         `json:"capability"`
	MetadataVersion    string         `json:"metadataVersion"`
	ResolvedBindingRef string         `json:"resolvedBindingRef"`
	RouteMetadataRef   string         `json:"routeMetadataRef"`
	SourceTargetRef    map[string]any `json:"sourceTargetRef,omitempty"`
	MetadataKind       string         `json:"metadataKind"`
	Metadata           any            `json:"metadata"`
}

func textGenerateRouteDescribeProbeFromExtensions(
	extensions []*runtimev1.ScenarioExtension,
) (*textGenerateRouteDescribeProbe, bool, error) {
	return textRouteDescribeProbeFromExtensions(extensions, textGenerateRouteDescribeExtensionNamespace)
}

func textEmbedRouteDescribeProbeFromExtensions(
	extensions []*runtimev1.ScenarioExtension,
) (*textEmbedRouteDescribeProbe, bool, error) {
	return textRouteDescribeProbeFromExtensions(extensions, textEmbedRouteDescribeExtensionNamespace)
}

func textRouteDescribeProbeFromExtensions(
	extensions []*runtimev1.ScenarioExtension,
	namespace string,
) (*textGenerateRouteDescribeProbe, bool, error) {
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
		if textGenerateRouteDescribePayloadHasLegacySelector(payload) {
			return nil, true, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &textGenerateRouteDescribeProbe{
			version:            version,
			resolvedBindingRef: resolvedBindingRef,
		}, true, nil
	}
	return nil, false, nil
}

func textGenerateRouteDescribePayloadHasLegacySelector(payload map[string]any) bool {
	for _, key := range []string{"localModelId", "goRuntimeLocalModelId", "modelId", "engine"} {
		if _, ok := payload[key]; ok {
			return true
		}
	}
	return false
}

func (s *Service) writeTextGenerateRouteDescribeHeader(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	probe *textGenerateRouteDescribeProbe,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	if probe == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	metadataPayload, err := s.describeTextGenerateRouteMetadata(ctx, head, modelResolved, remoteTarget, selected, probe)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(metadataPayload)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	encoded := base64.StdEncoding.EncodeToString(raw)
	if setErr := grpc.SetHeader(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set text.generate route describe header failed", "error", setErr)
	}
	if setErr := grpc.SetTrailer(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set text.generate route describe trailer failed", "error", setErr)
	}
	return nil
}

func (s *Service) writeTextEmbedRouteDescribeHeader(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	probe *textEmbedRouteDescribeProbe,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	if probe == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	metadataPayload, err := s.describeTextEmbedRouteMetadata(ctx, head, modelResolved, remoteTarget, selected, probe)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(metadataPayload)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	encoded := base64.StdEncoding.EncodeToString(raw)
	if setErr := grpc.SetHeader(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set text.embed route describe header failed", "error", setErr)
	}
	if setErr := grpc.SetTrailer(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set text.embed route describe trailer failed", "error", setErr)
	}
	return nil
}

func (s *Service) describeTextGenerateRouteMetadata(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	probe *textGenerateRouteDescribeProbe,
) (*runtimeRouteDescribeResultPayload, error) {
	if probe == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	reasoningCapability := reasoningCapabilityForRequest(modelResolved, remoteTarget, selected)
	supportsImageInput := false
	supportsAudioInput := false
	supportsVideoInput := false

	if selected != nil && selected.Route() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && remoteTarget == nil {
		selectedModel, err := s.selectLocalTextGenerateDescribeModel(ctx, head)
		if err != nil {
			return nil, err
		}
		reasoningCapability = reasoningCapabilityForLocalTextGenerateModel(selectedModel)
		supportsImageInput = localModelSupportsTextGenerateCapability(selectedModel, aicapabilities.TextGenerateVision)
		supportsAudioInput = localModelSupportsTextGenerateCapability(selectedModel, aicapabilities.TextGenerateAudio)
		supportsVideoInput = localModelSupportsTextGenerateCapability(selectedModel, aicapabilities.TextGenerateVideo)
	} else {
		var err error
		supportsImageInput, err = s.describeRemoteTextGenerateCapabilitySupport(
			ctx,
			modelResolved,
			remoteTarget,
			selected,
			aicapabilities.TextGenerateVision,
		)
		if err != nil {
			return nil, err
		}
		supportsAudioInput, err = s.describeRemoteTextGenerateCapabilitySupport(
			ctx,
			modelResolved,
			remoteTarget,
			selected,
			aicapabilities.TextGenerateAudio,
		)
		if err != nil {
			return nil, err
		}
		supportsVideoInput, err = s.describeRemoteTextGenerateCapabilitySupport(
			ctx,
			modelResolved,
			remoteTarget,
			selected,
			aicapabilities.TextGenerateVideo,
		)
		if err != nil {
			return nil, err
		}
	}

	return &runtimeRouteDescribeResultPayload{
		Capability:         aicapabilities.TextGenerate,
		MetadataVersion:    "v1",
		ResolvedBindingRef: probe.resolvedBindingRef,
		RouteMetadataRef:   routeMetadataRefForResolvedBinding(aicapabilities.TextGenerate, probe.resolvedBindingRef),
		SourceTargetRef:    runtimeDurableTargetRefJSON(head.GetTargetRef()),
		MetadataKind:       aicapabilities.TextGenerate,
		Metadata: textGenerateRouteDescribeMetadataPayload{
			SupportsThinking:         reasoningCapability.SupportsModeToggle,
			TraceModeSupport:         traceModeSupportForReasoningCapability(reasoningCapability),
			SupportsImageInput:       supportsImageInput,
			SupportsAudioInput:       supportsAudioInput,
			SupportsVideoInput:       supportsVideoInput,
			SupportsArtifactRefInput: supportsImageInput || supportsAudioInput || supportsVideoInput,
		},
	}, nil
}

func (s *Service) describeTextEmbedRouteMetadata(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	probe *textEmbedRouteDescribeProbe,
) (*runtimeRouteDescribeResultPayload, error) {
	if probe == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	dimensions := 0
	if selected != nil && selected.Route() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && remoteTarget == nil {
		selectedModel, err := s.selectLocalTextEmbedDescribeModel(ctx, head)
		if err != nil {
			return nil, err
		}
		dimensions = localTextEmbedDimensions(selectedModel)
	} else {
		providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected, runtimev1.Modal_MODAL_EMBEDDING)
		if providerType != "" && providerregistry.Contains(providerType) {
			if s == nil || s.speechCatalog == nil {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
			}
			supported, err := s.speechCatalog.SupportsCapabilityForSubject(
				catalogSubjectUserIDFromContext(ctx),
				providerType,
				modelResolved,
				aicapabilities.TextEmbed,
			)
			if err != nil && !errors.Is(err, aicatalog.ErrModelNotFound) {
				return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
			}
			if err == nil && !supported {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
			}
		}
	}

	metadataPayload := textEmbedRouteDescribeMetadataPayload{
		Dimensions:          dimensions,
		MaxInputsPerRequest: 16,
		SupportsBatch:       true,
	}
	return &runtimeRouteDescribeResultPayload{
		Capability:         aicapabilities.TextEmbed,
		MetadataVersion:    "v1",
		ResolvedBindingRef: probe.resolvedBindingRef,
		RouteMetadataRef:   routeMetadataRefForResolvedBinding(aicapabilities.TextEmbed, probe.resolvedBindingRef),
		SourceTargetRef:    runtimeDurableTargetRefJSON(head.GetTargetRef()),
		MetadataKind:       aicapabilities.TextEmbed,
		Metadata:           metadataPayload,
	}, nil
}

func reasoningCapabilityForLocalTextGenerateModel(model *runtimev1.LocalAssetRecord) nimillm.ReasoningCapability {
	if model == nil {
		return nimillm.UnsupportedReasoningCapability()
	}
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return nimillm.OllamaReasoningCapability()
	default:
		return nimillm.UnsupportedReasoningCapability()
	}
}

func traceModeSupportForReasoningCapability(capability nimillm.ReasoningCapability) string {
	if !capability.SupportsModeToggle {
		return "none"
	}
	if capability.SupportsSeparateText && capability.SupportsStreaming {
		return "separate"
	}
	return "hide"
}

func (s *Service) selectLocalTextGenerateDescribeModel(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
) (*runtimev1.LocalAssetRecord, error) {
	if s == nil || s.localModel == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	models, err := s.listAllLocalModels(ctx, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	selectedModel, reason, detail := selectLocalTextGenerateDescribeModelFromTargetRef(models, head.GetTargetRef())
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		if detail != "" {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, reason, grpcerr.ReasonOptions{
				ActionHint: "inspect_local_runtime_model_health",
				Message:    detail,
			})
		}
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
	}
	if selectedModel == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "inspect_local_runtime_model_health",
			Message:    "text.generate route describe targetRef did not match a local asset",
		})
	}
	return selectedModel, nil
}

func (s *Service) selectLocalTextEmbedDescribeModel(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
) (*runtimev1.LocalAssetRecord, error) {
	if s == nil || s.localModel == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	models, err := s.listAllLocalModels(ctx, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	selectedModel, reason, detail := selectLocalTextEmbedDescribeModelFromTargetRef(models, head.GetTargetRef())
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		if detail != "" {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, reason, grpcerr.ReasonOptions{
				ActionHint: "inspect_local_runtime_model_health",
				Message:    detail,
			})
		}
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, reason)
	}
	if selectedModel == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "inspect_local_runtime_model_health",
			Message:    "text.embed route describe targetRef did not match a local embedding asset",
		})
	}
	return selectedModel, nil
}

func (s *Service) describeRemoteTextGenerateCapabilitySupport(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	capability string,
) (bool, error) {
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected, runtimev1.Modal_MODAL_UNSPECIFIED)
	if providerType == "" || !providerregistry.Contains(providerType) {
		return false, nil
	}
	if s == nil || s.speechCatalog == nil {
		return false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	supported, err := s.speechCatalog.SupportsCapabilityForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelResolved, capability)
	if err != nil {
		if errors.Is(err, aicatalog.ErrModelNotFound) {
			return false, nil
		}
		return false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	return supported, nil
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func selectLocalTextGenerateDescribeModelFromTargetRef(
	models []*runtimev1.LocalAssetRecord,
	targetRef *runtimev1.RuntimeDurableTargetRef,
) (*runtimev1.LocalAssetRecord, runtimev1.ReasonCode, string) {
	localAssetID := localTextGenerateDescribeTargetRefLocalAssetID(targetRef)
	if localAssetID == "" {
		return nil, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "text.generate route describe requires a local-runtime targetRef"
	}
	if candidate := findLocalTextGenerateDescribeModelByAssetID(models, localAssetID); candidate != nil {
		return candidate, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
	}
	return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, "text.generate route describe targetRef did not match a local asset"
}

func selectLocalTextEmbedDescribeModelFromTargetRef(
	models []*runtimev1.LocalAssetRecord,
	targetRef *runtimev1.RuntimeDurableTargetRef,
) (*runtimev1.LocalAssetRecord, runtimev1.ReasonCode, string) {
	localAssetID := localTextGenerateDescribeTargetRefLocalAssetID(targetRef)
	if localAssetID == "" {
		return nil, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "text.embed route describe requires a local-runtime targetRef"
	}
	if candidate := findLocalTextEmbedDescribeModelByAssetID(models, localAssetID); candidate != nil {
		return candidate, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
	}
	return nil, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, "text.embed route describe targetRef did not match a local embedding asset"
}

func localTextGenerateDescribeTargetRefLocalAssetID(targetRef *runtimev1.RuntimeDurableTargetRef) string {
	if targetRef == nil {
		return ""
	}
	local := targetRef.GetLocalRuntime()
	if local == nil {
		return ""
	}
	var ref string
	switch local.GetRef().(type) {
	case *runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId:
		ref = local.GetProfileBindingId()
	case *runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef:
		ref = local.GetReadinessRef()
	default:
		return ""
	}
	ref = strings.TrimSpace(ref)
	return strings.TrimPrefix(ref, "local-runtime:")
}

func findLocalTextGenerateDescribeModelByAssetID(
	models []*runtimev1.LocalAssetRecord,
	assetID string,
) *runtimev1.LocalAssetRecord {
	normalized := strings.TrimSpace(assetID)
	if normalized == "" {
		return nil
	}
	for _, model := range models {
		if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(model.GetLocalAssetId()) == normalized {
			return model
		}
	}
	return nil
}

func findLocalTextEmbedDescribeModelByAssetID(
	models []*runtimev1.LocalAssetRecord,
	assetID string,
) *runtimev1.LocalAssetRecord {
	normalized := strings.TrimSpace(assetID)
	if normalized == "" {
		return nil
	}
	for _, model := range models {
		if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(model.GetLocalAssetId()) != normalized {
			continue
		}
		if model.GetKind() != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING {
			continue
		}
		if !localModelSupportsTextGenerateCapability(model, aicapabilities.TextEmbed) {
			continue
		}
		return model
	}
	return nil
}

func localTextEmbedDimensions(model *runtimev1.LocalAssetRecord) int {
	if model == nil || model.GetMetadata() == nil {
		return 0
	}
	metadata := nimillm.StructToMap(model.GetMetadata())
	for _, key := range []string{"embedding.dimension", "embeddingDimension", "dimensions"} {
		if parsed := intValue(metadata[key]); parsed > 0 {
			return parsed
		}
	}
	return 0
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		if typed > 0 {
			return typed
		}
	case int64:
		if typed > 0 {
			return int(typed)
		}
	case float64:
		if typed > 0 {
			return int(typed)
		}
	}
	return 0
}
