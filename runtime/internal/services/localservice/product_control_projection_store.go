package localservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const productControlRecordMaxBytes = 64 * 1024
const productControlMaxJSONSafeInteger = int64(1<<53 - 1)

var productControlRecordFields = []string{
	"schemaVersion",
	"installId",
	"productVersion",
	"state",
	"dataRoot",
	"firstRun",
	"pointers",
	"repair",
}

var productControlDataRootFields = []string{
	"path",
	"status",
	"selectedAt",
	"verifiedAt",
	"selectedAtUnixMs",
	"verifiedAtUnixMs",
}

var productControlFirstRunFields = []string{
	"installLevel",
	"aiProfileAlias",
	"completed",
	"completedAt",
}

var productControlPointerFields = []string{"factoryProfileIndex"}
var productControlRepairFields = []string{"required", "reason"}

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
		return productControlRecordProjection{Path: path, Exists: true, State: productControlStateRepairRequired, Error: &message}, nil
	}
	if record == nil {
		message := "product-control record is missing; first-run data-root selection has not initialized product control"
		return productControlRecordProjection{Path: path, Exists: false, State: productControlStateConfigMissing, Error: &message}, nil
	}
	if state, message := verifyProductControlSelectedDataRoot(record, s.productControlDataRootSecurityBinding()); message != "" {
		projectedRecord := record
		if state == productControlStateDataRootMissing {
			projectedRecord = productControlRecordWithoutSelectedDataRoot(record)
		}
		return productControlRecordProjection{Path: path, Exists: true, State: state, Record: projectedRecord, Error: &message}, nil
	}
	if usability := evaluateProductControlUsability(record); usability.RepairRequired {
		message := "Product Control requires repair"
		return productControlRecordProjection{Path: path, Exists: true, State: record.State, Record: record, Error: &message}, nil
	}
	if record.State == productControlStateReadyForUse {
		state, message := s.verifyProductControlReadyRecord(ctx, record)
		if message != "" {
			return productControlRecordProjection{Path: path, Exists: true, State: state, Record: record, Error: &message}, nil
		}
	}
	return productControlRecordProjection{Path: path, Exists: true, State: record.State, Record: record}, nil
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
	if err := validateReadyForUseShape(record); err != nil {
		return productControlStateLocalAIReady, err.Error()
	}
	if state, failure := s.verifyProductControlReadyAdmission(ctx, record); failure != "" {
		return state, "Runtime product-control ready read failed admission verification: " + failure
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
	usability := evaluateProductControlUsability(record)
	if usability.RepairRequired || !usability.Selected {
		message := "Product Control has no usable selected data root"
		if usability.RepairRequired {
			message = "Product Control requires repair"
		}
		return productControlSelectedDataRootProjection{
			Path:   path,
			Exists: true,
			State:  record.State,
			Error:  &message,
		}, nil
	}
	if state, failure := verifyProductControlSelectedDataRoot(record, s.productControlDataRootSecurityBinding()); failure != "" {
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
	"logs",
	"audit",
}

var retiredNimiDataRootDirectories = []string{
	"cache",
	"generated",
	"tmp",
}

// verifyProductControlSelectedDataRoot re-evaluates the owner-selected path
// without mutating either the durable record or the filesystem. Before any
// first-run setup advances beyond root selection, an invalid selection can safely return to the
// Storage phase. Once selection is no longer allowed, the same failure is a
// repair condition and must not silently reopen first-run selection.
func verifyProductControlSelectedDataRoot(record *productControlRecord, security ProductControlDataRootSecurityBinding) (productControlState, string) {
	dataRootPath := selectedProductDataRootPath(record)
	if dataRootPath == "" {
		return "", ""
	}
	if err := verifyNimiDataRootLayout(dataRootPath, security); err == nil {
		return "", ""
	} else {
		message := fmt.Sprintf("Runtime owner verification rejected selected nimi_data (%s): %v", dataRootPath, err)
		if ensureProductControlDataRootSelectionAllowed(record) == nil {
			return productControlStateDataRootMissing, message
		}
		return productControlStateRepairRequired, message
	}
}

func verifyNimiDataRootLayout(root string, security ProductControlDataRootSecurityBinding) error {
	if err := validateProductControlDataRootPlatform(filepath.Clean(root), security); err != nil {
		return fmt.Errorf("data root security validation failed: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("data root is unavailable: %w", err)
	}
	if !info.IsDir() {
		return errors.New("data root is not a directory")
	}
	for _, dir := range retiredNimiDataRootDirectories {
		entryPath := filepath.Join(root, dir)
		if _, err := os.Lstat(entryPath); err == nil {
			return fmt.Errorf("retired root-level directory %s still exists", dir)
		} else if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("inspect retired root-level directory %s: %w", dir, err)
		}
	}
	for _, dir := range nimiDataRootRequiredDirectories {
		entryPath := filepath.Join(root, dir)
		if err := validateProductControlDataRootPlatform(entryPath, ProductControlDataRootSecurityBinding{}); err != nil {
			return fmt.Errorf("required directory %s security validation failed: %w", dir, err)
		}
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
	if filepath.Base(path) != "nimi.json" || filepath.Base(filepath.Dir(path)) != ".nimi" {
		return nil, fmt.Errorf("product-control record path must be the fixed .nimi/nimi.json boundary (%s)", path)
	}
	controlRoot := filepath.Dir(path)
	rootInfo, err := os.Lstat(controlRoot)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("inspect product-control directory failed (%s): %w", controlRoot, err)
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 || productControlRecordIsReparsePoint(rootInfo) {
		return nil, fmt.Errorf("product-control .nimi must be a direct non-reparse directory (%s)", controlRoot)
	}

	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("inspect product-control record failed (%s): %w", path, err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || productControlRecordIsReparsePoint(info) {
		return nil, fmt.Errorf("product-control record must be a direct regular file (%s)", path)
	}
	if info.Size() > productControlRecordMaxBytes {
		return nil, fmt.Errorf("product-control record exceeds %d bytes (%s)", productControlRecordMaxBytes, path)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open product-control record failed (%s): %w", path, err)
	}
	defer func() { _ = file.Close() }()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("inspect opened product-control record failed (%s): %w", path, err)
	}
	if !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		return nil, fmt.Errorf("product-control record changed while opening direct regular file (%s)", path)
	}
	raw, err := io.ReadAll(io.LimitReader(file, productControlRecordMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read product-control record failed (%s): %w", path, err)
	}
	if len(raw) > productControlRecordMaxBytes {
		return nil, fmt.Errorf("product-control record exceeds %d bytes (%s)", productControlRecordMaxBytes, path)
	}
	if !utf8.Valid(raw) {
		return nil, fmt.Errorf("product-control record is not valid UTF-8 (%s)", path)
	}
	if bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}) {
		return nil, fmt.Errorf("product-control record must not contain a UTF-8 BOM (%s)", path)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	var fields map[string]json.RawMessage
	if err := dec.Decode(&fields); err != nil {
		return nil, fmt.Errorf("parse product-control record failed (%s): %w", path, err)
	}
	var trailing any
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse product-control record failed (%s): trailing JSON", path)
	}
	record, err := decodeProductControlRawRecord(fields)
	if err != nil {
		return nil, fmt.Errorf("parse product-control record failed (%s): %w", path, err)
	}
	if err := validateProductControlRecord(record); err != nil {
		return nil, err
	}
	return record, nil
}

