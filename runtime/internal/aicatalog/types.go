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
	TimingModes        []string                   `yaml:"timing_modes,omitempty" json:"timing_modes,omitempty"`
	AudioFormats       []string                   `yaml:"audio_formats,omitempty" json:"audio_formats,omitempty"`
	SupportsLanguage   bool                       `yaml:"supports_language,omitempty" json:"supports_language,omitempty"`
	SupportsEmotion    bool                       `yaml:"supports_emotion,omitempty" json:"supports_emotion,omitempty"`
	VoiceRenderHints   *VoiceRenderHintsSchema    `yaml:"voice_render_hints,omitempty" json:"voice_render_hints,omitempty"`
	ProviderExtensions *ProviderExtensionMetadata `yaml:"provider_extensions,omitempty" json:"provider_extensions,omitempty"`
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

type SelectionProfile struct {
	Provider         string `yaml:"provider,omitempty" json:"provider,omitempty"`
	ProfileID        string `yaml:"profile_id" json:"profile_id"`
	Capability       string `yaml:"capability" json:"capability"`
	ModelID          string `yaml:"model_id" json:"model_id"`
	ReviewedAt       string `yaml:"reviewed_at" json:"reviewed_at"`
	FreshnessSLADays int    `yaml:"freshness_sla_days" json:"freshness_sla_days"`
	Rationale        string `yaml:"rationale,omitempty" json:"rationale,omitempty"`
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
	Transcription       *TranscriptionOptions      `yaml:"transcription,omitempty" json:"transcription,omitempty"`
	VideoGeneration     *VideoGenerationCapability `yaml:"video_generation,omitempty" json:"video_generation,omitempty"`
	SourceRef           SourceRef                  `yaml:"source_ref" json:"source_ref"`
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
	Version               int                    `yaml:"version" json:"version"`
	Provider              string                 `yaml:"provider" json:"provider"`
	CatalogVersion        string                 `yaml:"catalog_version" json:"catalog_version"`
	DefaultTextModel      string                 `yaml:"default_text_model,omitempty" json:"default_text_model,omitempty"`
	SelectionProfiles     []SelectionProfile     `yaml:"selection_profiles,omitempty" json:"selection_profiles,omitempty"`
	Models                []ModelEntry           `yaml:"models" json:"models"`
	Voices                []VoiceEntry           `yaml:"voices,omitempty" json:"voices,omitempty"`
	VoiceWorkflowModels   []VoiceWorkflowModel   `yaml:"voice_workflow_models,omitempty" json:"voice_workflow_models,omitempty"`
	ModelWorkflowBindings []ModelWorkflowBinding `yaml:"model_workflow_bindings,omitempty" json:"model_workflow_bindings,omitempty"`
	VoiceHandlePolicies   []VoiceHandlePolicy    `yaml:"voice_handle_policies,omitempty" json:"voice_handle_policies,omitempty"`

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
