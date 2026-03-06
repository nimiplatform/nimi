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
	ProviderSourceBuiltin ProviderSource = "builtin"
	ProviderSourceCustom  ProviderSource = "custom"
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

type ModelEntry struct {
	Provider           string                     `yaml:"provider" json:"provider"`
	ModelID            string                     `yaml:"model_id" json:"model_id"`
	ModelType          string                     `yaml:"model_type" json:"model_type"`
	UpdatedAt          string                     `yaml:"updated_at" json:"updated_at"`
	Capabilities       []string                   `yaml:"capabilities" json:"capabilities"`
	Pricing            Pricing                    `yaml:"pricing" json:"pricing"`
	VoiceSetID         string                     `yaml:"voice_set_id,omitempty" json:"voice_set_id,omitempty"`
	VoiceDiscoveryMode string                     `yaml:"voice_discovery_mode,omitempty" json:"voice_discovery_mode,omitempty"`
	VoiceRefKinds      []string                   `yaml:"voice_ref_kinds,omitempty" json:"voice_ref_kinds,omitempty"`
	VideoGeneration    *VideoGenerationCapability `yaml:"video_generation,omitempty" json:"video_generation,omitempty"`
	SourceRef          SourceRef                  `yaml:"source_ref" json:"source_ref"`
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
	WorkflowModelID   string    `yaml:"workflow_model_id" json:"workflow_model_id"`
	WorkflowType      string    `yaml:"workflow_type" json:"workflow_type"`
	InputContractRef  string    `yaml:"input_contract_ref,omitempty" json:"input_contract_ref,omitempty"`
	OutputPersistence string    `yaml:"output_persistence,omitempty" json:"output_persistence,omitempty"`
	TargetModelRefs   []string  `yaml:"target_model_refs" json:"target_model_refs"`
	Langs             []string  `yaml:"langs,omitempty" json:"langs,omitempty"`
	SourceRef         SourceRef `yaml:"source_ref" json:"source_ref"`
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
	Models                []ModelEntry           `yaml:"models" json:"models"`
	Voices                []VoiceEntry           `yaml:"voices,omitempty" json:"voices,omitempty"`
	VoiceWorkflowModels   []VoiceWorkflowModel   `yaml:"voice_workflow_models,omitempty" json:"voice_workflow_models,omitempty"`
	ModelWorkflowBindings []ModelWorkflowBinding `yaml:"model_workflow_bindings,omitempty" json:"model_workflow_bindings,omitempty"`

	RawYAML string `yaml:"-" json:"raw_yaml"`
}

type Snapshot struct {
	CatalogVersion        string
	Models                []ModelEntry
	Voices                []VoiceEntry
	VoiceWorkflowModels   []VoiceWorkflowModel
	ModelWorkflowBindings []ModelWorkflowBinding
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
	Provider          string
	ModelID           string
	WorkflowType      string
	WorkflowModelID   string
	OutputPersistence string
	CatalogVersion    string
	Source            CatalogSource
}

type CatalogProviderRecord struct {
	Provider       string
	Version        int
	CatalogVersion string
	Source         ProviderSource
	ModelCount     int
	VoiceCount     int
	YAML           string
}

type ResolverConfig struct {
	Logger    *slog.Logger
	CustomDir string
}
