// Package capabilitydriver interprets exact capability implementation
// dialects. Local Drivers project and validate verified asset bindings; Cloud
// Drivers separate target/config validation, request mapping, response/stream
// normalization, and reason normalization. Drivers have no route,
// execution-host, fallback, or live-registration ownership.
package capabilitydriver

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	// MaxAssetFormatProbeBytes bounds the verified exact-entry prefix exposed to
	// Drivers for format and tensor-name admission.
	MaxAssetFormatProbeBytes = 4 << 20
	// MaxSafetensorsHeaderBytes leaves room for the fixed eight-byte header
	// length inside one bounded ModelAsset format probe.
	MaxSafetensorsHeaderBytes = MaxAssetFormatProbeBytes - 8

	LlamaImplementationID      = "local.text.generate.llama-cpp"
	LlamaDriverID              = "nimi.runtime.driver.llama-cpp"
	LlamaDriverDialect         = "llama.cpp/text-generate/v1"
	LlamaEmbedImplementationID = "local.text.embed.llama-cpp"
	LlamaEmbedDriverDialect    = "llama.cpp/text-embed/v1"
	LlamaCapabilityContract    = "text.generate"

	LlamaGemma4E2BRecipeID = "llama.text-generate.gemma-4-e2b-it.v1"
	LlamaGemma426BRecipeID = "llama.text-generate.gemma-4-26b-a4b-it.v1"
	LlamaEmbedGGUFRecipeID = "llama.text-embed.gguf.v1"

	MainGGUFRequirementID        = "main.gguf"
	CompanionMMProjRequirementID = "companion.mmproj"
	EmbeddingGGUFRequirementID   = "embedding.gguf"
)

// Identity is the complete implementation vocabulary key. Partial identity
// matching is deliberately unsupported.
type Identity struct {
	ImplementationID string
	DriverID         string
	DriverDialect    string
}

func IdentityFromProto(value *runtimev1.CapabilityImplementationIdentity) Identity {
	if value == nil {
		return Identity{}
	}
	return Identity{
		ImplementationID: value.GetImplementationId(),
		DriverID:         value.GetDriverId(),
		DriverDialect:    value.GetDriverDialect(),
	}
}

func (identity Identity) Proto() *runtimev1.CapabilityImplementationIdentity {
	return &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: identity.ImplementationID,
		DriverId:         identity.DriverID,
		DriverDialect:    identity.DriverDialect,
	}
}

// ModelAssetDescriptor is restricted to finite facts verified by ModelAsset.
// It carries no path, filename, runtime, cache, or process information.
type ModelAssetDescriptor struct {
	ModelAssetID      string
	VerifiedContentID string
	EntrySHA256       string
	Kind              runtimev1.LocalAssetKind
	Family            string
	Engine            string
	ArtifactRoles     []string
	// FormatProbe is a bounded prefix (at most MaxAssetFormatProbeBytes) read
	// from the verified exact entry. It is used only by Drivers whose dialect
	// requires magic/header validation.
	FormatProbe []byte
}

// ModelAssetFileFact is one path-safe, content-verified file exposed while a
// Driver projects an exact ModelAsset binding. FormatProbe is a bounded prefix
// of that same verified file; Drivers cannot reopen paths or discover files.
type ModelAssetFileFact struct {
	RelativePath string
	SizeBytes    int64
	FormatProbe  []byte
}

// ModelAssetBindingInput contains only ModelAsset-owned facts plus the exact
// recipe slot and binding being admitted. It has no mutable selection, route,
// process, endpoint, or host state.
type ModelAssetBindingInput struct {
	RecipeID    string
	Requirement *runtimev1.LocalCapabilityRequirement
	Binding     *runtimev1.ModelAssetExactBinding
	Entry       ModelAssetFileFact
	Files       []ModelAssetFileFact
}

// ModelAssetBindingProjection is the Driver-owned interpretation of verified
// ModelAsset facts. ModelContextWindowTokens is populated only by dialects
// whose execution contract consumes model-authored context metadata.
type ModelAssetBindingProjection struct {
	Descriptor               ModelAssetDescriptor
	ModelContextWindowTokens uint64
}

func validatedModelAssetBindingProjection(
	input ModelAssetBindingInput,
	descriptor ModelAssetDescriptor,
	contextWindow uint64,
	validate func(*runtimev1.LocalCapabilityRequirement, *runtimev1.ModelAssetExactBinding, ModelAssetDescriptor) runtimev1.LocalCapabilityReason,
) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	descriptor.ModelAssetID = input.Binding.GetModelAssetId()
	descriptor.VerifiedContentID = input.Binding.GetVerifiedContentId()
	descriptor.EntrySHA256 = input.Binding.GetEntrySha256()
	descriptor.ArtifactRoles = append([]string(nil), descriptor.ArtifactRoles...)
	descriptor.FormatProbe = append([]byte(nil), descriptor.FormatProbe...)
	if reason := validate(input.Requirement, input.Binding, descriptor); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return ModelAssetBindingProjection{}, reason
	}
	return ModelAssetBindingProjection{Descriptor: descriptor, ModelContextWindowTokens: contextWindow}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func modelAssetFileFact(input ModelAssetBindingInput, relativePath string) (ModelAssetFileFact, bool) {
	for _, file := range input.Files {
		if file.RelativePath == relativePath && file.SizeBytes > 0 {
			file.FormatProbe = append([]byte(nil), file.FormatProbe...)
			return file, true
		}
	}
	return ModelAssetFileFact{}, false
}

