package ai

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// localImageEffectiveInputs is the immutable p-caiex-011 capture. Background
// execution consumes only plan and request from this snapshot; it never reads
// AIConfig, selection, bindings, or LocalAsset state again.
type localImageEffectiveInputs struct {
	head              *runtimev1.ScenarioRequestHead
	intent            executionintent.Intent
	configurationID   string
	displayName       string
	driverIdentity    *runtimev1.CapabilityImplementationIdentity
	portableConfig    *structpb.Struct
	requirements      []*runtimev1.LocalCapabilityRequirement
	exactBindings     []capabilitydriver.InvocationExactBinding
	contentIDs        []string
	supportedFeatures []string
	request           *runtimev1.ImageGenerateScenarioSpec
	plan              *capabilitydriver.ImageInvocationPlan
}

func (input *localImageEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.configurationID
}

func (s *Service) captureLocalImageEffectiveInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.ImageGenerateScenarioSpec,
) (*localImageEffectiveInputs, error) {
	if s == nil || head == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveLocalImageConsumerIntent(ctx, head)
	if err != nil {
		return nil, err
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.StableDiffusionCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	if s.localExecution == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	selected, err := s.localExecution.ResolveSelectedLocalExecution(capabilitydriver.StableDiffusionCapabilityContract)
	if err != nil {
		return nil, err
	}
	if !validSelectedImageExecution(selected) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.SupportedFeatures); err != nil {
		return nil, err
	}

	request, err := normalizeLocalImageRequest(spec, intent.Defaults)
	if err != nil {
		return nil, err
	}
	if format := strings.TrimSpace(request.GetResponseFormat()); format != "" && format != "b64_json" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if err := requireSelectedImageRequestFeatures(request, selected.SupportedFeatures); err != nil {
		return nil, err
	}

	identity := capabilitydriver.IdentityFromProto(selected.DriverIdentity)
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.StableDiffusionCapabilityContract, identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	imageDriver, ok := driver.(capabilitydriver.ImageInvocationDriver)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}

	exactBindings := make([]capabilitydriver.InvocationExactBinding, 0, len(selected.ExactBindings))
	contentIDs := make([]string, 0, len(selected.ExactBindings))
	for _, binding := range selected.ExactBindings {
		exactBindings = append(exactBindings, capabilitydriver.InvocationExactBinding{
			RequirementID:     binding.RequirementID,
			LocalAssetID:      binding.LocalAssetID,
			AbsolutePath:      binding.AbsolutePath,
			VerifiedContentID: binding.VerifiedContentID,
			EntrySHA256:       binding.EntrySHA256,
		})
		contentIDs = append(contentIDs, binding.VerifiedContentID+"/"+binding.EntrySHA256)
	}
	sort.Strings(contentIDs)
	portable, _ := proto.Clone(selected.PortableConfig).(*structpb.Struct)
	capturedRequest, _ := proto.Clone(request).(*runtimev1.ImageGenerateScenarioSpec)
	plan, err := imageDriver.PlanImageInvocation(capabilitydriver.ImageInvocationInput{
		PortableConfig: portable,
		ExactBindings:  append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		Request:        capturedRequest,
	})
	if err != nil {
		return nil, localImageInvocationError(err)
	}
	if plan == nil || strings.TrimSpace(plan.ProcessKey()) == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	implementation, _ := proto.Clone(selected.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	requirements := make([]*runtimev1.LocalCapabilityRequirement, 0, len(selected.Requirements))
	for _, requirement := range selected.Requirements {
		cloned, _ := proto.Clone(requirement).(*runtimev1.LocalCapabilityRequirement)
		requirements = append(requirements, cloned)
	}
	return &localImageEffectiveInputs{
		head:              cloneScenarioHead(head),
		intent:            executionintent.Clone(intent),
		configurationID:   strings.TrimSpace(selected.ConfigurationID),
		displayName:       strings.TrimSpace(selected.DisplayName),
		driverIdentity:    implementation,
		portableConfig:    portable,
		requirements:      requirements,
		exactBindings:     append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		contentIDs:        append([]string(nil), contentIDs...),
		supportedFeatures: append([]string(nil), selected.SupportedFeatures...),
		request:           capturedRequest,
		plan:              plan,
	}, nil
}

func (s *Service) resolveLocalImageConsumerIntent(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.StableDiffusionCapabilityContract)
	return intent, err
}

func validSelectedImageExecution(selected *localexecution.SelectedLocalExecution) bool {
	return selected != nil && selected.Configured &&
		strings.TrimSpace(selected.ConfigurationID) != "" &&
		selected.CapabilityContract == capabilitydriver.StableDiffusionCapabilityContract &&
		selected.DriverIdentity != nil &&
		len(selected.Requirements) >= 3 && len(selected.Requirements) == len(selected.ExactBindings)
}

