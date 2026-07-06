package catalog

import (
	"errors"
	"log/slog"
)

type CatalogSource string

const (
	SourceBuiltinSnapshot CatalogSource = "builtin_snapshot"
	SourceCustomDir       CatalogSource = "custom_dir"
)

type ProviderSource string

const (
	ProviderSourceBuiltin    ProviderSource = "builtin"
	ProviderSourceCustom     ProviderSource = "custom"
	ProviderSourceOverridden ProviderSource = "overridden"
)

type ModelSource string

const (
	ModelSourceBuiltin    ModelSource = "builtin"
	ModelSourceCustom     ModelSource = "custom"
	ModelSourceOverridden ModelSource = "overridden"
)

var (
	ErrModelNotFound            = errors.New("model catalog entry not found")
	ErrVoiceSetEmpty            = errors.New("voice set has no entries")
	ErrProviderUnsupported      = errors.New("catalog provider is not supported")
	ErrCatalogMutationDisabled  = errors.New("catalog custom directory is not configured")
	ErrVoiceWorkflowUnsupported = errors.New("voice workflow is not supported by model")
)

type Pricing struct {
	Unit     string `yaml:"unit" json:"unit"`
	Input    string `yaml:"input" json:"input"`
	Output   string `yaml:"output" json:"output"`
	Currency string `yaml:"currency" json:"currency"`
	AsOf     string `yaml:"as_of" json:"as_of"`
	Notes    string `yaml:"notes" json:"notes"`
}

type SourceRef struct {
	URL         string `yaml:"url" json:"url"`
	RetrievedAt string `yaml:"retrieved_at" json:"retrieved_at"`
	Note        string `yaml:"note" json:"note"`
}

type VideoGenerationOptions struct {
	Supports    []string       `yaml:"supports" json:"supports"`
	Constraints map[string]any `yaml:"constraints" json:"constraints"`
}

type VideoGenerationOutputs struct {
	VideoURL     bool `yaml:"video_url,omitempty" json:"video_url,omitempty"`
	LastFrameURL bool `yaml:"last_frame_url,omitempty" json:"last_frame_url,omitempty"`
}

type VideoGenerationCapability struct {
	Modes      []string               `yaml:"modes" json:"modes"`
	InputRoles map[string][]string    `yaml:"input_roles" json:"input_roles"`
	Limits     map[string]any         `yaml:"limits" json:"limits"`
	Options    VideoGenerationOptions `yaml:"options" json:"options"`
	Outputs    VideoGenerationOutputs `yaml:"outputs" json:"outputs"`
}

type NumericRange struct {
	Min float64 `yaml:"min" json:"min"`
	Max float64 `yaml:"max" json:"max"`
}

type ProviderExtensionMetadata struct {
	Namespace     string `yaml:"namespace" json:"namespace"`
	SchemaVersion string `yaml:"schema_version" json:"schema_version"`
}

type VoiceRenderHintsSchema struct {
	Stability       *NumericRange `yaml:"stability,omitempty" json:"stability,omitempty"`
	SimilarityBoost *NumericRange `yaml:"similarity_boost,omitempty" json:"similarity_boost,omitempty"`
	Style           *NumericRange `yaml:"style,omitempty" json:"style,omitempty"`
	Speed           *NumericRange `yaml:"speed,omitempty" json:"speed,omitempty"`
	UseSpeakerBoost bool          `yaml:"use_speaker_boost,omitempty" json:"use_speaker_boost,omitempty"`
}

type VoiceRequestOptions struct {
	TimingModes             []string                   `yaml:"timing_modes,omitempty" json:"timing_modes,omitempty"`
	AudioFormats            []string                   `yaml:"audio_formats,omitempty" json:"audio_formats,omitempty"`
	SupportsLanguage        bool                       `yaml:"supports_language,omitempty" json:"supports_language,omitempty"`
	SupportsEmotion         bool                       `yaml:"supports_emotion,omitempty" json:"supports_emotion,omitempty"`
	SupportsNativeStreamTTS bool                       `yaml:"supports_native_stream_tts,omitempty" json:"supports_native_stream_tts,omitempty"`
	VoiceRenderHints        *VoiceRenderHintsSchema    `yaml:"voice_render_hints,omitempty" json:"voice_render_hints,omitempty"`
	ProviderExtensions      *ProviderExtensionMetadata `yaml:"provider_extensions,omitempty" json:"provider_extensions,omitempty"`
}

