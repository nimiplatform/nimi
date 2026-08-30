// @nimi-authority: rule.nimi.runtime.local-compute.r100
// @nimi-authority: rule.nimi.platform.core-protocol.p-caiex-011

package ai

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const localResolvedAssemblyVersion = 4

type localResolvedAssembly struct {
	Version                         int                                     `json:"version"`
	LoadoutID                       string                                  `json:"loadout_id"`
	CapabilityContract              string                                  `json:"capability_contract"`
	RecipeID                        string                                  `json:"recipe_id"`
	RecipeRevision                  string                                  `json:"recipe_revision"`
	DriverIdentity                  localResolvedAssemblyDriverIdentity     `json:"driver_identity"`
	PortableConfig                  json.RawMessage                         `json:"portable_config,omitempty"`
	Requirements                    []json.RawMessage                       `json:"requirements,omitempty"`
	ModelAxes                       []localResolvedAssemblyModelAxis        `json:"model_axes"`
	DependencySources               []localResolvedAssemblyDependencySource `json:"dependency_sources,omitempty"`
	RecipeCustody                   []json.RawMessage                       `json:"recipe_custody,omitempty"`
	ImplementationSupportedFeatures []string                                `json:"implementation_supported_features,omitempty"`
	ConfiguredFeatures              []string                                `json:"configured_features,omitempty"`
	AdmittedFeatures                []string                                `json:"admitted_features,omitempty"`
	AdmittedTextBehaviors           []runtimev1.TextBehaviorKind            `json:"admitted_text_behaviors,omitempty"`
	Request                         localResolvedAssemblyRequest            `json:"request"`
	LoadPlan                        localResolvedAssemblyLoadPlan           `json:"load_plan"`
	ProcessIdentity                 localResolvedAssemblyProcessIdentity    `json:"process_identity"`
}

type localResolvedAssemblyDriverIdentity struct {
	ImplementationID string `json:"implementation_id"`
	DriverID         string `json:"driver_id"`
	DriverDialect    string `json:"driver_dialect"`
}

type localResolvedAssemblyModelAxis struct {
	RequirementID     string                                       `json:"requirement_id"`
	RequirementRole   runtimev1.LocalCapabilityRequirementRole     `json:"requirement_role"`
	OccurrenceOrdinal uint32                                       `json:"occurrence_ordinal"`
	Presence          runtimev1.LocalCapabilityRequirementPresence `json:"presence"`
	DisplayLabel      string                                       `json:"display_label,omitempty"`
	ModelAssetID      string                                       `json:"model_asset_id"`
	AbsolutePath      string                                       `json:"absolute_path"`
	BundleDir         string                                       `json:"bundle_dir,omitempty"`
	DeclaredFiles     []string                                     `json:"declared_files,omitempty"`
	VerifiedContentID string                                       `json:"verified_content_id"`
	EntrySHA256       string                                       `json:"entry_sha256"`
	TemplateIdentity  string                                       `json:"template_identity,omitempty"`
}

type localResolvedAssemblyDependencySource struct {
	DependencyFamily       string            `json:"dependency_family"`
	DependencyID           string            `json:"dependency_id"`
	ConsumerScope          string            `json:"consumer_scope"`
	SelectedSourceRecordID string            `json:"selected_source_record_id"`
	CanonicalRoot          string            `json:"canonical_root"`
	Version                string            `json:"version,omitempty"`
	VerifiedArtifacts      []string          `json:"verified_artifacts,omitempty"`
	Hashes                 map[string]string `json:"hashes,omitempty"`
}

type localResolvedAssemblyRequest struct {
	Kind        string          `json:"kind"`
	Payload     json.RawMessage `json:"payload"`
	BinaryInput []byte          `json:"binary_input,omitempty"`
	MIMEType    string          `json:"mime_type,omitempty"`
}

type localResolvedAssemblyProcessIdentity struct {
	ProcessKey   string   `json:"process_key,omitempty"`
	ProcessArgs  []string `json:"process_args,omitempty"`
	DriverID     string   `json:"driver_id"`
	ModelAssetID string   `json:"model_asset_id,omitempty"`
}

type localResolvedAssemblyLoadPlan struct {
	Kind   string                           `json:"kind"`
	Text   *localResolvedAssemblyTextPlan   `json:"text,omitempty"`
	Embed  *localResolvedAssemblyEmbedPlan  `json:"embed,omitempty"`
	Speech *localResolvedAssemblySpeechPlan `json:"speech,omitempty"`
	Image  *localResolvedAssemblyImagePlan  `json:"image,omitempty"`
	Video  *localResolvedAssemblyVideoPlan  `json:"video,omitempty"`
	Music  *localResolvedAssemblyMusicPlan  `json:"music,omitempty"`
}

type localResolvedAssemblyMusicPlan struct {
	ProcessKey                     string  `json:"process_key"`
	AudioCppPackageID              string  `json:"audio_cpp_package_id"`
	AudioCppSelectedSourceRecordID string  `json:"audio_cpp_selected_source_record_id"`
	AudioCppRoot                   string  `json:"audio_cpp_root"`
	AudioCppExecutablePath         string  `json:"audio_cpp_executable_path"`
	CUDA13DependencyID             string  `json:"cuda13_dependency_id"`
	CUDA13SelectedSourceRecordID   string  `json:"cuda13_selected_source_record_id"`
	CUDA13Root                     string  `json:"cuda13_root"`
	ModelRoot                      string  `json:"model_root"`
	LanguageModelPath              string  `json:"language_model_path"`
	RVQDepthDecoderPath            string  `json:"rvq_depth_decoder_path"`
	FlowTransformerPath            string  `json:"flow_transformer_path"`
	DurationBudgetSeconds          int     `json:"duration_budget_seconds"`
	NumInferenceSteps              int     `json:"num_inference_steps"`
	GuidanceScale                  float64 `json:"guidance_scale"`
	ARGuidanceScale                float64 `json:"ar_guidance_scale"`
	TopK                           int     `json:"top_k"`
	Seed                           uint64  `json:"seed"`
	MemorySaver                    bool    `json:"memory_saver"`
	StagingWAVPath                 string  `json:"staging_wav_path"`
	ExpectedSampleRate             int     `json:"expected_sample_rate"`
	ExpectedChannels               int     `json:"expected_channels"`
	ExpectedBitsPerSample          int     `json:"expected_bits_per_sample"`
}

type localResolvedAssemblyInvocationBinding struct {
	RequirementID     string   `json:"requirement_id"`
	ModelAssetID      string   `json:"model_asset_id"`
	AbsolutePath      string   `json:"absolute_path"`
	BundleDir         string   `json:"bundle_dir,omitempty"`
	DeclaredFiles     []string `json:"declared_files,omitempty"`
	VerifiedContentID string   `json:"verified_content_id"`
	EntrySHA256       string   `json:"entry_sha256"`
	TemplateIdentity  string   `json:"template_identity,omitempty"`
}

type localResolvedAssemblyTextBehaviorMatch struct {
	RecipeID          string `json:"recipe_id"`
	RecipeRevision    string `json:"recipe_revision"`
	DriverDialect     string `json:"driver_dialect"`
	ModelAssetID      string `json:"model_asset_id"`
	VerifiedContentID string `json:"verified_content_id"`
	EntrySHA256       string `json:"entry_sha256"`
	TemplateIdentity  string `json:"template_identity,omitempty"`
}

type localResolvedAssemblyTextPlan struct {
	ProcessKey          string                                   `json:"process_key"`
	ProcessArgs         []string                                 `json:"process_args"`
	ModelFiles          []localResolvedAssemblyInvocationBinding `json:"model_files"`
	RequestPath         string                                   `json:"request_path"`
	RequestContentType  string                                   `json:"request_content_type"`
	RequestBody         []byte                                   `json:"request_body"`
	Stream              bool                                     `json:"stream"`
	ContextWindowTokens uint64                                   `json:"context_window_tokens"`
	BehaviorMatch       localResolvedAssemblyTextBehaviorMatch   `json:"behavior_match"`
	BehaviorAdapter     *textbehavior.AdapterCapture             `json:"behavior_adapter,omitempty"`
}

