package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"github.com/nimiplatform/nimi/runtime/internal/videomedia"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/structpb"
)

// localVideoEffectiveInputs is a submit-time snapshot. Background execution
// never rereads AIConfig, machine selection, bindings, or request content.
type localVideoEffectiveInputs struct {
	head            *runtimev1.ScenarioRequestHead
	intent          executionintent.Intent
	configurationID string
	displayName     string
	plan            *capabilitydriver.VideoInvocationPlan
}

func (input *localVideoEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.configurationID
}

func (s *Service) captureLocalVideoEffectiveInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.VideoGenerateScenarioSpec,
) (*localVideoEffectiveInputs, error) {
	if s == nil || head == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveLocalVideoConsumerIntent(ctx, head)
	if err != nil {
		return nil, err
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.StableDiffusionVideoCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	if s.localExecution == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	selected, err := s.localExecution.ResolveSelectedLocalExecution(capabilitydriver.StableDiffusionVideoCapabilityContract)
	if err != nil {
		return nil, err
	}
	if !validSelectedVideoExecution(selected) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.SupportedFeatures); err != nil {
		return nil, err
	}

	capturedSpec, err := normalizeLocalVideoSpec(spec, intent.Defaults)
	if err != nil {
		return nil, err
	}
	resolvedRequest, err := s.resolveLocalVideoInvocationRequest(head, capturedSpec)
	if err != nil {
		return nil, err
	}

	identity := capabilitydriver.IdentityFromProto(selected.DriverIdentity)
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.StableDiffusionVideoCapabilityContract, identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	videoDriver, ok := driver.(capabilitydriver.VideoInvocationDriver)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	exactBindings := make([]capabilitydriver.InvocationExactBinding, 0, len(selected.ExactBindings))
	for _, binding := range selected.ExactBindings {
		exactBindings = append(exactBindings, capabilitydriver.InvocationExactBinding{
			RequirementID: binding.RequirementID, LocalAssetID: binding.LocalAssetID, AbsolutePath: binding.AbsolutePath,
			VerifiedContentID: binding.VerifiedContentID, EntrySHA256: binding.EntrySHA256,
		})
	}
	portable, _ := proto.Clone(selected.PortableConfig).(*structpb.Struct)
	plan, err := videoDriver.PlanVideoInvocation(capabilitydriver.VideoInvocationInput{
		ConfigurationID: strings.TrimSpace(selected.ConfigurationID),
		PortableConfig:  portable, ExactBindings: exactBindings, Request: resolvedRequest,
	})
	if err != nil {
		return nil, localVideoInvocationError(err)
	}
	if plan == nil || strings.TrimSpace(plan.ProcessKey()) == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	return &localVideoEffectiveInputs{
		head: cloneScenarioHead(head), intent: executionintent.Clone(intent),
		configurationID: strings.TrimSpace(selected.ConfigurationID), displayName: strings.TrimSpace(selected.DisplayName),
		plan: plan,
	}, nil
}

func (s *Service) resolveLocalVideoConsumerIntent(ctx context.Context, head *runtimev1.ScenarioRequestHead) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.StableDiffusionVideoCapabilityContract)
	return intent, err
}

func validSelectedVideoExecution(selected *localexecution.SelectedLocalExecution) bool {
	return selected != nil && selected.Configured && strings.TrimSpace(selected.ConfigurationID) != "" &&
		selected.CapabilityContract == capabilitydriver.StableDiffusionVideoCapabilityContract && selected.DriverIdentity != nil
}

