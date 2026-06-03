package localservice

import (
	"context"
	"errors"
	"fmt"
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