type localResolvedAssemblyEmbedPlan struct {
	ProcessKey          string                                   `json:"process_key"`
	ProcessArgs         []string                                 `json:"process_args"`
	ModelFiles          []localResolvedAssemblyInvocationBinding `json:"model_files"`
	RequestPath         string                                   `json:"request_path"`
	RequestBody         []byte                                   `json:"request_body"`
	ExpectedCount       int                                      `json:"expected_count"`
	ContextWindowTokens uint64                                   `json:"context_window_tokens"`
}

type localResolvedAssemblySpeechPlan struct {
	Operation              string                                           `json:"operation"`
	DriverID               string                                           `json:"driver_id"`
	ModelAssetID           string                                           `json:"model_asset_id"`
	ModelFiles             []localResolvedAssemblyInvocationBinding         `json:"model_files"`
	Qwen3TTSAudioCpp       *localResolvedAssemblyQwen3TTSAudioCppPlan       `json:"qwen3_tts_audio_cpp,omitempty"`
	AudioCpp               *localResolvedAssemblyAudioCppSpeechPlan         `json:"audio_cpp,omitempty"`
	AudioCppReferenceVoice *localResolvedAssemblyAudioCppReferenceVoicePlan `json:"audio_cpp_reference_voice,omitempty"`
}

type localResolvedAssemblyAudioCppReferenceVoicePlan struct {
	Root             string `json:"root"`
	ProviderVoiceRef string `json:"provider_voice_ref"`
}

type localResolvedAssemblyAudioCppSpeechPlan struct {
	ProcessKey                     string   `json:"process_key"`
	Family                         string   `json:"family"`
	CLIArgs                        []string `json:"cli_args"`
	AudioCppPackageID              string   `json:"audio_cpp_package_id"`
	AudioCppSelectedSourceRecordID string   `json:"audio_cpp_selected_source_record_id"`
	AudioCppRoot                   string   `json:"audio_cpp_root"`
	AudioCppExecutablePath         string   `json:"audio_cpp_executable_path"`
	CUDA13DependencyID             string   `json:"cuda13_dependency_id"`
	CUDA13SelectedSourceRecordID   string   `json:"cuda13_selected_source_record_id"`
	CUDA13Root                     string   `json:"cuda13_root"`
	StagingWAVPath                 string   `json:"staging_wav_path,omitempty"`
	ReferenceWAVPath               string   `json:"reference_wav_path,omitempty"`
	ReferenceText                  string   `json:"reference_text,omitempty"`
	StagingAudioPath               string   `json:"staging_audio_path,omitempty"`
	StagingTextOutPath             string   `json:"staging_text_out_path,omitempty"`
}

type localResolvedAssemblyQwen3TTSAudioCppPlan struct {
	ProcessKey                     string  `json:"process_key"`
	AudioCppPackageID              string  `json:"audio_cpp_package_id"`
	AudioCppSelectedSourceRecordID string  `json:"audio_cpp_selected_source_record_id"`
	AudioCppRoot                   string  `json:"audio_cpp_root"`
	AudioCppExecutablePath         string  `json:"audio_cpp_executable_path"`
	CUDA13DependencyID             string  `json:"cuda13_dependency_id"`
	CUDA13SelectedSourceRecordID   string  `json:"cuda13_selected_source_record_id"`
	CUDA13Root                     string  `json:"cuda13_root"`
	ModelPath                      string  `json:"model_path"`
	Speaker                        string  `json:"speaker"`
	Language                       string  `json:"language,omitempty"`
	DoSample                       bool    `json:"do_sample"`
	Temperature                    float64 `json:"temperature"`
	TopK                           int     `json:"top_k"`
	TopP                           float64 `json:"top_p"`
	RepetitionPenalty              float64 `json:"repetition_penalty"`
	MaxTokens                      int     `json:"max_tokens"`
	TextChunkSize                  int     `json:"text_chunk_size"`
	Seed                           uint64  `json:"seed"`
	MemorySaver                    bool    `json:"memory_saver"`
	StagingWAVPath                 string  `json:"staging_wav_path"`
	ExpectedSampleRate             int     `json:"expected_sample_rate"`
	ExpectedChannels               int     `json:"expected_channels"`
	ExpectedBitsPerSample          int     `json:"expected_bits_per_sample"`
}

type localResolvedAssemblyImageModelFile struct {
	ModelAssetID      string `json:"model_asset_id"`
	AbsolutePath      string `json:"absolute_path"`
	VerifiedContentID string `json:"verified_content_id"`
	EntrySHA256       string `json:"entry_sha256"`
}

type localResolvedAssemblyImagePlan struct {
	ProcessKey         string                                   `json:"process_key"`
	ModelFiles         []localResolvedAssemblyInvocationBinding `json:"model_files"`
	RecipeID           string                                   `json:"recipe_id"`
	Main               localResolvedAssemblyImageModelFile      `json:"main"`
	TextEncoder        localResolvedAssemblyImageModelFile      `json:"text_encoder"`
	VAE                localResolvedAssemblyImageModelFile      `json:"vae"`
	UncondDiffusion    *localResolvedAssemblyImageModelFile     `json:"uncond_diffusion,omitempty"`
	Threads            int                                      `json:"threads"`
	CFGScale           float64                                  `json:"cfg_scale"`
	Sampler            string                                   `json:"sampler"`
	Scheduler          string                                   `json:"scheduler"`
	FlowShift          float64                                  `json:"flow_shift"`
	QwenImageZeroCondT bool                                     `json:"qwen_image_zero_cond_t"`
	FlashAttention     bool                                     `json:"flash_attention"`
	OffloadParamsToCPU bool                                     `json:"offload_params_to_cpu"`
	Request            localResolvedAssemblyImageRequestPlan    `json:"request"`
	Result             localResolvedAssemblyImageResult         `json:"result"`
}

type localResolvedAssemblyImageRequestPlan struct {
	Kind           string  `json:"kind"`
	Prompt         string  `json:"prompt"`
	NegativePrompt string  `json:"negative_prompt"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	Steps          int     `json:"steps"`
	CFGScale       float64 `json:"cfg_scale"`
	Seed           int64   `json:"seed"`
	ImageCount     int     `json:"image_count"`
	Sampler        string  `json:"sampler"`
	Scheduler      string  `json:"scheduler"`
	SourceIdentity string  `json:"source_identity,omitempty"`
	SourceImage    []byte  `json:"source_image,omitempty"`
}

type localResolvedAssemblyImageResult struct {
	ArtifactCount int    `json:"artifact_count"`
	MediaType     string `json:"media_type"`
	Format        string `json:"format"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
}

type localResolvedAssemblyVideoPlan struct {
	ProcessKey              string                                   `json:"process_key"`
	LoadoutID               string                                   `json:"loadout_id"`
	ExactBindings           []localResolvedAssemblyInvocationBinding `json:"exact_bindings"`
	ModelFiles              []localResolvedAssemblyInvocationBinding `json:"model_files"`
	DiffusionModelPath      string                                   `json:"diffusion_model_path"`
	EncoderPath             string                                   `json:"encoder_path"`
	VideoVAEPath            string                                   `json:"video_vae_path"`
	AudioVAEPath            string                                   `json:"audio_vae_path,omitempty"`
	Prompt                  string                                   `json:"prompt"`
	NegativePrompt          string                                   `json:"negative_prompt"`
	Width                   int                                      `json:"width"`
	Height                  int                                      `json:"height"`
	FrameCount              int                                      `json:"frame_count"`
	FPS                     int                                      `json:"fps"`
	Seed                    int64                                    `json:"seed"`
	AudioRequired           bool                                     `json:"audio_required"`
	ReturnLastFrame         bool                                     `json:"return_last_frame"`
	ConditioningMode        string                                   `json:"conditioning_mode"`
	ReferenceImage          *capabilitydriver.VideoResolvedInput     `json:"reference_image,omitempty"`
	CFGScale                float64                                  `json:"cfg_scale"`
	FlowShift               float64                                  `json:"flow_shift"`
	SampleMethod            string                                   `json:"sample_method"`
	Scheduler               string                                   `json:"scheduler"`
	DiffusionFlashAttention bool                                     `json:"diffusion_flash_attention"`
	OffloadToCPU            bool                                     `json:"offload_to_cpu"`
	RNG                     string                                   `json:"rng"`
}

