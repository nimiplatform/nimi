// @nimi-authority: rule.nimi.runtime.local-compute.r042

package ai

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
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
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type localSpeechEffectiveInputs struct {
	head                   *runtimev1.ScenarioRequestHead
	scenarioType           runtimev1.ScenarioType
	intent                 executionintent.Intent
	loadoutID              string
	displayName            string
	effectiveInputIdentity *runtimev1.LoadoutEffectiveInputIdentity
	driverIdentity         *runtimev1.CapabilityImplementationIdentity
	portableConfig         *structpb.Struct
	requirements           []*runtimev1.LocalCapabilityRequirement
	exactBindings          []capabilitydriver.InvocationExactBinding
	contentIDs             []string
	streamMode             capabilitydriver.SpeechStreamMode
	synthesizePlan         capabilitydriver.SpeechSynthesizePlan
	transcribePlan         capabilitydriver.SpeechTranscribePlan
	stagingWAVPath         string
	stagingPaths           []string
	resolvedAssembly       *localResolvedAssembly
}

func (input *localSpeechEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.loadoutID
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
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if !validSelectedSpeechExecution(selected, contract) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.ConfiguredFeatures); err != nil {
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
		head:           cloneScenarioHead(head),
		scenarioType:   request.GetScenarioType(),
		intent:         executionintent.Clone(intent),
		loadoutID:      strings.TrimSpace(selected.LoadoutID),
		displayName:    strings.TrimSpace(selected.DisplayName),
		driverIdentity: cloneCapabilityImplementationIdentity(selected.DriverIdentity),
		portableConfig: portable,
		requirements:   cloneLocalCapabilityRequirements(selected.Requirements),
		exactBindings:  exactBindings,
		contentIDs:     contentIDs,
	}

	switch contract {
	case capabilitydriver.AudioSynthesizeContract:
		spec, err := normalizeLocalSpeechSynthesizeRequest(request.GetSpec().GetSpeechSynthesize(), intent.Defaults)
		if err != nil {
			return nil, err
		}
		resolvedOwnedVoiceAsset := spec.GetVoiceRef().GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET
		if resolvedOwnedVoiceAsset {
			spec, err = s.resolveSynthesizeSpeechSpecVoiceRefForTarget(ctx, head, selected.ExecutionTarget, spec)
			if err != nil {
				return nil, err
			}
		}
		switch speechDriver := driver.(type) {
		case capabilitydriver.AudioCppTTSSynthesizeInvocationDriver:
			if !resolvedOwnedVoiceAsset && spec.GetVoiceRef().GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF && strings.HasPrefix(strings.TrimSpace(spec.GetVoiceRef().GetProviderVoiceRef()), capabilitydriver.AudioCppReferenceVoicePrefix) {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
			runtimeInput, runtimeErr := audioCppSpeechRuntimeInput(selected)
			if runtimeErr != nil {
				return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, runtimeErr, grpcerr.ReasonOptions{})
			}
			stagingPath, stagingErr := s.createLocalSpeechStagingPath("speech-*.wav")
			if stagingErr != nil {
				return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, stagingErr, grpcerr.ReasonOptions{})
			}
			effective.stagingPaths = append(effective.stagingPaths, stagingPath)
			var reference *capabilitydriver.AudioCppReferenceVoiceInput
			if spec.GetVoiceRef().GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF {
				referencePath, referenceErr := s.createLocalSpeechStagingPath("speech-reference-*.wav")
				if referenceErr != nil {
					cleanupLocalSpeechStagingPaths(effective.stagingPaths)
					return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, referenceErr, grpcerr.ReasonOptions{})
				}
				effective.stagingPaths = append(effective.stagingPaths, referencePath)
				reference, referenceErr = s.captureAudioCppReferenceVoice(spec.GetVoiceRef().GetProviderVoiceRef(), referencePath)
				if referenceErr != nil {
					cleanupLocalSpeechStagingPaths(effective.stagingPaths)
					return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND, referenceErr, grpcerr.ReasonOptions{})
				}
			}
			plan, planErr := speechDriver.PlanAudioCppTTSSynthesis(capabilitydriver.AudioCppTTSSynthesizeInvocationInput{LoadoutID: selected.LoadoutID, RecipeID: selected.RecipeID, PortableConfig: portable, ExactBindings: append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...), Runtime: runtimeInput, ReferenceVoice: reference, Request: spec, StagingWAVPath: stagingPath})
			if planErr != nil {
				cleanupLocalSpeechStagingPaths(effective.stagingPaths)
				return nil, localSpeechInvocationError(planErr)
			}
			effective.synthesizePlan = plan
			effective.stagingWAVPath = stagingPath
			effective.streamMode = speechDriver.SpeechStreamMode()
		case capabilitydriver.Qwen3TTSAudioCppInvocationDriver:
			packageInput, packageErr := audioCppRuntimePackageInput(selected)
			if packageErr != nil {
				return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, packageErr, grpcerr.ReasonOptions{})
			}
			stagingPath, stagingErr := s.createLocalSpeechStagingWAVPath()
			if stagingErr != nil {
				return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, stagingErr, grpcerr.ReasonOptions{})
			}
			plan, planErr := speechDriver.PlanQwen3TTSAudioCppInvocation(capabilitydriver.Qwen3TTSAudioCppInvocationInput{LoadoutID: selected.LoadoutID, RecipeID: selected.RecipeID, PortableConfig: portable, ExactBindings: append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...), Package: packageInput, Request: spec, StagingWAVPath: stagingPath})
			if planErr != nil {
				cleanupLocalSpeechStaging(stagingPath)
				return nil, localSpeechInvocationError(planErr)
			}
			effective.synthesizePlan = plan
			effective.stagingWAVPath = stagingPath
			effective.stagingPaths = append(effective.stagingPaths, stagingPath)
			effective.streamMode = speechDriver.SpeechStreamMode()
		case capabilitydriver.SpeechSynthesizeInvocationDriver:
			plan, planErr := speechDriver.PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{PortableConfig: portable, ExactBindings: append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...), Request: spec})
			if planErr != nil {
				return nil, localSpeechInvocationError(planErr)
			}
			effective.synthesizePlan = plan
			effective.streamMode = speechDriver.SpeechStreamMode()
		default:
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, grpcerr.ReasonOptions{Metadata: map[string]string{"local_speech_driver_stage": "synthesize_interface"}})
		}
		if effective.synthesizePlan == nil || strings.TrimSpace(effective.synthesizePlan.ModelAssetID()) == "" {
			cleanupLocalSpeechStagingPaths(effective.stagingPaths)
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, grpcerr.ReasonOptions{Metadata: map[string]string{"local_speech_driver_stage": "synthesize_plan"}})
		}
	case capabilitydriver.AudioTranscribeContract:
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
		switch speechDriver := driver.(type) {
		case capabilitydriver.AudioCppASRTranscribeInvocationDriver:
			runtimeInput, runtimeErr := audioCppSpeechRuntimeInput(selected)
			if runtimeErr != nil {
				return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, runtimeErr, grpcerr.ReasonOptions{})
			}
			audioPath, stagingErr := s.createLocalSpeechStagingPath("speech-input-*.wav")
			if stagingErr != nil {
				return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, stagingErr, grpcerr.ReasonOptions{})
			}
			textPath, stagingErr := s.createLocalSpeechStagingPath("speech-transcript-*.txt")
			if stagingErr != nil {
				cleanupLocalSpeechStagingPaths([]string{audioPath})
				return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, stagingErr, grpcerr.ReasonOptions{})
			}
			effective.stagingPaths = append(effective.stagingPaths, audioPath, textPath)
			plan, planErr := speechDriver.PlanAudioCppASRTranscription(capabilitydriver.AudioCppASRTranscribeInvocationInput{LoadoutID: selected.LoadoutID, RecipeID: selected.RecipeID, PortableConfig: portable, ExactBindings: append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...), Runtime: runtimeInput, Request: captured, AudioBytes: audioBytes, MIMEType: mimeType, StagingAudioPath: audioPath, StagingTextOutPath: textPath})
			if planErr != nil {
				cleanupLocalSpeechStagingPaths(effective.stagingPaths)
				return nil, localSpeechInvocationError(planErr)
			}
			effective.transcribePlan = plan
		case capabilitydriver.SpeechTranscribeInvocationDriver:
			plan, planErr := speechDriver.PlanSpeechTranscribeInvocation(capabilitydriver.SpeechTranscribeInvocationInput{PortableConfig: portable, ExactBindings: append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...), Request: captured, AudioBytes: audioBytes, MIMEType: mimeType})
			if planErr != nil {
				return nil, localSpeechInvocationError(planErr)
			}
			effective.transcribePlan = plan
		default:
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
		}
		if effective.transcribePlan == nil || strings.TrimSpace(effective.transcribePlan.ModelAssetID()) == "" {
			cleanupLocalSpeechStagingPaths(effective.stagingPaths)
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
		}
	}
	resolvedAssembly, err := localResolvedAssemblyForSpeech(selected, effective.synthesizePlan, effective.transcribePlan)
	if err != nil {
		cleanupLocalSpeechStagingPaths(effective.stagingPaths)
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local speech ResolvedAssembly capture failed"})
	}
	effectiveInputIdentity, err := projectResolvedAssemblyEffectiveInputIdentity(resolvedAssembly)
	if err != nil {
		cleanupLocalSpeechStagingPaths(effective.stagingPaths)
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local speech ResolvedAssembly attribution failed"})
	}
	effective.effectiveInputIdentity = effectiveInputIdentity
	effective.resolvedAssembly = resolvedAssembly
	return effective, nil
}

