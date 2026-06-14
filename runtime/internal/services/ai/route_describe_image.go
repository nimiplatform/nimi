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
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

const imageGenerateRouteDescribeExtensionNamespace = "nimi.scenario.image_generate.route_describe"

type imageGenerateRouteDescribeProbe struct {
	version            string
	resolvedBindingRef string
}

type imageGenerateRouteDescribeMetadataPayload struct {
	SupportedResponseFormats       []string `json:"supportedResponseFormats"`
	DefaultResponseFormat          string   `json:"defaultResponseFormat,omitempty"`
	MaxImagesPerRequest            int      `json:"maxImagesPerRequest"`
	SupportsNegativePrompt         bool     `json:"supportsNegativePrompt"`
	SupportsReferenceImages        bool     `json:"supportsReferenceImages"`
	SupportsMask                   bool     `json:"supportsMask"`
	SupportsSeed                   bool     `json:"supportsSeed"`
	SupportsSize                   bool     `json:"supportsSize"`
	SupportsAspectRatio            bool     `json:"supportsAspectRatio"`
	SupportsQuality                bool     `json:"supportsQuality"`
	SupportsStyle                  bool     `json:"supportsStyle"`
	ProviderExtensionNamespace     string   `json:"providerExtensionNamespace,omitempty"`
	ProviderExtensionSchemaVersion string   `json:"providerExtensionSchemaVersion,omitempty"`
}

type imageGenerateRouteDescribeResultPayload struct {
	Capability         string                                    `json:"capability"`
	MetadataVersion    string                                    `json:"metadataVersion"`
	ResolvedBindingRef string                                    `json:"resolvedBindingRef"`
	MetadataKind       string                                    `json:"metadataKind"`
	Metadata           imageGenerateRouteDescribeMetadataPayload `json:"metadata"`
}

func imageGenerateRouteDescribeProbeFromExtensions(
	scenarioType runtimev1.ScenarioType,
	extensions []*runtimev1.ScenarioExtension,
) (*imageGenerateRouteDescribeProbe, bool, error) {
	if scenarioType != runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE {
		return nil, false, nil
	}
	for _, item := range extensions {
		if strings.TrimSpace(item.GetNamespace()) != imageGenerateRouteDescribeExtensionNamespace {
			continue
		}
		payload := nimillm.StructToMap(item.GetPayload())
		version := strings.TrimSpace(stringValue(payload["version"]))
		resolvedBindingRef := strings.TrimSpace(stringValue(payload["resolvedBindingRef"]))
		if version != "v1" || resolvedBindingRef == "" {
			return nil, true, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		return &imageGenerateRouteDescribeProbe{
			version:            version,
			resolvedBindingRef: resolvedBindingRef,
		}, true, nil
	}
	return nil, false, nil
}

func imageCatalogProviderType(modelResolved string, remoteTarget *nimillm.RemoteTarget, selected provider) string {
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected, runtimev1.Modal_MODAL_IMAGE)
	if remoteTarget == nil && selected != nil && selected.Route() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && localrouting.IsKnownProvider(providerType) {
		return "local"
	}
	return providerType
}

