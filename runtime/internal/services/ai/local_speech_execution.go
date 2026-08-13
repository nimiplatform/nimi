package ai

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type localSpeechEffectiveInputs struct {
	head              *runtimev1.ScenarioRequestHead
	scenarioType      runtimev1.ScenarioType
	intent            executionintent.Intent
	configurationID   string
	displayName       string
	driverIdentity    *runtimev1.CapabilityImplementationIdentity
	portableConfig    *structpb.Struct
	requirements      []*runtimev1.LocalCapabilityRequirement
	exactBindings     []capabilitydriver.InvocationExactBinding
	contentIDs        []string
	supportedFeatures []string
	streamMode        capabilitydriver.SpeechStreamMode
	synthesizePlan    *capabilitydriver.SpeechSynthesizeInvocationPlan
	transcribePlan    *capabilitydriver.SpeechTranscribeInvocationPlan
}

func (input *localSpeechEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.configurationID
}

func (s *Service) captureLocalSpeechEffectiveInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, request *runtimev1.SubmitScenarioJobRequest) (*localSpeechEffectiveInputs, error) {
	if s == nil || head == nil || request == nil || request.GetSpec() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	contract := scenarioTargetCapability(request.GetScenarioType())
	if contract != capabilitydriver.AudioSynthesizeContract && contract != capabilitydriver.AudioTranscribeContract {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	intent, err := scenarioExecutionIntentFromContext(ctx, contract)
	if err != nil {
		return nil, err
	}
	if !intent.IsLocal() || intent.CapabilityContract != contract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	if s.localExecution == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	selected, err := s.localExecution.ResolveSelectedLocalExecution(contract)
	if err != nil {
		return nil, err
	}
	if !validSelectedSpeechExecution(selected, contract) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.SupportedFeatures); err != nil {
		return nil, err
	}

	identity := capabilitydriver.IdentityFromProto(selected.DriverIdentity)
	driver, reason := s.capabilityDrivers.Resolve(contract, identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, grpcerr.ReasonOptions{
			Metadata: map[string]string{"local_speech_driver_stage": "registry_resolve", "local_reason": reason.String()},
		})
	}
	exactBindings, contentIDs := captureLocalSpeechBindings(selected.ExactBindings)
	portable, _ := proto.Clone(selected.PortableConfig).(*structpb.Struct)
	effective := &localSpeechEffectiveInputs{
		head:              cloneScenarioHead(head),
		scenarioType:      request.GetScenarioType(),
		intent:            executionintent.Clone(intent),
		configurationID:   strings.TrimSpace(selected.ConfigurationID),
		displayName:       strings.TrimSpace(selected.DisplayName),
		driverIdentity:    cloneCapabilityImplementationIdentity(selected.DriverIdentity),
		portableConfig:    portable,
		requirements:      cloneLocalCapabilityRequirements(selected.Requirements),
		exactBindings:     exactBindings,
		contentIDs:        contentIDs,
		supportedFeatures: append([]string(nil), selected.SupportedFeatures...),
	}

	switch contract {
	case capabilitydriver.AudioSynthesizeContract:
		speechDriver, ok := driver.(capabilitydriver.SpeechSynthesizeInvocationDriver)
		if !ok {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, grpcerr.ReasonOptions{
				Metadata: map[string]string{"local_speech_driver_stage": "synthesize_interface"},
			})
		}
		spec, err := normalizeLocalSpeechSynthesizeRequest(request.GetSpec().GetSpeechSynthesize(), intent.Defaults)
		if err != nil {
			return nil, err
		}
		if spec.GetVoiceRef().GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET {
			spec, err = s.resolveSynthesizeSpeechSpecVoiceRefForTarget(ctx, head, selected.ExecutionTarget, spec)
			if err != nil {
				return nil, err
			}
		}
		plan, err := speechDriver.PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{
			PortableConfig: portable,
			ExactBindings:  append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
			Request:        spec,
		})
		if err != nil {
			return nil, localSpeechInvocationError(err)
		}
		if plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, grpcerr.ReasonOptions{
				Metadata: map[string]string{"local_speech_driver_stage": "synthesize_plan"},
			})
		}
		effective.synthesizePlan = plan
		effective.streamMode = speechDriver.SpeechStreamMode()
	case capabilitydriver.AudioTranscribeContract:
		speechDriver, ok := driver.(capabilitydriver.SpeechTranscribeInvocationDriver)
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
		}
		spec, err := normalizeLocalSpeechTranscribeRequest(request.GetSpec().GetSpeechTranscribe(), intent.Defaults)
		if err != nil {
			return nil, err
		}
		audioBytes, mimeType, _, err := nimillm.ResolveTranscriptionAudioSource(ctx, spec)
		if err != nil {
			return nil, err
		}
		captured, _ := proto.Clone(spec).(*runtimev1.SpeechTranscribeScenarioSpec)
		captured.AudioSource = nil
		plan, err := speechDriver.PlanSpeechTranscribeInvocation(capabilitydriver.SpeechTranscribeInvocationInput{
			PortableConfig: portable,
			ExactBindings:  append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
			Request:        captured,
			AudioBytes:     audioBytes,
			MIMEType:       mimeType,
		})
		if err != nil {
			return nil, localSpeechInvocationError(err)
		}
		if plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
		}
		effective.transcribePlan = plan
	}
	return effective, nil
}

