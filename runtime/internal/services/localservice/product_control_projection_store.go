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
	path, err := s.productControlRecordPath()
	if err != nil {
		return productControlRecordProjection{}, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		message := err.Error()
		return s.withProductControlDataRootProposal(productControlRecordProjection{Path: path, Exists: true, State: productControlStateRepairRequired, Error: &message}), nil
	}
	if record == nil {
		message := "product-control record is missing; first-run data-root selection has not initialized product control"
		return s.withProductControlDataRootProposal(productControlRecordProjection{Path: path, Exists: false, State: productControlStateConfigMissing, Error: &message}), nil
	}
	if state, message := verifyProductControlSelectedDataRoot(record); message != "" {
		projectedRecord := record
		if state == productControlStateDataRootMissing {
			projectedRecord = productControlRecordWithoutSelectedDataRoot(record)
		}
		return s.withProductControlDataRootProposal(productControlRecordProjection{Path: path, Exists: true, State: state, Record: projectedRecord, Error: &message}), nil
	}
	if record.State == productControlStateReadyForUse {
		state, message := s.verifyProductControlReadyRecord(ctx, record)
		if message != "" {
			return s.withProductControlDataRootProposal(productControlRecordProjection{Path: path, Exists: true, State: state, Record: record, Error: &message}), nil
		}
	}
	return s.withProductControlDataRootProposal(productControlRecordProjection{Path: path, Exists: true, State: record.State, Record: record}), nil
}

func (s *Service) withProductControlDataRootProposal(projection productControlRecordProjection) productControlRecordProjection {
	if s == nil {
		return projection
	}
	s.mu.Lock()
	path := strings.TrimSpace(s.productControlDataRootProposal)
	if path != "" {
		s.productControlProposalLocked = true
	}
	s.mu.Unlock()
	if path != "" {
		projection.DataRootProposal = &productControlDataRootProposal{
			Path:      path,
			Authority: "runtime_protected_product_control",
			Profile:   "dev_kernel_checkpoint",
		}
	}
	return projection
}

func productControlRecordWithoutSelectedDataRoot(record *productControlRecord) *productControlRecord {
	if record == nil {
		return nil
	}
	projected := *record
	projected.DataRoot = nil
	return &projected
}

