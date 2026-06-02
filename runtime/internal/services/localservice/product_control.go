package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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

func (s *Service) GetProductControlRecord(ctx context.Context, _ *runtimev1.GetProductControlRecordRequest) (*runtimev1.ProductControlProjectionJson, error) {
	return productControlJSON(s.readProductControlProjection(ctx))
}

func (s *Service) GetProductControlSelectedDataRoot(context.Context, *runtimev1.GetProductControlSelectedDataRootRequest) (*runtimev1.ProductControlProjectionJson, error) {
	return productControlJSON(readProductControlSelectedDataRootProjection())
}

func (s *Service) EnsureProductControlRecordCreated(context.Context, *runtimev1.EnsureProductControlRecordCreatedRequest) (*runtimev1.ProductControlProjectionJson, error) {
	path, err := productControlRecordPath()
	if err != nil {
		return nil, err
	}
	existing, err := readProductControlRecord(path)
	if err != nil {
		return productControlJSON(s.readProductControlProjection(context.Background()))
	}
	if existing == nil {
		record, err := s.emptyProductControlRecord(productControlStateDataRootMissing)
		if err != nil {
			return nil, err
		}
		if err := writeProductControlRecord(path, record); err != nil {
			message := fmt.Sprintf("~/.nimi/nimi.json could not be created: %v", err)
			return productControlJSON(productControlRecordProjection{
				Path:   path,
				Exists: false,
				State:  productControlStateBlocked,
				Record: nil,
				Error:  &message,
			}, nil)
		}
	}
	return productControlJSON(s.readProductControlProjection(context.Background()))
}

func (s *Service) SelectProductControlDataRoot(_ context.Context, req *runtimev1.SelectProductControlDataRootRequest) (*runtimev1.ProductControlProjectionJson, error) {
	trimmed := strings.TrimSpace(req.GetDataRoot())
	if trimmed == "" {
		return nil, errors.New("nimi_data path is required")
	}
	if !filepath.IsAbs(trimmed) {
		return nil, fmt.Errorf("nimi_data path must be absolute, got: %s", trimmed)
	}
	normalized := filepath.Clean(trimmed)
	path, err := productControlRecordPath()
	if err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, err
	}
	if record != nil {
		if err := ensureProductControlDataRootSelectionAllowed(record); err != nil {
			return nil, err
		}
		record.FirstRun = productFirstRunRecord{BuiltInAIConfigRefs: []string{}}
	} else {
		record, err = s.emptyProductControlRecord(productControlStateDataRootMissing)
		if err != nil {
			return nil, err
		}
	}
	if err := ensureNimiDataRootLayout(normalized); err != nil {
		return nil, err
	}
	now := nowProductControlUnixMS()
	nowISO := nowProductControlISO()
	record.State = productControlStateDataRootSelected
	record.DataRoot = &productDataRootRecord{
		Path:             normalized,
		Status:           productDataRootStatusSelected,
		SelectedAt:       nowISO,
		VerifiedAt:       nowISO,
		SelectedAtUnixMs: now,
		VerifiedAtUnixMs: now,
	}
	record.Pointers = resolveProductControlPointers()
	record.Repair = productRepairRecord{}
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(context.Background()))
}

func (s *Service) SetProductControlFirstRunInstallLevel(_ context.Context, req *runtimev1.SetProductControlFirstRunInstallLevelRequest) (*runtimev1.ProductControlProjectionJson, error) {
	level := strings.ToLower(strings.TrimSpace(req.GetInstallLevel()))
	if level != "minimal" && level != "recommended" {
		return nil, errors.New("first-run install level must be minimal or recommended")
	}
	alias := strings.TrimSpace(req.GetAiProfileAlias())
	if alias == "" {
		return nil, errors.New("first-run aiProfileAlias is required")
	}
	if err := s.verifyFirstRunFactoryAIProfile(alias, level); err != nil {
		return nil, err
	}
	path, err := productControlRecordPath()
	if err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errors.New("~/.nimi/nimi.json is missing; select nimi_data before install level")
	}
	if selectedProductDataRootPath(record) == "" {
		return nil, errors.New("selected nimi_data is required before install level")
	}
	record.FirstRun.InstallLevel = stringPtr(level)
	record.FirstRun.AIProfileAlias = stringPtr(alias)
	record.FirstRun.Completed = false
	record.FirstRun.CompletedAt = nil
	record.FirstRun.InitializationPlanID = nil
	record.FirstRun.BaselineProfileRef = nil
	record.FirstRun.BaselineCommitID = nil
	record.FirstRun.AccountDefaultProfileRef = nil
	record.FirstRun.BuiltInAIConfigRefs = []string{}
	record.FirstRun.RuntimeBaselineRef = nil
	record.FirstRun.ExecutionEvidenceRef = nil
	if record.State == productControlStateDataRootSelected {
		record.State = productControlStateAIEnvironmentUnconfigured
	}
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(context.Background()))
}

func (s *Service) CompleteProductControlFirstRunDeviceEnvironmentScan(ctx context.Context, _ *runtimev1.CompleteProductControlFirstRunDeviceEnvironmentScanRequest) (*runtimev1.ProductControlProjectionJson, error) {
	profile, err := s.CollectDeviceProfile(ctx, &runtimev1.CollectDeviceProfileRequest{})
	if err != nil {
		return nil, err
	}
	if profile.GetProfile().GetOs() == "" || profile.GetProfile().GetArch() == "" {
		return nil, errors.New("Runtime device profile must include os and arch")
	}
	path, err := productControlRecordPath()
	if err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errors.New("~/.nimi/nimi.json is missing; select nimi_data before device scan")
	}
	if selectedProductDataRootPath(record) == "" {
		return nil, errors.New("selected nimi_data is required before device scan")
	}
	switch record.State {
	case productControlStateDataRootSelected:
		record.State = productControlStateAIEnvironmentUnconfigured
	case productControlStateAIEnvironmentUnconfigured:
	default:
		return nil, errors.New("device environment scan can only complete after data-root selection")
	}
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(ctx))
}