func decodeProductControlRawRecord(fields map[string]json.RawMessage) (*productControlRecord, error) {
	if err := requireExactProductControlRawFields(fields, productControlRecordFields, "record"); err != nil {
		return nil, err
	}
	schemaVersion, err := decodeProductControlRawInteger(fields["schemaVersion"], "schemaVersion")
	if err != nil {
		return nil, err
	}
	installID, err := decodeProductControlRawText(fields["installId"], "installId")
	if err != nil {
		return nil, err
	}
	productVersion, err := decodeProductControlRawText(fields["productVersion"], "productVersion")
	if err != nil {
		return nil, err
	}
	state, err := decodeProductControlRawText(fields["state"], "state")
	if err != nil {
		return nil, err
	}
	dataRoot, err := decodeProductControlRawDataRoot(fields["dataRoot"])
	if err != nil {
		return nil, err
	}
	firstRun, err := decodeProductControlRawFirstRun(fields["firstRun"])
	if err != nil {
		return nil, err
	}
	pointers, err := decodeProductControlRawPointers(fields["pointers"])
	if err != nil {
		return nil, err
	}
	repair, err := decodeProductControlRawRepair(fields["repair"])
	if err != nil {
		return nil, err
	}
	return &productControlRecord{
		SchemaVersion:  int(schemaVersion),
		InstallID:      installID,
		ProductVersion: productVersion,
		State:          productControlState(state),
		DataRoot:       dataRoot,
		FirstRun:       firstRun,
		Pointers:       pointers,
		Repair:         repair,
	}, nil
}

