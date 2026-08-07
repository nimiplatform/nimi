package localservice

const productControlSchemaVersion = 1

type productControlState string

const (
	productControlStateNotLoggedIn      productControlState = "not_logged_in"
	productControlStateConfigMissing    productControlState = "config_missing"
	productControlStateDataRootMissing  productControlState = "data_root_missing"
	productControlStateDataRootSelected productControlState = "data_root_selected"
	productControlStateRepairRequired   productControlState = "repair_required"
	productControlStateBlocked          productControlState = "blocked"
	productControlStateReadyForUse      productControlState = "ready_for_use"
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
	Completed   bool    `json:"completed"`
	CompletedAt *string `json:"completedAt"`
}

type productPointersRecord struct {
	FactoryProfileIndex *string `json:"factoryProfileIndex"`
}

type productRepairRecord struct {
	Required bool    `json:"required"`
	Reason   *string `json:"reason"`
}

type productControlRecordProjection struct {
	Path           string                        `json:"path"`
	Exists         bool                          `json:"exists"`
	State          productControlState           `json:"state"`
	Record         *productControlRecord         `json:"record"`
	Error          *string                       `json:"error"`
	ConfigMutation *productControlConfigMutation `json:"configMutation,omitempty"`
}

type productControlConfigMutation struct {
	Disposition string `json:"disposition"`
	ReasonCode  string `json:"reasonCode"`
	ActionHint  string `json:"actionHint"`
}

type productControlSelectedDataRootProjection struct {
	Path     string                 `json:"path"`
	Exists   bool                   `json:"exists"`
	State    productControlState    `json:"state"`
	DataRoot *productDataRootRecord `json:"dataRoot"`
	Error    *string                `json:"error"`
}