func (s *Service) AdmitProductControlReadyForUse(ctx context.Context, req *runtimev1.AdmitProductControlReadyForUseRequest) (*runtimev1.ProductControlProjectionJson, error) {
	path, err := productControlRecordPath()
	if err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	if record == nil {
		return nil, errors.New("~/.nimi/nimi.json is missing; product readiness cannot be admitted")
	}
	evidence, failedState, failure := s.composeProductControlReadyAdmission(ctx, record, req)
	if failure != "" {
		if err := routeProductControlAdmissionFailure(path, record, failedState, failure); err != nil {
			return nil, err
		}
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	applyProductControlReadyEvidence(record, evidence)
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(ctx))
}

func (s *Service) RecordProductControlAccountDefaultProfileEvidence(ctx context.Context, req *runtimev1.RecordProductControlAccountDefaultProfileEvidenceRequest) (*runtimev1.ProductControlProjectionJson, error) {
	path, record, dataRootPath, installLevel, aiProfileAlias, accountID, err := s.productControlHostEvidenceInputs(ctx, "Account Default Profile")
	if err != nil {
		return nil, err
	}
	evidence, state, failure := parseAndVerifyAccountDefaultProfileEvidence(
		req.GetAccountDefaultProfileEvidenceJson(),
		accountID,
		productControlDataRootRef(dataRootPath),
		aiProfileAlias,
	)
	if failure != "" {
		if err := routeProductControlAdmissionFailure(path, record, state, failure); err != nil {
			return nil, err
		}
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	if strings.TrimSpace(evidence.AccountDefaultProfileRef) == "" {
		return nil, errors.New("Account Default Profile evidence ref is required")
	}
	if strings.TrimSpace(evidence.AIProfileAlias) != aiProfileAlias {
		return nil, errors.New("Account Default Profile evidence is bound to a different AI profile")
	}
	if strings.TrimSpace(installLevel) == "" {
		return nil, errors.New("first-run install level is required before Account Default Profile")
	}
	record.FirstRun.AccountDefaultProfileRef = stringPtr(evidence.AccountDefaultProfileRef)
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(ctx))
}

func (s *Service) RecordProductControlFirstRunLocalAiReadyEvidence(ctx context.Context, req *runtimev1.RecordProductControlFirstRunLocalAiReadyEvidenceRequest) (*runtimev1.ProductControlProjectionJson, error) {
	path, record, dataRootPath, installLevel, aiProfileAlias, accountID, err := s.productControlHostEvidenceInputs(ctx, "local AI finalization")
	if err != nil {
		return nil, err
	}
	selectedFactoryRef := firstRunFactoryProfileRef(installLevel)
	runtimeBaselineRef := strings.TrimSpace(req.GetRuntimeBaselineRef())
	if runtimeBaselineRef == "" {
		return nil, errors.New("runtimeBaselineRef is required before local AI finalization")
	}
	runtimeBaseline, state, failure := s.resolveProductControlRuntimeBaseline(ctx, runtimeBaselineRef, selectedFactoryRef, installLevel, dataRootPath)
	if failure != "" {
		if err := routeProductControlAdmissionFailure(path, record, state, failure); err != nil {
			return nil, err
		}
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	builtInRefs, state, failure := parseAndVerifyBuiltInAIConfigAdmissionEvidence(
		req.GetBuiltInAiConfigEvidenceJson(),
		record,
		accountID,
		productControlDataRootRef(dataRootPath),
		aiProfileAlias,
		installLevel,
	)
	if failure != "" {
		if err := routeProductControlAdmissionFailure(path, record, state, failure); err != nil {
			return nil, err
		}
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	executionEvidenceRef := strings.TrimSpace(req.GetExecutionEvidenceRef())
	if executionEvidenceRef == "" {
		return nil, errors.New("executionEvidenceRef is required before local AI finalization")
	}
	executionEvidence, state, failure := s.resolveProductControlExecutionEvidence(ctx, executionEvidenceRef, runtimeBaseline.GetRuntimeBaselineRef(), selectedFactoryRef, installLevel, dataRootPath)
	if failure != "" {
		if err := routeProductControlAdmissionFailure(path, record, state, failure); err != nil {
			return nil, err
		}
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	record.FirstRun.RuntimeBaselineRef = stringPtr(runtimeBaseline.GetRuntimeBaselineRef())
	record.FirstRun.BuiltInAIConfigRefs = builtInRefs
	record.FirstRun.ExecutionEvidenceRef = stringPtr(executionEvidence.GetExecutionEvidenceRef())
	record.State = productControlStateLocalAIReady
	record.Repair = productRepairRecord{}
	if record.DataRoot != nil {
		record.DataRoot.Status = productDataRootStatusReady
		record.DataRoot.VerifiedAt = nowProductControlISO()
		record.DataRoot.VerifiedAtUnixMs = nowProductControlUnixMS()
	}
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(ctx))
}

func (s *Service) ReconcileProductControlFirstRunSetupState(_ context.Context, req *runtimev1.ReconcileProductControlFirstRunSetupStateRequest) (*runtimev1.ProductControlProjectionJson, error) {
	state, err := parseProductControlRuntimeSetupState(req.GetState())
	if err != nil {
		return nil, err
	}
	path, err := productControlRecordPath()
	if err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errors.New("~/.nimi/nimi.json is missing; select nimi_data before Runtime setup state")
	}
	if selectedProductDataRootPath(record) == "" {
		return nil, errors.New("selected nimi_data is required before Runtime setup state")
	}
	if strings.TrimSpace(valueOrEmpty(record.FirstRun.InstallLevel)) == "" {
		return nil, errors.New("first-run install level is required before Runtime setup state")
	}
	detail := strings.TrimSpace(req.GetReason())
	record.State = state
	if state == productControlStateRepairRequired || state == productControlStateBlocked {
		record.Repair = productRepairRecord{Required: true, Reason: stringPtr(detail)}
		if record.DataRoot != nil {
			record.DataRoot.Status = productDataRootStatusRepairRequired
		}
	} else {
		record.Repair = productRepairRecord{}
	}
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(context.Background()))
}