func projectLoadoutEffectiveInputIdentity(selected *localexecution.SelectedLocalExecution, admittedFeatures ...string) *runtimev1.LoadoutEffectiveInputIdentity {
	if selected == nil {
		return nil
	}
	result := &runtimev1.LoadoutEffectiveInputIdentity{
		LoadoutId: strings.TrimSpace(selected.LoadoutID), CapabilityContract: strings.TrimSpace(selected.CapabilityContract),
		RecipeId: strings.TrimSpace(selected.RecipeID), RecipeRevision: strings.TrimSpace(selected.RecipeRevision),
		Options:          cloneResolvedAssemblyStruct(selected.PortableConfig),
		AdmittedFeatures: normalizeLocalFeatureSet(admittedFeatures),
	}
	if selected.DriverIdentity != nil {
		result.Implementation = proto.Clone(selected.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	}
	presenceByRequirement := localRequirementPresenceByID(selected.Requirements)
	for _, binding := range selected.ExactBindings {
		result.ModelAxes = append(result.ModelAxes, &runtimev1.LoadoutEffectiveModelAxisIdentity{
			SlotId: strings.TrimSpace(binding.RequirementID), ModelAssetId: strings.TrimSpace(binding.ModelAssetID), ContentId: strings.TrimSpace(binding.VerifiedContentID),
			Presence: presenceByRequirement[strings.TrimSpace(binding.RequirementID)],
		})
	}
	for _, custody := range selected.RecipeCustody {
		if custody != nil {
			result.RecipeCustody = append(result.RecipeCustody, proto.Clone(custody).(*runtimev1.LoadoutRecipeCustodyReference))
		}
	}
	return result
}

// projectResolvedAssemblyEffectiveInputIdentity is the only public attribution
// projection for a captured local ScenarioJob. The private ResolvedAssembly is
// the durable owner; callers must not independently re-project the selected
// Loadout into a second Job identity.
func projectResolvedAssemblyEffectiveInputIdentity(assembly *localResolvedAssembly) (*runtimev1.LoadoutEffectiveInputIdentity, error) {
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, err
	}
	result := &runtimev1.LoadoutEffectiveInputIdentity{
		LoadoutId:          strings.TrimSpace(assembly.LoadoutID),
		CapabilityContract: strings.TrimSpace(assembly.CapabilityContract),
		Implementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: strings.TrimSpace(assembly.DriverIdentity.ImplementationID),
			DriverId:         strings.TrimSpace(assembly.DriverIdentity.DriverID),
			DriverDialect:    strings.TrimSpace(assembly.DriverIdentity.DriverDialect),
		},
		RecipeId:         strings.TrimSpace(assembly.RecipeID),
		RecipeRevision:   strings.TrimSpace(assembly.RecipeRevision),
		AdmittedFeatures: append([]string(nil), assembly.AdmittedFeatures...),
		AdmittedTextBehaviors: append(
			[]runtimev1.TextBehaviorKind(nil), assembly.AdmittedTextBehaviors...,
		),
	}
	if len(assembly.PortableConfig) > 0 {
		options := &structpb.Struct{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.PortableConfig, options); err != nil {
			return nil, fmt.Errorf("decode ResolvedAssembly options: %w", err)
		}
		result.Options = options
	}
	for _, axis := range assembly.ModelAxes {
		result.ModelAxes = append(result.ModelAxes, &runtimev1.LoadoutEffectiveModelAxisIdentity{
			SlotId: strings.TrimSpace(axis.RequirementID), ModelAssetId: strings.TrimSpace(axis.ModelAssetID), ContentId: strings.TrimSpace(axis.VerifiedContentID),
			Presence: axis.Presence,
		})
	}
	for index, raw := range assembly.RecipeCustody {
		custody := &runtimev1.LoadoutRecipeCustodyReference{}
		if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(raw, custody); err != nil {
			return nil, fmt.Errorf("decode ResolvedAssembly recipe custody %d: %w", index, err)
		}
		result.RecipeCustody = append(result.RecipeCustody, custody)
	}
	return result, nil
}

func validateScenarioJobResolvedAssemblyPair(job *runtimev1.ScenarioJob, assembly *localResolvedAssembly) error {
	if job == nil {
		return fmt.Errorf("ScenarioJob is required")
	}
	if assembly != nil {
		if err := validateLocalResolvedAssembly(assembly); err != nil {
			return err
		}
	}
	if job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return nil
	}
	if job.GetEffectiveInputIdentity() == nil || assembly == nil {
		return fmt.Errorf("local ScenarioJob requires paired public effective input identity and private ResolvedAssembly")
	}
	projected, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return err
	}
	if !proto.Equal(job.GetEffectiveInputIdentity(), projected) {
		return fmt.Errorf("local ScenarioJob effective input identity does not match private ResolvedAssembly")
	}
	return nil
}

func newLocalResolvedAssembly(selected *localexecution.SelectedLocalExecution, requestKind string, requestPayload json.RawMessage) (*localResolvedAssembly, error) {
	if selected == nil || selected.DriverIdentity == nil || !json.Valid(requestPayload) {
		return nil, fmt.Errorf("complete local ResolvedAssembly input is required")
	}
	var compactRequest bytes.Buffer
	if err := json.Compact(&compactRequest, requestPayload); err != nil {
		return nil, fmt.Errorf("compact ResolvedAssembly request: %w", err)
	}
	assembly := &localResolvedAssembly{
		Version:            localResolvedAssemblyVersion,
		LoadoutID:          strings.TrimSpace(selected.LoadoutID),
		CapabilityContract: strings.TrimSpace(selected.CapabilityContract), RecipeID: strings.TrimSpace(selected.RecipeID),
		RecipeRevision:                  strings.TrimSpace(selected.RecipeRevision),
		ImplementationSupportedFeatures: normalizeLocalFeatureSet(selected.ImplementationSupportedFeatures),
		ConfiguredFeatures:              normalizeLocalFeatureSet(selected.ConfiguredFeatures),
		DriverIdentity: localResolvedAssemblyDriverIdentity{
			ImplementationID: strings.TrimSpace(selected.DriverIdentity.GetImplementationId()),
			DriverID:         strings.TrimSpace(selected.DriverIdentity.GetDriverId()),
			DriverDialect:    strings.TrimSpace(selected.DriverIdentity.GetDriverDialect()),
		},
		Request: localResolvedAssemblyRequest{Kind: requestKind, Payload: append(json.RawMessage(nil), compactRequest.Bytes()...)},
	}
	assembly.ProcessIdentity.DriverID = assembly.DriverIdentity.DriverID
	if selected.PortableConfig != nil {
		raw, err := protojson.Marshal(selected.PortableConfig)
		if err != nil {
			return nil, fmt.Errorf("marshal ResolvedAssembly portable config: %w", err)
		}
		assembly.PortableConfig = raw
	}
	for _, requirement := range selected.Requirements {
		if requirement == nil {
			continue
		}
		raw, err := protojson.Marshal(requirement)
		if err != nil {
			return nil, fmt.Errorf("marshal ResolvedAssembly requirement: %w", err)
		}
		assembly.Requirements = append(assembly.Requirements, raw)
	}
	presenceByRequirement := localRequirementPresenceByID(selected.Requirements)
	for _, binding := range selected.ExactBindings {
		assembly.ModelAxes = append(assembly.ModelAxes, localResolvedAssemblyModelAxis{
			RequirementID: strings.TrimSpace(binding.RequirementID), RequirementRole: binding.RequirementRole,
			OccurrenceOrdinal: binding.OccurrenceOrdinal, Presence: presenceByRequirement[strings.TrimSpace(binding.RequirementID)], DisplayLabel: strings.TrimSpace(binding.DisplayLabel),
			ModelAssetID: strings.TrimSpace(binding.ModelAssetID), AbsolutePath: strings.TrimSpace(binding.AbsolutePath),
			BundleDir: strings.TrimSpace(binding.BundleDir), DeclaredFiles: append([]string(nil), binding.DeclaredFiles...),
			VerifiedContentID: strings.TrimSpace(binding.VerifiedContentID), EntrySHA256: strings.TrimSpace(binding.EntrySHA256),
			TemplateIdentity: strings.TrimSpace(binding.TemplateIdentity),
		})
	}
	for _, custody := range selected.RecipeCustody {
		if custody == nil {
			continue
		}
		raw, err := protojson.Marshal(custody)
		if err != nil {
			return nil, fmt.Errorf("marshal ResolvedAssembly custody: %w", err)
		}
		assembly.RecipeCustody = append(assembly.RecipeCustody, raw)
	}
	for _, source := range selected.ExactDependencySources {
		hashes := make(map[string]string, len(source.Hashes))
		for key, value := range source.Hashes {
			hashes[key] = value
		}
		assembly.DependencySources = append(assembly.DependencySources, localResolvedAssemblyDependencySource{DependencyFamily: strings.TrimSpace(source.DependencyFamily), DependencyID: strings.TrimSpace(source.DependencyID), ConsumerScope: strings.TrimSpace(source.ConsumerScope), SelectedSourceRecordID: strings.TrimSpace(source.SelectedSourceRecordID), CanonicalRoot: strings.TrimSpace(source.CanonicalRoot), Version: strings.TrimSpace(source.Version), VerifiedArtifacts: append([]string(nil), source.VerifiedArtifacts...), Hashes: hashes})
	}
	return assembly, nil
}

