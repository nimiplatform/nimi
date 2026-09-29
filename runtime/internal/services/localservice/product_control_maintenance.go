package localservice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
)

const (
	productControlActivationNotEmptyReason        = "DATA_ROOT_NOT_EMPTY"
	productControlActivationChooseEmptyRootAction = "choose_new_empty_root"
)

// ProductControlMaintenance is the record-owner-only Product Control surface
// Runtime serves while an owner refuses the stored data in the selected root.
// It opens no owner, never reads anything inside the refused root, and
// replaces the selection only with an absent or empty path-disjoint folder.
type ProductControlMaintenance struct {
	mu                  sync.Mutex
	logger              *slog.Logger
	productControlRoot  string
	security            ProductControlDataRootSecurityBinding
	validateConfig      func(string) error
	writeConfig         func(string) (bool, error)
	audit               *auditlog.Store
	committedActivation string
}

// NewProductControlMaintenance binds the maintenance surface to the fixed
// Product Control root, the service-owned derived configuration, and the
// maintenance audit plane (outside every data root). A nil audit plane keeps
// reads available and refuses replacement as unrecordable.
func NewProductControlMaintenance(logger *slog.Logger, productControlRoot string, security ProductControlDataRootSecurityBinding, validateConfig func(string) error, writeConfig func(string) (bool, error), audit *auditlog.Store) (*ProductControlMaintenance, error) {
	root := filepath.Clean(strings.TrimSpace(productControlRoot))
	if !filepath.IsAbs(root) || filepath.Base(root) != ".nimi" {
		return nil, errors.New("maintenance Product Control requires the fixed absolute .nimi root")
	}
	if validateConfig == nil || writeConfig == nil {
		return nil, errors.New("maintenance Product Control requires service-owned data-root config validation and mutation")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &ProductControlMaintenance{
		logger:             logger,
		productControlRoot: root,
		security:           security,
		validateConfig:     validateConfig,
		writeConfig:        writeConfig,
		audit:              audit,
	}, nil
}

func (m *ProductControlMaintenance) recordPath() string {
	return filepath.Join(m.productControlRoot, "nimi.json")
}

// GetProductControlRecord projects the canonical record without account or
// root verification: in maintenance no owner is bound to the selected root.
func (m *ProductControlMaintenance) GetProductControlRecord(context.Context, *runtimev1.GetProductControlRecordRequest) (*runtimev1.ProductControlProjectionJson, error) {
	m.mu.Lock()
	committed := m.committedActivation
	m.mu.Unlock()
	path := m.recordPath()
	record, err := readProductControlRecord(path)
	if err != nil {
		message := err.Error()
		return productControlJSON(productControlRecordProjection{Path: path, Exists: true, State: productControlStateRepairRequired, Error: &message}, nil)
	}
	if record == nil {
		message := "product-control record is missing"
		return productControlJSON(productControlRecordProjection{Path: path, Exists: false, State: productControlStateConfigMissing, Error: &message}, nil)
	}
	projection := productControlRecordProjection{Path: path, Exists: true, State: record.State, Record: record}
	if committed != "" && record.DataRoot != nil && record.DataRoot.RootActivationID == committed {
		disposition, action := "committed_restart_required", productControlActivationRestartAction
		if record.State == productControlStateRepairRequired || record.Repair.Required {
			disposition, action = "committed_repair_required", "repair_runtime_config"
		}
		projection.RootHandoff = &productControlRootHandoff{
			Disposition: disposition, RootActivationID: committed, ActionHint: action,
		}
	}
	return productControlJSON(projection, nil)
}

// GetProductControlSelectedDataRoot projects the recorded selection only. It
// does not inspect the refused root and never offers a Host profile scope.
func (m *ProductControlMaintenance) GetProductControlSelectedDataRoot(context.Context, *runtimev1.GetProductControlSelectedDataRootRequest) (*runtimev1.ProductControlProjectionJson, error) {
	path := m.recordPath()
	record, err := readProductControlRecord(path)
	if err != nil {
		message := err.Error()
		return productControlJSON(productControlSelectedDataRootProjection{Path: path, Exists: true, State: productControlStateRepairRequired, Error: &message}, nil)
	}
	if record == nil {
		message := "product-control record is missing; selected nimi_data is not ready"
		return productControlJSON(productControlSelectedDataRootProjection{Path: path, Exists: false, State: productControlStateConfigMissing, Error: &message}, nil)
	}
	var dataRoot *productDataRootRecord
	if selectedProductDataRootPath(record) != "" {
		dataRoot = record.DataRoot
	}
	return productControlJSON(productControlSelectedDataRootProjection{
		Path: path, Exists: true, State: record.State, DataRoot: dataRoot,
	}, nil)
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007i
// ReplaceProductControlDataRoot commits a user-explicit replacement from the
// refused selection to an absent or empty path-disjoint folder. Only the
// canonical path relation and the target's own emptiness are examined.
func (m *ProductControlMaintenance) ReplaceProductControlDataRoot(ctx context.Context, req *runtimev1.ReplaceProductControlDataRootRequest) (*runtimev1.ProductControlProjectionJson, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.committedActivation != "" {
		return nil, errors.New("Runtime root handoff requires restart before another replacement")
	}
	target, err := normalizeProductControlDataRootPath(strings.TrimSpace(req.GetTargetRoot()))
	if err != nil {
		return nil, err
	}
	path := m.recordPath()
	if err := validateProductControlDataRootBoundary(target, filepath.Dir(path)); err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errors.New("product-control record is missing; maintenance replacement requires ready_for_use")
	}
	if record.SchemaVersion == productControlLegacySchemaVersion {
		return nil, errors.New("product-control root activation must be initialized before replacement")
	}
	if record.State != productControlStateReadyForUse || record.DataRoot == nil || record.DataRoot.Status != productDataRootStatusReady || strings.TrimSpace(record.DataRoot.RootActivationID) == "" {
		return nil, fmt.Errorf("maintenance data-root replacement requires a valid ready_for_use activation, got state=%s", record.State)
	}
	current := selectedProductDataRootPath(record)
	if current == "" {
		return nil, errors.New("maintenance data-root replacement requires a canonical current root")
	}
	if productControlPathsEqual(current, target) || productControlPathsOverlap(current, target) {
		message := "replacement target must be path-disjoint from the current data root"
		return productControlJSON(productControlRecordProjection{
			Path: path, Exists: true, State: record.State, Record: record, Error: &message,
			Activation: &productControlActivation{
				Activated: false, ReasonCode: productControlActivationOverlappingReason,
				ActionHint: productControlActivationChooseAnotherAction,
			},
		}, nil)
	}
	empty, err := productControlMaintenanceTargetEmpty(target)
	if err != nil {
		return productControlJSON(productControlRecordProjection{
			Path: path, Exists: true, State: record.State, Record: record,
			Error: stringPtr(err.Error()),
		}, nil)
	}
	if !empty {
		message := "replacement from refused stored data requires an absent or empty folder"
		return productControlJSON(productControlRecordProjection{
			Path: path, Exists: true, State: record.State, Record: record, Error: &message,
			Activation: &productControlActivation{
				Activated: false, ReasonCode: productControlActivationNotEmptyReason,
				ActionHint: productControlActivationChooseEmptyRootAction,
			},
		}, nil)
	}
	if err := m.validateConfig(target); err != nil {
		return nil, fmt.Errorf("validate Runtime service-owned data-root config mutation: %w", err)
	}
	if err := ensureNimiDataRootLayout(target, m.security); err != nil {
		return productControlJSON(productControlRecordProjection{
			Path: path, Exists: true, State: record.State, Record: record,
			Error: stringPtr(err.Error()),
		}, nil)
	}
	previousActivationID := record.DataRoot.RootActivationID
	mintProductControlActivation(record, target)
	// The record commits inside the maintenance audit transaction that records
	// it: an unrecordable replacement is never activated (rpc-foundations r001);
	// if only the audit commit fails afterwards, the activation stands.
	committed, commitErr := m.commitRecordedReplacement(ctx, previousActivationID, record.DataRoot.RootActivationID, func() error {
		return writeProductControlRecord(path, record)
	})
	if !committed {
		if errors.Is(commitErr, auditlog.ErrUnrecorded) {
			return nil, fmt.Errorf("record maintenance data-root replacement: %w", commitErr)
		}
		return nil, fmt.Errorf("commit Product Control data-root activation: %w", commitErr)
	}
	if commitErr != nil {
		m.logger.Error("maintenance data-root replacement committed without a durable audit record",
			"root_activation_id", record.DataRoot.RootActivationID, "audit_disposition", "unrecorded", "error", commitErr)
	}
	m.committedActivation = record.DataRoot.RootActivationID
	projection := committedProductControlActivationProjection(path, record, target, m.writeConfig, commitErr)
	disposition, action := "committed_restart_required", productControlActivationRestartAction
	if projection.Record != nil && (projection.Record.State == productControlStateRepairRequired || projection.Record.Repair.Required) {
		disposition, action = "committed_repair_required", "repair_runtime_config"
	}
	projection.RootHandoff = &productControlRootHandoff{
		Disposition: disposition, RootActivationID: m.committedActivation, ActionHint: action,
	}
	return productControlJSON(projection, nil)
}

func (m *ProductControlMaintenance) commitRecordedReplacement(ctx context.Context, previousActivationID string, nextActivationID string, write func() error) (bool, error) {
	if m.audit == nil {
		return false, fmt.Errorf("%w: the maintenance audit plane is unavailable", auditlog.ErrUnrecorded)
	}
	return m.audit.CommitRecorded(dataRootReplacementEvent(ctx, runtimev1.ReasonCode_ACTION_EXECUTED, map[string]any{
		"disposition":                   productControlActivationReplacedReason,
		"previous_root_activation_id":   previousActivationID,
		"root_activation_id":            nextActivationID,
		"restart_required_for_new_root": true,
		"from_refused_stored_data":      true,
	}), write)
}

// productControlMaintenanceTargetEmpty reports whether target is absent or
// holds no data: operating-system folder-view metadata and Nimi's own empty
// minimum layout (left by an earlier attempt that did not commit) do not make a
// folder non-empty; any other entry, or any file inside that layout, does.
func productControlMaintenanceTargetEmpty(target string) (bool, error) {
	entries, err := os.ReadDir(target)
	if errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect replacement target: %w", err)
	}
	for _, entry := range entries {
		if productControlFolderViewMetadata(entry.Name()) {
			continue
		}
		if !entry.IsDir() || !productControlRequiredLayoutDirectory(entry.Name()) {
			return false, nil
		}
		empty, err := productControlDirectoryHoldsNoFiles(filepath.Join(target, entry.Name()))
		if err != nil || !empty {
			return false, err
		}
	}
	return true, nil
}

func productControlFolderViewMetadata(name string) bool {
	switch name {
	case ".DS_Store", "desktop.ini", "Thumbs.db":
		return true
	}
	return false
}

func productControlRequiredLayoutDirectory(name string) bool {
	for _, directory := range nimiDataRootRequiredDirectories {
		if name == directory {
			return true
		}
	}
	return false
}

// productControlDirectoryHoldsNoFiles reports whether a layout directory holds
// only folder-view metadata and empty subdirectories. Symlinks count as data.
func productControlDirectoryHoldsNoFiles(directory string) (bool, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return false, fmt.Errorf("inspect replacement target: %w", err)
	}
	for _, entry := range entries {
		if productControlFolderViewMetadata(entry.Name()) {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() {
			return false, nil
		}
		empty, err := productControlDirectoryHoldsNoFiles(filepath.Join(directory, entry.Name()))
		if err != nil || !empty {
			return false, err
		}
	}
	return true, nil
}