type safetensorsTensorFact struct {
	DType       string  `json:"dtype"`
	Shape       []int64 `json:"shape"`
	DataOffsets []int64 `json:"data_offsets"`
}

func safetensorsTensorFacts(probe []byte) (map[string]safetensorsTensorFact, bool) {
	if len(probe) < 10 || len(probe) > MaxAssetFormatProbeBytes {
		return nil, false
	}
	headerLength := binary.LittleEndian.Uint64(probe[:8])
	if headerLength < 2 || headerLength > MaxSafetensorsHeaderBytes || headerLength > uint64(len(probe)-8) {
		return nil, false
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(probe[8:8+headerLength], &raw) != nil || len(raw) == 0 {
		return nil, false
	}
	tensors := make(map[string]safetensorsTensorFact, len(raw))
	for name, payload := range raw {
		if name == "__metadata__" {
			continue
		}
		if strings.TrimSpace(name) == "" {
			return nil, false
		}
		var tensor safetensorsTensorFact
		if json.Unmarshal(payload, &tensor) != nil || strings.TrimSpace(tensor.DType) == "" || tensor.Shape == nil ||
			len(tensor.DataOffsets) != 2 || tensor.DataOffsets[0] < 0 || tensor.DataOffsets[1] < tensor.DataOffsets[0] {
			return nil, false
		}
		tensors[name] = tensor
	}
	return tensors, len(tensors) > 0
}

func int64SlicesEqual(left, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

// InterpretInput is the portable resource intent interpreted by a driver.
// It deliberately excludes the larger stored configuration and all execution
// or host fields.
type InterpretInput struct {
	RecipeID          string
	PortableConfig    *structpb.Struct
	SupportedFeatures []string
}

// Driver is the complete production driver contract. Registry identity is
// owned by Registry rather than by this interface.
type Driver interface {
	Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason)
	// ProjectModelAssetBinding interprets verified file facts and validates the
	// resulting descriptor against the exact slot and binding. Generic services
	// must not reproduce recipe- or format-specific admission rules.
	ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason)
	ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason
	ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason
	// EffectiveRequestDefaults projects read-only display values for request
	// parameters the exact Driver will apply when the App intent leaves them
	// unset. Keys use the canonical AIConfig defaults paths.
	EffectiveRequestDefaults(recipeID string, portableConfig *structpb.Struct) map[string]string
}

// RecipeDriver owns the stable recipeId-to-slot and fixed execution semantics
// for one exact Driver dialect. Catalog metadata can decorate these slots but
// cannot create, remove, rename, or reorder them.
type RecipeDriver interface {
	Driver
	ProjectRecipe(recipeID string, options *structpb.Struct, supportedFeatures []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason)
}

// HostPlatformRecipeDriver is implemented only when one public recipe has
// multiple current Host-specific execution contracts. The Driver owns both
// Host-to-backend selection and every resulting slot rule; callers supply only
// the current normalized GOOS/GOARCH tuple.
type HostPlatformRecipeDriver interface {
	RecipeDriver
	ProjectRecipeForHost(recipeID string, options *structpb.Struct, supportedFeatures []string, platformTuple string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason)
}

// InvocationExactBinding is the immutable, already-verified occurrence passed
// to a Driver at job submission. Drivers receive exact absolute paths plus any
// captured ModelAsset bundle manifest; they never discover files or resolve
// bindings from a host model directory.
type InvocationExactBinding struct {
	RequirementID     string
	ModelAssetID      string
	AbsolutePath      string
	BundleDir         string
	DeclaredFiles     []string
	VerifiedContentID string
	EntrySHA256       string
}

// TextInvocationInput is the complete Driver-owned text invocation input. It
// deliberately contains no binary, port, endpoint, resident-process, route,
// model-selector, or fallback facts.
func cloneInvocationExactBindings(values []InvocationExactBinding) []InvocationExactBinding {
	cloned := append([]InvocationExactBinding(nil), values...)
	for index := range cloned {
		cloned[index].DeclaredFiles = append([]string(nil), cloned[index].DeclaredFiles...)
	}
	return cloned
}

func invocationExactBindingIdentity(binding InvocationExactBinding) []string {
	identity := []string{
		binding.RequirementID,
		binding.ModelAssetID,
		binding.AbsolutePath,
		binding.BundleDir,
		binding.VerifiedContentID,
		binding.EntrySHA256,
	}
	return append(identity, binding.DeclaredFiles...)
}

type TextInvocationInput struct {
	PortableConfig           *structpb.Struct
	ModelContextWindowTokens uint64
	ExactBindings            []InvocationExactBinding
	Request                  *runtimev1.TextGenerateScenarioSpec
	Stream                   bool
}

// EmbedInvocationInput is the complete Driver-owned embedding invocation
// input. It contains only the selected portable configuration, immutable exact
// bindings, model-authored capacity, and the normalized request.
type EmbedInvocationInput struct {
	PortableConfig           *structpb.Struct
	ModelContextWindowTokens uint64
	ExactBindings            []InvocationExactBinding
	Request                  *runtimev1.TextEmbedScenarioSpec
}

// ImageResolvedInput is one already-authorized, immutable image input captured
// by the service owner. Drivers never parse a URL or open an input path.
type ImageResolvedInput struct {
	SourceIdentity string
	ImageBytes     []byte
}

