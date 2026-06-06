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
			return productControlRecordProjection{Path: path, Exists: true, State: state, Record: record, Error: &message}, nil
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
