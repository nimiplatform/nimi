// @nimi-authority: rule.nimi.runtime.local-compute.r100
// @nimi-authority: rule.nimi.platform.core-protocol.p-caiex-011

package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const localResolvedAssemblyVersion = 1

type localResolvedAssembly struct {
	Version            int                                  `json:"version"`
	LoadoutID          string                               `json:"loadout_id"`
	CapabilityContract string                               `json:"capability_contract"`
	RecipeID           string                               `json:"recipe_id"`
	RecipeRevision     string                               `json:"recipe_revision"`
	DriverIdentity     localResolvedAssemblyDriverIdentity  `json:"driver_identity"`
	PortableConfig     json.RawMessage                      `json:"portable_config,omitempty"`
	Requirements       []json.RawMessage                    `json:"requirements,omitempty"`
	ModelAxes          []localResolvedAssemblyModelAxis     `json:"model_axes"`
	RecipeCustody      []json.RawMessage                    `json:"recipe_custody,omitempty"`
	SupportedFeatures  []string                             `json:"supported_features,omitempty"`
	Request            localResolvedAssemblyRequest         `json:"request"`
	LoadPlan           localResolvedAssemblyLoadPlan        `json:"load_plan"`
	ProcessIdentity    localResolvedAssemblyProcessIdentity `json:"process_identity"`
}

type localResolvedAssemblyDriverIdentity struct {
	ImplementationID string `json:"implementation_id"`
	DriverID         string `json:"driver_id"`
	DriverDialect    string `json:"driver_dialect"`
}

type localResolvedAssemblyModelAxis struct {
	RequirementID     string                                   `json:"requirement_id"`
	RequirementRole   runtimev1.LocalCapabilityRequirementRole `json:"requirement_role"`
	OccurrenceOrdinal uint32                                   `json:"occurrence_ordinal"`
	DisplayLabel      string                                   `json:"display_label,omitempty"`
	ModelAssetID      string                                   `json:"model_asset_id"`
	AbsolutePath      string                                   `json:"absolute_path"`
	BundleDir         string                                   `json:"bundle_dir,omitempty"`
	DeclaredFiles     []string                                 `json:"declared_files,omitempty"`
	VerifiedContentID string                                   `json:"verified_content_id"`
	EntrySHA256       string                                   `json:"entry_sha256"`
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
}

type localResolvedAssemblyInvocationBinding struct {
	RequirementID     string   `json:"requirement_id"`
	ModelAssetID      string   `json:"model_asset_id"`
	AbsolutePath      string   `json:"absolute_path"`
	BundleDir         string   `json:"bundle_dir,omitempty"`
	DeclaredFiles     []string `json:"declared_files,omitempty"`
	VerifiedContentID string   `json:"verified_content_id"`
	EntrySHA256       string   `json:"entry_sha256"`
}

