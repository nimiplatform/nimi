package localservice

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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

func (s *Service) verifyProductControlReadyAdmission(ctx context.Context, record *productControlRecord) (productControlState, string) {
	if record == nil {
		return productControlStateConfigMissing, "product-control record is required before ready admission"
	}
	dataRootPath := selectedProductDataRootPath(record)
	if dataRootPath == "" {
		return productControlStateDataRootMissing, "selected nimi_data is required before ready admission"
	}
	if strings.TrimSpace(record.InstallID) == "" || strings.TrimSpace(record.ProductVersion) == "" {
		return productControlStateBlocked, "product-control record installId and productVersion are required for ready admission"
	}
	if usability := evaluateProductControlUsability(record); usability.RepairRequired || !usability.Selected {
		return productControlStateRepairRequired, "product-control record and selected nimi_data must be usable before ready admission"
	}
	path, err := s.productControlRecordPath()
	if err != nil {
		return productControlStateBlocked, err.Error()
	}
	if err := validateProductControlDataRootBoundary(dataRootPath, filepath.Dir(path)); err != nil {
		return productControlStateBlocked, err.Error()
	}
	if state, failure := verifyProductControlSelectedDataRoot(record, s.productControlDataRootSecurityBinding()); failure != "" {
		return state, failure
	}
	projection, ok := s.authenticatedProductControlAccount(ctx)
	if !ok || projection == nil || strings.TrimSpace(projection.GetAccountId()) == "" {
		return productControlStateNotLoggedIn, "authenticated Runtime account session failed"
	}
	installLevel := strings.TrimSpace(valueOrEmpty(record.FirstRun.InstallLevel))
	if installLevel == "" {
		return productControlStateAIEnvironmentUnconfigured, "first-run install level is required before ready admission"
	}
	aiProfileAlias := strings.TrimSpace(valueOrEmpty(record.FirstRun.AIProfileAlias))
	if aiProfileAlias == "" {
		return productControlStateAIEnvironmentUnconfigured, "first-run aiProfileAlias is required before ready admission"
	}
	if err := s.verifyFirstRunFactoryAIProfile(aiProfileAlias, installLevel); err != nil {
		return productControlStateAIEnvironmentUnconfigured, err.Error()
	}
	reconciliation := s.deriveProductControlFirstRunSetupReconciliation(installLevel, dataRootPath)
	if !reconciliation.LocalAIReady {
		return reconciliation.State, reconciliation.Reason
	}
	return "", ""
}

func applyProductControlReady(record *productControlRecord) {
	completedAt := nowProductControlISO()
	record.State = productControlStateReadyForUse
	record.FirstRun.Completed = true
	record.FirstRun.CompletedAt = &completedAt
	record.Repair = productRepairRecord{}
	if record.DataRoot != nil {
		record.DataRoot.Status = productDataRootStatusReady
		record.DataRoot.VerifiedAt = nowProductControlISO()
		record.DataRoot.VerifiedAtUnixMs = nowProductControlUnixMS()
	}
}

func resetProductControlReadyState(record *productControlRecord) {
	record.FirstRun.Completed = false
	record.FirstRun.CompletedAt = nil
	if record.DataRoot != nil && record.DataRoot.Status == productDataRootStatusReady {
		record.DataRoot.Status = productDataRootStatusSelected
	}
}

func routeProductControlAdmissionFailure(path string, record *productControlRecord, state productControlState, detail string) error {
	resetProductControlReadyState(record)
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