func localResolvedAssemblyForMusic(selected *localexecution.SelectedLocalExecution, request *runtimev1.MusicGenerateScenarioSpec, plan *capabilitydriver.MusicInvocationPlan) (*localResolvedAssembly, error) {
	raw, err := protojson.Marshal(request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, "music.generate", raw)
	if err != nil {
		return nil, err
	}
	sampleRate, channels, bits := plan.ExpectedWAVFormat()
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "music", Music: &localResolvedAssemblyMusicPlan{ProcessKey: plan.ProcessKey(), AudioCppPackageID: plan.AudioCppPackageID(), AudioCppSelectedSourceRecordID: plan.AudioCppSelectedSourceRecordID(), AudioCppRoot: plan.AudioCppRoot(), AudioCppExecutablePath: plan.AudioCppExecutablePath(), CUDA13DependencyID: plan.CUDA13DependencyID(), CUDA13SelectedSourceRecordID: plan.CUDA13SelectedSourceRecordID(), CUDA13Root: plan.CUDA13Root(), ModelRoot: plan.ModelRoot(), LanguageModelPath: plan.LanguageModelPath(), RVQDepthDecoderPath: plan.RVQDepthDecoderPath(), FlowTransformerPath: plan.FlowTransformerPath(), DurationBudgetSeconds: plan.DurationBudgetSeconds(), NumInferenceSteps: plan.NumInferenceSteps(), GuidanceScale: plan.GuidanceScale(), ARGuidanceScale: plan.ARGuidanceScale(), TopK: plan.TopK(), Seed: plan.Seed(), MemorySaver: plan.MemorySaver(), StagingWAVPath: plan.StagingWAVPath(), ExpectedSampleRate: sampleRate, ExpectedChannels: channels, ExpectedBitsPerSample: bits}}
	assembly.ProcessIdentity.ProcessKey = plan.ProcessKey()
	return assembly, nil
}

func localResolvedAssemblyForText(selected *localexecution.SelectedLocalExecution, request *runtimev1.TextGenerateScenarioSpec, plan *capabilitydriver.TextInvocationPlan) (*localResolvedAssembly, error) {
	raw, err := protojson.Marshal(request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, "text.generate", raw)
	if err != nil {
		return nil, err
	}
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "text", Text: &localResolvedAssemblyTextPlan{
		ProcessKey: plan.ProcessKey(), ProcessArgs: plan.ProcessArgs(), ModelFiles: resolvedAssemblyInvocationBindings(plan.ModelFiles()),
		RequestPath: plan.RequestPath(), RequestContentType: plan.RequestContentType(), RequestBody: plan.RequestBody(), Stream: plan.Stream(), ContextWindowTokens: plan.ContextWindowTokens(),
		BehaviorMatch:   resolvedAssemblyTextBehaviorMatch(plan.BehaviorMatchFacts()),
		BehaviorAdapter: plan.BehaviorAdapterCapture(),
	}}
	assembly.AdmittedFeatures = localTextRequestFeatures(request)
	assembly.AdmittedTextBehaviors, err = localTextRequestBehaviorKinds(request)
	if err != nil {
		return nil, err
	}
	assembly.ProcessIdentity.ProcessKey = plan.ProcessKey()
	assembly.ProcessIdentity.ProcessArgs = plan.ProcessArgs()
	return assembly, nil
}

func resolvedAssemblyTextBehaviorMatch(facts capabilitydriver.TextBehaviorAdapterMatchFacts) localResolvedAssemblyTextBehaviorMatch {
	return localResolvedAssemblyTextBehaviorMatch{
		RecipeID: strings.TrimSpace(facts.RecipeID), RecipeRevision: strings.TrimSpace(facts.RecipeRevision),
		DriverDialect: strings.TrimSpace(facts.DriverDialect), ModelAssetID: strings.TrimSpace(facts.ModelAssetID),
		VerifiedContentID: strings.TrimSpace(facts.VerifiedContentID), EntrySHA256: strings.TrimSpace(facts.EntrySHA256),
		TemplateIdentity: strings.TrimSpace(facts.TemplateIdentity),
	}
}

func localTextRequestBehaviorKinds(spec *runtimev1.TextGenerateScenarioSpec) ([]runtimev1.TextBehaviorKind, error) {
	requested, err := requestedTextBehaviorsForSpec(spec)
	if err != nil {
		return nil, err
	}
	var result []runtimev1.TextBehaviorKind
	if requested.toolUse {
		result = append(result, runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE)
	}
	if requested.reasoning {
		result = append(result, runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_REASONING)
	}
	if requested.structured {
		result = append(result, runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_STRUCTURED_OUTPUT)
	}
	return result, nil
}

func localResolvedAssemblyForEmbed(selected *localexecution.SelectedLocalExecution, request *runtimev1.TextEmbedScenarioSpec, plan *capabilitydriver.EmbedInvocationPlan) (*localResolvedAssembly, error) {
	if request == nil || plan == nil {
		return nil, fmt.Errorf("text.embed ResolvedAssembly plan is required")
	}
	raw, err := protojson.Marshal(request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, "text.embed", raw)
	if err != nil {
		return nil, err
	}
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "embed", Embed: &localResolvedAssemblyEmbedPlan{
		ProcessKey: plan.ProcessKey(), ProcessArgs: plan.ProcessArgs(), ModelFiles: resolvedAssemblyInvocationBindings(plan.ModelFiles()),
		RequestPath: plan.RequestPath(), RequestBody: plan.RequestBody(), ExpectedCount: plan.ExpectedCount(),
		ContextWindowTokens: selected.ModelContextWindowTokens,
	}}
	assembly.ProcessIdentity.ProcessKey = plan.ProcessKey()
	assembly.ProcessIdentity.ProcessArgs = plan.ProcessArgs()
	return assembly, nil
}