func validSelectedSpeechExecution(selected *localexecution.SelectedLocalExecution, contract string) bool {
	return selected != nil && selected.Configured && strings.TrimSpace(selected.ConfigurationID) != "" &&
		selected.CapabilityContract == contract && selected.DriverIdentity != nil &&
		len(selected.Requirements) == 1 && len(selected.ExactBindings) == 1
}

func captureLocalSpeechBindings(values []localexecution.ExactBinding) ([]capabilitydriver.InvocationExactBinding, []string) {
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, len(values))
	contentIDs := make([]string, 0, len(values))
	for _, binding := range values {
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{
			RequirementID:     binding.RequirementID,
			AssetID:           binding.AssetID,
			LocalAssetID:      binding.LocalAssetID,
			AbsolutePath:      binding.AbsolutePath,
			VerifiedContentID: binding.VerifiedContentID,
			EntrySHA256:       binding.EntrySHA256,
		})
		contentIDs = append(contentIDs, binding.VerifiedContentID+"/"+binding.EntrySHA256)
	}
	sort.Strings(contentIDs)
	return bindings, contentIDs
}

func cloneCapabilityImplementationIdentity(value *runtimev1.CapabilityImplementationIdentity) *runtimev1.CapabilityImplementationIdentity {
	cloned, _ := proto.Clone(value).(*runtimev1.CapabilityImplementationIdentity)
	return cloned
}

func cloneLocalCapabilityRequirements(values []*runtimev1.LocalCapabilityRequirement) []*runtimev1.LocalCapabilityRequirement {
	result := make([]*runtimev1.LocalCapabilityRequirement, 0, len(values))
	for _, value := range values {
		cloned, _ := proto.Clone(value).(*runtimev1.LocalCapabilityRequirement)
		result = append(result, cloned)
	}
	return result
}

func normalizeLocalSpeechSynthesizeRequest(spec *runtimev1.SpeechSynthesizeScenarioSpec, defaults *structpb.Struct) (*runtimev1.SpeechSynthesizeScenarioSpec, error) {
	request, _ := proto.Clone(spec).(*runtimev1.SpeechSynthesizeScenarioSpec)
	if request == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	for key, value := range defaults.GetFields() {
		switch key {
		case "language":
			if request.GetLanguage() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.Language = text
			}
		case "audioFormat", "audio_format":
			if request.GetAudioFormat() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.AudioFormat = text
			}
		case "sampleRateHz", "sample_rate_hz":
			if request.SampleRateHz == nil {
				number, ok := integerDefault(value)
				if !ok || number < 0 || number > 192000 {
					return nil, invalidAppAIConfigError()
				}
				request.SampleRateHz = proto.Int32(int32(number))
			}
		case "speed":
			if request.Speed == nil {
				number, ok := finiteDefaultNumber(value)
				if !ok || number < 0 || number > 4 {
					return nil, invalidAppAIConfigError()
				}
				request.Speed = proto.Float32(float32(number))
			}
		case "pitch":
			if request.Pitch == nil {
				number, ok := finiteDefaultNumber(value)
				if !ok || number < -24 || number > 24 {
					return nil, invalidAppAIConfigError()
				}
				request.Pitch = proto.Float32(float32(number))
			}
		case "volume":
			if request.Volume == nil {
				number, ok := finiteDefaultNumber(value)
				if !ok || number < 0 || number > 4 {
					return nil, invalidAppAIConfigError()
				}
				request.Volume = proto.Float32(float32(number))
			}
		case "emotion":
			if request.GetEmotion() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.Emotion = text
			}
		default:
			return nil, invalidAppAIConfigError()
		}
	}
	return request, nil
}