func requireSelectedImageRequestFeatures(spec *runtimev1.ImageGenerateScenarioSpec, supported []string) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	required := make([]string, 0, 1)
	if len(spec.GetReferenceImages()) > 0 || strings.TrimSpace(spec.GetMask()) != "" {
		required = append(required, "input.image")
	}
	if err := requireSelectedFeatures(required, supported); err != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}
	return nil
}

func normalizeLocalImageRequest(
	spec *runtimev1.ImageGenerateScenarioSpec,
	defaults *structpb.Struct,
) (*runtimev1.ImageGenerateScenarioSpec, error) {
	cloned, _ := proto.Clone(spec).(*runtimev1.ImageGenerateScenarioSpec)
	if cloned == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if defaults == nil || len(defaults.GetFields()) == 0 {
		return cloned, nil
	}
	for key, value := range defaults.GetFields() {
		switch key {
		case "negativePrompt", "negative_prompt":
			if cloned.GetNegativePrompt() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.NegativePrompt = text
			}
		case "n":
			if cloned.N == nil {
				number, ok := integerDefault(value)
				if !ok || number < 1 || number > 4 {
					return nil, invalidAppAIConfigError()
				}
				cloned.N = proto.Int32(int32(number))
			}
		case "size":
			if cloned.GetSize() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.Size = text
			}
		case "aspectRatio", "aspect_ratio":
			if cloned.GetAspectRatio() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.AspectRatio = text
			}
		case "quality":
			if cloned.GetQuality() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.Quality = text
			}
		case "style":
			if cloned.GetStyle() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.Style = text
			}
		case "seed":
			if cloned.Seed == nil {
				number, ok := finiteDefaultNumber(value)
				if !ok || math.Trunc(number) != number || number < math.MinInt32 || number > math.MaxInt32 {
					return nil, invalidAppAIConfigError()
				}
				cloned.Seed = proto.Int64(int64(number))
			}
		case "responseFormat", "response_format":
			if cloned.GetResponseFormat() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.ResponseFormat = text
			}
		default:
			return nil, invalidAppAIConfigError()
		}
	}
	return cloned, nil
}

func localImageDefaultString(value *structpb.Value) (string, bool) {
	if value == nil {
		return "", false
	}
	if _, ok := value.GetKind().(*structpb.Value_StringValue); !ok {
		return "", false
	}
	text := strings.TrimSpace(value.GetStringValue())
	return text, text != "" && text == value.GetStringValue()
}

func localImageInvocationError(err error) error {
	var invocationErr *capabilitydriver.InvocationError
	if !errors.As(err, &invocationErr) {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	}
	switch invocationErr.Kind {
	case capabilitydriver.InvocationFailureInvalidRequest:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	case capabilitydriver.InvocationFailureUnsupported:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED, err, grpcerr.ReasonOptions{})
	case capabilitydriver.InvocationFailureInvalidBinding:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, err, grpcerr.ReasonOptions{})
	}
}

func localImageExecutionError(err error) error {
	return localExecutionError(err)
}

func (s *Service) executeCapturedLocalImage(
	ctx context.Context,
	effective *localImageEffectiveInputs,
	onArtifact localexecution.ImageArtifactFunc,
	progress localexecution.ImageProgressFunc,
) (localexecution.ImageResult, error) {
	if s == nil || s.localImageHost == nil {
		return localexecution.ImageResult{}, localImageExecutionError(&localexecution.ExecutionError{
			Kind: localexecution.FailureLoad,
			Err:  fmt.Errorf("local image execution host is unavailable"),
		})
	}
	result, err := s.localImageHost.ExecuteImage(ctx, effective.plan, onArtifact, progress)
	if err != nil {
		return result, localImageExecutionError(err)
	}
	return result, nil
}

func localImageArtifact(effective *localImageEffectiveInputs, produced localexecution.ImageArtifact) *runtimev1.ScenarioArtifact {
	if effective == nil {
		return nil
	}
	metadata := map[string]any{
		"batch_index":     produced.Index,
		"batch_count":     effective.plan.ImageCount(),
		"prompt":          strings.TrimSpace(effective.request.GetPrompt()),
		"negative_prompt": strings.TrimSpace(effective.request.GetNegativePrompt()),
		"size":            strings.TrimSpace(effective.request.GetSize()),
	}
	artifact := nimillm.BinaryArtifact(nimillm.ResolveImageArtifactMIME(effective.request, produced.Bytes), produced.Bytes, metadata)
	nimillm.ApplyImageSpecMetadata(artifact, effective.request)
	return artifact
}

func localImageUsage(result localexecution.ImageResult) *runtimev1.UsageStats {
	if result.ComputeMS <= 0 {
		return nil
	}
	return &runtimev1.UsageStats{ComputeMs: result.ComputeMS}
}