func localResolvedAssemblyForSpeech(selected *localexecution.SelectedLocalExecution, synthesize capabilitydriver.SpeechSynthesizePlan, transcribe capabilitydriver.SpeechTranscribePlan) (*localResolvedAssembly, error) {
	var request proto.Message
	plan := &localResolvedAssemblySpeechPlan{}
	var binaryInput []byte
	var mimeType string
	switch {
	case synthesize != nil:
		request = synthesize.Request()
		plan.Operation = "synthesize"
		plan.DriverID = synthesize.DriverID()
		plan.ModelAssetID = synthesize.ModelAssetID()
		plan.ModelFiles = resolvedAssemblyInvocationBindings(synthesize.ModelFiles())
		if exact, ok := synthesize.(*capabilitydriver.Qwen3TTSAudioCppInvocationPlan); ok {
			doSample, temperature, topK, topP, repetition := exact.Sampling()
			sampleRate, channels, bits := exact.ExpectedWAVFormat()
			plan.Qwen3TTSAudioCpp = &localResolvedAssemblyQwen3TTSAudioCppPlan{ProcessKey: exact.ProcessKey(), AudioCppPackageID: exact.AudioCppPackageID(), AudioCppSelectedSourceRecordID: exact.AudioCppSelectedSourceRecordID(), AudioCppRoot: exact.AudioCppRoot(), AudioCppExecutablePath: exact.AudioCppExecutablePath(), CUDA13DependencyID: exact.CUDA13DependencyID(), CUDA13SelectedSourceRecordID: exact.CUDA13SelectedSourceRecordID(), CUDA13Root: exact.CUDA13Root(), ModelPath: exact.ModelPath(), Speaker: exact.Speaker(), Language: exact.Language(), DoSample: doSample, Temperature: temperature, TopK: topK, TopP: topP, RepetitionPenalty: repetition, MaxTokens: exact.MaxTokens(), TextChunkSize: exact.TextChunkSize(), Seed: exact.Seed(), MemorySaver: exact.MemorySaver(), StagingWAVPath: exact.StagingWAVPath(), ExpectedSampleRate: sampleRate, ExpectedChannels: channels, ExpectedBitsPerSample: bits}
		} else if exact, ok := synthesize.(*capabilitydriver.AudioCppTTSSynthesizePlan); ok {
			plan.AudioCpp = &localResolvedAssemblyAudioCppSpeechPlan{ProcessKey: exact.ProcessKey(), Family: exact.Family(), CLIArgs: exact.CLIArgs(), AudioCppPackageID: exact.AudioCppPackageID(), AudioCppSelectedSourceRecordID: exact.AudioCppSelectedSourceRecordID(), AudioCppRoot: exact.AudioCppRoot(), AudioCppExecutablePath: exact.AudioCppExecutablePath(), CUDA13DependencyID: exact.CUDA13DependencyID(), CUDA13SelectedSourceRecordID: exact.CUDA13SelectedSourceRecordID(), CUDA13Root: exact.CUDA13Root(), StagingWAVPath: exact.StagingWAVPath(), ReferenceWAVPath: exact.ReferenceWAVPath(), ReferenceText: exact.ReferenceText()}
			binaryInput = exact.ReferenceWAVBytes()
			if len(binaryInput) > 0 {
				mimeType = "audio/wav"
			}
		}
	case transcribe != nil:
		request = transcribe.Request()
		plan.Operation = "transcribe"
		plan.DriverID = transcribe.DriverID()
		plan.ModelAssetID = transcribe.ModelAssetID()
		plan.ModelFiles = resolvedAssemblyInvocationBindings(transcribe.ModelFiles())
		binaryInput = transcribe.AudioBytes()
		mimeType = transcribe.MIMEType()
		if exact, ok := transcribe.(*capabilitydriver.AudioCppASRTranscribePlan); ok {
			plan.AudioCpp = &localResolvedAssemblyAudioCppSpeechPlan{ProcessKey: exact.ProcessKey(), Family: exact.Family(), CLIArgs: exact.CLIArgs(), AudioCppPackageID: exact.AudioCppPackageID(), AudioCppSelectedSourceRecordID: exact.AudioCppSelectedSourceRecordID(), AudioCppRoot: exact.AudioCppRoot(), AudioCppExecutablePath: exact.AudioCppExecutablePath(), CUDA13DependencyID: exact.CUDA13DependencyID(), CUDA13SelectedSourceRecordID: exact.CUDA13SelectedSourceRecordID(), CUDA13Root: exact.CUDA13Root(), StagingAudioPath: exact.StagingAudioPath(), StagingTextOutPath: exact.StagingTextOutPath()}
		}
	default:
		return nil, fmt.Errorf("speech ResolvedAssembly plan is required")
	}
	raw, err := protojson.Marshal(request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, "speech."+plan.Operation, raw)
	if err != nil {
		return nil, err
	}
	assembly.Request.BinaryInput = binaryInput
	assembly.Request.MIMEType = mimeType
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "speech", Speech: plan}
	assembly.ProcessIdentity.DriverID = plan.DriverID
	assembly.ProcessIdentity.ModelAssetID = plan.ModelAssetID
	if plan.Qwen3TTSAudioCpp != nil {
		assembly.ProcessIdentity.ProcessKey = plan.Qwen3TTSAudioCpp.ProcessKey
	} else if plan.AudioCpp != nil {
		assembly.ProcessIdentity.ProcessKey = plan.AudioCpp.ProcessKey
		assembly.ProcessIdentity.ProcessArgs = append([]string(nil), plan.AudioCpp.CLIArgs...)
	}
	return assembly, nil
}

func localResolvedAssemblyForVoiceCreate(selected *localexecution.SelectedLocalExecution, request *runtimev1.VoiceCreateScenarioSpec, plan *capabilitydriver.VoiceCreateInvocationPlan) (*localResolvedAssembly, error) {
	if request == nil || plan == nil {
		return nil, fmt.Errorf("voice.create ResolvedAssembly plan is required")
	}
	raw, err := protojson.Marshal(request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, "voice.create", raw)
	if err != nil {
		return nil, err
	}
	speechPlan := &localResolvedAssemblySpeechPlan{
		Operation: "voice.create", DriverID: plan.DriverID(), ModelAssetID: plan.ModelAssetID(),
		ModelFiles: resolvedAssemblyInvocationBindings(plan.ModelFiles()),
	}
	if plan.AudioCppProviderVoiceRef() != "" {
		speechPlan.AudioCppReferenceVoice = &localResolvedAssemblyAudioCppReferenceVoicePlan{Root: plan.AudioCppReferenceRoot(), ProviderVoiceRef: plan.AudioCppProviderVoiceRef()}
	}
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "speech", Speech: speechPlan}
	assembly.AdmittedFeatures = localVoiceCreateRequestFeatures(request)
	assembly.ProcessIdentity.DriverID = plan.DriverID()
	assembly.ProcessIdentity.ModelAssetID = plan.ModelAssetID()
	return assembly, nil
}

func localResolvedAssemblyForImage(selected *localexecution.SelectedLocalExecution, request *runtimev1.ImageGenerateScenarioSpec, plan *capabilitydriver.ImageInvocationPlan) (*localResolvedAssembly, error) {
	raw, err := protojson.Marshal(request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, "image.generate", raw)
	if err != nil {
		return nil, err
	}
	loadPlan, ok := plan.LoadPlan().(capabilitydriver.StableDiffusionCPPLoadPlan)
	if !ok {
		return nil, fmt.Errorf("unsupported image ResolvedAssembly load plan %T", plan.LoadPlan())
	}
	requestPlan := plan.RequestPlan()
	result, ok := plan.ResultConstraints().(capabilitydriver.StableDiffusionCPPResultConstraints)
	if requestPlan == nil || !ok {
		return nil, fmt.Errorf("image ResolvedAssembly request/result plan is incomplete")
	}
	imagePlan := &localResolvedAssemblyImagePlan{
		ProcessKey: plan.ProcessKey(), ModelFiles: resolvedAssemblyInvocationBindings(plan.ModelFiles()),
		RecipeID: loadPlan.RecipeID(), Main: resolvedAssemblyImageModelFile(loadPlan.Main()),
		TextEncoder: resolvedAssemblyImageModelFile(loadPlan.TextEncoder()), VAE: resolvedAssemblyImageModelFile(loadPlan.VAE()),
		Threads: loadPlan.Threads(), CFGScale: loadPlan.CFGScale(), Sampler: loadPlan.Sampler(), Scheduler: loadPlan.Scheduler(),
		FlowShift: loadPlan.FlowShift(), QwenImageZeroCondT: loadPlan.QwenImageZeroCondT(), FlashAttention: loadPlan.DiffusionFlashAttention(),
		OffloadParamsToCPU: loadPlan.OffloadParamsToCPU(),
		Request: localResolvedAssemblyImageRequestPlan{
			Prompt: requestPlan.Prompt(), NegativePrompt: requestPlan.NegativePrompt(), Width: requestPlan.Width(), Height: requestPlan.Height(),
			Steps: requestPlan.Steps(), CFGScale: requestPlan.CFGScale(), Seed: requestPlan.Seed(), ImageCount: requestPlan.ImageCount(),
			Sampler: requestPlan.Sampler(), Scheduler: requestPlan.Scheduler(),
		},
		Result: localResolvedAssemblyImageResult{
			ArtifactCount: result.ArtifactCount(), MediaType: result.MediaType(), Format: result.Format(), Width: result.Width(), Height: result.Height(),
		},
	}
	if uncond, present := loadPlan.UncondDiffusion(); present {
		converted := resolvedAssemblyImageModelFile(uncond)
		imagePlan.UncondDiffusion = &converted
	}
	switch typed := requestPlan.(type) {
	case capabilitydriver.StableDiffusionCPPTextToImageRequestPlan:
		imagePlan.Request.Kind = "text-to-image"
	case capabilitydriver.StableDiffusionCPPInstructionEditRequestPlan:
		imagePlan.Request.Kind = "instruction-edit"
		assembly.AdmittedFeatures = append(assembly.AdmittedFeatures, "input.image")
		source := typed.SourceImage()
		imagePlan.Request.SourceIdentity = source.SourceIdentity
		imagePlan.Request.SourceImage = source.ImageBytes
	default:
		return nil, fmt.Errorf("unsupported image ResolvedAssembly request plan %T", requestPlan)
	}
	if strings.TrimSpace(request.GetMask()) != "" {
		assembly.AdmittedFeatures = append(assembly.AdmittedFeatures, "input.mask")
	}
	assembly.AdmittedFeatures = normalizeLocalFeatureSet(assembly.AdmittedFeatures)
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "image", Image: imagePlan}
	assembly.ProcessIdentity.ProcessKey = plan.ProcessKey()
	return assembly, nil
}

