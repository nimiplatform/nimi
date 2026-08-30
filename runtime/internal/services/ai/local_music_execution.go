package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type localMusicEffectiveInputs struct {
	head                   *runtimev1.ScenarioRequestHead
	intent                 executionintent.Intent
	loadoutID              string
	displayName            string
	effectiveInputIdentity *runtimev1.LoadoutEffectiveInputIdentity
	request                *runtimev1.MusicGenerateScenarioSpec
	plan                   *capabilitydriver.MusicInvocationPlan
	resolvedAssembly       *localResolvedAssembly
}

func (input *localMusicEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.loadoutID
}

func (s *Service) captureLocalMusicEffectiveInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.MusicGenerateScenarioSpec, extensions []*runtimev1.ScenarioExtension) (_ *localMusicEffectiveInputs, err error) {
	if s == nil || head == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveLocalMusicConsumerIntent(ctx, head)
	if err != nil {
		return nil, err
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.MiniMaxMusic3CapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if !validSelectedMusicExecution(selected) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.ConfiguredFeatures); err != nil {
		return nil, err
	}
	driverValue, reason := s.capabilityDrivers.Resolve(capabilitydriver.MiniMaxMusic3CapabilityContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	driver, ok := driverValue.(capabilitydriver.MusicInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	packageInput, err := audioCppRuntimePackageInput(selected)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, err, grpcerr.ReasonOptions{})
	}
	stagingPath, err := s.createLocalMusicStagingWAVPath()
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	keepStaging := false
	defer func() {
		if !keepStaging {
			cleanupAudioMusicStaging(stagingPath)
		}
	}()
	request, _ := proto.Clone(spec).(*runtimev1.MusicGenerateScenarioSpec)
	portable, _ := proto.Clone(selected.PortableConfig).(*structpb.Struct)
	plan, err := driver.PlanMusicInvocation(capabilitydriver.MusicInvocationInput{LoadoutID: selected.LoadoutID, RecipeID: selected.RecipeID, PortableConfig: portable, ExactBindings: projectInvocationExactBindings(selected.ExactBindings), Package: packageInput, Request: request, Extensions: cloneScenarioExtensions(extensions), StagingWAVPath: stagingPath})
	if err != nil {
		return nil, localMusicInvocationError(err)
	}
	assembly, err := localResolvedAssemblyForMusic(selected, request, plan)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, err
	}
	keepStaging = true
	return &localMusicEffectiveInputs{head: cloneScenarioHead(head), intent: executionintent.Clone(intent), loadoutID: selected.LoadoutID, displayName: selected.DisplayName, effectiveInputIdentity: identity, request: request, plan: plan, resolvedAssembly: assembly}, nil
}

func (s *Service) localMusicEffectiveInputsFromResolvedAssembly(assembly *localResolvedAssembly) (*localMusicEffectiveInputs, error) {
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, err
	}
	if assembly.CapabilityContract != capabilitydriver.MiniMaxMusic3CapabilityContract || assembly.Request.Kind != "music.generate" || assembly.LoadPlan.Kind != "music" || assembly.LoadPlan.Music == nil {
		return nil, fmt.Errorf("local music ResolvedAssembly contract is mismatched")
	}
	request := &runtimev1.MusicGenerateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, fmt.Errorf("decode local music request: %w", err)
	}
	portable, err := resolvedAssemblyPortableConfig(assembly)
	if err != nil {
		return nil, err
	}
	driverValue, reason := s.capabilityDrivers.Resolve(capabilitydriver.MiniMaxMusic3CapabilityContract, capabilitydriver.Identity{ImplementationID: assembly.DriverIdentity.ImplementationID, DriverID: assembly.DriverIdentity.DriverID, DriverDialect: assembly.DriverIdentity.DriverDialect})
	driver, ok := driverValue.(capabilitydriver.MusicInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, fmt.Errorf("captured local music Driver is unavailable")
	}
	selected := selectedLocalExecutionFromResolvedAssembly(assembly)
	selected.PortableConfig = portable
	packageInput, err := audioCppRuntimePackageInput(selected)
	if err != nil {
		return nil, err
	}
	plan, err := driver.PlanMusicInvocation(capabilitydriver.MusicInvocationInput{LoadoutID: assembly.LoadoutID, RecipeID: assembly.RecipeID, PortableConfig: portable, ExactBindings: resolvedAssemblyExactBindings(assembly), Package: packageInput, Request: request, StagingWAVPath: assembly.LoadPlan.Music.StagingWAVPath})
	if err != nil {
		return nil, err
	}
	reprojected, err := localResolvedAssemblyForMusic(selected, request, plan)
	if err != nil {
		return nil, err
	}
	if err := validateRehydratedResolvedAssemblyPlan(assembly, reprojected); err != nil {
		return nil, err
	}
	return &localMusicEffectiveInputs{loadoutID: assembly.LoadoutID, request: request, plan: plan}, nil
}