// ImageInvocationInput is the complete Driver-owned image invocation input.
// Host selection, endpoints, binaries, routes, and fallback never enter it.
type ImageInvocationInput struct {
	RecipeID          string
	PortableConfig    *structpb.Struct
	SupportedFeatures []string
	ExactBindings     []InvocationExactBinding
	Request           *runtimev1.ImageGenerateScenarioSpec
	Inputs            []ImageResolvedInput
}

// AudioCppRuntimePackageInput is the capability-neutral selected-source pair
// captured before Job publication. Exact Drivers freeze it into their own
// immutable capability plans; it carries no model, request, or route facts.
type AudioCppRuntimePackageInput struct {
	AudioCppPackageID              string
	AudioCppSelectedSourceRecordID string
	AudioCppRoot                   string
	AudioCppExecutablePath         string
	CUDA13DependencyID             string
	CUDA13SelectedSourceRecordID   string
	CUDA13Root                     string
}

type MusicRuntimePackageInput = AudioCppRuntimePackageInput

type MusicInvocationInput struct {
	LoadoutID      string
	RecipeID       string
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Package        MusicRuntimePackageInput
	Request        *runtimev1.MusicGenerateScenarioSpec
	Extensions     []*runtimev1.ScenarioExtension
	StagingWAVPath string
}

// VideoInputRole classifies already-resolved media handles. The Driver never
// parses a URL or opens an input path.
type VideoInputRole string

const (
	VideoInputRoleReferenceImage VideoInputRole = "reference-image"
	VideoInputRoleFirstFrame     VideoInputRole = "first-frame"
	VideoInputRoleLastFrame      VideoInputRole = "last-frame"
	VideoInputRoleReferenceVideo VideoInputRole = "reference-video"
	VideoInputRoleReferenceAudio VideoInputRole = "reference-audio"
)

// VideoResolvedInput is one ordered request input captured by the service
// owner. ImageBytes is populated only for an image role.
type VideoResolvedInput struct {
	Role           VideoInputRole
	SourceIdentity string
	ImageBytes     []byte
}

// VideoInvocationRequest is the resolved, URL-free video request presented to
// a Driver before execution dispatch.
type VideoInvocationRequest struct {
	Prompt          string
	NegativePrompt  string
	Width           int
	Height          int
	Ratio           string
	DurationSec     int
	FrameCount      int
	FPS             int
	Seed            int64
	GenerateAudio   bool
	ReturnLastFrame bool
	Inputs          []VideoResolvedInput
}

// VideoInvocationInput is the complete Driver-owned video invocation input.
// LoadoutID and every binding identity have already been selected and
// verified by the machine-configuration owner.
type VideoInvocationInput struct {
	LoadoutID      string
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Request        VideoInvocationRequest
}

// InvocationFailureKind classifies failures while a Driver is forming a plan.
type InvocationFailureKind string

const (
	InvocationFailureInvalidConfig  InvocationFailureKind = "invalid_config"
	InvocationFailureInvalidBinding InvocationFailureKind = "invalid_binding"
	InvocationFailureInvalidRequest InvocationFailureKind = "invalid_request"
	InvocationFailureInvalidOption  InvocationFailureKind = "invalid_option"
	InvocationFailureUnsupported    InvocationFailureKind = "unsupported"
)

// InvocationError is returned before any host process or HTTP operation.
type InvocationError struct {
	Kind InvocationFailureKind
	Err  error
}

func (e *InvocationError) Error() string {
	if e == nil || e.Err == nil {
		return "capability invocation failed"
	}
	return e.Err.Error()
}

func (e *InvocationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// TextInvocationPlan is a Driver-private semantic plan flattened into opaque
// substrate instructions. Accessors return copies so captured job inputs
// cannot be changed after submission. The ExecutionHost only supplements host,
// port, and binary facts and executes these instructions.
type TextInvocationPlan struct {
	processKey    string
	processArgs   []string
	modelFiles    []InvocationExactBinding
	requestPath   string
	requestBody   []byte
	stream        bool
	contextWindow uint64
}

// EmbedInvocationPlan is the immutable llama embedding substrate plan. The
// ExecutionHost adds only process, endpoint, and transport facts.
type EmbedInvocationPlan struct {
	processKey    string
	processArgs   []string
	modelFiles    []InvocationExactBinding
	requestPath   string
	requestBody   []byte
	expectedCount int
}

func (p *EmbedInvocationPlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}

func (p *EmbedInvocationPlan) ProcessArgs() []string {
	if p == nil {
		return nil
	}
	return append([]string(nil), p.processArgs...)
}

func (p *EmbedInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneInvocationExactBindings(p.modelFiles)
}

func (p *EmbedInvocationPlan) RequestPath() string {
	if p == nil {
		return ""
	}
	return p.requestPath
}

func (p *EmbedInvocationPlan) RequestBody() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.requestBody...)
}

func (p *EmbedInvocationPlan) ExpectedCount() int {
	if p == nil {
		return 0
	}
	return p.expectedCount
}

func (p *TextInvocationPlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}

func (p *TextInvocationPlan) ProcessArgs() []string {
	if p == nil {
		return nil
	}
	return append([]string(nil), p.processArgs...)
}

// ModelFiles returns the exact captured content identities that must be
// revalidated immediately before a new process loads them. A resident process
// reused for the same ProcessKey does not reopen or revalidate these paths.
func (p *TextInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneInvocationExactBindings(p.modelFiles)
}