type productControlReadyAdmissionEvidence struct {
	BaselineProfileRef       string
	BaselineCommitID         string
	InitializationPlanID     string
	AccountDefaultProfileRef string
	BuiltInAIConfigRefs      []string
	RuntimeBaselineRef       string
	ExecutionEvidenceRef     string
}

func (s *Service) composeProductControlReadyAdmission(ctx context.Context, record *productControlRecord, req *runtimev1.AdmitProductControlReadyForUseRequest) (productControlReadyAdmissionEvidence, productControlState, string) {
	dataRootPath := selectedProductDataRootPath(record)
	if dataRootPath == "" {
		return productControlReadyAdmissionEvidence{}, productControlStateDataRootMissing, "selected nimi_data is required before ready admission"
	}
	if strings.TrimSpace(record.InstallID) == "" || strings.TrimSpace(record.ProductVersion) == "" {
		return productControlReadyAdmissionEvidence{}, productControlStateBlocked, "product-control record installId and productVersion are required for ready admission"
	}
	installLevel := strings.TrimSpace(valueOrEmpty(record.FirstRun.InstallLevel))
	if installLevel == "" {
		return productControlReadyAdmissionEvidence{}, productControlStateAIEnvironmentUnconfigured, "first-run install level is required before ready admission"
	}
	aiProfileAlias := strings.TrimSpace(valueOrEmpty(record.FirstRun.AIProfileAlias))
	if aiProfileAlias == "" {
		return productControlReadyAdmissionEvidence{}, productControlStateAIEnvironmentUnconfigured, "first-run aiProfileAlias is required before ready admission"
	}
	if err := s.verifyFirstRunFactoryAIProfile(aiProfileAlias, installLevel); err != nil {
		return productControlReadyAdmissionEvidence{}, productControlStateAIEnvironmentUnconfigured, err.Error()
	}
	projection, ok := s.authenticatedProductControlAccount(ctx)
	if !ok {
		return productControlReadyAdmissionEvidence{}, productControlStateNotLoggedIn, "authenticated Runtime account session failed"
	}
	accountID := strings.TrimSpace(projection.GetAccountId())
	expectedDataRootRef := productControlDataRootRef(dataRootPath)
	accountEvidence, state, errText := parseAndVerifyAccountDefaultProfileAdmissionEvidence(req.GetAccountDefaultProfileEvidenceJson(), record, accountID, expectedDataRootRef, aiProfileAlias)
	if errText != "" {
		return productControlReadyAdmissionEvidence{}, state, errText
	}
	if record.DataRoot == nil || record.DataRoot.Status != productDataRootStatusReady {
		return productControlReadyAdmissionEvidence{}, productControlStateLocalAIProfileNotReady, "selected nimi_data dataRoot.status must be ready before ready admission"
	}
	selectedFactoryRef := firstRunFactoryProfileRef(installLevel)
	runtimeBaselineRef := strings.TrimSpace(valueOrEmpty(record.FirstRun.RuntimeBaselineRef))
	if runtimeBaselineRef == "" {
		return productControlReadyAdmissionEvidence{}, productControlStateLocalAIProfileNotReady, "runtimeBaselineRef is required before ready admission"
	}
	runtimeBaseline, runtimeBaselineState, runtimeBaselineError := s.resolveProductControlRuntimeBaseline(ctx, runtimeBaselineRef, selectedFactoryRef, installLevel, dataRootPath)
	if runtimeBaselineError != "" {
		return productControlReadyAdmissionEvidence{}, runtimeBaselineState, runtimeBaselineError
	}
	builtInRefs, state, errText := parseAndVerifyBuiltInAIConfigAdmissionEvidence(req.GetBuiltInAiConfigEvidenceJson(), record, accountID, expectedDataRootRef, aiProfileAlias, installLevel)
	if errText != "" {
		return productControlReadyAdmissionEvidence{}, state, errText
	}
	executionEvidenceRef := strings.TrimSpace(valueOrEmpty(record.FirstRun.ExecutionEvidenceRef))
	if executionEvidenceRef == "" {
		return productControlReadyAdmissionEvidence{}, productControlStateLocalAIReady, "executionEvidenceRef is required before ready admission"
	}
	executionEvidence, executionState, executionError := s.resolveProductControlExecutionEvidence(ctx, executionEvidenceRef, runtimeBaseline.GetRuntimeBaselineRef(), selectedFactoryRef, installLevel, dataRootPath)
	if executionError != "" {
		return productControlReadyAdmissionEvidence{}, executionState, executionError
	}
	return productControlReadyAdmissionEvidence{
		BaselineProfileRef:       accountEvidence.ProfileID,
		BaselineCommitID:         accountEvidence.ContentHash,
		InitializationPlanID:     "first-run-plan:" + runtimeBaseline.GetRuntimeBaselineRef() + ":" + executionEvidence.GetExecutionEvidenceRef(),
		AccountDefaultProfileRef: accountEvidence.AccountDefaultProfileRef,
		BuiltInAIConfigRefs:      builtInRefs,
		RuntimeBaselineRef:       runtimeBaseline.GetRuntimeBaselineRef(),
		ExecutionEvidenceRef:     executionEvidence.GetExecutionEvidenceRef(),
	}, "", ""
}