func (s *Service) resolveLocalMusicConsumerIntent(ctx context.Context, head *runtimev1.ScenarioRequestHead) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.MiniMaxMusic3CapabilityContract)
	return intent, err
}

func validSelectedMusicExecution(selected *localexecution.SelectedLocalExecution) bool {
	return selected != nil && selected.Configured && selected.CapabilityContract == capabilitydriver.MiniMaxMusic3CapabilityContract && selected.DriverIdentity != nil && len(selected.Requirements) == 1 && len(selected.ExactBindings) == 1 && len(selected.ExactDependencySources) == 2
}

func audioCppRuntimePackageInput(selected *localexecution.SelectedLocalExecution) (capabilitydriver.AudioCppRuntimePackageInput, error) {
	var result capabilitydriver.AudioCppRuntimePackageInput
	for _, source := range selected.ExactDependencySources {
		switch {
		case source.DependencyFamily == "native-engine-package.audio-cpp" && source.DependencyID == "audio.cpp.package":
			result.AudioCppPackageID = capabilitydriver.AudioCppWindowsCUDA13PackageID
			result.AudioCppSelectedSourceRecordID = source.SelectedSourceRecordID
			result.AudioCppRoot = source.CanonicalRoot
			for _, artifact := range source.VerifiedArtifacts {
				if strings.EqualFold(filepath.Base(artifact), "audiocpp_cli.exe") {
					result.AudioCppExecutablePath = artifact
					break
				}
			}
		case source.DependencyFamily == "accelerator.cuda.runtime" && source.DependencyID == capabilitydriver.AudioCppCUDA13RuntimeDependencyID:
			result.CUDA13DependencyID = source.DependencyID
			result.CUDA13SelectedSourceRecordID = source.SelectedSourceRecordID
			result.CUDA13Root = source.CanonicalRoot
		}
	}
	if result.AudioCppSelectedSourceRecordID == "" || result.AudioCppExecutablePath == "" || result.CUDA13SelectedSourceRecordID == "" {
		return capabilitydriver.AudioCppRuntimePackageInput{}, fmt.Errorf("audio.cpp package/CUDA13 selected-source pair is incomplete")
	}
	return result, nil
}

func (s *Service) createLocalMusicStagingWAVPath() (string, error) {
	root := strings.TrimSpace(s.localMusicStagingRoot)
	if root == "" || !filepath.IsAbs(root) {
		return "", fmt.Errorf("Runtime music staging root is unavailable")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("create Runtime music staging root: %w", err)
	}
	file, err := os.CreateTemp(root, "music-*.wav")
	if err != nil {
		return "", fmt.Errorf("allocate Runtime music staging path: %w", err)
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

func cleanupAudioMusicStaging(path string) {
	if path != "" {
		_ = os.Remove(path)
		_ = os.Remove(path + ".tmp")
	}
}
func cloneScenarioExtensions(values []*runtimev1.ScenarioExtension) []*runtimev1.ScenarioExtension {
	result := make([]*runtimev1.ScenarioExtension, 0, len(values))
	for _, value := range values {
		if value != nil {
			result = append(result, proto.Clone(value).(*runtimev1.ScenarioExtension))
		}
	}
	return result
}

func localMusicInvocationError(err error) error {
	var invocationErr *capabilitydriver.InvocationError
	if !errors.As(err, &invocationErr) {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	}
	switch invocationErr.Kind {
	case capabilitydriver.InvocationFailureInvalidRequest:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID, err, grpcerr.ReasonOptions{})
	case capabilitydriver.InvocationFailureUnsupported, capabilitydriver.InvocationFailureInvalidOption:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, err, grpcerr.ReasonOptions{})
	case capabilitydriver.InvocationFailureInvalidBinding:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, err, grpcerr.ReasonOptions{})
	}
}

func (s *Service) executeCapturedLocalMusic(ctx context.Context, effective *localMusicEffectiveInputs, onStart localexecution.MusicExecutionStartFunc) (localexecution.MusicResult, error) {
	if s == nil || s.localMusicHost == nil {
		return localexecution.MusicResult{}, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureLoad, Err: fmt.Errorf("local music execution host is unavailable")})
	}
	result, err := s.localMusicHost.ExecuteMusic(ctx, effective.plan, onStart)
	if err != nil {
		return result, localExecutionError(err)
	}
	return result, nil
}
