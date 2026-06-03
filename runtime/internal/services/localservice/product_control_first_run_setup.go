package localservice

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) ReconcileProductControlFirstRunSetupState(ctx context.Context, _ *runtimev1.ReconcileProductControlFirstRunSetupStateRequest) (*runtimev1.ProductControlProjectionJson, error) {
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
	installLevel := strings.TrimSpace(valueOrEmpty(record.FirstRun.InstallLevel))
	aiProfileAlias := strings.TrimSpace(valueOrEmpty(record.FirstRun.AIProfileAlias))
	if aiProfileAlias == "" {
		return nil, errors.New("first-run aiProfileAlias is required before Runtime setup state")
	}
	if err := s.verifyFirstRunFactoryAIProfile(aiProfileAlias, installLevel); err != nil {
		return nil, err
	}
	if record.State == productControlStateLocalAIReady || record.State == productControlStateReadyForUse {
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	reconciliation := s.deriveProductControlFirstRunSetupReconciliation(installLevel, selectedProductDataRootPath(record))
	if reconciliation.LocalAIReady {
		return productControlJSON(s.readProductControlProjection(ctx))
	}
	applyProductControlFirstRunSetupReconciliation(record, reconciliation)
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, err
	}
	return productControlJSON(s.readProductControlProjection(ctx))
}

type productControlFirstRunSetupReconciliation struct {
	State        productControlState
	Reason       string
	LocalAIReady bool
}

func (s *Service) deriveProductControlFirstRunSetupReconciliation(installLevel string, dataRootPath string) productControlFirstRunSetupReconciliation {
	level := normalizeRuntimeBaselineInstallLevel(installLevel)
	if level == "" {
		return productControlFirstRunSetupBlocked("first-run install level must be minimal or recommended: " + strings.TrimSpace(installLevel))
	}
	dataRoot := strings.TrimSpace(dataRootPath)
	if dataRoot == "" {
		return productControlFirstRunSetupBlocked("selected runtime_data_root is required before Runtime setup state")
	}
	consumers, ok := runtimeBaselineConsumerSet(level)
	if !ok || len(consumers) == 0 {
		return productControlFirstRunSetupBlocked("no canonical first-run baseline consumer set for install level: " + level)
	}
	hostProfile := hostProfileOrCollected(nil)
	bindings, outcome := s.resolveBaselineConsumerBindings(level, hostProfile, consumers)
	if outcome.State != runtimeBaselineStateReady {
		return productControlFirstRunSetupBlocked("first-run baseline model resolution failed: " + strings.TrimSpace(outcome.Detail))
	}
	gates := make([]localEnvironmentConsumerActivationGate, 0, len(bindings))
	for _, binding := range bindings {
		requirement, ok := localEnvironmentConsumerRequirementByID(binding.ConsumerID)
		if !ok {
			return productControlFirstRunSetupBlocked("first-run baseline consumer is unsupported: " + strings.TrimSpace(binding.ConsumerID))
		}
		gates = append(gates, s.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
			ConsumerID:      binding.ConsumerID,
			PackID:          requirement.PackID,
			HostProfile:     hostProfile,
			RuntimeDataRoot: dataRoot,
			AssetID:         binding.AssetID,
			LocalAssetID:    binding.LocalAssetID,
		}))
	}
	return productControlFirstRunSetupReconciliationFromActivationGates(gates)
}