func localResolvedAssemblyForVideo(selected *localexecution.SelectedLocalExecution, request capabilitydriver.VideoInvocationRequest, plan *capabilitydriver.VideoInvocationPlan) (*localResolvedAssembly, error) {
	raw, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, "video.generate", raw)
	if err != nil {
		return nil, err
	}
	width, height := plan.Size()
	videoPlan := &localResolvedAssemblyVideoPlan{
		ProcessKey: plan.ProcessKey(), LoadoutID: plan.LoadoutID(), ExactBindings: resolvedAssemblyInvocationBindings(plan.ExactBindings()),
		ModelFiles: resolvedAssemblyInvocationBindings(plan.ModelFiles()), DiffusionModelPath: plan.DiffusionModelPath(), EncoderPath: plan.EncoderPath(),
		VideoVAEPath: plan.VideoVAEPath(), AudioVAEPath: plan.AudioVAEPath(), Prompt: plan.Prompt(), NegativePrompt: plan.NegativePrompt(),
		Width: width, Height: height, FrameCount: plan.FrameCount(), FPS: plan.FPS(), Seed: plan.Seed(), AudioRequired: plan.AudioRequired(),
		ReturnLastFrame: plan.ReturnLastFrame(), ConditioningMode: string(plan.ConditioningMode()), CFGScale: plan.CFGScale(), FlowShift: plan.FlowShift(),
		SampleMethod: plan.SampleMethod(), Scheduler: plan.Scheduler(), DiffusionFlashAttention: plan.DiffusionFlashAttention(),
		OffloadToCPU: plan.OffloadToCPU(), RNG: plan.RNG(),
	}
	if reference, present := plan.ReferenceImage(); present {
		videoPlan.ReferenceImage = &reference
		assembly.AdmittedFeatures = []string{"input.image"}
	}
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "video", Video: videoPlan}
	assembly.ProcessIdentity.ProcessKey = plan.ProcessKey()
	return assembly, nil
}

func resolvedAssemblyInvocationBindings(bindings []capabilitydriver.InvocationExactBinding) []localResolvedAssemblyInvocationBinding {
	result := make([]localResolvedAssemblyInvocationBinding, 0, len(bindings))
	for _, binding := range bindings {
		result = append(result, localResolvedAssemblyInvocationBinding{
			RequirementID: strings.TrimSpace(binding.RequirementID), ModelAssetID: strings.TrimSpace(binding.ModelAssetID), AbsolutePath: strings.TrimSpace(binding.AbsolutePath),
			BundleDir: strings.TrimSpace(binding.BundleDir), DeclaredFiles: append([]string(nil), binding.DeclaredFiles...),
			VerifiedContentID: strings.TrimSpace(binding.VerifiedContentID), EntrySHA256: strings.TrimSpace(binding.EntrySHA256),
			TemplateIdentity: strings.TrimSpace(binding.TemplateIdentity),
		})
	}
	return result
}

func resolvedAssemblyPortableConfig(assembly *localResolvedAssembly) (*structpb.Struct, error) {
	if assembly == nil || len(assembly.PortableConfig) == 0 {
		return nil, nil
	}
	portable := &structpb.Struct{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.PortableConfig, portable); err != nil {
		return nil, fmt.Errorf("decode local ResolvedAssembly portable config: %w", err)
	}
	return portable, nil
}

func resolvedAssemblyExactBindings(assembly *localResolvedAssembly) []capabilitydriver.InvocationExactBinding {
	if assembly == nil {
		return nil
	}
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, len(assembly.ModelAxes))
	for _, axis := range assembly.ModelAxes {
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{
			RequirementID:     axis.RequirementID,
			ModelAssetID:      axis.ModelAssetID,
			AbsolutePath:      axis.AbsolutePath,
			BundleDir:         axis.BundleDir,
			DeclaredFiles:     append([]string(nil), axis.DeclaredFiles...),
			VerifiedContentID: axis.VerifiedContentID,
			EntrySHA256:       axis.EntrySHA256,
			TemplateIdentity:  axis.TemplateIdentity,
		})
	}
	return bindings
}

func invocationExactDependencySources(values []localexecution.ExactDependencySource) []capabilitydriver.InvocationExactDependencySource {
	result := make([]capabilitydriver.InvocationExactDependencySource, 0, len(values))
	for _, value := range values {
		hashes := make(map[string]string, len(value.Hashes))
		for key, hash := range value.Hashes {
			hashes[key] = hash
		}
		result = append(result, capabilitydriver.InvocationExactDependencySource{
			DependencyFamily: value.DependencyFamily, DependencyID: value.DependencyID, ConsumerScope: value.ConsumerScope,
			SelectedSourceRecordID: value.SelectedSourceRecordID, CanonicalRoot: value.CanonicalRoot, Version: value.Version,
			VerifiedArtifacts: append([]string(nil), value.VerifiedArtifacts...), Hashes: hashes,
		})
	}
	return result
}

func resolvedAssemblyExactDependencySources(assembly *localResolvedAssembly) []capabilitydriver.InvocationExactDependencySource {
	if assembly == nil {
		return nil
	}
	values := make([]localexecution.ExactDependencySource, 0, len(assembly.DependencySources))
	for _, source := range assembly.DependencySources {
		values = append(values, localexecution.ExactDependencySource{
			DependencyFamily: source.DependencyFamily, DependencyID: source.DependencyID, ConsumerScope: source.ConsumerScope,
			SelectedSourceRecordID: source.SelectedSourceRecordID, CanonicalRoot: source.CanonicalRoot, Version: source.Version,
			VerifiedArtifacts: append([]string(nil), source.VerifiedArtifacts...), Hashes: source.Hashes,
		})
	}
	return invocationExactDependencySources(values)
}