func (s *Service) verifyProductControlReadyRecord(ctx context.Context, record *productControlRecord) (productControlState, string) {
	dataRootPath := selectedProductDataRootPath(record)
	installLevel := strings.TrimSpace(valueOrEmpty(record.FirstRun.InstallLevel))
	if dataRootPath == "" || installLevel == "" {
		return productControlStateLocalAIReady, "product-control ready_for_use requires Runtime product-control admission; Desktop projection is not admission"
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

func (s *Service) readProductControlSelectedDataRootProjection() (productControlSelectedDataRootProjection, error) {
	path, err := s.productControlRecordPath()
	if err != nil {
		return productControlSelectedDataRootProjection{}, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		message := err.Error()
		return productControlSelectedDataRootProjection{Path: path, Exists: true, State: productControlStateRepairRequired, Error: &message}, nil
	}
	if record == nil {
		message := "product-control record is missing; selected nimi_data is not ready"
		return productControlSelectedDataRootProjection{Path: path, Exists: false, State: productControlStateConfigMissing, Error: &message}, nil
	}
	if state, failure := verifyProductControlSelectedDataRoot(record); failure != "" {
		return productControlSelectedDataRootProjection{
			Path:   path,
			Exists: true,
			State:  state,
			Error:  &failure,
		}, nil
	}
	var dataRoot *productDataRootRecord
	if selectedProductDataRootPath(record) != "" {
		dataRoot = record.DataRoot
	}
	var message *string
	if dataRoot == nil {
		message = stringPtr("product-control record has no selected absolute dataRoot.path")
	}
	return productControlSelectedDataRootProjection{Path: path, Exists: true, State: record.State, DataRoot: dataRoot, Error: message}, nil
}

var nimiDataRootRequiredDirectories = []string{
	"models",
	"dependencies",
	"environments",
	"apps",
	"accounts",
	"cache",
	"logs",
	"audit",
	"generated",
	"tmp",
}

// verifyProductControlSelectedDataRoot re-evaluates the owner-selected path
// without mutating either the durable record or the filesystem. Before any
// first-run evidence exists, an invalid selection can safely return to the
// Storage phase. Once selection is no longer allowed, the same failure is a
// repair condition and must not silently reopen first-run selection.
func verifyProductControlSelectedDataRoot(record *productControlRecord) (productControlState, string) {
	dataRootPath := selectedProductDataRootPath(record)
	if dataRootPath == "" {
		return "", ""
	}
	if err := verifyNimiDataRootLayout(dataRootPath); err == nil {
		return "", ""
	} else {
		message := fmt.Sprintf("Runtime owner verification rejected selected nimi_data (%s): %v", dataRootPath, err)
		if ensureProductControlDataRootSelectionAllowed(record) == nil {
			return productControlStateDataRootMissing, message
		}
		return productControlStateRepairRequired, message
	}
}

func verifyNimiDataRootLayout(root string) error {
	info, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("data root is unavailable: %w", err)
	}
	if !info.IsDir() {
		return errors.New("data root is not a directory")
	}
	for _, dir := range nimiDataRootRequiredDirectories {
		entryPath := filepath.Join(root, dir)
		entry, err := os.Stat(entryPath)
		if err != nil {
			return fmt.Errorf("required directory %s is unavailable: %w", dir, err)
		}
		if !entry.IsDir() {
			return fmt.Errorf("required path %s is not a directory", dir)
		}
	}
	return nil
}

func readProductControlRecord(path string) (*productControlRecord, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read product-control record failed (%s): %w", path, err)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	var record productControlRecord
	if err := dec.Decode(&record); err != nil {
		return nil, fmt.Errorf("parse product-control record failed (%s): %w", path, err)
	}
	if err := validateProductControlRecord(&record); err != nil {
		return nil, err
	}
	return &record, nil
}

func validateProductControlRecord(record *productControlRecord) error {
	if record.SchemaVersion != productControlSchemaVersion {
		return fmt.Errorf("unsupported product-control schemaVersion=%d expected=%d", record.SchemaVersion, productControlSchemaVersion)
	}
	if strings.TrimSpace(record.InstallID) == "" {
		return errors.New("product-control installId is required")
	}
	if strings.TrimSpace(record.ProductVersion) == "" {
		return errors.New("product-control productVersion is required")
	}
	if stateRequiresDataRoot(record.State) && selectedProductDataRootPath(record) == "" {
		return errors.New("product-control state requires dataRoot.path")
	}
	if record.DataRoot != nil && (strings.TrimSpace(record.DataRoot.SelectedAt) == "" || strings.TrimSpace(record.DataRoot.VerifiedAt) == "") {
		return errors.New("product-control dataRoot requires selectedAt and verifiedAt")
	}
	if record.FirstRun.InstallLevel != nil {
		level := strings.TrimSpace(*record.FirstRun.InstallLevel)
		if level != "minimal" && level != "recommended" {
			return errors.New("product-control firstRun.installLevel must be minimal or recommended")
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
		return errors.New("product-control ready_for_use requires dataRoot.status=ready")
	}
	firstRun := record.FirstRun
	if !firstRun.Completed {
		return errors.New("product-control ready_for_use requires firstRun.completed=true")
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
		return errors.New("product-control ready_for_use requires the full first-run ready evidence field set")
	}
	for _, ref := range firstRun.BuiltInAIConfigRefs {
		if strings.TrimSpace(ref) == "" {
			return errors.New("product-control ready_for_use requires non-empty builtInAiConfigRefs")
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
		Pointers:       s.resolveProductControlPointers(),
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
		return fmt.Errorf("create product-control directory failed (%s): %w", filepath.Dir(path), err)
	}
	raw, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return fmt.Errorf("serialize product-control record failed: %w", err)
	}
	tmp := fmt.Sprintf("%s.tmp.%d.%d", path, os.Getpid(), nowProductControlUnixMS())
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return fmt.Errorf("write product-control temporary file failed (%s): %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("commit product-control record failed (%s): %w", path, err)
	}
	return nil
}

func productControlRootFromStateStorePath(stateStorePath string) string {
	path := filepath.Clean(strings.TrimSpace(stateStorePath))
	if path == "." || !filepath.IsAbs(path) {
		return ""
	}
	root := filepath.Dir(path)
	if strings.EqualFold(filepath.Base(root), "runtime") {
		root = filepath.Dir(root)
	}
	return root
}

// SetProductControlRoot binds product-control state to one Runtime-owner root.
// Protected service startup supplies its already-verified service state root;
// ordinary non-production Runtime derives the same owner root from its local
// state-store path. No environment, request, or renderer input can change the
// root after startup.
func (s *Service) SetProductControlRoot(root string) error {
	if s == nil {
		return errors.New("local service is nil")
	}
	normalized := filepath.Clean(strings.TrimSpace(root))
	if normalized == "." || !filepath.IsAbs(normalized) || normalized == filepath.VolumeName(normalized)+string(filepath.Separator) {
		return fmt.Errorf("product-control root must be an absolute non-root path")
	}
	s.mu.Lock()
	if s.productControlRootLocked {
		s.mu.Unlock()
		return errors.New("product-control root is already in use")
	}
	s.productControlRoot = normalized
	s.mu.Unlock()
	return nil
}

// SetProductControlDataRootProposal binds the non-release First Run directory
// proposal before protected listeners open. It does not create or select the
// path; SelectProductControlDataRoot remains the only record mutation.
func (s *Service) SetProductControlDataRootProposal(path string) error {
	if s == nil {
		return errors.New("local service is nil")
	}
	normalized := filepath.Clean(strings.TrimSpace(path))
	if normalized == "." || !filepath.IsAbs(normalized) || normalized == filepath.VolumeName(normalized)+string(filepath.Separator) {
		return fmt.Errorf("product-control data-root proposal must be an absolute non-root path")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.productControlProposalLocked {
		return errors.New("product-control data-root proposal is already in use")
	}
	s.productControlDataRootProposal = normalized
	return nil
}

func (s *Service) productControlRecordPath() (string, error) {
	if s == nil {
		return "", errors.New("local service is nil")
	}
	s.mu.Lock()
	root := strings.TrimSpace(s.productControlRoot)
	if root != "" {
		s.productControlRootLocked = true
	}
	s.mu.Unlock()
	if root == "" {
		return "", errors.New("product-control root is unavailable")
	}
	return filepath.Join(root, "nimi.json"), nil
}

func (s *Service) resolveProductControlPointers() productPointersRecord {
	// Product control owns readiness state, not Runtime configuration or app
	// discovery/package paths. The schema retains the opaque pointers object,
	// but 0K forbids every path field until an independent owner admits one.
	return productPointersRecord{}
}

func ensureNimiDataRootLayout(root string) error {
	for _, dir := range nimiDataRootRequiredDirectories {
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
