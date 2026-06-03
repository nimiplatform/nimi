package localservice

const productControlSchemaVersion = 1

type productControlState string

const (
	productControlStateNotLoggedIn               productControlState = "not_logged_in"
	productControlStateConfigMissing             productControlState = "config_missing"
	productControlStateDataRootMissing           productControlState = "data_root_missing"
	productControlStateDataRootSelected          productControlState = "data_root_selected"
	productControlStateAIEnvironmentUnconfigured productControlState = "ai_environment_unconfigured"
	productControlStateLocalAIProfileNotReady    productControlState = "local_ai_profile_selected_environment_not_ready"
	productControlStateLocalAIReady              productControlState = "local_ai_ready"
	productControlStateRepairRequired            productControlState = "repair_required"
	productControlStateBlocked                   productControlState = "blocked"
	productControlStateReadyForUse               productControlState = "ready_for_use"
)

type productDataRootStatus string

const (
	productDataRootStatusSelected       productDataRootStatus = "selected"
	productDataRootStatusReady          productDataRootStatus = "ready"
	productDataRootStatusRepairRequired productDataRootStatus = "repair_required"
)

type productControlRecord struct {
	SchemaVersion  int                    `json:"schemaVersion"`
	InstallID      string                 `json:"installId"`
	ProductVersion string                 `json:"productVersion"`
	State          productControlState    `json:"state"`
	DataRoot       *productDataRootRecord `json:"dataRoot"`
	FirstRun       productFirstRunRecord  `json:"firstRun"`
	Pointers       productPointersRecord  `json:"pointers"`
	Repair         productRepairRecord    `json:"repair"`
}

type productDataRootRecord struct {
	Path             string                `json:"path"`
	Status           productDataRootStatus `json:"status"`
	SelectedAt       string                `json:"selectedAt"`
	VerifiedAt       string                `json:"verifiedAt"`
	SelectedAtUnixMs int64                 `json:"selectedAtUnixMs"`
	VerifiedAtUnixMs int64                 `json:"verifiedAtUnixMs"`
}

type productFirstRunRecord struct {
	InstallLevel             *string  `json:"installLevel"`
	AIProfileAlias           *string  `json:"aiProfileAlias"`
	Completed                bool     `json:"completed"`
	CompletedAt              *string  `json:"completedAt"`
	InitializationPlanID     *string  `json:"initializationPlanId"`
	BaselineProfileRef       *string  `json:"baselineProfileRef"`
	BaselineCommitID         *string  `json:"baselineCommitId"`
	AccountDefaultProfileRef *string  `json:"accountDefaultProfileRef"`
	BuiltInAIConfigRefs      []string `json:"builtInAiConfigRefs"`
	RuntimeBaselineRef       *string  `json:"runtimeBaselineRef"`
	ExecutionEvidenceRef     *string  `json:"executionEvidenceRef"`
}

type productPointersRecord struct {
	RuntimeConfigPath   *string `json:"runtimeConfigPath"`
	FactoryProfileIndex *string `json:"factoryProfileIndex"`
	AppRegistry         *string `json:"appRegistry"`
	AppPackages         *string `json:"appPackages"`
}

type productRepairRecord struct {
	Required bool    `json:"required"`
	Reason   *string `json:"reason"`
}

type productControlRecordProjection struct {
	Path   string                `json:"path"`
	Exists bool                  `json:"exists"`
	State  productControlState   `json:"state"`
	Record *productControlRecord `json:"record"`
	Error  *string               `json:"error"`
}

type productControlSelectedDataRootProjection struct {
	Path     string                 `json:"path"`
	Exists   bool                   `json:"exists"`
	State    productControlState    `json:"state"`
	DataRoot *productDataRootRecord `json:"dataRoot"`
	Error    *string                `json:"error"`
}

type accountDefaultProfileAdmissionEvidence struct {
	AccountDefaultProfileRef string `json:"accountDefaultProfileRef"`
	AccountID                string `json:"accountId"`
	DataRootRef              string `json:"dataRootRef"`
	ProfileID                string `json:"profileId"`
	ContentHash              string `json:"contentHash"`
	SourcePolicyRef          string `json:"sourcePolicyRef"`
	SourceCatalogID          string `json:"sourceCatalogId"`
	SourceCatalogVersion     int    `json:"sourceCatalogVersion"`
	CreatedAt                string `json:"createdAt"`
	UpdatedAt                string `json:"updatedAt"`
	AIProfileAlias           string `json:"aiProfileAlias"`
	ProfilePayloadHash       string `json:"profilePayloadHash"`
	FactoryProvenanceHash    string `json:"factoryProvenanceHash"`
}

type builtInAIConfigAdmissionEvidenceSet struct {
	Nimi  builtInAIConfigAdmissionEvidence `json:"nimi"`
	Agent builtInAIConfigAdmissionEvidence `json:"agent"`
}

type builtInAIConfigAdmissionEvidence struct {
	BuiltInAIConfigRef  string                       `json:"builtInAiConfigRef"`
	AccountID           string                       `json:"accountId"`
	DataRootRef         string                       `json:"dataRootRef"`
	ScopeRef            builtInChatScopeAdmissionRef `json:"scopeRef"`
	AIProfileRef        builtInAIProfileAdmissionRef `json:"aiProfileRef"`
	AIConfigVersion     uint64                       `json:"aiConfigVersion"`
	AIConfigContentHash string                       `json:"aiConfigContentHash"`
	WriterIdentity      string                       `json:"writerIdentity"`
	CommittedAt         string                       `json:"committedAt"`
}

type builtInChatScopeAdmissionRef struct {
	Kind      string `json:"kind"`
	OwnerID   string `json:"ownerId"`
	SurfaceID string `json:"surfaceId"`
}

type builtInAIProfileAdmissionRef struct {
	ProfileID            string `json:"profileId"`
	AIProfileAlias       string `json:"aiProfileAlias"`
	InstallLevel         string `json:"installLevel"`
	SourcePolicyRef      string `json:"sourcePolicyRef"`
	SourceCatalogID      string `json:"sourceCatalogId"`
	SourceCatalogVersion int    `json:"sourceCatalogVersion"`
	ProfilePayloadHash   string `json:"profilePayloadHash"`
	AppliedAt            string `json:"appliedAt"`
}
