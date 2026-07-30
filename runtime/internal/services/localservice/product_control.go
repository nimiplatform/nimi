package localservice

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) GetProductControlRecord(ctx context.Context, _ *runtimev1.GetProductControlRecordRequest) (*runtimev1.ProductControlProjectionJson, error) {
	return productControlJSON(s.readProductControlProjection(ctx))
}

func (s *Service) GetProductControlSelectedDataRoot(context.Context, *runtimev1.GetProductControlSelectedDataRootRequest) (*runtimev1.ProductControlProjectionJson, error) {
	return productControlJSON(s.readProductControlSelectedDataRootProjection())
}

func (s *Service) EnsureProductControlRecordCreated(context.Context, *runtimev1.EnsureProductControlRecordCreatedRequest) (*runtimev1.ProductControlProjectionJson, error) {
	path, err := s.productControlRecordPath()
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
			message := fmt.Sprintf("product-control record could not be created: %v", err)
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
	normalized, err := normalizeProductControlDataRootPath(trimmed)
	if err != nil {
		return nil, err
	}
	path, err := s.productControlRecordPath()
	if err != nil {
		return nil, err
	}
	if err := validateProductControlDataRootBoundary(normalized, filepath.Dir(path)); err != nil {
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
		record.FirstRun = productFirstRunRecord{}
	} else {
		record, err = s.emptyProductControlRecord(productControlStateDataRootMissing)
		if err != nil {
			return nil, err
		}
	}
	s.mu.RLock()
	configWriter := s.productControlDataRootConfigWriter
	s.mu.RUnlock()
	if configWriter == nil {
		return nil, errors.New("Runtime service-owned data-root config mutation is unavailable")
	}
	originalRaw, originalReadErr := os.ReadFile(path)
	originalExisted := originalReadErr == nil
	if originalReadErr != nil && !errors.Is(originalReadErr, os.ErrNotExist) {
		return nil, fmt.Errorf("snapshot product-control record before data-root transaction: %w", originalReadErr)
	}
	if err := ensureNimiDataRootLayout(normalized, s.productControlDataRootSecurityBinding()); err != nil {
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
	record.Pointers = s.resolveProductControlPointers()
	record.Repair = productRepairRecord{}
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	changed, err := configWriter(normalized)
	if err != nil {
		rollbackErr := restoreProductControlRecordSnapshot(path, originalRaw, originalExisted)
		return nil, errors.Join(fmt.Errorf("commit Runtime service-owned data-root config: %w", err), rollbackErr)
	}
	s.mu.Lock()
	s.runtimeDataRoot = normalized
	s.localModelsPath = filepath.Join(normalized, "models")
	s.mu.Unlock()
	projection, err := s.readProductControlProjection(context.Background())
	if err != nil {
		return nil, err
	}
	if changed {
		projection.ConfigMutation = &productControlConfigMutation{
			Disposition: "restart_required",
			ReasonCode:  "CONFIG_RESTART_REQUIRED",
			ActionHint:  "request_typed_runtime_restart",
		}
	} else {
		projection.ConfigMutation = &productControlConfigMutation{
			Disposition: "applied",
			ReasonCode:  "CONFIG_APPLIED",
			ActionHint:  "continue_product_setup",
		}
	}
	return productControlJSON(projection, nil)
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
	path, err := s.productControlRecordPath()
	if err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errors.New("product-control record is missing; select nimi_data before install level")
	}
	if selectedProductDataRootPath(record) == "" {
		return nil, errors.New("selected nimi_data is required before install level")
	}
	record.FirstRun.InstallLevel = stringPtr(level)
	record.FirstRun.AIProfileAlias = stringPtr(alias)
	record.FirstRun.Completed = false
	record.FirstRun.CompletedAt = nil
	if record.State == productControlStateDataRootSelected {
		record.State = productControlStateAIEnvironmentUnconfigured
	} else if record.State == productControlStateAIEnvironmentUnconfigured {
		// This command is the user's concrete initialization-plan
		// confirmation. Move Product Control into Setup even when every
		// dependency is already present; Desktop will then project the
		// materialization result and request Runtime-owned finalization.
		record.State = productControlStateLocalAIProfileAssetsMissing
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
	path, err := s.productControlRecordPath()
	if err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errors.New("product-control record is missing; select nimi_data before device scan")
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

func (s *Service) AdmitProductControlReadyForUse(ctx context.Context, _ *runtimev1.AdmitProductControlReadyForUseRequest) (*runtimev1.ProductControlProjectionJson, error) {
	path, err := s.productControlRecordPath()
	if err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	if record == nil {
		return nil, errors.New("product-control record is missing; product readiness cannot be admitted")
	}
	failedState, failure := s.verifyProductControlReadyAdmission(ctx, record)
	if failure != "" {
		if err := routeProductControlAdmissionFailure(path, record, failedState, failure); err != nil {
			return nil, err
		}
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	applyProductControlReady(record)
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(ctx))
}