func decodeProductControlRawDataRoot(raw json.RawMessage) (*productDataRootRecord, error) {
	if productControlRawIsNull(raw) {
		return nil, nil
	}
	fields, err := decodeProductControlRawObject(raw, productControlDataRootFields, "dataRoot")
	if err != nil {
		return nil, err
	}
	path, err := decodeProductControlRawText(fields["path"], "dataRoot.path")
	if err != nil {
		return nil, err
	}
	status, err := decodeProductControlRawText(fields["status"], "dataRoot.status")
	if err != nil {
		return nil, err
	}
	selectedAt, err := decodeProductControlRawText(fields["selectedAt"], "dataRoot.selectedAt")
	if err != nil {
		return nil, err
	}
	verifiedAt, err := decodeProductControlRawText(fields["verifiedAt"], "dataRoot.verifiedAt")
	if err != nil {
		return nil, err
	}
	selectedAtUnixMS, err := decodeProductControlRawInteger(
		fields["selectedAtUnixMs"],
		"dataRoot.selectedAtUnixMs",
	)
	if err != nil {
		return nil, err
	}
	verifiedAtUnixMS, err := decodeProductControlRawInteger(
		fields["verifiedAtUnixMs"],
		"dataRoot.verifiedAtUnixMs",
	)
	if err != nil {
		return nil, err
	}
	return &productDataRootRecord{
		Path:             path,
		Status:           productDataRootStatus(status),
		SelectedAt:       selectedAt,
		VerifiedAt:       verifiedAt,
		SelectedAtUnixMs: selectedAtUnixMS,
		VerifiedAtUnixMs: verifiedAtUnixMS,
	}, nil
}

func decodeProductControlRawFirstRun(raw json.RawMessage) (productFirstRunRecord, error) {
	fields, err := decodeProductControlRawObject(raw, productControlFirstRunFields, "firstRun")
	if err != nil {
		return productFirstRunRecord{}, err
	}
	installLevel, err := decodeProductControlRawNullableText(fields["installLevel"], "firstRun.installLevel")
	if err != nil {
		return productFirstRunRecord{}, err
	}
	aiProfileAlias, err := decodeProductControlRawNullableText(fields["aiProfileAlias"], "firstRun.aiProfileAlias")
	if err != nil {
		return productFirstRunRecord{}, err
	}
	completed, err := decodeProductControlRawBool(fields["completed"], "firstRun.completed")
	if err != nil {
		return productFirstRunRecord{}, err
	}
	completedAt, err := decodeProductControlRawNullableText(fields["completedAt"], "firstRun.completedAt")
	if err != nil {
		return productFirstRunRecord{}, err
	}
	return productFirstRunRecord{
		InstallLevel:   installLevel,
		AIProfileAlias: aiProfileAlias,
		Completed:      completed,
		CompletedAt:    completedAt,
	}, nil
}

func decodeProductControlRawPointers(raw json.RawMessage) (productPointersRecord, error) {
	fields, err := decodeProductControlRawObject(raw, productControlPointerFields, "pointers")
	if err != nil {
		return productPointersRecord{}, err
	}
	factoryProfileIndex, err := decodeProductControlRawNullableText(
		fields["factoryProfileIndex"],
		"pointers.factoryProfileIndex",
	)
	if err != nil {
		return productPointersRecord{}, err
	}
	return productPointersRecord{FactoryProfileIndex: factoryProfileIndex}, nil
}