type ImageRequestOptions struct {
	ResponseFormats         []string                   `yaml:"response_formats,omitempty" json:"response_formats,omitempty"`
	MaxImagesPerRequest     int                        `yaml:"max_images_per_request,omitempty" json:"max_images_per_request,omitempty"`
	SupportsNegativePrompt  bool                       `yaml:"supports_negative_prompt,omitempty" json:"supports_negative_prompt,omitempty"`
	SupportsReferenceImages bool                       `yaml:"supports_reference_images,omitempty" json:"supports_reference_images,omitempty"`
	SupportsMask            bool                       `yaml:"supports_mask,omitempty" json:"supports_mask,omitempty"`
	SupportsSeed            bool                       `yaml:"supports_seed,omitempty" json:"supports_seed,omitempty"`
	SupportsSize            bool                       `yaml:"supports_size,omitempty" json:"supports_size,omitempty"`
	SupportsAspectRatio     bool                       `yaml:"supports_aspect_ratio,omitempty" json:"supports_aspect_ratio,omitempty"`
	SupportsQuality         bool                       `yaml:"supports_quality,omitempty" json:"supports_quality,omitempty"`
	SupportsStyle           bool                       `yaml:"supports_style,omitempty" json:"supports_style,omitempty"`
	ProviderExtensions      *ProviderExtensionMetadata `yaml:"provider_extensions,omitempty" json:"provider_extensions,omitempty"`
}

// EmbeddingCapability is the K-MCAT-002 capability-conditional block carried by
// `text.embed` models. It is the catalog authority for the model's output
// embedding dimension (K-MEM-004 embedding-profile identity). Only `dimension`
// is a model-inherent fact and therefore catalog-owned; distance_metric and
// migration_policy remain runtime memory-bank policy, not model facts.
type EmbeddingCapability struct {
	Dimension int32 `yaml:"dimension" json:"dimension"`
}

type TranscriptionOptions struct {
	Tiers               []string                   `yaml:"tiers,omitempty" json:"tiers,omitempty"`
	ResponseFormats     []string                   `yaml:"response_formats,omitempty" json:"response_formats,omitempty"`
	SupportsLanguage    bool                       `yaml:"supports_language,omitempty" json:"supports_language,omitempty"`
	SupportsPrompt      bool                       `yaml:"supports_prompt,omitempty" json:"supports_prompt,omitempty"`
	SupportsTimestamps  bool                       `yaml:"supports_timestamps,omitempty" json:"supports_timestamps,omitempty"`
	SupportsDiarization bool                       `yaml:"supports_diarization,omitempty" json:"supports_diarization,omitempty"`
	MaxSpeakerCount     int                        `yaml:"max_speaker_count,omitempty" json:"max_speaker_count,omitempty"`
	ProviderExtensions  *ProviderExtensionMetadata `yaml:"provider_extensions,omitempty" json:"provider_extensions,omitempty"`
}