func (s *Service) localSpeechEffectiveInputsFromResolvedAssembly(assembly *localResolvedAssembly) (*localSpeechEffectiveInputs, error) {
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, err
	}
	if assembly.LoadPlan.Kind != "speech" || assembly.LoadPlan.Speech == nil {
		return nil, fmt.Errorf("local speech ResolvedAssembly contract is mismatched")
	}
	portable, err := resolvedAssemblyPortableConfig(assembly)
	if err != nil {
		return nil, err
	}
	if s == nil || s.capabilityDrivers == nil {
		return nil, fmt.Errorf("local speech Driver registry is unavailable")
	}
	driver, reason := s.capabilityDrivers.Resolve(assembly.CapabilityContract, capabilitydriver.Identity{
		ImplementationID: assembly.DriverIdentity.ImplementationID,
		DriverID:         assembly.DriverIdentity.DriverID,
		DriverDialect:    assembly.DriverIdentity.DriverDialect,
	})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return nil, fmt.Errorf("captured local speech Driver is unavailable")
	}
	effective := &localSpeechEffectiveInputs{loadoutID: assembly.LoadoutID}
	bindings := resolvedAssemblyExactBindings(assembly)
	switch assembly.LoadPlan.Speech.Operation {
	case "synthesize":
		if assembly.CapabilityContract != capabilitydriver.AudioSynthesizeContract || assembly.Request.Kind != "speech.synthesize" {
			return nil, fmt.Errorf("local speech synthesis ResolvedAssembly contract is mismatched")
		}
		request := &runtimev1.SpeechSynthesizeScenarioSpec{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
			return nil, fmt.Errorf("decode local speech synthesis request: %w", err)
		}
		switch speechDriver := driver.(type) {
		case capabilitydriver.AudioCppTTSSynthesizeInvocationDriver:
			captured := assembly.LoadPlan.Speech.AudioCpp
			if captured == nil {
				return nil, fmt.Errorf("captured audio.cpp TTS plan is missing")
			}
			if !s.localSpeechStagingPathAdmitted(captured.StagingWAVPath, ".wav") || (captured.ReferenceWAVPath != "" && !s.localSpeechStagingPathAdmitted(captured.ReferenceWAVPath, ".wav")) {
				return nil, fmt.Errorf("captured audio.cpp TTS staging path is invalid")
			}
			selectedForPlan := selectedLocalExecutionFromResolvedAssembly(assembly)
			runtimeInput, runtimeErr := audioCppSpeechRuntimeInput(selectedForPlan)
			if runtimeErr != nil {
				return nil, runtimeErr
			}
			var reference *capabilitydriver.AudioCppReferenceVoiceInput
			if captured.ReferenceWAVPath != "" {
				reference = &capabilitydriver.AudioCppReferenceVoiceInput{ProviderVoiceRef: request.GetVoiceRef().GetProviderVoiceRef(), WAVPath: captured.ReferenceWAVPath, WAVBytes: assembly.Request.BinaryInput, MIMEType: assembly.Request.MIMEType, ReferenceText: captured.ReferenceText}
			}
			effective.synthesizePlan, err = speechDriver.PlanAudioCppTTSSynthesis(capabilitydriver.AudioCppTTSSynthesizeInvocationInput{LoadoutID: assembly.LoadoutID, RecipeID: assembly.RecipeID, PortableConfig: portable, ExactBindings: bindings, Runtime: runtimeInput, ReferenceVoice: reference, Request: request, StagingWAVPath: captured.StagingWAVPath})
			effective.stagingWAVPath = captured.StagingWAVPath
			effective.stagingPaths = append(effective.stagingPaths, captured.StagingWAVPath)
			if captured.ReferenceWAVPath != "" {
				effective.stagingPaths = append(effective.stagingPaths, captured.ReferenceWAVPath)
			}
			effective.streamMode = speechDriver.SpeechStreamMode()
		case capabilitydriver.Qwen3TTSAudioCppInvocationDriver:
			captured := assembly.LoadPlan.Speech.Qwen3TTSAudioCpp
			if captured == nil {
				return nil, fmt.Errorf("captured Qwen3-TTS audio.cpp plan is missing")
			}
			if !s.localSpeechStagingPathAdmitted(captured.StagingWAVPath, ".wav") {
				return nil, fmt.Errorf("captured Qwen3-TTS audio.cpp staging path is invalid")
			}
			selectedForPlan := selectedLocalExecutionFromResolvedAssembly(assembly)
			packageInput, packageErr := audioCppRuntimePackageInput(selectedForPlan)
			if packageErr != nil {
				return nil, packageErr
			}
			effective.synthesizePlan, err = speechDriver.PlanQwen3TTSAudioCppInvocation(capabilitydriver.Qwen3TTSAudioCppInvocationInput{LoadoutID: assembly.LoadoutID, RecipeID: assembly.RecipeID, PortableConfig: portable, ExactBindings: bindings, Package: packageInput, Request: request, StagingWAVPath: captured.StagingWAVPath})
			effective.stagingWAVPath = captured.StagingWAVPath
			effective.stagingPaths = append(effective.stagingPaths, captured.StagingWAVPath)
			effective.streamMode = speechDriver.SpeechStreamMode()
		case capabilitydriver.SpeechSynthesizeInvocationDriver:
			effective.synthesizePlan, err = speechDriver.PlanSpeechSynthesizeInvocation(capabilitydriver.SpeechSynthesizeInvocationInput{PortableConfig: portable, ExactBindings: bindings, Request: request})
			effective.streamMode = speechDriver.SpeechStreamMode()
		default:
			return nil, fmt.Errorf("captured local speech synthesis Driver has no invocation contract")
		}
		effective.scenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE
	case "transcribe":
		if assembly.CapabilityContract != capabilitydriver.AudioTranscribeContract || assembly.Request.Kind != "speech.transcribe" {
			return nil, fmt.Errorf("local speech transcription ResolvedAssembly contract is mismatched")
		}
		request := &runtimev1.SpeechTranscribeScenarioSpec{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
			return nil, fmt.Errorf("decode local speech transcription request: %w", err)
		}
		switch speechDriver := driver.(type) {
		case capabilitydriver.AudioCppASRTranscribeInvocationDriver:
			captured := assembly.LoadPlan.Speech.AudioCpp
			if captured == nil {
				return nil, fmt.Errorf("captured audio.cpp ASR plan is missing")
			}
			if !s.localSpeechStagingPathAdmitted(captured.StagingAudioPath, ".wav") || !s.localSpeechStagingPathAdmitted(captured.StagingTextOutPath, ".txt") {
				return nil, fmt.Errorf("captured audio.cpp ASR staging paths are invalid")
			}
			selectedForPlan := selectedLocalExecutionFromResolvedAssembly(assembly)
			runtimeInput, runtimeErr := audioCppSpeechRuntimeInput(selectedForPlan)
			if runtimeErr != nil {
				return nil, runtimeErr
			}
			effective.transcribePlan, err = speechDriver.PlanAudioCppASRTranscription(capabilitydriver.AudioCppASRTranscribeInvocationInput{LoadoutID: assembly.LoadoutID, RecipeID: assembly.RecipeID, PortableConfig: portable, ExactBindings: bindings, Runtime: runtimeInput, Request: request, AudioBytes: assembly.Request.BinaryInput, MIMEType: assembly.Request.MIMEType, StagingAudioPath: captured.StagingAudioPath, StagingTextOutPath: captured.StagingTextOutPath})
			effective.stagingPaths = append(effective.stagingPaths, captured.StagingAudioPath, captured.StagingTextOutPath)
		case capabilitydriver.SpeechTranscribeInvocationDriver:
			effective.transcribePlan, err = speechDriver.PlanSpeechTranscribeInvocation(capabilitydriver.SpeechTranscribeInvocationInput{PortableConfig: portable, ExactBindings: bindings, Request: request, AudioBytes: append([]byte(nil), assembly.Request.BinaryInput...), MIMEType: assembly.Request.MIMEType})
		default:
			return nil, fmt.Errorf("captured local speech transcription Driver has no invocation contract")
		}
		effective.scenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
	default:
		return nil, fmt.Errorf("captured local speech operation %q is unsupported", assembly.LoadPlan.Speech.Operation)
	}
	if err != nil {
		return nil, err
	}
	selected := selectedLocalExecutionFromResolvedAssembly(assembly)
	selected.PortableConfig = portable
	reprojected, err := localResolvedAssemblyForSpeech(selected, effective.synthesizePlan, effective.transcribePlan)
	if err != nil {
		return nil, err
	}
	if err := validateRehydratedResolvedAssemblyPlan(assembly, reprojected); err != nil {
		return nil, err
	}
	return effective, nil
}