// selectedLocalExecutionFromResolvedAssembly is a data-only projection used
// to re-project a Driver plan into the same private assembly shape. It never
// resolves current Loadout, ModelAsset, catalog, or selection state.
func selectedLocalExecutionFromResolvedAssembly(assembly *localResolvedAssembly) *localexecution.SelectedLocalExecution {
	if assembly == nil {
		return nil
	}
	selected := &localexecution.SelectedLocalExecution{
		LoadoutID:          assembly.LoadoutID,
		CapabilityContract: assembly.CapabilityContract,
		RecipeID:           assembly.RecipeID,
		RecipeRevision:     assembly.RecipeRevision,
		DriverIdentity: (&capabilitydriver.Identity{
			ImplementationID: assembly.DriverIdentity.ImplementationID,
			DriverID:         assembly.DriverIdentity.DriverID,
			DriverDialect:    assembly.DriverIdentity.DriverDialect,
		}).Proto(),
		ImplementationSupportedFeatures: append([]string(nil), assembly.ImplementationSupportedFeatures...),
		ConfiguredFeatures:              append([]string(nil), assembly.ConfiguredFeatures...),
		Configured:                      true,
	}
	for _, axis := range assembly.ModelAxes {
		selected.ExactBindings = append(selected.ExactBindings, localexecution.ExactBinding{
			RequirementID:     axis.RequirementID,
			RequirementRole:   axis.RequirementRole,
			OccurrenceOrdinal: axis.OccurrenceOrdinal,
			DisplayLabel:      axis.DisplayLabel,
			ModelAssetID:      axis.ModelAssetID,
			AbsolutePath:      axis.AbsolutePath,
			BundleDir:         axis.BundleDir,
			DeclaredFiles:     append([]string(nil), axis.DeclaredFiles...),
			VerifiedContentID: axis.VerifiedContentID,
			EntrySHA256:       axis.EntrySHA256,
			TemplateIdentity:  axis.TemplateIdentity,
		})
	}
	for _, source := range assembly.DependencySources {
		hashes := make(map[string]string, len(source.Hashes))
		for key, value := range source.Hashes {
			hashes[key] = value
		}
		selected.ExactDependencySources = append(selected.ExactDependencySources, localexecution.ExactDependencySource{DependencyFamily: source.DependencyFamily, DependencyID: source.DependencyID, ConsumerScope: source.ConsumerScope, SelectedSourceRecordID: source.SelectedSourceRecordID, CanonicalRoot: source.CanonicalRoot, Version: source.Version, VerifiedArtifacts: append([]string(nil), source.VerifiedArtifacts...), Hashes: hashes})
	}
	return selected
}

func validateRehydratedResolvedAssemblyPlan(captured, reprojected *localResolvedAssembly) error {
	if captured == nil || reprojected == nil {
		return fmt.Errorf("rehydrated local ResolvedAssembly is missing")
	}
	differing := make([]string, 0, 4)
	if !reflect.DeepEqual(captured.Request, reprojected.Request) {
		differing = append(differing, "request")
	}
	if !reflect.DeepEqual(captured.LoadPlan, reprojected.LoadPlan) {
		differing = append(differing, "load_plan")
	}
	if !reflect.DeepEqual(captured.ProcessIdentity, reprojected.ProcessIdentity) {
		differing = append(differing, "process_identity")
	}
	if !reflect.DeepEqual(captured.AdmittedFeatures, reprojected.AdmittedFeatures) {
		differing = append(differing, "admitted_features")
	}
	if !reflect.DeepEqual(captured.AdmittedTextBehaviors, reprojected.AdmittedTextBehaviors) {
		differing = append(differing, "admitted_text_behaviors")
	}
	if len(differing) > 0 {
		return fmt.Errorf("rehydrated local ResolvedAssembly differs from the captured contract: %s", strings.Join(differing, ","))
	}
	return nil
}

func resolvedAssemblyImageModelFile(file capabilitydriver.ImageModelFile) localResolvedAssemblyImageModelFile {
	return localResolvedAssemblyImageModelFile{
		ModelAssetID: file.ModelAssetID(), AbsolutePath: file.AbsolutePath(), VerifiedContentID: file.VerifiedContentID(), EntrySHA256: file.EntrySHA256(),
	}
}