func (s *Service) verifyFirstRunFactoryAIProfile(alias, installLevel string) error {
	preset, ok := s.localProviderCatalog.Preset(installLevel)
	if !ok {
		return fmt.Errorf("first-run install level %q has no Runtime local catalog preset", installLevel)
	}
	if strings.TrimSpace(preset.FactoryAIProfileAlias) != alias {
		return fmt.Errorf("aiProfileAlias %q is not admitted for first-run install level %q", alias, installLevel)
	}
	return nil
}

func (s *Service) authenticatedProductControlAccount(ctx context.Context) (*runtimev1.AccountProjection, bool) {
	if s == nil {
		return nil, false
	}
	s.mu.RLock()
	provider := s.runtimeAccountProvider
	s.mu.RUnlock()
	if provider == nil {
		return nil, false
	}
	return provider.AuthenticatedRuntimeProjection(ctx)
}

func (s *Service) productControlHostEvidenceInputs(ctx context.Context, label string) (string, *productControlRecord, string, string, string, string, error) {
	path, err := productControlRecordPath()
	if err != nil {
		return "", nil, "", "", "", "", err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return "", nil, "", "", "", "", err
	}
	if record == nil {
		return "", nil, "", "", "", "", fmt.Errorf("~/.nimi/nimi.json is missing; select nimi_data before %s", label)
	}
	dataRootPath := selectedProductDataRootPath(record)
	if dataRootPath == "" {
		return "", nil, "", "", "", "", fmt.Errorf("selected nimi_data is required before %s", label)
	}
	installLevel := strings.TrimSpace(valueOrEmpty(record.FirstRun.InstallLevel))
	if installLevel == "" {
		return "", nil, "", "", "", "", fmt.Errorf("first-run install level is required before %s", label)
	}
	aiProfileAlias := strings.TrimSpace(valueOrEmpty(record.FirstRun.AIProfileAlias))
	if aiProfileAlias == "" {
		return "", nil, "", "", "", "", fmt.Errorf("first-run aiProfileAlias is required before %s", label)
	}
	if err := s.verifyFirstRunFactoryAIProfile(aiProfileAlias, installLevel); err != nil {
		return "", nil, "", "", "", "", err
	}
	projection, ok := s.authenticatedProductControlAccount(ctx)
	if !ok {
		return "", nil, "", "", "", "", errors.New("authenticated Runtime account session is required")
	}
	accountID := strings.TrimSpace(projection.GetAccountId())
	if accountID == "" {
		return "", nil, "", "", "", "", errors.New("authenticated Runtime account session did not include account_id")
	}
	return path, record, dataRootPath, installLevel, aiProfileAlias, accountID, nil
}

func (s *Service) resolveProductControlRuntimeBaseline(ctx context.Context, runtimeBaselineRef string, selectedFactoryRef string, installLevel string, dataRootPath string) (*runtimev1.RuntimeBaselineReadinessRef, productControlState, string) {
	hostProfile, state, failure := s.productControlHostProfile(ctx)
	if failure != "" {
		return nil, state, failure
	}
	response, err := s.ResolveRuntimeBaselineReadiness(ctx, &runtimev1.ResolveRuntimeBaselineReadinessRequest{
		RuntimeBaselineRef: runtimeBaselineRef,
		HostProfile:        hostProfile,
	})
	if err != nil {
		return nil, productControlStateLocalAIProfileNotReady, err.Error()
	}
	if response.GetState() == runtimeBaselineStateRepairRequired {
		return nil, productControlStateRepairRequired, "Runtime baseline readiness owner verification failed: " + response.GetDetail()
	}
	if response.GetState() == string(productControlStateBlocked) {
		return nil, productControlStateBlocked, "Runtime baseline readiness owner verification failed: " + response.GetDetail()
	}
	if response.GetState() != runtimeBaselineStateReady || response.GetRef() == nil {
		return nil, productControlStateLocalAIProfileNotReady, "Runtime baseline readiness owner verification failed: " + response.GetDetail()
	}
	ref := response.GetRef()
	if strings.TrimSpace(ref.GetInstallLevel()) != installLevel {
		return nil, productControlStateLocalAIProfileNotReady, "Runtime baseline readiness is bound to a different install level"
	}
	if strings.TrimSpace(ref.GetSelectedLocalFactoryAiProfileRef()) != selectedFactoryRef {
		return nil, productControlStateLocalAIProfileNotReady, "Runtime baseline readiness is bound to a different selected factory AIProfile"
	}
	if strings.TrimSpace(ref.GetRuntimeDataRootOrDataRootRef()) != dataRootPath {
		return nil, productControlStateLocalAIProfileNotReady, "Runtime baseline readiness is bound to a different data root"
	}
	return ref, "", ""
}

func (s *Service) resolveProductControlExecutionEvidence(ctx context.Context, executionEvidenceRef string, runtimeBaselineRef string, selectedFactoryRef string, installLevel string, dataRootPath string) (*runtimev1.ExecutionEvidenceRef, productControlState, string) {
	hostProfile, state, failure := s.productControlHostProfile(ctx)
	if failure != "" {
		return nil, state, failure
	}
	response, err := s.ResolveFirstRunExecutionEvidence(ctx, &runtimev1.ResolveFirstRunExecutionEvidenceRequest{
		ExecutionEvidenceRef:       executionEvidenceRef,
		ExpectedRuntimeBaselineRef: runtimeBaselineRef,
		ExpectedDataRootRef:        dataRootPath,
		ExpectedInstallLevel:       installLevel,
		HostProfile:                hostProfile,
	})
	if err != nil {
		return nil, productControlStateLocalAIReady, err.Error()
	}
	if response.GetState() == "blocked" || response.GetState() == "local_ai_blocked" {
		return nil, productControlStateBlocked, "Runtime baseline execution owner verification failed: " + response.GetDetail()
	}
	if response.GetState() != string(productControlStateLocalAIReady) || response.GetRef() == nil {
		return nil, productControlStateLocalAIReady, "Runtime baseline execution owner verification failed: " + response.GetDetail()
	}
	ref := response.GetRef()
	if strings.TrimSpace(ref.GetRuntimeBaselineRef()) != runtimeBaselineRef {
		return nil, productControlStateLocalAIReady, "execution evidence is bound to a different runtimeBaselineRef"
	}
	if strings.TrimSpace(ref.GetSelectedLocalFactoryAiProfileRef()) != selectedFactoryRef {
		return nil, productControlStateLocalAIReady, "execution evidence is bound to a different selected factory AIProfile"
	}
	if strings.TrimSpace(ref.GetInstallLevel()) != installLevel {
		return nil, productControlStateLocalAIReady, "execution evidence is bound to a different install level"
	}
	if strings.TrimSpace(ref.GetDataRootRef()) != dataRootPath {
		return nil, productControlStateLocalAIReady, "execution evidence is bound to a different data root"
	}
	return ref, "", ""
}

