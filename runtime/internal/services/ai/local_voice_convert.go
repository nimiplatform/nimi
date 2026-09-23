package ai

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
func (s *Service) captureLocalVoiceConvert(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.AudioVoiceConvertScenarioSpec) (*localMusicEffectiveInputs, error) {
	if err := validateVoiceConvertSpec(spec); err != nil {
		return nil, err
	}
	intent, ok := executionintent.FromContext(ctx)
	if !ok {
		var err error
		_, intent, err = s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.VoiceConvertCapabilityContract)
		if err != nil {
			return nil, err
		}
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.VoiceConvertCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != capabilitydriver.VoiceConvertCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.ConfiguredFeatures); err != nil {
		return nil, err
	}
	value, reason := s.capabilityDrivers.Resolve(capabilitydriver.VoiceConvertCapabilityContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	driver, ok := value.(capabilitydriver.VoiceConvertInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	pkg, err := audioCppRuntimePackageInput(selected)
	if err != nil {
		return nil, localMusicInvocationError(err)
	}
	source, err := s.openMusicInputSource(ctx, head, spec.GetSourceVocal().GetArtifactId())
	if err != nil {
		return nil, err
	}
	defer source.Body.Close()
	sourceCanonical := source.Record.CanonicalAudio
	if sourceCanonical == nil || source.Record.MimeType != "audio/wav" || source.Record.SizeBytes <= 0 || source.Record.SizeBytes > audiomedia.MaxInputBytes {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	staging, err := s.createLocalMusicStagingWAVPath()
	if err != nil {
		return nil, err
	}
	keep := false
	defer func() {
		if !keep {
			cleanupLocalVoiceConvertStaging(filepath.Dir(staging))
		}
	}()
	stagingDir := filepath.Dir(staging)
	sourcePath := filepath.Join(stagingDir, "source.wav")
	targetPath := filepath.Join(stagingDir, "target.wav")
	sourceInfo := &runtimev1.LocalAppAudioInfo{SampleRateHz: sourceCanonical.SampleRateHz, Channels: uint32(sourceCanonical.Channels), FrameCount: sourceCanonical.FrameCount}
	if sourceCanonical.SampleRateHz != 0 {
		sourceInfo.DurationMs = int64(sourceCanonical.FrameCount * 1000 / uint64(sourceCanonical.SampleRateHz))
	}
	var targetInfo *runtimev1.LocalAppAudioInfo
	if reference := spec.GetTargetVoice().GetReferenceAudio(); reference != nil {
		opened, err := s.openMusicInputSource(ctx, head, reference.GetArtifactId())
		if err != nil {
			return nil, err
		}
		defer opened.Body.Close()
		targetCanonical := opened.Record.CanonicalAudio
		if targetCanonical == nil || opened.Record.MimeType != "audio/wav" || opened.Record.SizeBytes <= 0 || opened.Record.SizeBytes > audiomedia.MaxInputBytes {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		targetInfo = &runtimev1.LocalAppAudioInfo{SampleRateHz: targetCanonical.SampleRateHz, Channels: uint32(targetCanonical.Channels), FrameCount: targetCanonical.FrameCount}
		if targetCanonical.SampleRateHz != 0 {
			targetInfo.DurationMs = int64(targetCanonical.FrameCount * 1000 / uint64(targetCanonical.SampleRateHz))
		}
		planTargetRange := reference.GetRange()
		if planTargetRange == nil {
			planTargetRange = &runtimev1.AudioFrameRange{EndFrame: targetCanonical.FrameCount}
		}
		_, err = audiomedia.CopyCanonicalRange(ctx, opened.Body, audiomedia.Facts{SampleRateHz: targetCanonical.SampleRateHz, Channels: targetCanonical.Channels, FrameCount: targetCanonical.FrameCount, SizeBytes: opened.Record.SizeBytes, DataOffset: targetCanonical.DataOffset}, planTargetRange.GetStartFrame(), planTargetRange.GetEndFrame(), targetPath)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
		}
		if err := opened.Body.Close(); err != nil {
			return nil, err
		}
	}
	plan, err := driver.PlanVoiceConvertInvocation(capabilitydriver.VoiceConvertInvocationInput{LoadoutID: selected.LoadoutID, RecipeID: selected.RecipeID,
		PortableConfig: selected.PortableConfig, ExactBindings: projectInvocationExactBindings(selected.ExactBindings), Package: pkg, Request: spec,
		SourceInfo: sourceInfo, TargetInfo: targetInfo, SourcePath: sourcePath, TargetPath: targetPath, StagingDir: stagingDir})
	if err != nil {
		return nil, localMusicInvocationError(err)
	}
	request := plan.VoiceConvertRequest()
	sourceRange := request.GetSourceVocal().GetRange()
	_, err = audiomedia.CopyCanonicalRange(ctx, source.Body, audiomedia.Facts{SampleRateHz: sourceCanonical.SampleRateHz, Channels: sourceCanonical.Channels, FrameCount: sourceCanonical.FrameCount, SizeBytes: source.Record.SizeBytes, DataOffset: sourceCanonical.DataOffset}, sourceRange.GetStartFrame(), sourceRange.GetEndFrame(), plan.VoiceConvertSourcePath())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if err := source.Body.Close(); err != nil {
		return nil, err
	}
	assembly, err := localResolvedAssemblyForVoiceConvert(selected, plan)
	if err != nil {
		return nil, err
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, err
	}
	keep = true
	return &localMusicEffectiveInputs{head: cloneScenarioHead(head), intent: executionintent.Clone(intent), loadoutID: selected.LoadoutID, displayName: selected.DisplayName,
		effectiveInputIdentity: identity, voiceConvertRequest: request, plan: plan, resolvedAssembly: assembly}, nil
}

func localResolvedAssemblyForVoiceConvert(selected *localexecution.SelectedLocalExecution, plan *capabilitydriver.MusicInvocationPlan) (*localResolvedAssembly, error) {
	raw, err := protojson.Marshal(plan.VoiceConvertRequest())
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.VoiceConvertCapabilityContract, raw)
	if err != nil {
		return nil, err
	}
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "music-voice-convert", Music: &localResolvedAssemblyMusicPlan{
		ProcessKey: plan.ProcessKey(), AudioCppPackageID: plan.AudioCppPackageID(), AudioCppSelectedSourceRecordID: plan.AudioCppSelectedSourceRecordID(), AudioCppRoot: plan.AudioCppRoot(), AudioCppExecutablePath: plan.AudioCppExecutablePath(),
		CUDA13DependencyID: plan.CUDA13DependencyID(), CUDA13SelectedSourceRecordID: plan.CUDA13SelectedSourceRecordID(), CUDA13Root: plan.CUDA13Root(), ModelRoot: plan.ModelRoot(),
		SourcePath: plan.VoiceConvertSourcePath(), SourceInfo: plan.VoiceConvertSourceInfo(), TargetPath: plan.VoiceConvertTargetPath(), TargetInfo: plan.VoiceConvertTargetInfo(), StagingDirectory: plan.StagingDirectory()}}
	assembly.ProcessIdentity.ProcessKey = plan.ProcessKey()
	assembly.ProcessIdentity.ProcessArgs = plan.CLIArgs()
	return assembly, nil
}