type VoiceWorkflowRequestOptions struct {
	TextPromptMode                 string                     `yaml:"text_prompt_mode,omitempty" json:"text_prompt_mode,omitempty"`
	InstructionTextMode            string                     `yaml:"instruction_text_mode,omitempty" json:"instruction_text_mode,omitempty"`
	PreviewTextMode                string                     `yaml:"preview_text_mode,omitempty" json:"preview_text_mode,omitempty"`
	SupportsLanguageHints          *bool                      `yaml:"supports_language_hints,omitempty" json:"supports_language_hints,omitempty"`
	SupportsLanguage               *bool                      `yaml:"supports_language,omitempty" json:"supports_language,omitempty"`
	SupportsPreferredName          *bool                      `yaml:"supports_preferred_name,omitempty" json:"supports_preferred_name,omitempty"`
	ReferenceAudioURIInput         *bool                      `yaml:"reference_audio_uri_input,omitempty" json:"reference_audio_uri_input,omitempty"`
	ReferenceAudioBytesInput       *bool                      `yaml:"reference_audio_bytes_input,omitempty" json:"reference_audio_bytes_input,omitempty"`
	AllowedReferenceAudioMimeTypes []string                   `yaml:"allowed_reference_audio_mime_types,omitempty" json:"allowed_reference_audio_mime_types,omitempty"`
	ProviderExtensions             *ProviderExtensionMetadata `yaml:"provider_extensions,omitempty" json:"provider_extensions,omitempty"`
}

type DynamicInventoryPolicy struct {
	DiscoveryTransport     string   `yaml:"discovery_transport,omitempty" json:"discovery_transport,omitempty"`
	CacheTTLSeconds        int      `yaml:"cache_ttl_sec,omitempty" json:"cache_ttl_sec,omitempty"`
	SelectionMode          string   `yaml:"selection_mode,omitempty" json:"selection_mode,omitempty"`
	FailurePolicy          string   `yaml:"failure_policy,omitempty" json:"failure_policy,omitempty"`
	AllowedCapabilities    []string `yaml:"allowed_capabilities,omitempty" json:"allowed_capabilities,omitempty"`
	DenyModelPatterns      []string `yaml:"deny_model_patterns,omitempty" json:"deny_model_patterns,omitempty"`
	AllowModelPatterns     []string `yaml:"allow_model_patterns,omitempty" json:"allow_model_patterns,omitempty"`
	PreferredModelPatterns []string `yaml:"preferred_model_patterns,omitempty" json:"preferred_model_patterns,omitempty"`
}

type SelectionProfile struct {
	Provider         string `yaml:"provider,omitempty" json:"provider,omitempty"`
	ProfileID        string `yaml:"profile_id" json:"profile_id"`
	Capability       string `yaml:"capability" json:"capability"`
	ModelID          string `yaml:"model_id" json:"model_id"`
	ReviewedAt       string `yaml:"reviewed_at" json:"reviewed_at"`
	FreshnessSLADays int    `yaml:"freshness_sla_days" json:"freshness_sla_days"`
	Rationale        string `yaml:"rationale,omitempty" json:"rationale,omitempty"`
}

// LocalPlaneHostRequirement is the K-MCAT-032 per-variant host fitness input.
// MinVRAMBytes is meaningful only when Accelerator != "cpu".
type LocalPlaneHostRequirement struct {
	Accelerator  string `yaml:"accelerator" json:"accelerator"`
	MinRAMBytes  int64  `yaml:"min_ram_bytes" json:"min_ram_bytes"`
	MinVRAMBytes int64  `yaml:"min_vram_bytes,omitempty" json:"min_vram_bytes,omitempty"`
}

// LocalPlaneVariant is one K-MCAT-032 quant variant — an installable asset.
// VariantID is the variant-level asset_id used by the resolver and by
// InstallVerifiedAsset.
type LocalPlaneVariant struct {
	VariantID       string                    `yaml:"variant_id" json:"variant_id"`
	Quant           string                    `yaml:"quant" json:"quant"`
	Entry           string                    `yaml:"entry" json:"entry"`
	Files           []string                  `yaml:"files" json:"files"`
	Hashes          map[string]string         `yaml:"hashes" json:"hashes"`
	TotalSizeBytes  int64                     `yaml:"total_size_bytes" json:"total_size_bytes"`
	HostRequirement LocalPlaneHostRequirement `yaml:"host_requirement" json:"host_requirement"`
}