func (s *Service) productControlHostProfile(ctx context.Context) (*runtimev1.LocalDeviceProfile, productControlState, string) {
	response, err := s.CollectDeviceProfile(ctx, &runtimev1.CollectDeviceProfileRequest{})
	if err != nil {
		return nil, productControlStateLocalAIProfileNotReady, "Runtime device profile owner verification failed: " + err.Error()
	}
	profile := response.GetProfile()
	if profile == nil || strings.TrimSpace(profile.GetOs()) == "" || strings.TrimSpace(profile.GetArch()) == "" {
		return nil, productControlStateLocalAIProfileNotReady, "Runtime device profile owner verification failed: missing os or arch"
	}
	return profile, "", ""
}

func parseAndVerifyAccountDefaultProfileAdmissionEvidence(raw string, record *productControlRecord, accountID string, dataRootRef string, aiProfileAlias string) (accountDefaultProfileAdmissionEvidence, productControlState, string) {
	evidence, state, failure := parseAndVerifyAccountDefaultProfileEvidence(raw, accountID, dataRootRef, aiProfileAlias)
	if failure != "" {
		return evidence, state, failure
	}
	expectedRef := strings.TrimSpace(valueOrEmpty(record.FirstRun.AccountDefaultProfileRef))
	if expectedRef == "" {
		return evidence, productControlStateLocalAIReady, "accountDefaultProfileRef is required before ready admission"
	}
	if strings.TrimSpace(evidence.AccountDefaultProfileRef) != expectedRef {
		return evidence, productControlStateLocalAIReady, "Account Default Profile ref is stale or mismatched"
	}
	return evidence, "", ""
}

func parseAndVerifyAccountDefaultProfileEvidence(raw string, accountID string, dataRootRef string, aiProfileAlias string) (accountDefaultProfileAdmissionEvidence, productControlState, string) {
	var evidence accountDefaultProfileAdmissionEvidence
	if err := json.Unmarshal([]byte(raw), &evidence); err != nil {
		return evidence, productControlStateLocalAIReady, "Account Default Profile owner evidence is missing or invalid JSON"
	}
	if strings.TrimSpace(evidence.AccountDefaultProfileRef) == "" {
		return evidence, productControlStateLocalAIReady, "Account Default Profile ref is required"
	}
	if strings.TrimSpace(evidence.AccountID) != accountID {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence is bound to a different account"
	}
	if strings.TrimSpace(evidence.DataRootRef) != dataRootRef {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence is bound to a different data root"
	}
	if strings.TrimSpace(evidence.AIProfileAlias) != aiProfileAlias {
		return evidence, productControlStateAIEnvironmentUnconfigured, "Account Default Profile evidence is bound to a different AI profile"
	}
	if strings.TrimSpace(evidence.ProfileID) == "" || strings.TrimSpace(evidence.ContentHash) == "" {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence is missing baseline refs"
	}
	if !strings.HasPrefix(strings.TrimSpace(evidence.ContentHash), "sha256:") ||
		!strings.HasPrefix(strings.TrimSpace(evidence.ProfilePayloadHash), "sha256:") ||
		!strings.HasPrefix(strings.TrimSpace(evidence.FactoryProvenanceHash), "sha256:") {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence hash fields must use sha256"
	}
	if strings.TrimSpace(evidence.SourcePolicyRef) == "" || strings.TrimSpace(evidence.SourceCatalogID) == "" || evidence.SourceCatalogVersion <= 0 ||
		strings.TrimSpace(evidence.CreatedAt) == "" || strings.TrimSpace(evidence.UpdatedAt) == "" {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence required projection is incomplete"
	}
	return evidence, "", ""
}

