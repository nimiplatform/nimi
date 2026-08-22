package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// localImageEffectiveInputs is the immutable p-caiex-011 capture. Background
// execution consumes only plan and request from this snapshot; it never reads
// AIConfig, selection, bindings, or LocalAsset state again.
type localImageEffectiveInputs struct {
	head                   *runtimev1.ScenarioRequestHead
	intent                 executionintent.Intent
	loadoutID              string
	effectiveInputIdentity *runtimev1.LoadoutEffectiveInputIdentity
	displayName            string
	driverIdentity         *runtimev1.CapabilityImplementationIdentity
	portableConfig         *structpb.Struct
	requirements           []*runtimev1.LocalCapabilityRequirement
	exactBindings          []capabilitydriver.InvocationExactBinding
	contentIDs             []string
	supportedFeatures      []string
	request                *runtimev1.ImageGenerateScenarioSpec
	plan                   *capabilitydriver.ImageInvocationPlan
	resolvedAssembly       *localResolvedAssembly
}

func (input *localImageEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.loadoutID
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
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
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
	if err := requireSelectedImageRequestFeatures(request, selected.SupportedFeatures); err != nil {
		return nil, err
	}
	inputs, err := s.resolveLocalImageInputs(ctx, head, request)
	if err != nil {
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

	exactBindings := projectInvocationExactBindings(selected.ExactBindings)
	contentIDs := make([]string, 0, len(selected.ExactBindings))
	for _, binding := range selected.ExactBindings {
		contentIDs = append(contentIDs, binding.VerifiedContentID+"/"+binding.EntrySHA256)
	}
	sort.Strings(contentIDs)
	portable, _ := proto.Clone(selected.PortableConfig).(*structpb.Struct)
	capturedRequest, _ := proto.Clone(request).(*runtimev1.ImageGenerateScenarioSpec)
	// The custody reference is consumed by the service owner. Driver planning
	// receives only the already-authorized immutable bytes.
	capturedRequest.ReferenceImageArtifactId = ""
	plan, err := imageDriver.PlanImageInvocation(capabilitydriver.ImageInvocationInput{
		RecipeID:          selected.RecipeID,
		PortableConfig:    portable,
		SupportedFeatures: append([]string(nil), selected.SupportedFeatures...),
		ExactBindings:     append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		Request:           capturedRequest,
		Inputs:            inputs,
	})
	if err != nil {
		return nil, localImageInvocationError(err)
	}
	if plan == nil || strings.TrimSpace(plan.ProcessKey()) == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	resolvedAssembly, err := localResolvedAssemblyForImage(selected, capturedRequest, plan)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local image ResolvedAssembly capture failed"})
	}
	effectiveInputIdentity, err := projectResolvedAssemblyEffectiveInputIdentity(resolvedAssembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local image ResolvedAssembly attribution failed"})
	}
	implementation, _ := proto.Clone(selected.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	requirements := make([]*runtimev1.LocalCapabilityRequirement, 0, len(selected.Requirements))
	for _, requirement := range selected.Requirements {
		cloned, _ := proto.Clone(requirement).(*runtimev1.LocalCapabilityRequirement)
		requirements = append(requirements, cloned)
	}
	return &localImageEffectiveInputs{
		head:                   cloneScenarioHead(head),
		intent:                 executionintent.Clone(intent),
		loadoutID:              strings.TrimSpace(selected.LoadoutID),
		effectiveInputIdentity: effectiveInputIdentity,
		displayName:            strings.TrimSpace(selected.DisplayName),
		driverIdentity:         implementation,
		portableConfig:         portable,
		requirements:           requirements,
		exactBindings:          append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		contentIDs:             append([]string(nil), contentIDs...),
		supportedFeatures:      append([]string(nil), selected.SupportedFeatures...),
		request:                capturedRequest,
		plan:                   plan,
		resolvedAssembly:       resolvedAssembly,
	}, nil
}

func (s *Service) localImageEffectiveInputsFromResolvedAssembly(assembly *localResolvedAssembly) (*localImageEffectiveInputs, error) {
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, err
	}
	if assembly.CapabilityContract != capabilitydriver.StableDiffusionCapabilityContract || assembly.Request.Kind != "image.generate" ||
		assembly.LoadPlan.Kind != "image" || assembly.LoadPlan.Image == nil {
		return nil, fmt.Errorf("local image ResolvedAssembly contract is mismatched")
	}
	request := &runtimev1.ImageGenerateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, fmt.Errorf("decode local image ResolvedAssembly request: %w", err)
	}
	portable, err := resolvedAssemblyPortableConfig(assembly)
	if err != nil {
		return nil, err
	}
	var inputs []capabilitydriver.ImageResolvedInput
	switch assembly.LoadPlan.Image.Request.Kind {
	case "text-to-image":
	case "instruction-edit":
		inputs = []capabilitydriver.ImageResolvedInput{{
			SourceIdentity: assembly.LoadPlan.Image.Request.SourceIdentity,
			ImageBytes:     append([]byte(nil), assembly.LoadPlan.Image.Request.SourceImage...),
		}}
	default:
		return nil, fmt.Errorf("captured local image request variant %q is unsupported", assembly.LoadPlan.Image.Request.Kind)
	}
	if s == nil || s.capabilityDrivers == nil {
		return nil, fmt.Errorf("local image Driver registry is unavailable")
	}
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.StableDiffusionCapabilityContract, capabilitydriver.Identity{
		ImplementationID: assembly.DriverIdentity.ImplementationID,
		DriverID:         assembly.DriverIdentity.DriverID,
		DriverDialect:    assembly.DriverIdentity.DriverDialect,
	})
	imageDriver, ok := driver.(capabilitydriver.ImageInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, fmt.Errorf("captured local image Driver is unavailable")
	}
	plan, err := imageDriver.PlanImageInvocation(capabilitydriver.ImageInvocationInput{
		RecipeID:          assembly.RecipeID,
		PortableConfig:    portable,
		SupportedFeatures: append([]string(nil), assembly.SupportedFeatures...),
		ExactBindings:     resolvedAssemblyExactBindings(assembly),
		Request:           request,
		Inputs:            inputs,
	})
	if err != nil {
		return nil, err
	}
	selected := selectedLocalExecutionFromResolvedAssembly(assembly)
	selected.PortableConfig = portable
	reprojected, err := localResolvedAssemblyForImage(selected, request, plan)
	if err != nil {
		return nil, err
	}
	if err := validateRehydratedResolvedAssemblyPlan(assembly, reprojected); err != nil {
		return nil, err
	}
	return &localImageEffectiveInputs{loadoutID: assembly.LoadoutID, request: request, plan: plan}, nil
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
		strings.TrimSpace(selected.LoadoutID) != "" &&
		selected.CapabilityContract == capabilitydriver.StableDiffusionCapabilityContract &&
		selected.DriverIdentity != nil &&
		len(selected.Requirements) >= 3 && len(selected.Requirements) == len(selected.ExactBindings)
}