func (s *Service) createLocalSpeechStagingWAVPath() (string, error) {
	return s.createLocalSpeechStagingPath("speech-*.wav")
}

func (s *Service) createLocalSpeechStagingPath(pattern string) (string, error) {
	root := strings.TrimSpace(s.localSpeechStagingRoot)
	if root == "" || !filepath.IsAbs(root) {
		return "", fmt.Errorf("Runtime speech staging root is unavailable")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("create Runtime speech staging root: %w", err)
	}
	file, err := os.CreateTemp(root, pattern)
	if err != nil {
		return "", fmt.Errorf("allocate Runtime speech staging path: %w", err)
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	if err := os.Remove(path); err != nil {
		return "", err
	}
	return path, nil
}

func cleanupLocalSpeechStaging(path string) {
	if strings.TrimSpace(path) != "" {
		_ = os.Remove(path)
		_ = os.Remove(path + ".tmp")
	}
}

func cleanupLocalSpeechStagingPaths(paths []string) {
	for _, path := range paths {
		cleanupLocalSpeechStaging(path)
	}
}

func (s *Service) localSpeechStagingPathAdmitted(path string, extension string) bool {
	root := strings.TrimSpace(s.localSpeechStagingRoot)
	candidate := strings.TrimSpace(path)
	if !filepath.IsAbs(root) || !filepath.IsAbs(candidate) || !strings.EqualFold(filepath.Ext(candidate), extension) {
		return false
	}
	relative, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	return err == nil && relative != "." && relative != "" && filepath.Dir(relative) == "." && !filepath.IsAbs(relative) && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}

func audioCppSpeechRuntimeInput(selected *localexecution.SelectedLocalExecution) (capabilitydriver.AudioCppSpeechRuntimeInput, error) {
	packageInput, err := audioCppRuntimePackageInput(selected)
	if err != nil {
		return capabilitydriver.AudioCppSpeechRuntimeInput{}, err
	}
	result := capabilitydriver.AudioCppSpeechRuntimeInput{Package: packageInput}
	for _, source := range selected.ExactDependencySources {
		if source.DependencyID != capabilitydriver.AudioCppESpeakDependencyID {
			continue
		}
		result.ESpeakSelectedSourceRecordID = strings.TrimSpace(source.SelectedSourceRecordID)
		for _, artifact := range source.VerifiedArtifacts {
			switch strings.ToLower(filepath.Base(artifact)) {
			case "espeak-ng.dll", "libespeak-ng.dll":
				result.ESpeakLibraryPath = filepath.Clean(artifact)
			case "phontab":
				result.ESpeakDataPath = filepath.Dir(filepath.Clean(artifact))
			}
		}
	}
	return result, nil
}

func validSelectedSpeechExecution(selected *localexecution.SelectedLocalExecution, contract string) bool {
	return selected != nil && selected.Configured && strings.TrimSpace(selected.LoadoutID) != "" &&
		selected.CapabilityContract == contract && selected.DriverIdentity != nil &&
		len(selected.Requirements) > 0 && len(selected.Requirements) == len(selected.ExactBindings)
}

func captureLocalSpeechBindings(values []localexecution.ExactBinding) ([]capabilitydriver.InvocationExactBinding, []string) {
	bindings := projectInvocationExactBindings(values)
	contentIDs := make([]string, 0, len(values))
	for _, binding := range values {
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
		if result.StagingWAVPath != "" {
			if result.AudioBody != nil || len(result.AudioBytes) != 0 {
				if result.AudioBody != nil {
					_ = result.AudioBody.Close()
				}
				return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: fmt.Errorf("local speech synthesis returned ambiguous staging and audio bodies")})
			}
			plan, ok := effective.synthesizePlan.(interface {
				StagingWAVPath() string
				ExpectedWAVFormat() (int, int, int)
			})
			if !ok {
				return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureContentMismatch, Err: fmt.Errorf("local speech staging output has no exact Driver plan")})
			}
			validated, validateErr := validateLocalAudioCppWAV(result, plan)
			if validateErr != nil {
				return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureContentMismatch, Err: validateErr})
			}
			artifact, body, bodyErr := localQwen3TTSAudioCppArtifactBody(validated, effective.loadoutID)
			if bodyErr != nil {
				return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: bodyErr})
			}
			usage := result.Usage
			if usage == nil {
				usage = &runtimev1.UsageStats{ComputeMs: result.ComputeMS}
			}
			return []*runtimev1.ScenarioArtifact{artifact}, map[string]*capabilitydriver.ArtifactBody{artifact.GetArtifactId(): body}, usage, nil
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
				Metadata:   nimillm.ToStruct(map[string]any{"loadout_id": effective.loadoutID}),
			}
			return []*runtimev1.ScenarioArtifact{artifact}, map[string]*capabilitydriver.ArtifactBody{artifactID: body}, result.Usage, nil
		}
		if len(result.AudioBytes) == 0 {
			return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: fmt.Errorf("local speech synthesis returned no audio")})
		}
		return []*runtimev1.ScenarioArtifact{nimillm.BinaryArtifact(mimeType, result.AudioBytes, map[string]any{"loadout_id": effective.loadoutID})}, nil, result.Usage, nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		result, err := s.localSpeechHost.ExecuteSpeechTranscription(ctx, effective.transcribePlan, onStart)
		if err != nil {
			return nil, nil, nil, localExecutionError(err)
		}
		text := strings.TrimSpace(result.Text)
		if text == "" {
			return nil, nil, nil, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: fmt.Errorf("local speech transcription returned no text")})
		}
		return []*runtimev1.ScenarioArtifact{nimillm.BinaryArtifact("text/plain; charset=utf-8", []byte(text), map[string]any{"loadout_id": effective.loadoutID})}, nil, result.Usage, nil
	default:
		return nil, nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