func parseAndVerifyBuiltInAIConfigAdmissionEvidence(raw string, record *productControlRecord, accountID string, dataRootRef string, aiProfileAlias string, installLevel string) ([]string, productControlState, string) {
	var evidenceSet builtInAIConfigAdmissionEvidenceSet
	if err := json.Unmarshal([]byte(raw), &evidenceSet); err != nil {
		return nil, productControlStateLocalAIReady, "built-in AIConfig owner evidence is missing or invalid JSON"
	}
	refs := []string{strings.TrimSpace(evidenceSet.Nimi.BuiltInAIConfigRef), strings.TrimSpace(evidenceSet.Agent.BuiltInAIConfigRef)}
	if len(record.FirstRun.BuiltInAIConfigRefs) > 0 && !sameStringSet(refs, record.FirstRun.BuiltInAIConfigRefs) {
		return nil, productControlStateLocalAIReady, "built-in AIConfig evidence refs are stale or mismatched"
	}
	for expectedSurface, evidence := range map[string]builtInAIConfigAdmissionEvidence{
		"nimi":  evidenceSet.Nimi,
		"agent": evidenceSet.Agent,
	} {
		if strings.TrimSpace(evidence.BuiltInAIConfigRef) == "" ||
			strings.TrimSpace(evidence.AIConfigContentHash) == "" ||
			strings.TrimSpace(evidence.WriterIdentity) == "" ||
			strings.TrimSpace(evidence.CommittedAt) == "" ||
			evidence.AIConfigVersion == 0 {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence required projection is incomplete"
		}
		if !strings.HasPrefix(strings.TrimSpace(evidence.AIConfigContentHash), "sha256:") ||
			!strings.HasPrefix(strings.TrimSpace(evidence.AIProfileRef.ProfilePayloadHash), "sha256:") {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence hash fields must use sha256"
		}
		if strings.TrimSpace(evidence.AccountID) != accountID || strings.TrimSpace(evidence.DataRootRef) != dataRootRef {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence is bound to a different account or data root"
		}
		if evidence.ScopeRef.Kind != "feature" || evidence.ScopeRef.OwnerID != "desktop.chat" || evidence.ScopeRef.SurfaceID != expectedSurface {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence is not bound to the canonical desktop chat scopes"
		}
		if strings.TrimSpace(evidence.AIProfileRef.AIProfileAlias) != aiProfileAlias || strings.TrimSpace(evidence.AIProfileRef.InstallLevel) != installLevel {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence is bound to a different AI profile"
		}
		if strings.TrimSpace(evidence.AIProfileRef.SourcePolicyRef) == "" ||
			strings.TrimSpace(evidence.AIProfileRef.SourceCatalogID) == "" ||
			evidence.AIProfileRef.SourceCatalogVersion <= 0 ||
			strings.TrimSpace(evidence.AIProfileRef.AppliedAt) == "" {
			return nil, productControlStateLocalAIReady, "built-in AIConfig AIProfile projection is incomplete"
		}
	}
	return refs, "", ""
}

func applyProductControlReadyEvidence(record *productControlRecord, evidence productControlReadyAdmissionEvidence) {
	completedAt := nowProductControlISO()
	record.State = productControlStateReadyForUse
	record.FirstRun.Completed = true
	record.FirstRun.CompletedAt = &completedAt
	record.FirstRun.InitializationPlanID = stringPtr(evidence.InitializationPlanID)
	record.FirstRun.BaselineProfileRef = stringPtr(evidence.BaselineProfileRef)
	record.FirstRun.BaselineCommitID = stringPtr(evidence.BaselineCommitID)
	record.FirstRun.AccountDefaultProfileRef = stringPtr(evidence.AccountDefaultProfileRef)
	record.FirstRun.BuiltInAIConfigRefs = append([]string{}, evidence.BuiltInAIConfigRefs...)
	record.FirstRun.RuntimeBaselineRef = stringPtr(evidence.RuntimeBaselineRef)
	record.FirstRun.ExecutionEvidenceRef = stringPtr(evidence.ExecutionEvidenceRef)
	record.Repair = productRepairRecord{}
	if record.DataRoot != nil {
		record.DataRoot.Status = productDataRootStatusReady
		record.DataRoot.VerifiedAt = nowProductControlISO()
		record.DataRoot.VerifiedAtUnixMs = nowProductControlUnixMS()
	}
}

func routeProductControlAdmissionFailure(path string, record *productControlRecord, state productControlState, detail string) error {
	record.State = state
	if state == productControlStateRepairRequired || state == productControlStateBlocked {
		record.Repair = productRepairRecord{Required: true, Reason: stringPtr(detail)}
		if record.DataRoot != nil {
			record.DataRoot.Status = productDataRootStatusRepairRequired
		}
	} else {
		record.Repair = productRepairRecord{}
	}
	return writeProductControlRecord(path, record)
}

func productControlJSON(value any, err error) (*runtimev1.ProductControlProjectionJson, error) {
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("serialize product-control projection: %w", err)
	}
	return &runtimev1.ProductControlProjectionJson{Json: string(raw)}, nil
}

func (s *Service) readProductControlProjection(ctx context.Context) (productControlRecordProjection, error) {
	path, err := productControlRecordPath()
	if err != nil {
		return productControlRecordProjection{}, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		message := err.Error()
		return productControlRecordProjection{Path: path, Exists: true, State: productControlStateRepairRequired, Error: &message}, nil
	}
	if record == nil {
		message := "~/.nimi/nimi.json is missing; first-run data-root selection has not initialized product control"
		return productControlRecordProjection{Path: path, Exists: false, State: productControlStateConfigMissing, Error: &message}, nil
	}
	if record.State == productControlStateReadyForUse {
		state, message := s.verifyProductControlReadyRecord(ctx, record)
		if message != "" {
			return productControlRecordProjection{Path: path, Exists: true, State: state, Error: &message}, nil
		}
	}
	return productControlRecordProjection{Path: path, Exists: true, State: record.State, Record: record}, nil
}

func (s *Service) verifyProductControlReadyRecord(ctx context.Context, record *productControlRecord) (productControlState, string) {
	dataRootPath := selectedProductDataRootPath(record)
	installLevel := strings.TrimSpace(valueOrEmpty(record.FirstRun.InstallLevel))
	if dataRootPath == "" || installLevel == "" {
		return productControlStateLocalAIReady, "~/.nimi/nimi.json ready_for_use requires Runtime product-control admission; legacy Desktop admission is not accepted"
	}
	selectedFactoryRef := firstRunFactoryProfileRef(installLevel)
	runtimeBaselineRef := strings.TrimSpace(valueOrEmpty(record.FirstRun.RuntimeBaselineRef))
	if _, state, failure := s.resolveProductControlRuntimeBaseline(ctx, runtimeBaselineRef, selectedFactoryRef, installLevel, dataRootPath); failure != "" {
		return state, "Runtime product-control ready read failed owner verification: " + failure
	}
	executionEvidenceRef := strings.TrimSpace(valueOrEmpty(record.FirstRun.ExecutionEvidenceRef))
	if _, state, failure := s.resolveProductControlExecutionEvidence(ctx, executionEvidenceRef, runtimeBaselineRef, selectedFactoryRef, installLevel, dataRootPath); failure != "" {
		return state, "Runtime product-control ready read failed owner verification: " + failure
	}
	return "", ""
}