func decodeProductControlRawRepair(raw json.RawMessage) (productRepairRecord, error) {
	fields, err := decodeProductControlRawObject(raw, productControlRepairFields, "repair")
	if err != nil {
		return productRepairRecord{}, err
	}
	required, err := decodeProductControlRawBool(fields["required"], "repair.required")
	if err != nil {
		return productRepairRecord{}, err
	}
	reason, err := decodeProductControlRawNullableText(fields["reason"], "repair.reason")
	if err != nil {
		return productRepairRecord{}, err
	}
	return productRepairRecord{Required: required, Reason: reason}, nil
}

func decodeProductControlRawObject(
	raw json.RawMessage,
	expected []string,
	label string,
) (map[string]json.RawMessage, error) {
	if len(raw) == 0 || productControlRawIsNull(raw) {
		return nil, fmt.Errorf("%s must be an object", label)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, fmt.Errorf("%s must be an object", label)
	}
	if err := requireExactProductControlRawFields(fields, expected, label); err != nil {
		return nil, err
	}
	return fields, nil
}

func requireExactProductControlRawFields(
	fields map[string]json.RawMessage,
	expected []string,
	label string,
) error {
	if fields == nil {
		return fmt.Errorf("%s must be an object", label)
	}
	if len(fields) != len(expected) {
		return fmt.Errorf("%s fields are invalid", label)
	}
	for _, key := range expected {
		if _, ok := fields[key]; !ok {
			return fmt.Errorf("%s fields are invalid", label)
		}
	}
	return nil
}

func productControlRawIsNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

