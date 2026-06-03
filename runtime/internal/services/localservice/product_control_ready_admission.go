package localservice

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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