// LocalPlaneInstall is the K-MCAT-032 installable-fact block shared by every
// variant of a local-plane model row.
type LocalPlaneInstall struct {
	Repo            string   `yaml:"repo" json:"repo"`
	Revision        string   `yaml:"revision" json:"revision"`
	InstallKind     string   `yaml:"install_kind" json:"install_kind"`
	Entry           string   `yaml:"entry" json:"entry"`
	ArtifactRoles   []string `yaml:"artifact_roles" json:"artifact_roles"`
	PreferredEngine string   `yaml:"preferred_engine" json:"preferred_engine"`
}

// LocalPlaneFitness is the K-MCAT-032 main-model fitness metadata.
type LocalPlaneFitness struct {
	ParamCount    int64 `yaml:"param_count" json:"param_count"`
	ContextLength int64 `yaml:"context_length" json:"context_length"`
}

// LocalPlaneCompanion is one K-MCAT-032 companion block — a passive
// parent-bound asset (VAE, text encoder, etc.). A companion carries install +
// variants like a model but no capabilities and no fitness (K-LOCAL-007
// passive asset). CompanionKind is a K-LOCAL-007 passive-kind; EngineSlot is a
// K-LOCAL-031 engine-defined workflow slot, unique within the parent row.
type LocalPlaneCompanion struct {
	CompanionKind string              `yaml:"companion_kind" json:"companion_kind"`
	EngineSlot    string              `yaml:"engine_slot" json:"engine_slot"`
	Install       *LocalPlaneInstall  `yaml:"install" json:"install"`
	Variants      []LocalPlaneVariant `yaml:"variants" json:"variants"`
}

type ModelEntry struct {
	Provider            string                     `yaml:"provider" json:"provider"`
	ModelID             string                     `yaml:"model_id" json:"model_id"`
	ApiModelID          string                     `yaml:"api_model_id,omitempty" json:"api_model_id,omitempty"`
	ModelType           string                     `yaml:"model_type" json:"model_type"`
	UpdatedAt           string                     `yaml:"updated_at" json:"updated_at"`
	Capabilities        []string                   `yaml:"capabilities" json:"capabilities"`
	Pricing             Pricing                    `yaml:"pricing" json:"pricing"`
	VoiceSetID          string                     `yaml:"voice_set_id,omitempty" json:"voice_set_id,omitempty"`
	VoiceDiscoveryMode  string                     `yaml:"voice_discovery_mode,omitempty" json:"voice_discovery_mode,omitempty"`
	VoiceRefKinds       []string                   `yaml:"voice_ref_kinds,omitempty" json:"voice_ref_kinds,omitempty"`
	VoiceRequestOptions *VoiceRequestOptions       `yaml:"voice_request_options,omitempty" json:"voice_request_options,omitempty"`
	ImageRequestOptions *ImageRequestOptions       `yaml:"image_request_options,omitempty" json:"image_request_options,omitempty"`
	Transcription       *TranscriptionOptions      `yaml:"transcription,omitempty" json:"transcription,omitempty"`
	VideoGeneration     *VideoGenerationCapability `yaml:"video_generation,omitempty" json:"video_generation,omitempty"`
	// Embedding is the K-MCAT-002 capability-conditional block for `text.embed`
	// models. It carries the catalog-authoritative output dimension consumed by
	// the runtime memory embedding profile resolver (K-MEM-004, K-AIEXEC-006).
	Embedding *EmbeddingCapability `yaml:"embedding,omitempty" json:"embedding,omitempty"`
	SourceRef SourceRef            `yaml:"source_ref" json:"source_ref"`

	// K-MCAT-032 local-plane block — present only on runtime_plane=local rows.
	Install  *LocalPlaneInstall  `yaml:"install,omitempty" json:"install,omitempty"`
	Variants []LocalPlaneVariant `yaml:"variants,omitempty" json:"variants,omitempty"`
	Fitness  *LocalPlaneFitness  `yaml:"fitness,omitempty" json:"fitness,omitempty"`
	// Companions is the optional K-MCAT-032 passive companion-asset list. It is
	// present only on rows whose engine genuinely requires companions (image /
	// video workflow models); core text/speech rows carry none.
	Companions []LocalPlaneCompanion `yaml:"companions,omitempty" json:"companions,omitempty"`
}