type localResolvedAssemblyTextPlan struct {
	ProcessKey          string                                   `json:"process_key"`
	ProcessArgs         []string                                 `json:"process_args"`
	ModelFiles          []localResolvedAssemblyInvocationBinding `json:"model_files"`
	RequestPath         string                                   `json:"request_path"`
	RequestBody         []byte                                   `json:"request_body"`
	Stream              bool                                     `json:"stream"`
	ContextWindowTokens uint64                                   `json:"context_window_tokens"`
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
	Operation    string                                   `json:"operation"`
	DriverID     string                                   `json:"driver_id"`
	ModelAssetID string                                   `json:"model_asset_id"`
	ModelFiles   []localResolvedAssemblyInvocationBinding `json:"model_files"`
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
	InputImage     string  `json:"input_image,omitempty"`
	Mask           string  `json:"mask,omitempty"`
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

func projectLoadoutEffectiveInputIdentity(selected *localexecution.SelectedLocalExecution) *runtimev1.LoadoutEffectiveInputIdentity {
	if selected == nil {
		return nil
	}
	result := &runtimev1.LoadoutEffectiveInputIdentity{
		LoadoutId: strings.TrimSpace(selected.LoadoutID), CapabilityContract: strings.TrimSpace(selected.CapabilityContract),
		RecipeId: strings.TrimSpace(selected.RecipeID), RecipeRevision: strings.TrimSpace(selected.RecipeRevision),
		Options: cloneResolvedAssemblyStruct(selected.PortableConfig),
	}
	if selected.DriverIdentity != nil {
		result.Implementation = proto.Clone(selected.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	}
	for _, binding := range selected.ExactBindings {
		result.ModelAxes = append(result.ModelAxes, &runtimev1.LoadoutEffectiveModelAxisIdentity{
			SlotId: strings.TrimSpace(binding.RequirementID), ModelAssetId: strings.TrimSpace(binding.ModelAssetID), ContentId: strings.TrimSpace(binding.VerifiedContentID),
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
		RecipeId:       strings.TrimSpace(assembly.RecipeID),
		RecipeRevision: strings.TrimSpace(assembly.RecipeRevision),
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
		RecipeRevision: strings.TrimSpace(selected.RecipeRevision), SupportedFeatures: append([]string(nil), selected.SupportedFeatures...),
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
	for _, binding := range selected.ExactBindings {
		assembly.ModelAxes = append(assembly.ModelAxes, localResolvedAssemblyModelAxis{
			RequirementID: strings.TrimSpace(binding.RequirementID), RequirementRole: binding.RequirementRole,
			OccurrenceOrdinal: binding.OccurrenceOrdinal, DisplayLabel: strings.TrimSpace(binding.DisplayLabel),
			ModelAssetID: strings.TrimSpace(binding.ModelAssetID), AbsolutePath: strings.TrimSpace(binding.AbsolutePath),
			BundleDir: strings.TrimSpace(binding.BundleDir), DeclaredFiles: append([]string(nil), binding.DeclaredFiles...),
			VerifiedContentID: strings.TrimSpace(binding.VerifiedContentID), EntrySHA256: strings.TrimSpace(binding.EntrySHA256),
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
		RequestPath: plan.RequestPath(), RequestBody: plan.RequestBody(), Stream: plan.Stream(), ContextWindowTokens: plan.ContextWindowTokens(),
	}}
	assembly.ProcessIdentity.ProcessKey = plan.ProcessKey()
	assembly.ProcessIdentity.ProcessArgs = plan.ProcessArgs()
	return assembly, nil
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

func localResolvedAssemblyForSpeech(selected *localexecution.SelectedLocalExecution, synthesize *capabilitydriver.SpeechSynthesizeInvocationPlan, transcribe *capabilitydriver.SpeechTranscribeInvocationPlan) (*localResolvedAssembly, error) {
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
	case transcribe != nil:
		request = transcribe.Request()
		plan.Operation = "transcribe"
		plan.DriverID = transcribe.DriverID()
		plan.ModelAssetID = transcribe.ModelAssetID()
		plan.ModelFiles = resolvedAssemblyInvocationBindings(transcribe.ModelFiles())
		binaryInput = transcribe.AudioBytes()
		mimeType = transcribe.MIMEType()
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
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "speech", Speech: &localResolvedAssemblySpeechPlan{
		Operation: "voice.create", DriverID: plan.DriverID(), ModelAssetID: plan.ModelAssetID(),
		ModelFiles: resolvedAssemblyInvocationBindings(plan.ModelFiles()),
	}}
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
	case capabilitydriver.StableDiffusionCPPImageToImageRequestPlan:
		imagePlan.Request.Kind = "image-to-image"
		imagePlan.Request.InputImage = typed.InputImage()
		imagePlan.Request.Mask = typed.Mask()
	case capabilitydriver.StableDiffusionCPPInstructionEditRequestPlan:
		imagePlan.Request.Kind = "instruction-edit"
		source := typed.SourceImage()
		imagePlan.Request.SourceIdentity = source.SourceIdentity
		imagePlan.Request.SourceImage = source.ImageBytes
	default:
		return nil, fmt.Errorf("unsupported image ResolvedAssembly request plan %T", requestPlan)
	}
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
		})
	}
	return bindings
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
		SupportedFeatures: append([]string(nil), assembly.SupportedFeatures...),
		Configured:        true,
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
		})
	}
	return selected
}

func validateRehydratedResolvedAssemblyPlan(captured, reprojected *localResolvedAssembly) error {
	if captured == nil || reprojected == nil ||
		!reflect.DeepEqual(captured.Request, reprojected.Request) ||
		!reflect.DeepEqual(captured.LoadPlan, reprojected.LoadPlan) ||
		!reflect.DeepEqual(captured.ProcessIdentity, reprojected.ProcessIdentity) {
		return fmt.Errorf("rehydrated local ResolvedAssembly request, load, or process plan differs from the captured contract")
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
	if len(assembly.ModelAxes) == 0 {
		return fmt.Errorf("local ResolvedAssembly model axes are empty")
	}
	for index, axis := range assembly.ModelAxes {
		modelAssetID := strings.TrimSpace(axis.ModelAssetID)
		if strings.TrimSpace(axis.RequirementID) == "" || modelAssetID == "" || strings.TrimSpace(axis.AbsolutePath) == "" || strings.TrimSpace(axis.VerifiedContentID) == "" || strings.TrimSpace(axis.EntrySHA256) == "" {
			return fmt.Errorf("local ResolvedAssembly model axis %d is incomplete", index)
		}
	}
	if strings.TrimSpace(assembly.Request.Kind) == "" || !json.Valid(assembly.Request.Payload) {
		return fmt.Errorf("local ResolvedAssembly request is invalid")
	}
	switch assembly.LoadPlan.Kind {
	case "text":
		if assembly.LoadPlan.Text == nil || strings.TrimSpace(assembly.LoadPlan.Text.ProcessKey) == "" {
			return fmt.Errorf("local ResolvedAssembly text load plan is incomplete")
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
	case "image":
		if assembly.LoadPlan.Image == nil || strings.TrimSpace(assembly.LoadPlan.Image.ProcessKey) == "" || strings.TrimSpace(assembly.LoadPlan.Image.Request.Kind) == "" {
			return fmt.Errorf("local ResolvedAssembly image load plan is incomplete")
		}
	case "video":
		if assembly.LoadPlan.Video == nil || strings.TrimSpace(assembly.LoadPlan.Video.ProcessKey) == "" {
			return fmt.Errorf("local ResolvedAssembly video load plan is incomplete")
		}
	default:
		return fmt.Errorf("local ResolvedAssembly load plan kind %q is unsupported", assembly.LoadPlan.Kind)
	}
	return nil
}

func cloneLocalResolvedAssembly(input *localResolvedAssembly) (*localResolvedAssembly, error) {
	if input == nil {
		return nil, nil
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	var cloned localResolvedAssembly
	if err := decodeScenarioJobStrictJSON(raw, &cloned); err != nil {
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