func readProductControlSelectedDataRootProjection() (productControlSelectedDataRootProjection, error) {
	path, err := productControlRecordPath()
	if err != nil {
		return productControlSelectedDataRootProjection{}, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		message := err.Error()
		return productControlSelectedDataRootProjection{Path: path, Exists: true, State: productControlStateRepairRequired, Error: &message}, nil
	}
	if record == nil {
		message := "~/.nimi/nimi.json is missing; selected nimi_data is not ready"
		return productControlSelectedDataRootProjection{Path: path, Exists: false, State: productControlStateConfigMissing, Error: &message}, nil
	}
	var dataRoot *productDataRootRecord
	if selectedProductDataRootPath(record) != "" {
		dataRoot = record.DataRoot
	}
	var message *string
	if dataRoot == nil {
		message = stringPtr("~/.nimi/nimi.json has no selected absolute dataRoot.path")
	}
	return productControlSelectedDataRootProjection{Path: path, Exists: true, State: record.State, DataRoot: dataRoot, Error: message}, nil
}

func readProductControlRecord(path string) (*productControlRecord, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read ~/.nimi/nimi.json failed (%s): %w", path, err)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	var record productControlRecord
	if err := dec.Decode(&record); err != nil {
		return nil, fmt.Errorf("parse ~/.nimi/nimi.json failed (%s): %w", path, err)
	}
	if err := validateProductControlRecord(&record); err != nil {
		return nil, err
	}
	return &record, nil
}

func validateProductControlRecord(record *productControlRecord) error {
	if record.SchemaVersion != productControlSchemaVersion {
		return fmt.Errorf("unsupported ~/.nimi/nimi.json schemaVersion=%d expected=%d", record.SchemaVersion, productControlSchemaVersion)
	}
	if strings.TrimSpace(record.InstallID) == "" {
		return errors.New("~/.nimi/nimi.json installId is required")
	}
	if strings.TrimSpace(record.ProductVersion) == "" {
		return errors.New("~/.nimi/nimi.json productVersion is required")
	}
	if stateRequiresDataRoot(record.State) && selectedProductDataRootPath(record) == "" {
		return errors.New("~/.nimi/nimi.json state requires dataRoot.path")
	}
	if record.DataRoot != nil && (strings.TrimSpace(record.DataRoot.SelectedAt) == "" || strings.TrimSpace(record.DataRoot.VerifiedAt) == "") {
		return errors.New("~/.nimi/nimi.json dataRoot requires selectedAt and verifiedAt")
	}
	if record.FirstRun.InstallLevel != nil {
		level := strings.TrimSpace(*record.FirstRun.InstallLevel)
		if level != "minimal" && level != "recommended" {
			return errors.New("~/.nimi/nimi.json firstRun.installLevel must be minimal or recommended")
		}
	}
	if record.State == productControlStateReadyForUse {
		if err := validateReadyForUseShape(record); err != nil {
			return err
		}
	}
	return nil
}

func validateReadyForUseShape(record *productControlRecord) error {
	if record.DataRoot == nil || record.DataRoot.Status != productDataRootStatusReady {
		return errors.New("~/.nimi/nimi.json ready_for_use requires dataRoot.status=ready")
	}
	firstRun := record.FirstRun
	if !firstRun.Completed {
		return errors.New("~/.nimi/nimi.json ready_for_use requires firstRun.completed=true")
	}
	required := firstRun.CompletedAt != nil && strings.TrimSpace(*firstRun.CompletedAt) != "" &&
		firstRun.InstallLevel != nil && strings.TrimSpace(*firstRun.InstallLevel) != "" &&
		firstRun.InitializationPlanID != nil && strings.TrimSpace(*firstRun.InitializationPlanID) != "" &&
		firstRun.BaselineProfileRef != nil && strings.TrimSpace(*firstRun.BaselineProfileRef) != "" &&
		firstRun.BaselineCommitID != nil && strings.TrimSpace(*firstRun.BaselineCommitID) != "" &&
		firstRun.AccountDefaultProfileRef != nil && strings.TrimSpace(*firstRun.AccountDefaultProfileRef) != "" &&
		len(firstRun.BuiltInAIConfigRefs) > 0 &&
		firstRun.RuntimeBaselineRef != nil && strings.TrimSpace(*firstRun.RuntimeBaselineRef) != "" &&
		firstRun.ExecutionEvidenceRef != nil && strings.TrimSpace(*firstRun.ExecutionEvidenceRef) != ""
	if !required {
		return errors.New("~/.nimi/nimi.json ready_for_use requires the full first-run ready evidence field set")
	}
	for _, ref := range firstRun.BuiltInAIConfigRefs {
		if strings.TrimSpace(ref) == "" {
			return errors.New("~/.nimi/nimi.json ready_for_use requires non-empty builtInAiConfigRefs")
		}
	}
	return nil
}

func stateRequiresDataRoot(state productControlState) bool {
	switch state {
	case productControlStateDataRootSelected, productControlStateAIEnvironmentUnconfigured, productControlStateLocalAIProfileAssetsMissing, productControlStateLocalAIProfileNotReady, productControlStateLocalAIAssetsDownloadedEnvironmentNotReady, productControlStateLocalAIReady, productControlStateReadyForUse:
		return true
	default:
		return false
	}
}

const (
	productControlStateLocalAIProfileAssetsMissing                productControlState = "local_ai_profile_selected_assets_missing"
	productControlStateLocalAIAssetsDownloadedEnvironmentNotReady productControlState = "local_ai_assets_downloaded_environment_not_ready"
)

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func firstRunFactoryProfileRef(installLevel string) string {
	return fmt.Sprintf("aiprofile/nimi.first-run.local-factory.%s@1", strings.ToLower(strings.TrimSpace(installLevel)))
}

