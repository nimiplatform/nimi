package ai

import (
	"context"
	"fmt"
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

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
func (s *Service) captureLocalMusicTranscription(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.MusicTranscribeScenarioSpec) (*localMusicEffectiveInputs, error) {
	if err := validateMusicTranscriptionSpec(spec); err != nil {
		return nil, err
	}
	intent, ok := executionintent.FromContext(ctx)
	if !ok {
		var err error
		_, intent, err = s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.MusicTranscribeCapabilityContract)
		if err != nil {
			return nil, err
		}
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.MusicTranscribeCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != capabilitydriver.MusicTranscribeCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.ConfiguredFeatures); err != nil {
		return nil, err
	}
	value, reason := s.capabilityDrivers.Resolve(capabilitydriver.MusicTranscribeCapabilityContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	driver, ok := value.(capabilitydriver.MusicTranscriptionInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	pkg, err := audioCppRuntimePackageInput(selected)
	if err != nil {
		return nil, localMusicInvocationError(err)
	}
	source, err := s.openMusicInputSource(ctx, head, spec.GetSourceAudio().GetArtifactId())
	if err != nil {
		return nil, err
	}
	defer func() { _ = source.Body.Close() }()
	canonical := source.Record.CanonicalAudio
	if canonical == nil || source.Record.MimeType != "audio/wav" || source.Record.SizeBytes <= 0 || source.Record.SizeBytes > audiomedia.MaxInputBytes {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	staging, err := s.createLocalMusicStagingWAVPath()
	if err != nil {
		return nil, err
	}
	keep := false
	defer func() {
		if !keep {
			cleanupAudioMusicStaging(staging)
		}
	}()
	info := &runtimev1.LocalAppAudioInfo{SampleRateHz: canonical.SampleRateHz, Channels: uint32(canonical.Channels), FrameCount: canonical.FrameCount}
	if canonical.SampleRateHz != 0 {
		info.DurationMs = int64(canonical.FrameCount * 1000 / uint64(canonical.SampleRateHz))
	}
	plan, err := driver.PlanMusicTranscriptionInvocation(capabilitydriver.MusicTranscriptionInvocationInput{LoadoutID: selected.LoadoutID, RecipeID: selected.RecipeID,
		PortableConfig: selected.PortableConfig, ExactBindings: projectInvocationExactBindings(selected.ExactBindings), Package: pkg, Request: spec, SourceInfo: info,
		StagingDir: filepath.Dir(staging), SourcePath: filepath.Join(filepath.Dir(staging), "source.wav")})
	if err != nil {
		return nil, localMusicInvocationError(err)
	}
	request := plan.TranscriptionRequest()
	sourceRange := request.GetSourceAudio().GetRange()
	_, err = audiomedia.CopyCanonicalRange(ctx, source.Body, audiomedia.Facts{SampleRateHz: canonical.SampleRateHz, Channels: canonical.Channels, FrameCount: canonical.FrameCount, SizeBytes: source.Record.SizeBytes, DataOffset: canonical.DataOffset}, sourceRange.GetStartFrame(), sourceRange.GetEndFrame(), plan.TranscriptionSourcePath())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if err := source.Body.Close(); err != nil {
		return nil, err
	}
	assembly, err := localResolvedAssemblyForMusicTranscription(selected, plan)
	if err != nil {
		return nil, err
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, err
	}
	keep = true
	return &localMusicEffectiveInputs{head: cloneScenarioHead(head), intent: executionintent.Clone(intent), loadoutID: selected.LoadoutID, displayName: selected.DisplayName,
		effectiveInputIdentity: identity, transcriptionRequest: request, plan: plan, resolvedAssembly: assembly}, nil
}

func localResolvedAssemblyForMusicTranscription(selected *localexecution.SelectedLocalExecution, plan *capabilitydriver.MusicInvocationPlan) (*localResolvedAssembly, error) {
	raw, err := protojson.Marshal(plan.TranscriptionRequest())
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.MusicTranscribeCapabilityContract, raw)
	if err != nil {
		return nil, err
	}
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "music-transcription", Music: &localResolvedAssemblyMusicPlan{
		ProcessKey: plan.ProcessKey(), AudioCppPackageID: plan.AudioCppPackageID(), AudioCppSelectedSourceRecordID: plan.AudioCppSelectedSourceRecordID(), AudioCppRoot: plan.AudioCppRoot(), AudioCppExecutablePath: plan.AudioCppExecutablePath(),
		CUDA13DependencyID: plan.CUDA13DependencyID(), CUDA13SelectedSourceRecordID: plan.CUDA13SelectedSourceRecordID(), CUDA13Root: plan.CUDA13Root(), ModelRoot: plan.ModelRoot(),
		SourcePath: plan.TranscriptionSourcePath(), SourceInfo: plan.TranscriptionSourceInfo(), StagingDirectory: plan.StagingDirectory()}}
	assembly.ProcessIdentity.ProcessKey = plan.ProcessKey()
	assembly.ProcessIdentity.ProcessArgs = plan.CLIArgs()
	return assembly, nil
}

func (s *Service) localMusicTranscriptionFromResolvedAssembly(assembly *localResolvedAssembly) (*localMusicEffectiveInputs, error) {
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, err
	}
	if assembly.CapabilityContract != capabilitydriver.MusicTranscribeCapabilityContract || assembly.LoadPlan.Kind != "music-transcription" || assembly.LoadPlan.Music == nil {
		return nil, fmt.Errorf("music transcription captured contract is invalid")
	}
	request := &runtimev1.MusicTranscribeScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, err
	}
	value, reason := s.capabilityDrivers.Resolve(capabilitydriver.MusicTranscribeCapabilityContract, capabilitydriver.Identity{ImplementationID: assembly.DriverIdentity.ImplementationID, DriverID: assembly.DriverIdentity.DriverID, DriverDialect: assembly.DriverIdentity.DriverDialect})
	driver, ok := value.(capabilitydriver.MusicTranscriptionInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, fmt.Errorf("captured music transcription Driver is unavailable")
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
	plan, err := driver.PlanMusicTranscriptionInvocation(capabilitydriver.MusicTranscriptionInvocationInput{LoadoutID: assembly.LoadoutID, RecipeID: assembly.RecipeID, PortableConfig: portable,
		ExactBindings: resolvedAssemblyExactBindings(assembly), Package: pkg, Request: request, SourceInfo: assembly.LoadPlan.Music.SourceInfo, SourcePath: assembly.LoadPlan.Music.SourcePath, StagingDir: assembly.LoadPlan.Music.StagingDirectory})
	if err != nil {
		return nil, err
	}
	reprojected, err := localResolvedAssemblyForMusicTranscription(selected, plan)
	if err != nil {
		return nil, err
	}
	if err := validateRehydratedResolvedAssemblyPlan(assembly, reprojected); err != nil {
		return nil, err
	}
	return &localMusicEffectiveInputs{loadoutID: assembly.LoadoutID, transcriptionRequest: proto.Clone(request).(*runtimev1.MusicTranscribeScenarioSpec), plan: plan}, nil
}

func cleanupLocalMusicPlan(plan *capabilitydriver.MusicInvocationPlan) {
	if plan == nil {
		return
	}
	if plan.IsVoiceConvert() {
		cleanupLocalVoiceConvertStaging(plan.StagingDirectory())
		return
	}
	cleanupAudioMusicStaging(filepath.Join(plan.StagingDirectory(), "music.wav"))
}