func requireSelectedImageRequestFeatures(spec *runtimev1.ImageGenerateScenarioSpec, supported []string) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	required := make([]string, 0, 2)
	if len(spec.GetReferenceImages()) > 0 || strings.TrimSpace(spec.GetReferenceImageArtifactId()) != "" {
		required = append(required, aicapabilities.FeatureInputImage)
	}
	if strings.TrimSpace(spec.GetMask()) != "" {
		required = append(required, aicapabilities.FeatureInputMask)
	}
	if err := requireSelectedFeatures(required, supported); err != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}
	return nil
}

func (s *Service) resolveLocalImageInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.ImageGenerateScenarioSpec,
) ([]capabilitydriver.ImageResolvedInput, error) {
	if spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if len(spec.GetReferenceImages()) != 0 {
		return nil, grpcerr.WithReasonCodeOptions(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED,
			grpcerr.ReasonOptions{Message: "local image input requires an explicit Runtime Artifact reference"},
		)
	}
	artifactID := strings.TrimSpace(spec.GetReferenceImageArtifactId())
	if artifactID == "" {
		return nil, nil
	}
	if artifactID != spec.GetReferenceImageArtifactId() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	input, err := s.resolveLocalImageArtifactInput(ctx, head, artifactID)
	if err != nil {
		return nil, err
	}
	return []capabilitydriver.ImageResolvedInput{input}, nil
}

