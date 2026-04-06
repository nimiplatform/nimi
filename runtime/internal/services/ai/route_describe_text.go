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
	routeDescribeResponseHeaderKey              = "x-nimi-route-describe-result"
)

type textGenerateRouteDescribeProbe struct {
	version               string
	resolvedBindingRef    string
	localModelID          string
	goRuntimeLocalModelID string
	engine                string
	modelID               string
}

type textGenerateRouteDescribeMetadataPayload struct {
	SupportsThinking         bool   `json:"supportsThinking"`
	TraceModeSupport         string `json:"traceModeSupport"`
	SupportsImageInput       bool   `json:"supportsImageInput"`
	SupportsAudioInput       bool   `json:"supportsAudioInput"`
	SupportsVideoInput       bool   `json:"supportsVideoInput"`
	SupportsArtifactRefInput bool   `json:"supportsArtifactRefInput"`
}

type runtimeRouteDescribeResultPayload struct {
	Capability         string                                   `json:"capability"`
	MetadataVersion    string                                   `json:"metadataVersion"`
	ResolvedBindingRef string                                   `json:"resolvedBindingRef"`
	MetadataKind       string                                   `json:"metadataKind"`
	Metadata           textGenerateRouteDescribeMetadataPayload `json:"metadata"`
}

func textGenerateRouteDescribeProbeFromExtensions(
	extensions []*runtimev1.ScenarioExtension,
) (*textGenerateRouteDescribeProbe, bool, error) {
	for _, item := range extensions {
		if strings.TrimSpace(item.GetNamespace()) != textGenerateRouteDescribeExtensionNamespace {
			continue
		}
		payload := nimillm.StructToMap(item.GetPayload())
		version := strings.TrimSpace(stringValue(payload["version"]))
		resolvedBindingRef := strings.TrimSpace(stringValue(payload["resolvedBindingRef"]))
		if version != "v1" || resolvedBindingRef == "" {
			return nil, true, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &textGenerateRouteDescribeProbe{
			version:               version,
			resolvedBindingRef:    resolvedBindingRef,
			localModelID:          strings.TrimSpace(stringValue(payload["localModelId"])),
			goRuntimeLocalModelID: strings.TrimSpace(stringValue(payload["goRuntimeLocalModelId"])),
			engine:                strings.TrimSpace(stringValue(payload["engine"])),
			modelID:               strings.TrimSpace(stringValue(payload["modelId"])),
		}, true, nil
	}
	return nil, false, nil
}

func (s *Service) writeTextGenerateRouteDescribeHeader(
	ctx context.Context,
	probe *textGenerateRouteDescribeProbe,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	if probe == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	metadataPayload, err := s.describeTextGenerateRouteMetadata(ctx, modelResolved, remoteTarget, selected, probe)
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
	return nil
}

func (s *Service) describeTextGenerateRouteMetadata(
	ctx context.Context,
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
		selectedModel, err := s.selectLocalTextGenerateDescribeModel(ctx, modelResolved, probe)
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
	modelResolved string,
	probe *textGenerateRouteDescribeProbe,
) (*runtimev1.LocalAssetRecord, error) {
	if s == nil || s.localModel == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	models, err := s.listAllLocalModels(ctx, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	selectedModel, usedSelector, reason, detail := selectLocalTextGenerateDescribeModelFromProbe(models, modelResolved, probe)
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
		if usedSelector {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				ActionHint: "inspect_local_runtime_model_health",
				Message:    "text.generate route describe selector did not match a local asset",
			})
		}
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
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

func selectLocalTextGenerateDescribeModelFromProbe(
	models []*runtimev1.LocalAssetRecord,
	modelResolved string,
	probe *textGenerateRouteDescribeProbe,
) (*runtimev1.LocalAssetRecord, bool, runtimev1.ReasonCode, string) {
	if probe != nil {
		if candidate := findLocalTextGenerateDescribeModelByAssetID(models, probe.goRuntimeLocalModelID); candidate != nil {
			return candidate, true, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
		}
		if probe.goRuntimeLocalModelID != "" {
			return nil, true, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, "text.generate route describe goRuntimeLocalModelId did not match a local asset"
		}
		if candidate := findLocalTextGenerateDescribeModelByAssetID(models, probe.localModelID); candidate != nil {
			return candidate, true, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
		}
		if probe.localModelID != "" {
			return nil, true, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, "text.generate route describe localModelId did not match a local asset"
		}

		probeModelID := normalizeComparableModelID(probe.modelID)
		probeEngine := strings.TrimSpace(probe.engine)
		if probeModelID != "" || probeEngine != "" {
			candidates := make([]*runtimev1.LocalAssetRecord, 0, len(models))
			for _, model := range models {
				if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
					continue
				}
				if probeModelID != "" && normalizeComparableModelID(model.GetAssetId()) != probeModelID {
					continue
				}
				if probeEngine != "" && !strings.EqualFold(strings.TrimSpace(model.GetEngine()), probeEngine) {
					continue
				}
				candidates = append(candidates, model)
			}
			if selected := firstRunnableLocalModel(candidates, runtimev1.Modal_MODAL_UNSPECIFIED); selected != nil {
				return selected, true, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, ""
			}
			if len(candidates) > 0 {
				return nil, true, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, unavailableLocalModelDetail(candidates)
			}
			return nil, true, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, "text.generate route describe engine/model selector did not match a local asset"
		}
	}

	selectedModel, reason, detail := selectRunnableLocalModel(models, parseLocalModelSelector(modelResolved, runtimev1.Modal_MODAL_UNSPECIFIED))
	return selectedModel, false, reason, detail
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
