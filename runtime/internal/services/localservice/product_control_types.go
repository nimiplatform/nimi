package localservice

const (
	productControlSchemaVersion       = 2
	productControlLegacySchemaVersion = 1
)

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

// @nimi-authority: definition.nimi.platform.product-lifecycle.product-control-record
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-009b
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-015-wire-shape
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-015-data-root-wire-shape
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
	RootActivationID string                `json:"rootActivationId,omitempty"`
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
	Activation     *productControlActivation     `json:"activation,omitempty"`
	RootHandoff    *productControlRootHandoff    `json:"rootHandoff,omitempty"`
}

type productControlActivation struct {
	Activated  bool   `json:"activated"`
	ReasonCode string `json:"reasonCode"`
	ActionHint string `json:"actionHint"`
}

type productControlConfigMutation struct {
	Disposition string `json:"disposition"`
	ReasonCode  string `json:"reasonCode"`
	ActionHint  string `json:"actionHint"`
}

// productControlRootHandoff is a queryable process disposition. The durable
// record remains the activation truth; this projection tells a Host that lost
// the Replace response whether this Runtime has committed that activation but
// still requires restart, or is already serving it.
type productControlRootHandoff struct {
	Disposition      string `json:"disposition"`
	RootActivationID string `json:"rootActivationId"`
	ActionHint       string `json:"actionHint"`
}

type productControlSelectedDataRootProjection struct {
	Path     string                 `json:"path"`
	Exists   bool                   `json:"exists"`
	State    productControlState    `json:"state"`
	DataRoot *productDataRootRecord `json:"dataRoot"`
	Error    *string                `json:"error"`
}