func (p *TextInvocationPlan) RequestPath() string {
	if p == nil {
		return ""
	}
	return p.requestPath
}

func (p *TextInvocationPlan) RequestBody() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.requestBody...)
}

func (p *TextInvocationPlan) Stream() bool {
	return p != nil && p.stream
}

func (p *TextInvocationPlan) ContextWindowTokens() uint64 {
	if p == nil {
		return 0
	}
	return p.contextWindow
}

// TextInvocationDriver is the invocation seam implemented by a text Driver.
// Configuration projection and invocation remain one exact Driver identity,
// while Registry continues to admit non-text Drivers through Driver.
type TextInvocationDriver interface {
	Driver
	PlanTextInvocation(input TextInvocationInput) (*TextInvocationPlan, error)
	TextContextWindow(portableConfig *structpb.Struct, modelContextWindowTokens uint64) (uint64, error)
}

// EmbedInvocationDriver is the invocation seam implemented by the exact local
// text.embed Driver identity.
type EmbedInvocationDriver interface {
	Driver
	PlanEmbedInvocation(input EmbedInvocationInput) (*EmbedInvocationPlan, error)
}

// ImageModelFile is the content-custody reference carried across the
// Driver/Host seam. Requirement identity has already been consumed by the
// exact Driver and deliberately does not cross this boundary.
type ImageModelFile struct {
	modelAssetID      string
	absolutePath      string
	verifiedContentID string
	entrySHA256       string
}

func (f ImageModelFile) ModelAssetID() string      { return f.modelAssetID }
func (f ImageModelFile) AbsolutePath() string      { return f.absolutePath }
func (f ImageModelFile) VerifiedContentID() string { return f.verifiedContentID }
func (f ImageModelFile) EntrySHA256() string       { return f.entrySHA256 }

// ImageLoadPlan is a closed implementation-dialect load variant. The private
// marker prevents Host or another package from inventing variants.
type ImageLoadPlan interface {
	imageLoadPlanVariant()
}

// StableDiffusionCPPLoadPlan contains only named stable-diffusion.cpp load
// decisions. Backend slots and raw options are physical-adapter vocabulary.
type StableDiffusionCPPLoadPlan struct {
	recipeID                string
	main                    ImageModelFile
	textEncoder             ImageModelFile
	vae                     ImageModelFile
	uncondDiffusion         *ImageModelFile
	flowShift               float64
	qwenImageZeroCondT      bool
	threads                 int
	cfgScale                float64
	sampler                 string
	scheduler               string
	diffusionFlashAttention bool
	offloadParamsToCPU      bool
}

func (StableDiffusionCPPLoadPlan) imageLoadPlanVariant()         {}
func (p StableDiffusionCPPLoadPlan) RecipeID() string            { return p.recipeID }
func (p StableDiffusionCPPLoadPlan) Main() ImageModelFile        { return p.main }
func (p StableDiffusionCPPLoadPlan) TextEncoder() ImageModelFile { return p.textEncoder }
func (p StableDiffusionCPPLoadPlan) VAE() ImageModelFile         { return p.vae }
func (p StableDiffusionCPPLoadPlan) UncondDiffusion() (ImageModelFile, bool) {
	if p.uncondDiffusion == nil {
		return ImageModelFile{}, false
	}
	return *p.uncondDiffusion, true
}
func (p StableDiffusionCPPLoadPlan) Threads() int             { return p.threads }
func (p StableDiffusionCPPLoadPlan) CFGScale() float64        { return p.cfgScale }
func (p StableDiffusionCPPLoadPlan) Sampler() string          { return p.sampler }
func (p StableDiffusionCPPLoadPlan) Scheduler() string        { return p.scheduler }
func (p StableDiffusionCPPLoadPlan) FlowShift() float64       { return p.flowShift }
func (p StableDiffusionCPPLoadPlan) QwenImageZeroCondT() bool { return p.qwenImageZeroCondT }
func (p StableDiffusionCPPLoadPlan) DiffusionFlashAttention() bool {
	return p.diffusionFlashAttention
}
func (p StableDiffusionCPPLoadPlan) OffloadParamsToCPU() bool { return p.offloadParamsToCPU }

// ImageRequestPlan is a closed request-route variant. Input and mask are
// typed fields rather than string-encoded enable parameters.
type ImageRequestPlan interface {
	imageRequestPlanVariant()
	Prompt() string
	NegativePrompt() string
	Width() int
	Height() int
	Steps() int
	CFGScale() float64
	Seed() int64
	ImageCount() int
	Sampler() string
	Scheduler() string
}

type stableDiffusionCPPRequestFields struct {
	prompt         string
	negativePrompt string
	width          int
	height         int
	steps          int
	cfgScale       float64
	seed           int64
	imageCount     int
	sampler        string
	scheduler      string
}

func (p stableDiffusionCPPRequestFields) Prompt() string         { return p.prompt }
func (p stableDiffusionCPPRequestFields) NegativePrompt() string { return p.negativePrompt }
func (p stableDiffusionCPPRequestFields) Width() int             { return p.width }
func (p stableDiffusionCPPRequestFields) Height() int            { return p.height }
func (p stableDiffusionCPPRequestFields) Steps() int             { return p.steps }
func (p stableDiffusionCPPRequestFields) CFGScale() float64      { return p.cfgScale }
func (p stableDiffusionCPPRequestFields) Seed() int64            { return p.seed }
func (p stableDiffusionCPPRequestFields) ImageCount() int        { return p.imageCount }
func (p stableDiffusionCPPRequestFields) Sampler() string        { return p.sampler }
func (p stableDiffusionCPPRequestFields) Scheduler() string      { return p.scheduler }