func productControlFirstRunSetupReconciliationFromActivationGates(gates []localEnvironmentConsumerActivationGate) productControlFirstRunSetupReconciliation {
	if len(gates) == 0 {
		return productControlFirstRunSetupBlocked("Runtime resolved no first-run baseline activation gates")
	}
	if productControlActivationGatesAnyState(gates, localEnvironmentActivationStateUnsupported) {
		return productControlFirstRunSetupBlocked(productControlActivationGateReason("runtime_materialization_unsupported", gates))
	}
	if productControlActivationGatesAnyState(gates, localEnvironmentActivationStateRepairRequired) {
		return productControlFirstRunSetupNotReady("runtime_materialization_repair_required", gates)
	}
	if productControlActivationGatesAnyState(gates, localEnvironmentActivationStateFailed) {
		return productControlFirstRunSetupNotReady("runtime_materialization_job_failed", gates)
	}
	if productControlActivationGatesAnyState(gates, localEnvironmentActivationStateCancelled) {
		return productControlFirstRunSetupNotReady("runtime_materialization_job_cancelled", gates)
	}
	if productControlActivationGatesAnyState(gates, localEnvironmentActivationStateSetupInProgress) {
		return productControlFirstRunSetupAssetsMissing("runtime_materialization_jobs_in_progress", gates)
	}
	if productControlActivationGatesAnyState(gates, localEnvironmentActivationStateSetupRequired) {
		return productControlFirstRunSetupAssetsMissing("materialization_requires_confirmation", gates)
	}
	for _, gate := range gates {
		if strings.TrimSpace(gate.State) != localEnvironmentActivationStateReady {
			return productControlFirstRunSetupNotReady("runtime_activation_gate_not_ready", gates)
		}
	}
	return productControlFirstRunSetupReconciliation{
		State:        productControlStateLocalAIReady,
		Reason:       "runtime_local_ai_ready_evidence_projected",
		LocalAIReady: true,
	}
}

func productControlFirstRunSetupBlocked(reason string) productControlFirstRunSetupReconciliation {
	return productControlFirstRunSetupReconciliation{
		State:  productControlStateBlocked,
		Reason: strings.TrimSpace(reason),
	}
}

func productControlFirstRunSetupNotReady(reason string, gates []localEnvironmentConsumerActivationGate) productControlFirstRunSetupReconciliation {
	return productControlFirstRunSetupReconciliation{
		State:  productControlStateLocalAIProfileNotReady,
		Reason: productControlActivationGateReason(reason, gates),
	}
}

func productControlFirstRunSetupAssetsMissing(reason string, gates []localEnvironmentConsumerActivationGate) productControlFirstRunSetupReconciliation {
	return productControlFirstRunSetupReconciliation{
		State:  productControlStateLocalAIProfileAssetsMissing,
		Reason: productControlActivationGateReason(reason, gates),
	}
}

func productControlActivationGatesAnyState(gates []localEnvironmentConsumerActivationGate, state string) bool {
	for _, gate := range gates {
		if strings.TrimSpace(gate.State) == state {
			return true
		}
	}
	return false
}

func productControlActivationGateReason(prefix string, gates []localEnvironmentConsumerActivationGate) string {
	parts := make([]string, 0, len(gates))
	for _, gate := range gates {
		if strings.TrimSpace(gate.State) == localEnvironmentActivationStateReady {
			continue
		}
		consumerID := strings.TrimSpace(gate.ConsumerID)
		if consumerID == "" {
			consumerID = "unknown_consumer"
		}
		state := strings.TrimSpace(gate.State)
		if state == "" {
			state = localEnvironmentStateUnknown
		}
		detail := strings.TrimSpace(gate.Detail)
		if detail == "" {
			detail = strings.TrimSpace(gate.ReasonCode)
		}
		if detail != "" {
			parts = append(parts, consumerID+"="+state+"("+detail+")")
			continue
		}
		parts = append(parts, consumerID+"="+state)
	}
	if len(parts) == 0 {
		return strings.TrimSpace(prefix)
	}
	return strings.TrimSpace(prefix) + ":" + strings.Join(parts, ";")
}

func applyProductControlFirstRunSetupReconciliation(record *productControlRecord, reconciliation productControlFirstRunSetupReconciliation) {
	record.State = reconciliation.State
	switch reconciliation.State {
	case productControlStateRepairRequired, productControlStateBlocked:
		record.Repair = productRepairRecord{Required: true, Reason: stringPtr(strings.TrimSpace(reconciliation.Reason))}
		if record.DataRoot != nil {
			record.DataRoot.Status = productDataRootStatusRepairRequired
		}
	default:
		record.Repair = productRepairRecord{}
		if record.DataRoot != nil && record.DataRoot.Status == productDataRootStatusRepairRequired {
			record.DataRoot.Status = productDataRootStatusSelected
		}
	}
}