func normalizeLocalSpeechTranscribeRequest(spec *runtimev1.SpeechTranscribeScenarioSpec, defaults *structpb.Struct) (*runtimev1.SpeechTranscribeScenarioSpec, error) {
	request, _ := proto.Clone(spec).(*runtimev1.SpeechTranscribeScenarioSpec)
	if request == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	for key, value := range defaults.GetFields() {
		switch key {
		case "mimeType", "mime_type":
			if request.GetMimeType() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.MimeType = text
			}
		case "language":
			if request.GetLanguage() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.Language = text
			}
		case "timestamps":
			if request.Timestamps == nil {
				boolean, ok := exactDefaultBool(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.Timestamps = proto.Bool(boolean)
			}
		case "diarization":
			if request.Diarization == nil {
				boolean, ok := exactDefaultBool(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.Diarization = proto.Bool(boolean)
			}
		case "speakerCount", "speaker_count":
			if request.SpeakerCount == nil {
				number, ok := integerDefault(value)
				if !ok || number < 0 || number > 32 {
					return nil, invalidAppAIConfigError()
				}
				request.SpeakerCount = proto.Int32(int32(number))
			}
		case "prompt":
			if request.GetPrompt() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.Prompt = text
			}
		case "responseFormat", "response_format":
			if request.GetResponseFormat() == "" {
				text, ok := localImageDefaultString(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				request.ResponseFormat = text
			}
		default:
			return nil, invalidAppAIConfigError()
		}
	}
	return request, nil
}

func exactDefaultBool(value *structpb.Value) (bool, bool) {
	if value == nil {
		return false, false
	}
	_, ok := value.GetKind().(*structpb.Value_BoolValue)
	return value.GetBoolValue(), ok
}

func localSpeechInvocationError(err error) error {
	var invocationErr *capabilitydriver.InvocationError
	if !errors.As(err, &invocationErr) {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	}
	switch invocationErr.Kind {
	case capabilitydriver.InvocationFailureInvalidRequest:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	case capabilitydriver.InvocationFailureUnsupported:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, err, grpcerr.ReasonOptions{})
	case capabilitydriver.InvocationFailureInvalidBinding:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, err, grpcerr.ReasonOptions{})
	}
}

func (s *Service) executeCapturedLocalSpeech(ctx context.Context, effective *localSpeechEffectiveInputs, onStart localexecution.SpeechExecutionStartFunc) ([]*runtimev1.ScenarioArtifact, map[string]*capabilitydriver.ArtifactBody, *runtimev1.UsageStats, error) {
	if s == nil || s.localSpeechHost == nil || effective == nil {
		return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureLoad, Err: fmt.Errorf("local speech execution host is unavailable")})
	}
	switch effective.scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		result, err := s.localSpeechHost.ExecuteSpeechSynthesis(ctx, effective.synthesizePlan, onStart)
		if err != nil {
			return nil, nil, nil, localExecutionError(err)
		}
		if result.AudioBody != nil && len(result.AudioBytes) != 0 {
			_ = result.AudioBody.Close()
			return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: fmt.Errorf("local speech synthesis returned ambiguous audio bodies")})
		}
		mimeType := strings.TrimSpace(result.MIMEType)
		if mimeType == "" {
			mimeType = "audio/wav"
		}
		if result.AudioBody != nil {
			body, bodyErr := capabilitydriver.NewIncrementalArtifactBody(result.AudioBody)
			if bodyErr != nil {
				_ = result.AudioBody.Close()
				return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: bodyErr})
			}
			artifactID := ulid.Make().String()
			artifact := &runtimev1.ScenarioArtifact{
				ArtifactId: artifactID,
				MimeType:   mimeType,
				SizeBytes:  result.SizeBytes,
				Metadata:   nimillm.ToStruct(map[string]any{"local_configuration_id": effective.configurationID}),
			}
			return []*runtimev1.ScenarioArtifact{artifact}, map[string]*capabilitydriver.ArtifactBody{artifactID: body}, result.Usage, nil
		}
		if len(result.AudioBytes) == 0 {
			return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: fmt.Errorf("local speech synthesis returned no audio")})
		}
		return []*runtimev1.ScenarioArtifact{nimillm.BinaryArtifact(mimeType, result.AudioBytes, map[string]any{"local_configuration_id": effective.configurationID})}, nil, result.Usage, nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		result, err := s.localSpeechHost.ExecuteSpeechTranscription(ctx, effective.transcribePlan, onStart)
		if err != nil {
			return nil, nil, nil, localExecutionError(err)
		}
		text := strings.TrimSpace(result.Text)
		if text == "" {
			return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: fmt.Errorf("local speech transcription returned no text")})
		}
		return []*runtimev1.ScenarioArtifact{nimillm.BinaryArtifact("text/plain; charset=utf-8", []byte(text), map[string]any{"local_configuration_id": effective.configurationID})}, nil, result.Usage, nil
	default:
		return nil, nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}