type validatedLocalQwen3TTSAudioCppWAV struct {
	Path       string
	SizeBytes  int64
	SHA256     string
	SampleRate int
	Channels   int
	Bits       int
	DurationMS int64
}

func validateLocalAudioCppWAV(result localexecution.SpeechSynthesisResult, plan interface {
	StagingWAVPath() string
	ExpectedWAVFormat() (int, int, int)
}) (validatedLocalQwen3TTSAudioCppWAV, error) {
	if plan == nil || result.StagingWAVPath != plan.StagingWAVPath() {
		return validatedLocalQwen3TTSAudioCppWAV{}, fmt.Errorf("speech staging identity mismatch")
	}
	file, err := os.Open(result.StagingWAVPath)
	if err != nil {
		return validatedLocalQwen3TTSAudioCppWAV{}, err
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || info.Size() < 44 {
		return validatedLocalQwen3TTSAudioCppWAV{}, fmt.Errorf("speech WAV is incomplete")
	}
	header := make([]byte, 12)
	if _, err := io.ReadFull(file, header); err != nil || string(header[:4]) != "RIFF" || string(header[8:12]) != "WAVE" || int64(binary.LittleEndian.Uint32(header[4:8]))+8 != info.Size() {
		return validatedLocalQwen3TTSAudioCppWAV{}, fmt.Errorf("speech WAV RIFF bounds are invalid")
	}
	var format, channels, bits uint16
	var sampleRate, byteRate, dataBytes uint32
	for position := int64(12); position+8 <= info.Size(); {
		chunk := make([]byte, 8)
		if _, err := io.ReadFull(file, chunk); err != nil {
			return validatedLocalQwen3TTSAudioCppWAV{}, err
		}
		position += 8
		size := binary.LittleEndian.Uint32(chunk[4:])
		if position+int64(size) > info.Size() {
			return validatedLocalQwen3TTSAudioCppWAV{}, fmt.Errorf("speech WAV chunk exceeds file bounds")
		}
		if string(chunk[:4]) == "fmt " {
			payload := make([]byte, size)
			if _, err := io.ReadFull(file, payload); err != nil || len(payload) < 16 {
				return validatedLocalQwen3TTSAudioCppWAV{}, fmt.Errorf("speech WAV fmt is invalid")
			}
			format = binary.LittleEndian.Uint16(payload[:2])
			channels = binary.LittleEndian.Uint16(payload[2:4])
			sampleRate = binary.LittleEndian.Uint32(payload[4:8])
			byteRate = binary.LittleEndian.Uint32(payload[8:12])
			bits = binary.LittleEndian.Uint16(payload[14:16])
		} else {
			if string(chunk[:4]) == "data" {
				dataBytes = size
			}
			if _, err := file.Seek(int64(size), io.SeekCurrent); err != nil {
				return validatedLocalQwen3TTSAudioCppWAV{}, err
			}
		}
		position += int64(size)
		if size%2 == 1 {
			if _, err := file.Seek(1, io.SeekCurrent); err != nil {
				return validatedLocalQwen3TTSAudioCppWAV{}, err
			}
			position++
		}
	}
	expectedRate, expectedChannels, expectedBits := plan.ExpectedWAVFormat()
	if format != 1 || sampleRate == 0 || channels == 0 || bits != 16 || (expectedRate > 0 && int(sampleRate) != expectedRate) || (expectedChannels > 0 && int(channels) != expectedChannels) || (expectedBits > 0 && int(bits) != expectedBits) || byteRate == 0 || dataBytes == 0 {
		return validatedLocalQwen3TTSAudioCppWAV{}, fmt.Errorf("speech WAV format does not match the audio.cpp Driver contract")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return validatedLocalQwen3TTSAudioCppWAV{}, err
	}
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return validatedLocalQwen3TTSAudioCppWAV{}, err
	}
	return validatedLocalQwen3TTSAudioCppWAV{Path: result.StagingWAVPath, SizeBytes: info.Size(), SHA256: hex.EncodeToString(hasher.Sum(nil)), SampleRate: int(sampleRate), Channels: int(channels), Bits: int(bits), DurationMS: int64(dataBytes) * 1000 / int64(byteRate)}, nil
}

func validateLocalQwen3TTSAudioCppWAV(result localexecution.SpeechSynthesisResult, plan *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) (validatedLocalQwen3TTSAudioCppWAV, error) {
	return validateLocalAudioCppWAV(result, plan)
}

func localQwen3TTSAudioCppArtifactBody(wav validatedLocalQwen3TTSAudioCppWAV, loadoutID string) (*runtimev1.ScenarioArtifact, *capabilitydriver.ArtifactBody, error) {
	file, err := os.Open(wav.Path)
	if err != nil {
		return nil, nil, err
	}
	body, err := capabilitydriver.NewIncrementalArtifactBody(file)
	if err != nil {
		_ = file.Close()
		return nil, nil, err
	}
	metadata, _ := structpb.NewStruct(map[string]any{"loadout_id": loadoutID, "format": "pcm_s16le", "bits_per_sample": wav.Bits})
	return &runtimev1.ScenarioArtifact{ArtifactId: ulid.Make().String(), MimeType: "audio/wav", Sha256: wav.SHA256, SizeBytes: wav.SizeBytes, DurationMs: wav.DurationMS, SampleRateHz: int32(wav.SampleRate), Channels: int32(wav.Channels), Metadata: metadata}, body, nil
}
