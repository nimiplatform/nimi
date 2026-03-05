package catalog

import (
	"errors"
	"log/slog"
	"time"
)

type CatalogSource string

const (
	SourceBuiltinSnapshot CatalogSource = "builtin_snapshot"
	SourceCustomDir      CatalogSource = "custom_dir"
	SourceRemoteCache    CatalogSource = "remote_cache"
)

type ProviderSource string

const (
	ProviderSourceBuiltin ProviderSource = "builtin"
	ProviderSourceCustom  ProviderSource = "custom"
	ProviderSourceRemote  ProviderSource = "remote"
)

var (
	ErrModelNotFound          = errors.New("model catalog entry not found")
	ErrVoiceSetEmpty          = errors.New("voice set has no entries")
	ErrProviderUnsupported    = errors.New("catalog provider is not supported")
	ErrCatalogMutationDisabled = errors.New("catalog custom directory is not configured")
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

type ModelEntry struct {
	Provider     string    `yaml:"provider" json:"provider"`
	ModelID      string    `yaml:"model_id" json:"model_id"`
	ModelType    string    `yaml:"model_type" json:"model_type"`
	UpdatedAt    string    `yaml:"updated_at" json:"updated_at"`
	Capabilities []string  `yaml:"capabilities" json:"capabilities"`
	Pricing      Pricing   `yaml:"pricing" json:"pricing"`
	VoiceSetID   string    `yaml:"voice_set_id" json:"voice_set_id"`
	SourceRef    SourceRef `yaml:"source_ref" json:"source_ref"`
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

type ProviderDocument struct {
	Version        int          `yaml:"version" json:"version"`
	Provider       string       `yaml:"provider" json:"provider"`
	CatalogVersion string       `yaml:"catalog_version" json:"catalog_version"`
	Models         []ModelEntry `yaml:"models" json:"models"`
	Voices         []VoiceEntry `yaml:"voices" json:"voices"`

	RawYAML string `yaml:"-" json:"raw_yaml"`
}

type RemoteBundle struct {
	Version        int                `yaml:"version" json:"version"`
	CatalogVersion string             `yaml:"catalog_version" json:"catalog_version"`
	Providers      []ProviderDocument `yaml:"providers" json:"providers"`
}

type Snapshot struct {
	CatalogVersion string
	Models         []ModelEntry
	Voices         []VoiceEntry
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
	Logger              *slog.Logger
	CustomDir           string
	RemoteEnabled       bool
	RemoteURL           string
	RefreshInterval     time.Duration
	CachePath           string
	MaxRemotePayloadLen int64
	HTTPTimeout         time.Duration
}