type StableDiffusionCPPTextToImageRequestPlan struct {
	stableDiffusionCPPRequestFields
}

func (StableDiffusionCPPTextToImageRequestPlan) imageRequestPlanVariant() {}

type StableDiffusionCPPInstructionEditRequestPlan struct {
	stableDiffusionCPPRequestFields
	sourceImage ImageResolvedInput
}

func (StableDiffusionCPPInstructionEditRequestPlan) imageRequestPlanVariant() {}
func (p StableDiffusionCPPInstructionEditRequestPlan) SourceImage() ImageResolvedInput {
	result := p.sourceImage
	result.ImageBytes = append([]byte(nil), p.sourceImage.ImageBytes...)
	return result
}

// ImageResultConstraints is a closed Driver-owned result contract.
type ImageResultConstraints interface {
	imageResultConstraintsVariant()
	ArtifactCount() int
}

type StableDiffusionCPPResultConstraints struct {
	artifactCount int
	mediaType     string
	format        string
	width         int
	height        int
}

func (StableDiffusionCPPResultConstraints) imageResultConstraintsVariant() {}
func (p StableDiffusionCPPResultConstraints) ArtifactCount() int           { return p.artifactCount }
func (p StableDiffusionCPPResultConstraints) MediaType() string            { return p.mediaType }
func (p StableDiffusionCPPResultConstraints) Format() string               { return p.format }
func (p StableDiffusionCPPResultConstraints) Width() int                   { return p.width }
func (p StableDiffusionCPPResultConstraints) Height() int                  { return p.height }

type ImageBackendProgressObservation struct {
	CurrentStep     int32
	TotalSteps      int32
	ProgressPercent int32
}

type ImageProgress struct {
	CurrentStep     int32
	TotalSteps      int32
	ProgressPercent int32
}

type ImageBackendArtifactObservation struct {
	Index   int32
	Payload []byte
	Format  string
	Width   int
	Height  int
}

type ImageArtifact struct {
	Index     int32
	Payload   []byte
	MediaType string
}

type ImageBackendFailureStage string

const (
	ImageBackendFailureLoad     ImageBackendFailureStage = "load"
	ImageBackendFailureProgress ImageBackendFailureStage = "progress"
	ImageBackendFailureGenerate ImageBackendFailureStage = "generate"
	ImageBackendFailureResult   ImageBackendFailureStage = "result"
)

type imageDialectTranslator interface {
	validateImagePlan(*ImageInvocationPlan) error
	translateImageProgress(*ImageInvocationPlan, ImageBackendProgressObservation) (ImageProgress, error)
	translateImageArtifact(*ImageInvocationPlan, ImageBackendArtifactObservation) (ImageArtifact, error)
	translateImageFailure(ImageBackendFailureStage, error) error
}

// ImageInvocationPlan is the immutable closed Driver/Host seam.
type ImageInvocationPlan struct {
	processKey        string
	modelFiles        []InvocationExactBinding
	loadPlan          ImageLoadPlan
	requestPlan       ImageRequestPlan
	resultConstraints ImageResultConstraints
	translator        imageDialectTranslator
}

func (p *ImageInvocationPlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}

func (p *ImageInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneInvocationExactBindings(p.modelFiles)
}

func (p *ImageInvocationPlan) LoadPlan() ImageLoadPlan {
	if p == nil {
		return nil
	}
	return p.loadPlan
}

func (p *ImageInvocationPlan) RequestPlan() ImageRequestPlan {
	if p == nil {
		return nil
	}
	return p.requestPlan
}

func (p *ImageInvocationPlan) ResultConstraints() ImageResultConstraints {
	if p == nil {
		return nil
	}
	return p.resultConstraints
}

func (p *ImageInvocationPlan) ImageCount() int {
	if p == nil || p.requestPlan == nil {
		return 0
	}
	return p.requestPlan.ImageCount()
}

func (p *ImageInvocationPlan) Validate() error {
	if p == nil || p.translator == nil {
		return fmt.Errorf("image invocation plan is incomplete")
	}
	return p.translator.validateImagePlan(p)
}

func (p *ImageInvocationPlan) TranslateProgress(observation ImageBackendProgressObservation) (ImageProgress, error) {
	if p == nil || p.translator == nil {
		return ImageProgress{}, fmt.Errorf("image invocation translator is unavailable")
	}
	return p.translator.translateImageProgress(p, observation)
}

func (p *ImageInvocationPlan) TranslateArtifact(observation ImageBackendArtifactObservation) (ImageArtifact, error) {
	if p == nil || p.translator == nil {
		return ImageArtifact{}, fmt.Errorf("image invocation translator is unavailable")
	}
	observation.Payload = append([]byte(nil), observation.Payload...)
	return p.translator.translateImageArtifact(p, observation)
}

func (p *ImageInvocationPlan) TranslateFailure(stage ImageBackendFailureStage, err error) error {
	if p == nil || p.translator == nil {
		return fmt.Errorf("image invocation translator is unavailable: %w", err)
	}
	return p.translator.translateImageFailure(stage, err)
}

// ImageInvocationDriver is the invocation seam implemented by an image
// Driver. The resulting plan contains the exact dialect translator used by the
// Host after physical execution.
type ImageInvocationDriver interface {
	Driver
	PlanImageInvocation(input ImageInvocationInput) (*ImageInvocationPlan, error)
}