func decodeProductControlRawText(raw json.RawMessage, label string) (string, error) {
	if len(raw) == 0 || productControlRawIsNull(raw) {
		return "", fmt.Errorf("%s must be non-empty text", label)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil ||
		value == "" ||
		strings.TrimSpace(value) != value {
		return "", fmt.Errorf("%s must be non-empty text", label)
	}
	return value, nil
}

func decodeProductControlRawNullableText(raw json.RawMessage, label string) (*string, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("%s is required", label)
	}
	if productControlRawIsNull(raw) {
		return nil, nil
	}
	value, err := decodeProductControlRawText(raw, label)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func decodeProductControlRawBool(raw json.RawMessage, label string) (bool, error) {
	if len(raw) == 0 || productControlRawIsNull(raw) {
		return false, fmt.Errorf("%s must be boolean", label)
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, fmt.Errorf("%s must be boolean", label)
	}
	return value, nil
}

func decodeProductControlRawInteger(raw json.RawMessage, label string) (int64, error) {
	if len(raw) == 0 || productControlRawIsNull(raw) {
		return 0, fmt.Errorf("%s must be a non-negative safe integer", label)
	}
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil ||
		value < 0 ||
		value > float64(productControlMaxJSONSafeInteger) ||
		math.Trunc(value) != value {
		return 0, fmt.Errorf("%s must be a non-negative safe integer", label)
	}
	return int64(value), nil
}

func validateProductControlRecord(record *productControlRecord) error {
	if record == nil {
		return errors.New("product-control record is required")
	}
	if record.SchemaVersion != productControlSchemaVersion {
		return fmt.Errorf("unsupported product-control schemaVersion=%d expected=%d", record.SchemaVersion, productControlSchemaVersion)
	}
	if !isKnownProductControlState(record.State) {
		return fmt.Errorf("unsupported product-control state=%q", record.State)
	}
	if strings.TrimSpace(record.InstallID) == "" || strings.TrimSpace(record.InstallID) != record.InstallID {
		return errors.New("product-control installId is required")
	}
	if strings.TrimSpace(record.ProductVersion) == "" || strings.TrimSpace(record.ProductVersion) != record.ProductVersion {
		return errors.New("product-control productVersion is required")
	}
	if stateRequiresDataRoot(record.State) && selectedProductDataRootPath(record) == "" {
		return errors.New("product-control state requires dataRoot.path")
	}
	if (record.State == productControlStateConfigMissing || record.State == productControlStateDataRootMissing) &&
		record.DataRoot != nil {
		return fmt.Errorf("product-control state %q cannot carry dataRoot", record.State)
	}
	if record.DataRoot != nil {
		if _, err := normalizeProductControlDataRootPath(record.DataRoot.Path); err != nil {
			return err
		}
		if !isKnownProductDataRootStatus(record.DataRoot.Status) {
			return fmt.Errorf("unsupported product-control dataRoot.status=%q", record.DataRoot.Status)
		}
		if strings.TrimSpace(record.DataRoot.SelectedAt) == "" ||
			strings.TrimSpace(record.DataRoot.SelectedAt) != record.DataRoot.SelectedAt ||
			strings.TrimSpace(record.DataRoot.VerifiedAt) == "" ||
			strings.TrimSpace(record.DataRoot.VerifiedAt) != record.DataRoot.VerifiedAt {
			return errors.New("product-control dataRoot requires selectedAt and verifiedAt")
		}
		if record.DataRoot.SelectedAtUnixMs < 0 ||
			record.DataRoot.SelectedAtUnixMs > productControlMaxJSONSafeInteger ||
			record.DataRoot.VerifiedAtUnixMs < 0 ||
			record.DataRoot.VerifiedAtUnixMs > productControlMaxJSONSafeInteger {
			return errors.New("product-control dataRoot verification timestamps are invalid")
		}
	}
	if record.FirstRun.InstallLevel != nil {
		level := *record.FirstRun.InstallLevel
		if level != "minimal" && level != "recommended" {
			return errors.New("product-control firstRun.installLevel must be minimal or recommended")
		}
	}
	nullableTextFields := []struct {
		label string
		value *string
	}{
		{"firstRun.aiProfileAlias", record.FirstRun.AIProfileAlias},
		{"firstRun.completedAt", record.FirstRun.CompletedAt},
		{"pointers.factoryProfileIndex", record.Pointers.FactoryProfileIndex},
		{"repair.reason", record.Repair.Reason},
	}
	for _, field := range nullableTextFields {
		if field.value != nil &&
			(*field.value == "" || strings.TrimSpace(*field.value) != *field.value) {
			return fmt.Errorf("product-control %s must be non-empty text or null", field.label)
		}
	}
	failClosedState := record.State == productControlStateRepairRequired ||
		record.State == productControlStateBlocked
	if failClosedState {
		if !record.Repair.Required || record.Repair.Reason == nil ||
			(record.DataRoot != nil && record.DataRoot.Status != productDataRootStatusRepairRequired) {
			return fmt.Errorf("product-control state %q has inconsistent state/status/repair fields", record.State)
		}
	} else if record.Repair.Required ||
		record.Repair.Reason != nil ||
		(record.DataRoot != nil && record.DataRoot.Status == productDataRootStatusRepairRequired) {
		return fmt.Errorf("product-control state %q has inconsistent state/status/repair fields", record.State)
	}
	if record.State == productControlStateReadyForUse {
		if err := validateReadyForUseShape(record); err != nil {
			return err
		}
	}
	return nil
}

func isKnownProductControlState(state productControlState) bool {
	switch state {
	case productControlStateNotLoggedIn,
		productControlStateConfigMissing,
		productControlStateDataRootMissing,
		productControlStateDataRootSelected,
		productControlStateAIEnvironmentUnconfigured,
		productControlStateLocalAIProfileAssetsMissing,
		productControlStateLocalAIProfileNotReady,
		productControlStateLocalAIAssetsDownloadedEnvironmentNotReady,
		productControlStateLocalAIReady,
		productControlStateRepairRequired,
		productControlStateBlocked,
		productControlStateReadyForUse:
		return true
	default:
		return false
	}
}

func isKnownProductDataRootStatus(status productDataRootStatus) bool {
	switch status {
	case productDataRootStatusSelected,
		productDataRootStatusReady,
		productDataRootStatusRepairRequired:
		return true
	default:
		return false
	}
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
		firstRun.AIProfileAlias != nil && strings.TrimSpace(*firstRun.AIProfileAlias) != ""
	if !required {
		return errors.New("product-control ready_for_use requires completed firstRun selection")
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
	if firstRun.Completed || firstRun.CompletedAt != nil {
		return errors.New("nimi_data data root cannot be changed after first-run completion")
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
		FirstRun:       productFirstRunRecord{},
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
	value, err := normalizeProductControlDataRootPath(record.DataRoot.Path)
	if err != nil {
		return ""
	}
	return value
}

func normalizeProductControlDataRootPath(value string) (string, error) {
	if value == "" || strings.TrimSpace(value) != value {
		return "", errors.New("product-control dataRoot.path must be absolute")
	}
	cleaned := filepath.Clean(value)
	if (filepath.Separator == '\\' && !isAdmittedWindowsProductControlDataRootPath(cleaned)) ||
		(filepath.Separator != '\\' && !filepath.IsAbs(cleaned)) {
		return "", errors.New("product-control dataRoot.path must be absolute")
	}
	volume := filepath.VolumeName(cleaned)
	isVolumeRoot := false
	if volume == "" {
		isVolumeRoot = cleaned == string(filepath.Separator)
	} else {
		isVolumeRoot = strings.EqualFold(cleaned, volume) ||
			strings.EqualFold(cleaned, volume+string(filepath.Separator))
	}
	if filepath.Separator == '\\' {
		const extendedUNCPrefix = `\\?\UNC\`
		if len(cleaned) >= len(extendedUNCPrefix) &&
			strings.EqualFold(cleaned[:len(extendedUNCPrefix)], extendedUNCPrefix) {
			parts := strings.Split(
				strings.Trim(cleaned[len(extendedUNCPrefix):], `\`),
				`\`,
			)
			if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
				isVolumeRoot = true
			}
		}
	}
	if isVolumeRoot {
		return "", errors.New("product-control dataRoot.path must not be a volume root")
	}
	return cleaned, nil
}

func isAdmittedWindowsProductControlDataRootPath(value string) bool {
	isDriveQualified := func(candidate string) bool {
		return len(candidate) >= 3 &&
			((candidate[0] >= 'A' && candidate[0] <= 'Z') ||
				(candidate[0] >= 'a' && candidate[0] <= 'z')) &&
			candidate[1] == ':' &&
			candidate[2] == '\\'
	}
	if isDriveQualified(value) {
		return true
	}
	lower := strings.ToLower(value)
	const extendedUNCPrefix = `\\?\unc\`
	if strings.HasPrefix(lower, extendedUNCPrefix) {
		parts := strings.Split(value[len(extendedUNCPrefix):], `\`)
		return len(parts) >= 2 && parts[0] != "" && parts[1] != ""
	}
	const extendedPrefix = `\\?\`
	if strings.HasPrefix(lower, extendedPrefix) {
		return isDriveQualified(value[len(extendedPrefix):])
	}
	if !strings.HasPrefix(value, `\\`) ||
		strings.HasPrefix(lower, `\\.\`) ||
		strings.HasPrefix(lower, `\\??\`) {
		return false
	}
	parts := strings.Split(value[2:], `\`)
	return len(parts) >= 2 && parts[0] != "" && parts[1] != ""
}

func writeProductControlRecord(path string, record *productControlRecord) error {
	if err := validateProductControlRecord(record); err != nil {
		return err
	}
	if filepath.Base(path) != "nimi.json" || filepath.Base(filepath.Dir(path)) != ".nimi" {
		return fmt.Errorf("product-control record path must be the fixed .nimi/nimi.json boundary (%s)", path)
	}
	controlRoot := filepath.Dir(path)
	rootInfo, err := os.Lstat(controlRoot)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.Mkdir(controlRoot, 0o755); err != nil {
			return fmt.Errorf("create direct product-control directory failed (%s): %w", controlRoot, err)
		}
		rootInfo, err = os.Lstat(controlRoot)
	}
	if err != nil {
		return fmt.Errorf("inspect product-control directory failed (%s): %w", controlRoot, err)
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 || productControlRecordIsReparsePoint(rootInfo) {
		return fmt.Errorf("product-control .nimi must be a direct non-reparse directory (%s)", controlRoot)
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

func restoreProductControlRecordSnapshot(path string, raw []byte, existed bool) error {
	if !existed {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("rollback newly-created product-control record failed (%s): %w", path, err)
		}
		return nil
	}
	tmp := fmt.Sprintf("%s.rollback.%d.%d", path, os.Getpid(), nowProductControlUnixMS())
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return fmt.Errorf("write product-control rollback snapshot failed (%s): %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("commit product-control rollback snapshot failed (%s): %w", path, err)
	}
	return nil
}

// SetProductControlRoot binds Product Control to the fixed .nimi directory for
// the relevant interactive user. Protected startup derives it from an
// OS-verified profile mapping; environment, request, renderer, and Runtime
// private-state paths cannot change it after first use.
func (s *Service) SetProductControlRoot(root string) error {
	if s == nil {
		return errors.New("local service is nil")
	}
	normalized := filepath.Clean(strings.TrimSpace(root))
	if normalized == "." || !filepath.IsAbs(normalized) ||
		normalized == filepath.VolumeName(normalized)+string(filepath.Separator) ||
		filepath.Base(normalized) != ".nimi" {
		return fmt.Errorf("product-control root must be the fixed absolute .nimi directory")
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

// SetProductControlDataRootSecurityBinding binds the verified platform
// interactive-user and fixed Runtime service identities before Product
// Control is first read. It never supplies a path.
func (s *Service) SetProductControlDataRootSecurityBinding(binding ProductControlDataRootSecurityBinding) error {
	if s == nil {
		return errors.New("local service is nil")
	}
	binding.InteractiveUserSID = strings.TrimSpace(binding.InteractiveUserSID)
	binding.RuntimeServiceSID = strings.TrimSpace(binding.RuntimeServiceSID)
	sidBound := binding.InteractiveUserSID != "" || binding.RuntimeServiceSID != ""
	uidBound := binding.InteractiveUserUID != 0 || binding.RuntimeServiceUID != 0
	if (binding.InteractiveUserSID == "") != (binding.RuntimeServiceSID == "") {
		return errors.New("Product Control data-root security binding requires both interactive-user and Runtime service SIDs")
	}
	if (binding.InteractiveUserUID == 0) != (binding.RuntimeServiceUID == 0) {
		return errors.New("Product Control data-root security binding requires both interactive-user and Runtime service UIDs")
	}
	if sidBound && uidBound {
		return errors.New("Product Control data-root security binding cannot mix SID and UID identities")
	}
	if binding.PerUserRuntime && (sidBound || !uidBound || binding.InteractiveUserUID != binding.RuntimeServiceUID) {
		return errors.New("per-user Product Control security binding requires one shared current-user UID")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.productControlRootLocked {
		return errors.New("Product Control data-root security binding cannot change after first use")
	}
	s.productControlDataRootSecurity = binding
	return nil
}

func (s *Service) productControlDataRootSecurityBinding() ProductControlDataRootSecurityBinding {
	if s == nil {
		return ProductControlDataRootSecurityBinding{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.productControlDataRootSecurity
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

func ensureNimiDataRootLayout(root string, security ProductControlDataRootSecurityBinding) error {
	if strings.TrimSpace(security.InteractiveUserSID) != "" ||
		strings.TrimSpace(security.RuntimeServiceSID) != "" ||
		security.InteractiveUserUID != 0 ||
		security.RuntimeServiceUID != 0 {
		if err := validateProductControlDataRootPlatform(filepath.Clean(root), security); err != nil {
			return fmt.Errorf("validate prepared nimi_data root before layout mutation: %w", err)
		}
	}
	for _, dir := range nimiDataRootRequiredDirectories {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			return fmt.Errorf("create nimi_data directory %s: %w", dir, err)
		}
	}
	if err := verifyNimiDataRootLayout(root, security); err != nil {
		return fmt.Errorf("verify created nimi_data layout: %w", err)
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