func (s *Service) localVoiceConvertFromResolvedAssembly(assembly *localResolvedAssembly) (*localMusicEffectiveInputs, error) {
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, err
	}
	if assembly.CapabilityContract != capabilitydriver.VoiceConvertCapabilityContract || assembly.LoadPlan.Kind != "music-voice-convert" || assembly.LoadPlan.Music == nil {
		return nil, fmt.Errorf("voice convert captured contract is invalid")
	}
	request := &runtimev1.AudioVoiceConvertScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, err
	}
	value, reason := s.capabilityDrivers.Resolve(capabilitydriver.VoiceConvertCapabilityContract, capabilitydriver.Identity{ImplementationID: assembly.DriverIdentity.ImplementationID, DriverID: assembly.DriverIdentity.DriverID, DriverDialect: assembly.DriverIdentity.DriverDialect})
	driver, ok := value.(capabilitydriver.VoiceConvertInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, fmt.Errorf("captured voice convert Driver is unavailable")
	}
	selected := selectedLocalExecutionFromResolvedAssembly(assembly)
	portable, err := resolvedAssemblyPortableConfig(assembly)
	if err != nil {
		return nil, err
	}
	selected.PortableConfig = portable
	pkg, err := audioCppRuntimePackageInput(selected)
	if err != nil {
		return nil, err
	}
	plan, err := driver.PlanVoiceConvertInvocation(capabilitydriver.VoiceConvertInvocationInput{LoadoutID: assembly.LoadoutID, RecipeID: assembly.RecipeID, PortableConfig: portable,
		ExactBindings: resolvedAssemblyExactBindings(assembly), Package: pkg, Request: request, SourceInfo: assembly.LoadPlan.Music.SourceInfo, TargetInfo: assembly.LoadPlan.Music.TargetInfo,
		SourcePath: assembly.LoadPlan.Music.SourcePath, TargetPath: assembly.LoadPlan.Music.TargetPath, StagingDir: assembly.LoadPlan.Music.StagingDirectory})
	if err != nil {
		return nil, err
	}
	reprojected, err := localResolvedAssemblyForVoiceConvert(selected, plan)
	if err != nil {
		return nil, err
	}
	if err := validateRehydratedResolvedAssemblyPlan(assembly, reprojected); err != nil {
		return nil, err
	}
	return &localMusicEffectiveInputs{loadoutID: assembly.LoadoutID, voiceConvertRequest: proto.Clone(request).(*runtimev1.AudioVoiceConvertScenarioSpec), plan: plan}, nil
}

func cleanupLocalVoiceConvertStaging(dir string) {
	if dir == "" {
		return
	}
	for _, name := range []string{"music.wav", "vocal.wav", "source.wav", "target.wav"} {
		_ = os.Remove(filepath.Join(dir, name))
	}
	_ = os.Remove(dir)
}