func parseProductControlRuntimeSetupState(value string) (productControlState, error) {
	switch productControlState(strings.TrimSpace(value)) {
	case productControlStateLocalAIProfileAssetsMissing,
		productControlStateLocalAIProfileNotReady,
		productControlStateLocalAIAssetsDownloadedEnvironmentNotReady,
		productControlStateRepairRequired,
		productControlStateBlocked:
		return productControlState(strings.TrimSpace(value)), nil
	case productControlStateLocalAIReady:
		return "", errors.New("first-run setup state cannot mark local AI ready without Runtime evidence recording")
	case productControlStateReadyForUse:
		return "", errors.New("first-run setup state cannot mark ready_for_use")
	default:
		return "", errors.New("first-run setup state must be a non-ready local setup, repair, or blocked state")
	}
}

func productControlDataRootRef(dataRootPath string) string {
	sum := sha256.Sum256([]byte(filepath.Clean(dataRootPath)))
	return "data-root:sha256:" + hex.EncodeToString(sum[:])
}

func sameStringSet(left []string, right []string) bool {
	normalize := func(values []string) []string {
		out := make([]string, 0, len(values))
		for _, value := range values {
			trimmed := strings.TrimSpace(value)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
		sort.Strings(out)
		return out
	}
	l := normalize(left)
	r := normalize(right)
	if len(l) != len(r) {
		return false
	}
	for i := range l {
		if l[i] != r[i] {
			return false
		}
	}
	return true
}

func ensureProductControlDataRootSelectionAllowed(record *productControlRecord) error {
	switch record.State {
	case productControlStateConfigMissing, productControlStateDataRootMissing, productControlStateDataRootSelected, productControlStateAIEnvironmentUnconfigured:
	default:
		return fmt.Errorf("nimi_data data root is already beyond first-run selection state (%s); data-root selection is first-run only", record.State)
	}
	if record.DataRoot != nil && record.DataRoot.Status == productDataRootStatusReady {
		return errors.New("nimi_data data root is already ready; data-root selection is first-run only")
	}
	firstRun := record.FirstRun
	if firstRun.Completed || firstRun.CompletedAt != nil || firstRun.InitializationPlanID != nil || firstRun.BaselineProfileRef != nil || firstRun.BaselineCommitID != nil || firstRun.AccountDefaultProfileRef != nil || len(firstRun.BuiltInAIConfigRefs) > 0 || firstRun.RuntimeBaselineRef != nil || firstRun.ExecutionEvidenceRef != nil {
		return errors.New("nimi_data data root cannot be changed after first-run evidence exists")
	}
	return nil
}

func (s *Service) emptyProductControlRecord(state productControlState) (*productControlRecord, error) {
	productVersion, err := s.productControlProductVersion()
	if err != nil {
		return nil, err
	}
	return &productControlRecord{
		SchemaVersion:  productControlSchemaVersion,
		InstallID:      fmt.Sprintf("local-%d-%d", nowProductControlUnixMS(), os.Getpid()),
		ProductVersion: productVersion,
		State:          state,
		FirstRun:       productFirstRunRecord{BuiltInAIConfigRefs: []string{}},
		Pointers:       resolveProductControlPointers(),
		Repair:         productRepairRecord{},
	}, nil
}

func (s *Service) productControlProductVersion() (string, error) {
	if s == nil {
		return "", errors.New("local service is nil")
	}
	s.mu.RLock()
	version := strings.TrimSpace(s.productVersion)
	s.mu.RUnlock()
	if version == "" {
		return "", errors.New("Runtime product version is required before product-control record creation")
	}
	return version, nil
}

func selectedProductDataRootPath(record *productControlRecord) string {
	if record == nil || record.DataRoot == nil {
		return ""
	}
	value := strings.TrimSpace(record.DataRoot.Path)
	if value == "" || !filepath.IsAbs(value) {
		return ""
	}
	return filepath.Clean(value)
}

func writeProductControlRecord(path string, record *productControlRecord) error {
	if err := validateProductControlRecord(record); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create ~/.nimi directory failed (%s): %w", filepath.Dir(path), err)
	}
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize ~/.nimi/nimi.json failed: %w", err)
	}
	tmp := fmt.Sprintf("%s.tmp.%d.%d", path, os.Getpid(), nowProductControlUnixMS())
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return fmt.Errorf("write ~/.nimi/nimi.json temporary file failed (%s): %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("commit ~/.nimi/nimi.json failed (%s): %w", path, err)
	}
	return nil
}

func productControlRecordPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve HOME for ~/.nimi/nimi.json: %w", err)
	}
	return filepath.Join(home, ".nimi", "nimi.json"), nil
}

func resolveProductControlPointers() productPointersRecord {
	home, err := os.UserHomeDir()
	if err != nil {
		return productPointersRecord{}
	}
	nimiDir := filepath.Join(home, ".nimi")
	return productPointersRecord{
		RuntimeConfigPath:   stringPtr(filepath.Join(nimiDir, "runtime", "config.json")),
		FactoryProfileIndex: stringPtr(filepath.Join(nimiDir, "profiles", "factory-index.json")),
		AppRegistry:         stringPtr(filepath.Join(nimiDir, "apps", "registry.json")),
		AppPackages:         stringPtr(filepath.Join(nimiDir, "apps", "packages.json")),
	}
}

func ensureNimiDataRootLayout(root string) error {
	for _, dir := range []string{"models", "dependencies", "environments", "apps", "accounts", "cache", "logs", "audit", "generated", "tmp"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			return fmt.Errorf("create nimi_data directory %s: %w", dir, err)
		}
	}
	return nil
}

func nowProductControlUnixMS() int64 {
	return time.Now().UnixMilli()
}

func nowProductControlISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func stringPtr(value string) *string {
	return &value
}