// MusicInvocationPlan is the immutable closed MiniMax-Music3 Driver/Host seam.
type MusicInvocationPlan struct {
	processKey                     string
	loadoutID                      string
	recipeID                       string
	driverIdentity                 Identity
	modelBinding                   InvocationExactBinding
	modelRoot                      string
	languageModelPath              string
	rvqDepthDecoderPath            string
	flowTransformerPath            string
	audioCppPackageID              string
	audioCppSelectedSourceRecordID string
	audioCppRoot                   string
	audioCppExecutablePath         string
	cuda13DependencyID             string
	cuda13SelectedSourceRecordID   string
	cuda13Root                     string
	prompt                         string
	lyrics                         string
	durationBudgetSeconds          int
	numInferenceSteps              int
	guidanceScale                  float64
	arGuidanceScale                float64
	topK                           int
	seed                           uint64
	memorySaver                    bool
	stagingWAVPath                 string
	expectedSampleRate             int
	expectedChannels               int
	expectedBitsPerSample          int
}

func (p *MusicInvocationPlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}
func (p *MusicInvocationPlan) LoadoutID() string {
	if p == nil {
		return ""
	}
	return p.loadoutID
}
func (p *MusicInvocationPlan) RecipeID() string {
	if p == nil {
		return ""
	}
	return p.recipeID
}
func (p *MusicInvocationPlan) DriverIdentity() Identity {
	if p == nil {
		return Identity{}
	}
	return p.driverIdentity
}
func (p *MusicInvocationPlan) ModelBinding() InvocationExactBinding {
	if p == nil {
		return InvocationExactBinding{}
	}
	return cloneInvocationExactBindings([]InvocationExactBinding{p.modelBinding})[0]
}
func (p *MusicInvocationPlan) ModelRoot() string {
	if p == nil {
		return ""
	}
	return p.modelRoot
}
func (p *MusicInvocationPlan) LanguageModelPath() string {
	if p == nil {
		return ""
	}
	return p.languageModelPath
}
func (p *MusicInvocationPlan) RVQDepthDecoderPath() string {
	if p == nil {
		return ""
	}
	return p.rvqDepthDecoderPath
}
func (p *MusicInvocationPlan) FlowTransformerPath() string {
	if p == nil {
		return ""
	}
	return p.flowTransformerPath
}
func (p *MusicInvocationPlan) AudioCppPackageID() string {
	if p == nil {
		return ""
	}
	return p.audioCppPackageID
}
func (p *MusicInvocationPlan) AudioCppSelectedSourceRecordID() string {
	if p == nil {
		return ""
	}
	return p.audioCppSelectedSourceRecordID
}
func (p *MusicInvocationPlan) AudioCppRoot() string {
	if p == nil {
		return ""
	}
	return p.audioCppRoot
}
func (p *MusicInvocationPlan) AudioCppExecutablePath() string {
	if p == nil {
		return ""
	}
	return p.audioCppExecutablePath
}
func (p *MusicInvocationPlan) CUDA13DependencyID() string {
	if p == nil {
		return ""
	}
	return p.cuda13DependencyID
}
func (p *MusicInvocationPlan) CUDA13SelectedSourceRecordID() string {
	if p == nil {
		return ""
	}
	return p.cuda13SelectedSourceRecordID
}
func (p *MusicInvocationPlan) CUDA13Root() string {
	if p == nil {
		return ""
	}
	return p.cuda13Root
}
func (p *MusicInvocationPlan) Prompt() string {
	if p == nil {
		return ""
	}
	return p.prompt
}
func (p *MusicInvocationPlan) Lyrics() string {
	if p == nil {
		return ""
	}
	return p.lyrics
}
func (p *MusicInvocationPlan) DurationBudgetSeconds() int {
	if p == nil {
		return 0
	}
	return p.durationBudgetSeconds
}
func (p *MusicInvocationPlan) NumInferenceSteps() int {
	if p == nil {
		return 0
	}
	return p.numInferenceSteps
}
func (p *MusicInvocationPlan) GuidanceScale() float64 {
	if p == nil {
		return 0
	}
	return p.guidanceScale
}
func (p *MusicInvocationPlan) ARGuidanceScale() float64 {
	if p == nil {
		return 0
	}
	return p.arGuidanceScale
}
func (p *MusicInvocationPlan) TopK() int {
	if p == nil {
		return 0
	}
	return p.topK
}
func (p *MusicInvocationPlan) Seed() uint64 {
	if p == nil {
		return 0
	}
	return p.seed
}
func (p *MusicInvocationPlan) MemorySaver() bool { return p != nil && p.memorySaver }
func (p *MusicInvocationPlan) StagingWAVPath() string {
	if p == nil {
		return ""
	}
	return p.stagingWAVPath
}
func (p *MusicInvocationPlan) ExpectedWAVFormat() (int, int, int) {
	if p == nil {
		return 0, 0, 0
	}
	return p.expectedSampleRate, p.expectedChannels, p.expectedBitsPerSample
}

type MusicInvocationDriver interface {
	Driver
	PlanMusicInvocation(MusicInvocationInput) (*MusicInvocationPlan, error)
}

// VideoConditioningMode is the exact stable-diffusion.cpp H3 route selected at
// admission. No execution-time fallback is permitted.
type VideoConditioningMode string

