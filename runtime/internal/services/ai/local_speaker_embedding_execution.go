package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type localResolvedAssemblySpeakerEmbeddingPlan struct {
	ProfileRoot        string `json:"profile_root"`
	ProfileDigest      string `json:"profile_digest"`
	DriverBundleDigest string `json:"driver_bundle_digest"`
	Dimension          int    `json:"dimension"`
}
type localSpeakerEmbeddingEffectiveInputs struct {
	assembly    *localResolvedAssembly
	identity    *runtimev1.LoadoutEffectiveInputIdentity
	displayName string
}

func (s *Service) SetLocalSpeakerEmbeddingExecutionHost(host localexecution.SpeakerEmbeddingExecutionHost) {
	if s != nil {
		s.localSpeakerEmbeddingHost = host
	}
}

// @nimi-authority: rule.nimi.runtime.speaker-representation.audio-speaker-embedding-result
func (s *Service) captureLocalSpeakerEmbeddingEffectiveInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.AudioSpeakerEmbedScenarioSpec) (*localSpeakerEmbeddingEffectiveInputs, error) {
	if spec == nil || (spec.AudioSource == nil) == (spec.SourceAudio == nil) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.SpeakerEmbedContract)
	if err != nil {
		return nil, err
	}
	if !intent.IsLocal() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != capabilitydriver.SpeakerEmbedContract || len(selected.ExactBindings) != 1 || selected.EmbeddingDimension <= 0 || len(intent.Defaults.GetFields()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.SpeakerEmbedContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	encoder, ok := driver.(interface {
		PlanSpeakerEmbeddingInvocation(capabilitydriver.SpeakerEmbeddingInvocationInput) (*capabilitydriver.SpeakerEmbeddingInvocationPlan, error)
	})
	if !ok || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || s.localSpeakerEmbeddingHost == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	audio, mime, err := s.captureSpeakerAudio(ctx, head, spec)
	if err != nil {
		return nil, err
	}
	plan, err := encoder.PlanSpeakerEmbeddingInvocation(capabilitydriver.SpeakerEmbeddingInvocationInput{RecipeID: selected.RecipeID, Request: spec, Bindings: projectInvocationExactBindings(selected.ExactBindings), DependencySources: invocationExactDependencySources(selected.ExactDependencySources), AudioBytes: audio, MIMEType: mime, Dimension: selected.EmbeddingDimension})
	if err != nil {
		return nil, localSpeechInvocationError(err)
	}
	request := proto.Clone(spec).(*runtimev1.AudioSpeakerEmbedScenarioSpec)
	request.AudioSource = nil
	request.SourceAudio = nil
	raw, err := protojson.Marshal(request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.SpeakerEmbedContract, raw)
	if err != nil {
		return nil, err
	}
	assembly.Request.BinaryInput = append([]byte(nil), audio...)
	assembly.EmbeddingDimension = plan.Dimension
	assembly.Request.MIMEType = mime
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "speaker-embedding", SpeakerEmbedding: speakerEmbeddingResolvedPlan(plan)}
	assembly.ProcessIdentity.ModelAssetID = plan.Binding.ModelAssetID
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, err
	}
	return &localSpeakerEmbeddingEffectiveInputs{assembly: assembly, identity: identity, displayName: selected.DisplayName}, nil
}