// PresetSlot is one K-MCAT-033 curated slot binding a capability to a model.
type PresetSlot struct {
	Slot            string `yaml:"slot" json:"slot"`
	Capability      string `yaml:"capability" json:"capability"`
	ModelRef        string `yaml:"model_ref" json:"model_ref"`
	Required        bool   `yaml:"required" json:"required"`
	HostConditional bool   `yaml:"host_conditional,omitempty" json:"host_conditional,omitempty"`
}

// Preset is one K-MCAT-033 install-level preset (a fixed concrete model set).
type Preset struct {
	FactoryAIProfileAlias string       `yaml:"factory_aiprofile_alias" json:"factory_aiprofile_alias"`
	Slots                 []PresetSlot `yaml:"slots" json:"slots"`
}

// Presets is the K-MCAT-033 curated presets section. Install-level keys are
// fixed to minimal and recommended.
type Presets struct {
	Minimal     *Preset `yaml:"minimal,omitempty" json:"minimal,omitempty"`
	Recommended *Preset `yaml:"recommended,omitempty" json:"recommended,omitempty"`
}

type VoiceEntry struct {
	VoiceSetID string    `yaml:"voice_set_id" json:"voice_set_id"`
	Provider   string    `yaml:"provider" json:"provider"`
	VoiceID    string    `yaml:"voice_id" json:"voice_id"`
	Name       string    `yaml:"name" json:"name"`
	Langs      []string  `yaml:"langs" json:"langs"`
	ModelIDs   []string  `yaml:"model_ids" json:"model_ids"`
	SourceRef  SourceRef `yaml:"source_ref" json:"source_ref"`
}

type VoiceWorkflowModel struct {
	WorkflowModelID   string                       `yaml:"workflow_model_id" json:"workflow_model_id"`
	WorkflowType      string                       `yaml:"workflow_type" json:"workflow_type"`
	InputContractRef  string                       `yaml:"input_contract_ref,omitempty" json:"input_contract_ref,omitempty"`
	OutputPersistence string                       `yaml:"output_persistence,omitempty" json:"output_persistence,omitempty"`
	RequestOptions    *VoiceWorkflowRequestOptions `yaml:"request_options,omitempty" json:"request_options,omitempty"`
	TargetModelRefs   []string                     `yaml:"target_model_refs" json:"target_model_refs"`
	Langs             []string                     `yaml:"langs,omitempty" json:"langs,omitempty"`
	SourceRef         SourceRef                    `yaml:"source_ref" json:"source_ref"`
}

type VoiceHandlePolicy struct {
	Provider                      string    `yaml:"provider,omitempty" json:"provider,omitempty"`
	PolicyID                      string    `yaml:"policy_id" json:"policy_id"`
	AppliesToWorkflowTypes        []string  `yaml:"applies_to_workflow_types" json:"applies_to_workflow_types"`
	Persistence                   string    `yaml:"persistence" json:"persistence"`
	DefaultTTL                    string    `yaml:"default_ttl" json:"default_ttl"`
	Scope                         string    `yaml:"scope" json:"scope"`
	DeleteSemantics               string    `yaml:"delete_semantics,omitempty" json:"delete_semantics,omitempty"`
	RuntimeReconciliationRequired bool      `yaml:"runtime_reconciliation_required,omitempty" json:"runtime_reconciliation_required,omitempty"`
	SourceRef                     SourceRef `yaml:"source_ref" json:"source_ref"`
}

type ModelWorkflowBinding struct {
	ModelID           string   `yaml:"model_id" json:"model_id"`
	WorkflowModelRefs []string `yaml:"workflow_model_refs" json:"workflow_model_refs"`
	WorkflowTypes     []string `yaml:"workflow_types" json:"workflow_types"`
}