func validateImageGenerateRouteDescribeSpec(spec *runtimev1.ScenarioSpec) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	image := spec.GetImageGenerate()
	if image == nil || strings.TrimSpace(image.GetPrompt()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	if image.GetN() < 0 || image.GetN() > 16 {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil
}

func (s *Service) writeImageGenerateRouteDescribeHeader(
	ctx context.Context,
	probe *imageGenerateRouteDescribeProbe,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
) error {
	payload, err := s.describeImageGenerateRouteMetadata(ctx, modelResolved, remoteTarget, selected, probe)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	encoded := base64.StdEncoding.EncodeToString(raw)
	if setErr := grpc.SetHeader(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set image route describe header failed", "error", setErr)
	}
	if setErr := grpc.SetTrailer(ctx, metadata.Pairs(routeDescribeResponseHeaderKey, encoded)); setErr != nil && s.logger != nil {
		s.logger.Warn("set image route describe trailer failed", "error", setErr)
	}
	return nil
}

func (s *Service) describeImageGenerateRouteMetadata(
	ctx context.Context,
	modelResolved string,
	remoteTarget *nimillm.RemoteTarget,
	selected provider,
	probe *imageGenerateRouteDescribeProbe,
) (*imageGenerateRouteDescribeResultPayload, error) {
	if probe == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s == nil || s.speechCatalog == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	providerType := imageCatalogProviderType(modelResolved, remoteTarget, selected)
	model, err := s.speechCatalog.ResolveModelEntryForSubject(catalogSubjectUserIDFromContext(ctx), providerType, modelResolved)
	if err != nil {
		if errors.Is(err, catalog.ErrModelNotFound) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
		}
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	if model.ImageRequestOptions == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}

	metadataPayload := imageGenerateRouteDescribeMetadataPayload{
		SupportedResponseFormats: append([]string(nil), model.ImageRequestOptions.ResponseFormats...),
		MaxImagesPerRequest:      model.ImageRequestOptions.MaxImagesPerRequest,
		SupportsNegativePrompt:   model.ImageRequestOptions.SupportsNegativePrompt,
		SupportsReferenceImages:  model.ImageRequestOptions.SupportsReferenceImages,
		SupportsMask:             model.ImageRequestOptions.SupportsMask,
		SupportsSeed:             model.ImageRequestOptions.SupportsSeed,
		SupportsSize:             model.ImageRequestOptions.SupportsSize,
		SupportsAspectRatio:      model.ImageRequestOptions.SupportsAspectRatio,
		SupportsQuality:          model.ImageRequestOptions.SupportsQuality,
		SupportsStyle:            model.ImageRequestOptions.SupportsStyle,
	}
	if len(metadataPayload.SupportedResponseFormats) > 0 {
		metadataPayload.DefaultResponseFormat = strings.TrimSpace(metadataPayload.SupportedResponseFormats[0])
	}
	if ext := model.ImageRequestOptions.ProviderExtensions; ext != nil {
		metadataPayload.ProviderExtensionNamespace = strings.TrimSpace(ext.Namespace)
		metadataPayload.ProviderExtensionSchemaVersion = strings.TrimSpace(ext.SchemaVersion)
	}

	return &imageGenerateRouteDescribeResultPayload{
		Capability:         aicapabilities.ImageGenerate,
		MetadataVersion:    "v1",
		ResolvedBindingRef: probe.resolvedBindingRef,
		MetadataKind:       aicapabilities.ImageGenerate,
		Metadata:           metadataPayload,
	}, nil
}

func executeImageGenerateRouteDescribeScenario(
	ctx context.Context,
	s *Service,
	req *runtimev1.ExecuteScenarioRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
	probe *imageGenerateRouteDescribeProbe,
) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateImageGenerateRouteDescribeSpec(req.GetSpec()); err != nil {
		return nil, err
	}

	remoteTarget, localPlan, err := s.prepareScenarioRequestWithLocalPlan(ctx, req.GetHead(), req.GetScenarioType())
	if err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("execute_scenario_image_route_describe", req.GetHead().GetAppId(), acquireResult)

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
	modelResolved = applyLocalExecutionPlanModelResolved(localPlan, modelResolved, remoteTarget, selectedProvider)
	if err := s.validateScenarioCapability(ctx, req, modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}
	if err := s.writeImageGenerateRouteDescribeHeader(ctx, probe, modelResolved, remoteTarget, selectedProvider); err != nil {
		return nil, err
	}

	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateResult{},
			},
		},
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		RouteDecision:     routeDecision,
		ModelResolved:     modelResolved,
		TraceId:           ulid.Make().String(),
		IgnoredExtensions: ignored,
	}, nil
}