func normalizeLocalVideoSpec(spec *runtimev1.VideoGenerateScenarioSpec, defaults *structpb.Struct) (*runtimev1.VideoGenerateScenarioSpec, error) {
	cloned, _ := proto.Clone(spec).(*runtimev1.VideoGenerateScenarioSpec)
	if cloned == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if defaults != nil && len(defaults.GetFields()) > 0 {
		descriptor := cloned.ProtoReflect().Descriptor()
		currentRaw, err := protojson.MarshalOptions{UseProtoNames: false}.Marshal(cloned)
		if err != nil {
			return nil, invalidAppAIConfigError()
		}
		current := map[string]any{}
		if err := json.Unmarshal(currentRaw, &current); err != nil {
			return nil, invalidAppAIConfigError()
		}
		allowed := map[protoreflect.Name]bool{"negative_prompt": true, "mode": true, "options": true}
		for key, value := range defaults.GetFields() {
			field := localVideoDefaultField(descriptor, key)
			if field == nil || !allowed[field.Name()] {
				return nil, invalidAppAIConfigError()
			}
			jsonName := field.JSONName()
			incoming := value.AsInterface()
			if existing, exists := current[jsonName]; exists {
				current[jsonName] = mergeLocalVideoDefault(existing, incoming)
			} else {
				current[jsonName] = incoming
			}
		}
		mergedRaw, err := json.Marshal(current)
		if err != nil {
			return nil, invalidAppAIConfigError()
		}
		merged := &runtimev1.VideoGenerateScenarioSpec{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(mergedRaw, merged); err != nil {
			return nil, invalidAppAIConfigError()
		}
		cloned = merged
	}
	if err := validateVideoGenerateScenarioSpec(cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func localVideoDefaultField(descriptor protoreflect.MessageDescriptor, key string) protoreflect.FieldDescriptor {
	key = strings.TrimSpace(key)
	fields := descriptor.Fields()
	for index := 0; index < fields.Len(); index++ {
		field := fields.Get(index)
		if key == string(field.Name()) || key == field.JSONName() {
			return field
		}
	}
	return nil
}

func mergeLocalVideoDefault(existing any, incoming any) any {
	existingMap, existingOK := existing.(map[string]any)
	incomingMap, incomingOK := incoming.(map[string]any)
	if !existingOK || !incomingOK {
		return existing
	}
	merged := make(map[string]any, len(existingMap)+len(incomingMap))
	for key, value := range incomingMap {
		merged[key] = value
	}
	for key, value := range existingMap {
		if defaultValue, exists := merged[key]; exists {
			merged[key] = mergeLocalVideoDefault(value, defaultValue)
		} else {
			merged[key] = value
		}
	}
	return merged
}

func (s *Service) resolveLocalVideoInvocationRequest(head *runtimev1.ScenarioRequestHead, spec *runtimev1.VideoGenerateScenarioSpec) (capabilitydriver.VideoInvocationRequest, error) {
	if spec == nil || spec.GetOptions() == nil {
		return capabilitydriver.VideoInvocationRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	options := spec.GetOptions()
	if strings.TrimSpace(options.GetRatio()) != "" || options.GetDurationSec() != 0 || options.GetCameraFixed() || options.GetWatermark() ||
		options.GetDraft() || strings.TrimSpace(options.GetServiceTier()) != "" || options.GetExecutionExpiresAfterSec() != 0 || options.GetReturnLastFrame() {
		return capabilitydriver.VideoInvocationRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	inputs := make([]capabilitydriver.VideoResolvedInput, 0)
	for _, item := range spec.GetContent() {
		if item == nil || item.GetType() == runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT {
			continue
		}
		if item.GetType() != runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_ARTIFACT_REF {
			// Local execution never interprets URL text as an Artifact id and does
			// not fetch remote media.
			return capabilitydriver.VideoInvocationRequest{}, grpcerr.WithReasonCodeOptions(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED,
				grpcerr.ReasonOptions{Message: "local video media input requires an explicit Runtime Artifact reference"},
			)
		}
		resolved, err := s.resolveLocalVideoArtifactInput(head, item)
		if err != nil {
			return capabilitydriver.VideoInvocationRequest{}, err
		}
		inputs = append(inputs, resolved)
	}
	width, height := nimillm.ParseDimensionPair(options.GetResolution())
	return capabilitydriver.VideoInvocationRequest{
		Prompt: nimillm.VideoPrompt(spec), NegativePrompt: nimillm.VideoNegativePrompt(spec),
		Width: int(width), Height: int(height), FrameCount: int(options.GetFrames()), FPS: int(options.GetFps()),
		Seed: options.GetSeed(), GenerateAudio: options.GetGenerateAudio(), Inputs: inputs,
	}, nil
}

func (s *Service) resolveLocalVideoArtifactInput(head *runtimev1.ScenarioRequestHead, item *runtimev1.VideoContentItem) (capabilitydriver.VideoResolvedInput, error) {
	artifactID := strings.TrimSpace(item.GetArtifactRef().GetArtifactId())
	if artifactID == "" {
		return capabilitydriver.VideoResolvedInput{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_INVALID_INPUT)
	}
	if s == nil || s.runtimeArtifacts == nil {
		return capabilitydriver.VideoResolvedInput{}, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	record, ok := s.runtimeArtifacts.Get(artifactID)
	if !ok {
		return capabilitydriver.VideoResolvedInput{}, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	owner := runtimeArtifactOwner(head)
	if owner == nil || record.Owner == nil || record.Owner.SubjectUserID != owner.SubjectUserID || record.Owner.AppID != owner.AppID {
		return capabilitydriver.VideoResolvedInput{}, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(record.MimeType)), "image/") {
		return capabilitydriver.VideoResolvedInput{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	if record.SizeBytes > runtimeartifact.MaxInlineBytes || len(record.Bytes) > runtimeartifact.MaxInlineBytes {
		return capabilitydriver.VideoResolvedInput{}, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	if record.SizeBytes != int64(len(record.Bytes)) || len(record.Bytes) == 0 {
		return capabilitydriver.VideoResolvedInput{}, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_ARTIFACT_NOT_FOUND)
	}
	role := capabilitydriver.VideoInputRole("")
	switch item.GetRole() {
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME:
		role = capabilitydriver.VideoInputRoleFirstFrame
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME:
		role = capabilitydriver.VideoInputRoleLastFrame
	case runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE:
		role = capabilitydriver.VideoInputRoleReferenceImage
	default:
		return capabilitydriver.VideoResolvedInput{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	return capabilitydriver.VideoResolvedInput{
		Role: role, SourceIdentity: artifactID, ImageBytes: append([]byte(nil), record.Bytes...),
	}, nil
}

func localVideoInvocationError(err error) error {
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

func localVideoMediaError(err error) error {
	if err == nil {
		return nil
	}
	kind := videomedia.FailureKindOf(err)
	if kind == videomedia.FailureUnavailable {
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{
			Metadata: map[string]string{"media_phase": string(kind)},
		})
	}
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{
		Metadata: map[string]string{"media_phase": string(kind)},
	})
}

func (s *Service) executeCapturedLocalVideo(ctx context.Context, effective *localVideoEffectiveInputs, progress localexecution.VideoProgressFunc) (localexecution.RawAVCandidate, error) {
	if s == nil || s.localVideoHost == nil {
		return localexecution.RawAVCandidate{}, localExecutionError(&localexecution.ExecutionError{
			Kind: localexecution.FailureLoad, Err: fmt.Errorf("local video execution host is unavailable"),
		})
	}
	candidate, err := s.localVideoHost.ExecuteVideo(ctx, effective.plan, progress)
	if err != nil {
		return candidate, localExecutionError(err)
	}
	return candidate, nil
}

func localVideoArtifact(effective *localVideoEffectiveInputs, result videomedia.Result) (*runtimev1.ScenarioArtifact, error) {
	if effective == nil || len(result.Bytes) == 0 || result.Facts.MIMEType != videomedia.MIMETypeMP4 {
		return nil, fmt.Errorf("local video artifact projection is incomplete")
	}
	metadata, err := structpb.NewStruct(map[string]any{
		"container":         "mp4",
		"frame_count":       result.Facts.FrameCount,
		"media_validation":  "ffprobe",
		"conditioning_mode": string(effective.plan.ConditioningMode()),
		"prompt":            effective.plan.Prompt(),
		"negative_prompt":   effective.plan.NegativePrompt(),
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.ScenarioArtifact{
		ArtifactId: "artifact_" + ulid.Make().String(), MimeType: result.Facts.MIMEType,
		Bytes: append([]byte(nil), result.Bytes...), Sha256: result.Facts.SHA256, SizeBytes: result.Facts.SizeBytes,
		DurationMs: result.Facts.Duration.Milliseconds(), Fps: int32(result.Facts.FPS), Width: int32(result.Facts.Width), Height: int32(result.Facts.Height),
		SampleRateHz: int32(result.Facts.SampleRate), Channels: int32(result.Facts.Channels), Metadata: metadata,
	}, nil
}