type ProviderDocument struct {
	Version               int                     `yaml:"version" json:"version"`
	Provider              string                  `yaml:"provider" json:"provider"`
	CatalogVersion        string                  `yaml:"catalog_version" json:"catalog_version"`
	InventoryMode         string                  `yaml:"inventory_mode,omitempty" json:"inventory_mode,omitempty"`
	DynamicInventory      *DynamicInventoryPolicy `yaml:"dynamic_inventory,omitempty" json:"dynamic_inventory,omitempty"`
	DefaultTextModel      string                  `yaml:"default_text_model,omitempty" json:"default_text_model,omitempty"`
	SelectionProfiles     []SelectionProfile      `yaml:"selection_profiles,omitempty" json:"selection_profiles,omitempty"`
	Models                []ModelEntry            `yaml:"models" json:"models"`
	Voices                []VoiceEntry            `yaml:"voices,omitempty" json:"voices,omitempty"`
	VoiceWorkflowModels   []VoiceWorkflowModel    `yaml:"voice_workflow_models,omitempty" json:"voice_workflow_models,omitempty"`
	ModelWorkflowBindings []ModelWorkflowBinding  `yaml:"model_workflow_bindings,omitempty" json:"model_workflow_bindings,omitempty"`
	VoiceHandlePolicies   []VoiceHandlePolicy     `yaml:"voice_handle_policies,omitempty" json:"voice_handle_policies,omitempty"`

	// K-MCAT-033 curated presets — present only on the local provider document.
	Presets *Presets `yaml:"presets,omitempty" json:"presets,omitempty"`

	RawYAML string `yaml:"-" json:"raw_yaml"`
}

type Snapshot struct {
	CatalogVersion        string
	SelectionProfiles     []SelectionProfile
	Models                []ModelEntry
	Voices                []VoiceEntry
	VoiceWorkflowModels   []VoiceWorkflowModel
	ModelWorkflowBindings []ModelWorkflowBinding
	VoiceHandlePolicies   []VoiceHandlePolicy
}

type VoiceDescriptor struct {
	VoiceID        string
	Name           string
	Lang           string
	SupportedLangs []string
}

type ResolveVoicesResult struct {
	Provider       string
	ModelID        string
	CatalogVersion string
	Source         CatalogSource
	Voices         []VoiceDescriptor
}

type ResolveVoiceWorkflowResult struct {
	Provider                       string
	ModelID                        string
	APIModelID                     string
	WorkflowType                   string
	WorkflowModelID                string
	WorkflowFamily                 string
	InputContractRef               string
	OutputPersistence              string
	HandlePolicyID                 string
	HandlePolicyPersistence        string
	HandlePolicyScope              string
	HandlePolicyDefaultTTL         string
	HandlePolicyDeleteSemantics    string
	RuntimeReconciliationRequired  bool
	RequestOptions                 *VoiceWorkflowRequestOptions
	RequiresTargetSynthesisBinding bool
	CatalogVersion                 string
	Source                         CatalogSource
}

type CatalogProviderRecord struct {
	Provider             string
	Version              int
	CatalogVersion       string
	InventoryMode        string
	DynamicInventory     *DynamicInventoryPolicy
	DefaultTextModel     string
	Source               ProviderSource
	ModelCount           int
	VoiceCount           int
	CustomModelCount     int
	OverriddenModelCount int
	Capabilities         []string
	HasOverlay           bool
	OverlayUpdatedAt     string
	YAML                 string
	EffectiveYAML        string
}

type CatalogOverlayWarning struct {
	Code    string
	Message string
}

type CatalogModelRecord struct {
	Model      ModelEntry
	Source     ModelSource
	UserScoped bool
	Warnings   []CatalogOverlayWarning
}

type CatalogModelDetailRecord struct {
	Model                ModelEntry
	Source               ModelSource
	UserScoped           bool
	Warnings             []CatalogOverlayWarning
	Voices               []VoiceEntry
	VoiceWorkflowModels  []VoiceWorkflowModel
	VoiceHandlePolicies  []VoiceHandlePolicy
	ModelWorkflowBinding *ModelWorkflowBinding
}

type ResolverConfig struct {
	Logger    *slog.Logger
	CustomDir string
}