const (
	VideoConditioningModeFL2VAT2VA   VideoConditioningMode = "fl2va-t2va"
	VideoConditioningModeRef2VAImage VideoConditioningMode = "ref2va-image"
)

// VideoInvocationPlan is private to the video Driver/Host seam. Its fields are
// immutable after construction and accessors return copies where needed.
type VideoInvocationPlan struct {
	processKey              string
	loadoutID               string
	driverIdentity          Identity
	portableConfig          *structpb.Struct
	exactBindings           []InvocationExactBinding
	modelFiles              []InvocationExactBinding
	diffusionModelPath      string
	encoderPath             string
	videoVAEPath            string
	audioVAEPath            string
	prompt                  string
	negativePrompt          string
	width                   int
	height                  int
	frameCount              int
	fps                     int
	seed                    int64
	audioRequired           bool
	returnLastFrame         bool
	conditioningMode        VideoConditioningMode
	referenceImage          *VideoResolvedInput
	cfgScale                float64
	flowShift               float64
	sampleMethod            string
	scheduler               string
	diffusionFlashAttention bool
	offloadToCPU            bool
	rng                     string
}

func (p *VideoInvocationPlan) ProcessKey() string {
	if p == nil {
		return ""
	}
	return p.processKey
}

func (p *VideoInvocationPlan) LoadoutID() string {
	if p == nil {
		return ""
	}
	return p.loadoutID
}

func (p *VideoInvocationPlan) DriverIdentity() Identity {
	if p == nil {
		return Identity{}
	}
	return p.driverIdentity
}

func (p *VideoInvocationPlan) PortableConfig() *structpb.Struct {
	if p == nil {
		return nil
	}
	return cloneStruct(p.portableConfig)
}

// ExactBindings returns all five configuration-level H3 slots in canonical
// order, including the diffusion transformer not used by this invocation.
func (p *VideoInvocationPlan) ExactBindings() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneInvocationExactBindings(p.exactBindings)
}

// ModelFiles returns only the four slots actually loaded for this route.
func (p *VideoInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneInvocationExactBindings(p.modelFiles)
}

func (p *VideoInvocationPlan) DiffusionModelPath() string {
	if p == nil {
		return ""
	}
	return p.diffusionModelPath
}

func (p *VideoInvocationPlan) EncoderPath() string {
	if p == nil {
		return ""
	}
	return p.encoderPath
}

func (p *VideoInvocationPlan) VideoVAEPath() string {
	if p == nil {
		return ""
	}
	return p.videoVAEPath
}

func (p *VideoInvocationPlan) AudioVAEPath() string {
	if p == nil {
		return ""
	}
	return p.audioVAEPath
}

func (p *VideoInvocationPlan) Prompt() string {
	if p == nil {
		return ""
	}
	return p.prompt
}

func (p *VideoInvocationPlan) NegativePrompt() string {
	if p == nil {
		return ""
	}
	return p.negativePrompt
}

func (p *VideoInvocationPlan) Size() (int, int) {
	if p == nil {
		return 0, 0
	}
	return p.width, p.height
}

func (p *VideoInvocationPlan) FrameCount() int {
	if p == nil {
		return 0
	}
	return p.frameCount
}

func (p *VideoInvocationPlan) FPS() int {
	if p == nil {
		return 0
	}
	return p.fps
}

func (p *VideoInvocationPlan) Seed() int64 {
	if p == nil {
		return 0
	}
	return p.seed
}

func (p *VideoInvocationPlan) AudioRequired() bool {
	return p != nil && p.audioRequired
}

func (p *VideoInvocationPlan) ReturnLastFrame() bool {
	return p != nil && p.returnLastFrame
}

func (p *VideoInvocationPlan) ConditioningMode() VideoConditioningMode {
	if p == nil {
		return ""
	}
	return p.conditioningMode
}

func (p *VideoInvocationPlan) ReferenceImage() (VideoResolvedInput, bool) {
	if p == nil || p.referenceImage == nil {
		return VideoResolvedInput{}, false
	}
	result := *p.referenceImage
	result.ImageBytes = append([]byte(nil), p.referenceImage.ImageBytes...)
	return result, true
}

func (p *VideoInvocationPlan) CFGScale() float64 {
	if p == nil {
		return 0
	}
	return p.cfgScale
}

func (p *VideoInvocationPlan) FlowShift() float64 {
	if p == nil {
		return 0
	}
	return p.flowShift
}

func (p *VideoInvocationPlan) SampleMethod() string {
	if p == nil {
		return ""
	}
	return p.sampleMethod
}

func (p *VideoInvocationPlan) Scheduler() string {
	if p == nil {
		return ""
	}
	return p.scheduler
}

func (p *VideoInvocationPlan) DiffusionFlashAttention() bool {
	return p != nil && p.diffusionFlashAttention
}

func (p *VideoInvocationPlan) OffloadToCPU() bool {
	return p != nil && p.offloadToCPU
}

func (p *VideoInvocationPlan) RNG() string {
	if p == nil {
		return ""
	}
	return p.rng
}

// VideoInvocationDriver is the invocation seam implemented by a video Driver.
type VideoInvocationDriver interface {
	Driver
	PlanVideoInvocation(input VideoInvocationInput) (*VideoInvocationPlan, error)
}

func cloneStruct(value *structpb.Struct) *structpb.Struct {
	if value == nil {
		return nil
	}
	fields := make(map[string]*structpb.Value, len(value.GetFields()))
	for key, field := range value.GetFields() {
		fields[key] = cloneValue(field)
	}
	return &structpb.Struct{Fields: fields}
}