func (s *Service) captureSpeakerAudio(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.AudioSpeakerEmbedScenarioSpec) ([]byte, string, error) {
	if spec.SourceAudio == nil {
		audio, mime, _, err := nimillm.ResolveTranscriptionAudioSource(ctx, &runtimev1.SpeechTranscribeScenarioSpec{MimeType: spec.MimeType, AudioSource: spec.AudioSource})
		return audio, mime, err
	}
	source, err := s.openMusicInputSource(ctx, head, spec.SourceAudio.GetArtifactId())
	if err != nil {
		return nil, "", err
	}
	defer source.Body.Close()
	facts := source.Record.CanonicalAudio
	if facts == nil || facts.SampleRateHz <= 0 {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	start, end := uint64(0), facts.FrameCount
	if selected := spec.SourceAudio.GetRange(); selected != nil {
		start, end = selected.StartFrame, selected.EndFrame
	}
	if end <= start || end > facts.FrameCount || end-start > uint64(facts.SampleRateHz)*30 {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if !filepath.IsAbs(s.localSpeechStagingRoot) {
		return nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := os.MkdirAll(s.localSpeechStagingRoot, 0700); err != nil {
		return nil, "", err
	}
	work, err := os.MkdirTemp(s.localSpeechStagingRoot, "speaker-source-")
	if err != nil {
		return nil, "", err
	}
	defer os.RemoveAll(work)
	filename := filepath.Join(work, "audio.wav")
	if _, err := audiomedia.CopyCanonicalRange(ctx, source.Body, audiomedia.Facts{SampleRateHz: facts.SampleRateHz, Channels: facts.Channels, FrameCount: facts.FrameCount, SizeBytes: source.Record.SizeBytes, DataOffset: facts.DataOffset}, start, end, filename); err != nil {
		return nil, "", err
	}
	info, err := os.Stat(filename)
	if err != nil {
		return nil, "", err
	}
	if info.Size() > 32*1024*1024 {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	audio, err := os.ReadFile(filename)
	return audio, "audio/wav", err
}

func speakerEmbeddingResolvedPlan(plan *capabilitydriver.SpeakerEmbeddingInvocationPlan) *localResolvedAssemblySpeakerEmbeddingPlan {
	return &localResolvedAssemblySpeakerEmbeddingPlan{ProfileRoot: plan.ProfileRoot, ProfileDigest: plan.ProfileDigest, DriverBundleDigest: plan.DriverBundleDigest, Dimension: plan.Dimension}
}
func speakerEmbeddingPlanFromResolvedAssembly(assembly *localResolvedAssembly) (*capabilitydriver.SpeakerEmbeddingInvocationPlan, error) {
	if assembly == nil || assembly.CapabilityContract != capabilitydriver.SpeakerEmbedContract || assembly.Request.Kind != capabilitydriver.SpeakerEmbedContract || assembly.LoadPlan.Kind != "speaker-embedding" || assembly.LoadPlan.SpeakerEmbedding == nil || assembly.DriverIdentity.DriverID != capabilitydriver.SherpaSpeakerEmbedDriverID || assembly.DriverIdentity.DriverDialect != capabilitydriver.SherpaSpeakerEmbedDriverDialect || assembly.DriverIdentity.ImplementationID != capabilitydriver.SherpaSpeakerEmbedImplementationID {
		return nil, fmt.Errorf("captured speaker assembly is incomplete")
	}
	request := &runtimev1.AudioSpeakerEmbedScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, err
	}
	plan, err := (capabilitydriver.SherpaSpeakerEmbedDriver{}).PlanSpeakerEmbeddingInvocation(capabilitydriver.SpeakerEmbeddingInvocationInput{RecipeID: assembly.RecipeID, Request: request, Bindings: resolvedAssemblyExactBindings(assembly), DependencySources: resolvedAssemblyExactDependencySources(assembly), AudioBytes: assembly.Request.BinaryInput, MIMEType: assembly.Request.MIMEType, Dimension: assembly.EmbeddingDimension})
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(assembly.LoadPlan.SpeakerEmbedding, speakerEmbeddingResolvedPlan(plan)) || assembly.ProcessIdentity.ModelAssetID != plan.Binding.ModelAssetID {
		return nil, fmt.Errorf("captured speaker plan changed")
	}
	return plan, nil
}

func speakerEmbeddingSpaceID(assembly *localResolvedAssembly) (string, error) {
	plan, err := speakerEmbeddingPlanFromResolvedAssembly(assembly)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal([]any{capabilitydriver.SpeakerEmbedContract, assembly.DriverIdentity, plan.Binding.VerifiedContentID, plan.Binding.EntrySHA256, plan.DriverBundleDigest, plan.ProfileDigest, plan.Dimension})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return "speaker-" + hex.EncodeToString(digest[:]), nil
}