func validateLocalResolvedAssembly(assembly *localResolvedAssembly) error {
	if assembly == nil {
		return nil
	}
	loadoutID := strings.TrimSpace(assembly.LoadoutID)
	if assembly.Version != localResolvedAssemblyVersion || loadoutID == "" || strings.TrimSpace(assembly.CapabilityContract) == "" ||
		strings.TrimSpace(assembly.RecipeID) == "" || strings.TrimSpace(assembly.RecipeRevision) == "" {
		return fmt.Errorf("local ResolvedAssembly version or capability is invalid")
	}
	if strings.TrimSpace(assembly.DriverIdentity.ImplementationID) == "" || strings.TrimSpace(assembly.DriverIdentity.DriverID) == "" || strings.TrimSpace(assembly.DriverIdentity.DriverDialect) == "" {
		return fmt.Errorf("local ResolvedAssembly Driver identity is incomplete")
	}
	if !localFeatureSetIsCanonical(assembly.ImplementationSupportedFeatures) ||
		!localFeatureSetIsCanonical(assembly.ConfiguredFeatures) ||
		!localFeatureSetIsCanonical(assembly.AdmittedFeatures) ||
		!localFeatureSubset(assembly.ConfiguredFeatures, assembly.ImplementationSupportedFeatures) ||
		!localFeatureSubset(assembly.AdmittedFeatures, assembly.ConfiguredFeatures) {
		return fmt.Errorf("local ResolvedAssembly feature projections are invalid")
	}
	if !localTextBehaviorSetIsCanonical(assembly.AdmittedTextBehaviors) {
		return fmt.Errorf("local ResolvedAssembly admitted text behaviors are invalid")
	}
	if len(assembly.ModelAxes) == 0 {
		return fmt.Errorf("local ResolvedAssembly model axes are empty")
	}
	for index, axis := range assembly.ModelAxes {
		modelAssetID := strings.TrimSpace(axis.ModelAssetID)
		if strings.TrimSpace(axis.RequirementID) == "" || modelAssetID == "" || strings.TrimSpace(axis.AbsolutePath) == "" || strings.TrimSpace(axis.VerifiedContentID) == "" || strings.TrimSpace(axis.EntrySHA256) == "" {
			return fmt.Errorf("local ResolvedAssembly model axis %d is incomplete", index)
		}
		if axis.Presence != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED &&
			axis.Presence != runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL {
			return fmt.Errorf("local ResolvedAssembly model axis %d presence is invalid", index)
		}
		if axis.TemplateIdentity != "" && !canonicalResolvedAssemblySHA256Identity(axis.TemplateIdentity) {
			return fmt.Errorf("local ResolvedAssembly model axis %d template identity is invalid", index)
		}
	}
	if strings.TrimSpace(assembly.Request.Kind) == "" || !json.Valid(assembly.Request.Payload) {
		return fmt.Errorf("local ResolvedAssembly request is invalid")
	}
	if assembly.LoadPlan.Kind != "text" && len(assembly.AdmittedTextBehaviors) != 0 {
		return fmt.Errorf("non-text ResolvedAssembly carries admitted text behaviors")
	}
	switch assembly.LoadPlan.Kind {
	case "text":
		if assembly.LoadPlan.Text == nil || strings.TrimSpace(assembly.LoadPlan.Text.ProcessKey) == "" ||
			strings.TrimSpace(assembly.LoadPlan.Text.RequestContentType) == "" {
			return fmt.Errorf("local ResolvedAssembly text load plan is incomplete")
		}
		var main *localResolvedAssemblyModelAxis
		for index := range assembly.ModelAxes {
			axis := &assembly.ModelAxes[index]
			if axis.RequirementID == capabilitydriver.MainGGUFRequirementID {
				if main != nil {
					return fmt.Errorf("local ResolvedAssembly text behavior match has ambiguous main GGUF axes")
				}
				main = axis
			} else if axis.TemplateIdentity != "" {
				return fmt.Errorf("local ResolvedAssembly text template identity is attached to a non-main axis")
			}
		}
		if main == nil {
			return fmt.Errorf("local ResolvedAssembly text behavior match has no main GGUF axis")
		}
		expectedMatch := localResolvedAssemblyTextBehaviorMatch{
			RecipeID: assembly.RecipeID, RecipeRevision: assembly.RecipeRevision, DriverDialect: assembly.DriverIdentity.DriverDialect,
			ModelAssetID: main.ModelAssetID, VerifiedContentID: main.VerifiedContentID, EntrySHA256: main.EntrySHA256,
			TemplateIdentity: main.TemplateIdentity,
		}
		if !reflect.DeepEqual(assembly.LoadPlan.Text.BehaviorMatch, expectedMatch) {
			return fmt.Errorf("local ResolvedAssembly text behavior match differs from the exact model axis")
		}
		if adapter := assembly.LoadPlan.Text.BehaviorAdapter; adapter != nil {
			if err := adapter.Validate(); err != nil {
				return fmt.Errorf("local ResolvedAssembly text behavior adapter is invalid: %w", err)
			}
			if adapter.RequiredTemplateIdentity != "" && adapter.RequiredTemplateIdentity != expectedMatch.TemplateIdentity {
				return fmt.Errorf("local ResolvedAssembly text behavior adapter template differs from the exact model axis")
			}
			if len(assembly.AdmittedTextBehaviors) == 0 {
				return fmt.Errorf("local ResolvedAssembly text behavior adapter has no admitted behavior")
			}
		} else if len(assembly.AdmittedTextBehaviors) != 0 {
			return fmt.Errorf("local ResolvedAssembly admitted text behavior has no adapter")
		}
	case "embed":
		if assembly.LoadPlan.Embed == nil || strings.TrimSpace(assembly.LoadPlan.Embed.ProcessKey) == "" || assembly.LoadPlan.Embed.ExpectedCount <= 0 {
			return fmt.Errorf("local ResolvedAssembly embed load plan is incomplete")
		}
	case "speech":
		if assembly.LoadPlan.Speech == nil || strings.TrimSpace(assembly.LoadPlan.Speech.DriverID) == "" || strings.TrimSpace(assembly.LoadPlan.Speech.ModelAssetID) == "" {
			return fmt.Errorf("local ResolvedAssembly speech load plan is incomplete")
		}
		if operation := strings.TrimSpace(assembly.LoadPlan.Speech.Operation); operation != "synthesize" && operation != "transcribe" && operation != "voice.create" {
			return fmt.Errorf("local ResolvedAssembly speech operation %q is unsupported", operation)
		}
		if assembly.DriverIdentity.DriverID == capabilitydriver.Qwen3TTSAudioCppDriverID {
			plan := assembly.LoadPlan.Speech.Qwen3TTSAudioCpp
			if plan == nil || strings.TrimSpace(plan.ProcessKey) == "" || strings.TrimSpace(plan.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(plan.CUDA13SelectedSourceRecordID) == "" || strings.TrimSpace(plan.StagingWAVPath) == "" {
				return fmt.Errorf("local Qwen3-TTS audio.cpp ResolvedAssembly plan is incomplete")
			}
		}
		if plan := assembly.LoadPlan.Speech.AudioCpp; plan != nil {
			if strings.TrimSpace(plan.ProcessKey) == "" || strings.TrimSpace(plan.Family) == "" || len(plan.CLIArgs) == 0 || strings.TrimSpace(plan.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(plan.CUDA13SelectedSourceRecordID) == "" {
				return fmt.Errorf("local audio.cpp speech ResolvedAssembly plan is incomplete")
			}
			switch assembly.LoadPlan.Speech.Operation {
			case "synthesize":
				if strings.TrimSpace(plan.StagingWAVPath) == "" {
					return fmt.Errorf("local audio.cpp TTS ResolvedAssembly plan is incomplete")
				}
			case "transcribe":
				if strings.TrimSpace(plan.StagingAudioPath) == "" || strings.TrimSpace(plan.StagingTextOutPath) == "" {
					return fmt.Errorf("local audio.cpp ASR ResolvedAssembly plan is incomplete")
				}
			}
		}
		if plan := assembly.LoadPlan.Speech.AudioCppReferenceVoice; plan != nil {
			if assembly.LoadPlan.Speech.Operation != "voice.create" || !filepath.IsAbs(strings.TrimSpace(plan.Root)) || strings.TrimSpace(plan.ProviderVoiceRef) == "" {
				return fmt.Errorf("local audio.cpp reference voice ResolvedAssembly plan is incomplete")
			}
		}
	case "image":
		if assembly.LoadPlan.Image == nil || strings.TrimSpace(assembly.LoadPlan.Image.ProcessKey) == "" || strings.TrimSpace(assembly.LoadPlan.Image.Request.Kind) == "" {
			return fmt.Errorf("local ResolvedAssembly image load plan is incomplete")
		}
	case "video":
		if assembly.LoadPlan.Video == nil || strings.TrimSpace(assembly.LoadPlan.Video.ProcessKey) == "" {
			return fmt.Errorf("local ResolvedAssembly video load plan is incomplete")
		}
	case "music":
		if assembly.LoadPlan.Music == nil || strings.TrimSpace(assembly.LoadPlan.Music.ProcessKey) == "" || strings.TrimSpace(assembly.LoadPlan.Music.AudioCppSelectedSourceRecordID) == "" || strings.TrimSpace(assembly.LoadPlan.Music.CUDA13SelectedSourceRecordID) == "" || strings.TrimSpace(assembly.LoadPlan.Music.StagingWAVPath) == "" {
			return fmt.Errorf("local ResolvedAssembly music load plan is incomplete")
		}
	default:
		return fmt.Errorf("local ResolvedAssembly load plan kind %q is unsupported", assembly.LoadPlan.Kind)
	}
	return nil
}

func canonicalResolvedAssemblySHA256Identity(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || value != strings.ToLower(value) || len(value) != len("sha256:")+64 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func normalizeLocalFeatureSet(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			set[value] = struct{}{}
		}
	}
	if len(set) == 0 {
		return nil
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func localFeatureSetIsCanonical(values []string) bool {
	for index, value := range values {
		if strings.TrimSpace(value) == "" || strings.TrimSpace(value) != value || (index > 0 && values[index-1] >= value) {
			return false
		}
	}
	return true
}

func localTextBehaviorSetIsCanonical(values []runtimev1.TextBehaviorKind) bool {
	for index, value := range values {
		if value != runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_TOOL_USE &&
			value != runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_REASONING &&
			value != runtimev1.TextBehaviorKind_TEXT_BEHAVIOR_KIND_STRUCTURED_OUTPUT {
			return false
		}
		if index > 0 && values[index-1] >= value {
			return false
		}
	}
	return true
}

func localFeatureSubset(values, available []string) bool {
	set := make(map[string]struct{}, len(available))
	for _, value := range available {
		set[value] = struct{}{}
	}
	for _, value := range values {
		if _, ok := set[value]; !ok {
			return false
		}
	}
	return true
}

func localRequirementPresenceByID(requirements []*runtimev1.LocalCapabilityRequirement) map[string]runtimev1.LocalCapabilityRequirementPresence {
	result := make(map[string]runtimev1.LocalCapabilityRequirementPresence, len(requirements))
	for _, requirement := range requirements {
		if requirement == nil {
			continue
		}
		presence := requirement.GetPresence()
		if presence == runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_UNSPECIFIED {
			presence = runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED
		}
		result[strings.TrimSpace(requirement.GetRequirementId())] = presence
	}
	return result
}

func localVoiceCreateRequestFeatures(request *runtimev1.VoiceCreateScenarioSpec) []string {
	if request == nil {
		return nil
	}
	switch request.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		return []string{aicapabilities.FeatureInputAudio}
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		return []string{aicapabilities.FeatureInputText}
	default:
		return nil
	}
}

func cloneLocalResolvedAssembly(input *localResolvedAssembly) (*localResolvedAssembly, error) {
	if input == nil {
		return nil, nil
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(input); err != nil {
		return nil, err
	}
	var cloned localResolvedAssembly
	if err := decodeScenarioJobStrictJSON(encoded.Bytes(), &cloned); err != nil {
		return nil, err
	}
	return &cloned, nil
}

func cloneLoadoutEffectiveInputIdentity(input *runtimev1.LoadoutEffectiveInputIdentity) *runtimev1.LoadoutEffectiveInputIdentity {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.LoadoutEffectiveInputIdentity)
}

func cloneResolvedAssemblyStruct(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*structpb.Struct)
}