func cloneValue(value *structpb.Value) *structpb.Value {
	if value == nil {
		return nil
	}
	cloned, err := structpb.NewValue(value.AsInterface())
	if err != nil {
		return nil
	}
	return cloned
}

// RegistrationKey scopes an exact driver identity to one capability contract.
// Capability contracts deliberately remain outside the public implementation
// identity proto message.
type RegistrationKey struct {
	CapabilityContract string
	Identity           Identity
}

// Registry resolves only an exact capability-contract and three-part identity.
type Registry struct {
	drivers map[RegistrationKey]Driver
}

func NewRegistry(entries map[RegistrationKey]Driver) (*Registry, error) {
	drivers := make(map[RegistrationKey]Driver, len(entries))
	for key, driver := range entries {
		identity := key.Identity
		if key.CapabilityContract == "" || identity.ImplementationID == "" || identity.DriverID == "" || identity.DriverDialect == "" || driver == nil {
			return nil, fmt.Errorf("capabilitydriver registry: capability contract, identity, and driver are required")
		}
		drivers[key] = driver
	}
	return &Registry{drivers: drivers}, nil
}

// Resolve returns the driver or the public reason which explains why its
// contract-scoped identity could not be resolved.
func (registry *Registry) Resolve(capabilityContract string, identity Identity) (Driver, runtimev1.LocalCapabilityReason) {
	if registry == nil {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED
	}
	driver, ok := registry.drivers[RegistrationKey{CapabilityContract: capabilityContract, Identity: identity}]
	if ok {
		return driver, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
	}
	implementationKnown := false
	driverKnown := false
	for key := range registry.drivers {
		if key.CapabilityContract != capabilityContract || key.Identity.ImplementationID != identity.ImplementationID {
			continue
		}
		implementationKnown = true
		if key.Identity.DriverID == identity.DriverID {
			driverKnown = true
		}
	}
	if driverKnown {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	if implementationKnown {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_NOT_FOUND
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED
}

func NewProductionRegistry() *Registry {
	registry, err := NewRegistry(map[RegistrationKey]Driver{
		{CapabilityContract: LlamaCapabilityContract, Identity: Identity{ImplementationID: LlamaImplementationID, DriverID: LlamaDriverID, DriverDialect: LlamaDriverDialect}}:                                                             LlamaTextDriver{},
		{CapabilityContract: TextEmbedCapabilityContract, Identity: Identity{ImplementationID: LlamaEmbedImplementationID, DriverID: LlamaDriverID, DriverDialect: LlamaEmbedDriverDialect}}:                                               LlamaEmbedDriver{},
		{CapabilityContract: StableDiffusionCapabilityContract, Identity: Identity{ImplementationID: StableDiffusionImplementationID, DriverID: StableDiffusionDriverID, DriverDialect: StableDiffusionDriverDialect}}:                     StableDiffusionImageDriver{},
		{CapabilityContract: StableDiffusionVideoCapabilityContract, Identity: Identity{ImplementationID: StableDiffusionVideoImplementationID, DriverID: StableDiffusionVideoDriverID, DriverDialect: StableDiffusionVideoDriverDialect}}: StableDiffusionVideoDriver{},
		{CapabilityContract: AudioSynthesizeContract, Identity: Identity{ImplementationID: Qwen3TTSImplementationID, DriverID: Qwen3TTSDriverID, DriverDialect: Qwen3TTSDriverDialect}}:                                                    Qwen3TTSDriver{},
		{CapabilityContract: AudioSynthesizeContract, Identity: Identity{ImplementationID: Qwen3TTSAudioCppImplementationID, DriverID: Qwen3TTSAudioCppDriverID, DriverDialect: Qwen3TTSAudioCppDriverDialect}}:                            Qwen3TTSAudioCppDriver{},
		{CapabilityContract: AudioSynthesizeContract, Identity: Identity{ImplementationID: VoxCPMImplementationID, DriverID: VoxCPMDriverID, DriverDialect: VoxCPMDriverDialect}}:                                                          VoxCPMDriver{},
		{CapabilityContract: VoiceCreateContract, Identity: Identity{ImplementationID: Qwen3VoiceCreateImplementationID, DriverID: Qwen3TTSDriverID, DriverDialect: Qwen3VoiceCreateDriverDialect}}:                                        Qwen3VoiceCreateDriver{},
		{CapabilityContract: AudioTranscribeContract, Identity: Identity{ImplementationID: Qwen3ASRImplementationID, DriverID: Qwen3ASRDriverID, DriverDialect: Qwen3ASRDriverDialect}}:                                                    Qwen3ASRDriver{},
		{CapabilityContract: AudioTranscribeContract, Identity: Identity{ImplementationID: Qwen3ASRTransformersImplementationID, DriverID: Qwen3ASRTransformersDriverID, DriverDialect: Qwen3ASRTransformersDriverDialect}}:                Qwen3ASRTransformersDriver{},
		{CapabilityContract: MiniMaxMusic3CapabilityContract, Identity: Identity{ImplementationID: MiniMaxMusic3ImplementationID, DriverID: MiniMaxMusic3DriverID, DriverDialect: MiniMaxMusic3DriverDialect}}:                             MiniMaxMusic3AudioCppDriver{},
	})
	if err != nil {
		panic(err)
	}
	return registry
}
