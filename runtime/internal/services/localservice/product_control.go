package localservice

import (
	"context"
	"errors"
	"fmt"
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
			return productControlJSON(s.withProductControlDataRootProposal(productControlRecordProjection{
				Path:   path,
				Exists: false,
				State:  productControlStateBlocked,
				Record: nil,
				Error:  &message,
			}), nil)
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
	path, err := s.productControlRecordPath()
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
	record.Pointers = s.resolveProductControlPointers()
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

func (s *Service) AdmitProductControlReadyForUse(ctx context.Context, req *runtimev1.AdmitProductControlReadyForUseRequest) (*runtimev1.ProductControlProjectionJson, error) {
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
		false,
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