func (s *Service) resolveLocalImageArtifactInput(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	artifactID string,
) (capabilitydriver.ImageResolvedInput, error) {
	if artifactID == "" {
		return capabilitydriver.ImageResolvedInput{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	var source *runtimeartifact.ArtifactSource
	if decision, localApp := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); localApp {
		var err error
		source, err = s.openAuthorizedLocalAppArtifact(ctx, decision, artifactID, localAppArtifactOperationInput)
		if err != nil {
			return capabilitydriver.ImageResolvedInput{}, err
		}
	} else {
		if s == nil || s.runtimeArtifacts == nil {
			return capabilitydriver.ImageResolvedInput{}, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
		}
		var ok bool
		source, ok = s.runtimeArtifacts.Open(ctx, artifactID)
		if !ok {
			return capabilitydriver.ImageResolvedInput{}, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
		}
		owner := runtimeArtifactOwner(head)
		if owner == nil || source.Record.Owner == nil || source.Record.Owner.RegisteredAppSubject != "" ||
			source.Record.Owner.SubjectUserID != owner.SubjectUserID || source.Record.Owner.AppID != owner.AppID {
			_ = source.Body.Close()
			return capabilitydriver.ImageResolvedInput{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
		}
	}
	defer func() { _ = source.Body.Close() }()
	record := source.Record
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(record.MimeType)), "image/") {
		return capabilitydriver.ImageResolvedInput{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	if record.SizeBytes > runtimeartifact.MaxInlineBytes {
		return capabilitydriver.ImageResolvedInput{}, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	payload, err := io.ReadAll(io.LimitReader(source.Body, runtimeartifact.MaxInlineBytes+1))
	if err != nil || len(payload) == 0 || int64(len(payload)) != record.SizeBytes {
		if _, localApp := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); localApp {
			return capabilitydriver.ImageResolvedInput{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
		}
		return capabilitydriver.ImageResolvedInput{}, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	return capabilitydriver.ImageResolvedInput{SourceIdentity: artifactID, ImageBytes: payload}, nil
}

func normalizeLocalImageRequest(
	spec *runtimev1.ImageGenerateScenarioSpec,
	defaults *structpb.Struct,
) (*runtimev1.ImageGenerateScenarioSpec, error) {
	cloned, _ := proto.Clone(spec).(*runtimev1.ImageGenerateScenarioSpec)
	if cloned == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if cloned.Seed != nil && (cloned.GetSeed() < math.MinInt32 || cloned.GetSeed() > math.MaxInt32) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
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
				if !ok || !capabilitydriver.StableDiffusionImageSizeSupported(text) {
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
	case capabilitydriver.InvocationFailureInvalidOption:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, err, grpcerr.ReasonOptions{})
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
	onStart localexecution.ImageExecutionStartFunc,
	onArtifact localexecution.ImageArtifactFunc,
	progress localexecution.ImageProgressFunc,
) (localexecution.ImageResult, error) {
	if s == nil || s.localImageHost == nil {
		return localexecution.ImageResult{}, localImageExecutionError(&localexecution.ExecutionError{
			Kind: localexecution.FailureLoad,
			Err:  fmt.Errorf("local image execution host is unavailable"),
		})
	}
	result, err := s.localImageHost.ExecuteImage(ctx, effective.plan, onStart, onArtifact, progress)
	if err != nil {
		if _, ok := grpcerr.ExtractReasonCode(err); ok {
			return result, err
		}
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
	artifact := nimillm.BinaryArtifact(produced.MediaType, produced.Bytes, metadata)
	nimillm.ApplyImageSpecMetadata(artifact, effective.request)
	return artifact
}

func localImageUsage(result localexecution.ImageResult) *runtimev1.UsageStats {
	if result.ComputeMS <= 0 {
		return nil
	}
	return &runtimev1.UsageStats{ComputeMs: result.ComputeMS}
}
