package localservice

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	productControlActivationReplacedReason      = "DATA_ROOT_REPLACED"
	productControlActivationUnchangedReason     = "DATA_ROOT_UNCHANGED"
	productControlActivationOverlappingReason   = "DATA_ROOT_OVERLAPS_CURRENT"
	productControlActivationRestartAction       = "restart_runtime_and_check_sync"
	productControlActivationManualSyncAction    = "run_check_sync"
	productControlActivationChooseAnotherAction = "choose_path_disjoint_root"
)

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007a
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007b
func (s *Service) ReplaceProductControlDataRoot(ctx context.Context, req *runtimev1.ReplaceProductControlDataRootRequest) (*runtimev1.ProductControlProjectionJson, error) {
	if s == nil {
		return nil, errors.New("local service is nil")
	}
	s.productControlReplacementMu.Lock()
	defer s.productControlReplacementMu.Unlock()

	target, err := normalizeProductControlDataRootPath(strings.TrimSpace(req.GetTargetRoot()))
	if err != nil {
		return nil, err
	}
	path, err := s.productControlRecordPath()
	if err != nil {
		return nil, err
	}
	if err := validateProductControlDataRootBoundary(target, filepath.Dir(path)); err != nil {
		return nil, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, errors.New("product-control record is missing; explicit replacement requires ready_for_use")
	}
	if record.SchemaVersion == productControlLegacySchemaVersion {
		return nil, errors.New("product-control root activation must be initialized before replacement")
	}
	if record.State != productControlStateReadyForUse || record.DataRoot == nil || record.DataRoot.Status != productDataRootStatusReady || strings.TrimSpace(record.DataRoot.RootActivationID) == "" {
		return nil, fmt.Errorf("explicit data-root replacement requires a valid ready_for_use activation, got state=%s", record.State)
	}
	current := selectedProductDataRootPath(record)
	if current == "" {
		return nil, errors.New("explicit data-root replacement requires a canonical current root")
	}
	if productControlPathsEqual(current, target) {
		return productControlJSON(productControlRecordProjection{
			Path: path, Exists: true, State: record.State, Record: record,
			Activation: &productControlActivation{
				Activated: false, ReasonCode: productControlActivationUnchangedReason,
				ActionHint: productControlActivationManualSyncAction,
			},
		}, nil)
	}
	if productControlPathsOverlap(current, target) {
		message := "replacement target must be path-disjoint from the current data root"
		return productControlJSON(productControlRecordProjection{
			Path: path, Exists: true, State: record.State, Record: record, Error: &message,
			Activation: &productControlActivation{
				Activated: false, ReasonCode: productControlActivationOverlappingReason,
				ActionHint: productControlActivationChooseAnotherAction,
			},
		}, nil)
	}

	s.mu.RLock()
	admissionClosed := s.productControlRootAdmissionClosed
	configValidator := s.productControlDataRootConfigValidator
	configWriter := s.productControlDataRootConfigWriter
	handoff := s.productControlRootHandoff
	s.mu.RUnlock()
	if admissionClosed {
		return nil, errors.New("Runtime root handoff requires restart before another replacement")
	}
	if configWriter == nil {
		return nil, errors.New("Runtime service-owned data-root config mutation is unavailable")
	}
	if configValidator == nil {
		return nil, errors.New("Runtime service-owned data-root config validation is unavailable")
	}
	if err := configValidator(target); err != nil {
		return nil, fmt.Errorf("validate Runtime service-owned data-root config mutation: %w", err)
	}
	if handoff == nil {
		return nil, errors.New("Runtime root-handoff lifecycle is unavailable")
	}
	if err := ensureNimiDataRootLayout(target, s.productControlDataRootSecurityBinding()); err != nil {
		return nil, err
	}
	previousActivationID := record.DataRoot.RootActivationID
	if err := s.closeProductControlCheckSyncAdmission(ctx); err != nil {
		return nil, err
	}
	checkSyncAborted := true
	defer func() {
		if checkSyncAborted {
			s.abortProductControlCheckSyncHandoff()
		}
	}()
	if err := handoff.CloseRootAdmission(ctx); err != nil {
		handoff.AbortRootHandoff()
		return nil, fmt.Errorf("close Runtime root-bound admission: %w", err)
	}
	aborted := true
	defer func() {
		if aborted {
			s.resumeProductControlRootBoundWork()
			handoff.AbortRootHandoff()
		}
	}()
	if err := s.stopProductControlRootBoundWork(ctx); err != nil {
		return nil, err
	}

	now := nowProductControlUnixMS()
	nowISO := nowProductControlISO()
	record.SchemaVersion = productControlSchemaVersion
	record.State = productControlStateReadyForUse
	record.DataRoot = &productDataRootRecord{
		Path:             target,
		Status:           productDataRootStatusReady,
		RootActivationID: mintProductControlRootActivationID(),
		SelectedAt:       nowISO,
		VerifiedAt:       nowISO,
		SelectedAtUnixMs: now,
		VerifiedAtUnixMs: now,
	}
	record.Repair = productRepairRecord{}
	if err := writeProductControlRecord(path, record); err != nil {
		return nil, fmt.Errorf("commit Product Control data-root activation: %w", err)
	}
	// From this point the replacement is committed and cannot be aborted. Mark
	// the process disposition before the remaining post-commit operations, so a
	// Host that loses the RPC response can resolve the exact activation.
	s.mu.Lock()
	s.runtimeDataRoot = target
	s.localModelsPath = filepath.Join(target, "models")
	s.productControlRootAdmissionClosed = true
	s.mu.Unlock()
	aborted = false
	checkSyncAborted = false
	s.commitProductControlCheckSyncHandoff(previousActivationID)
	handoff.CommitRootHandoff()

	_, configErr := configWriter(target)
	projection := productControlRecordProjection{
		Path: path, Exists: true, State: record.State, Record: record,
		Activation: &productControlActivation{
			Activated: true, ReasonCode: productControlActivationReplacedReason,
			ActionHint: productControlActivationRestartAction,
		},
		ConfigMutation: &productControlConfigMutation{
			Disposition: "restart_required", ReasonCode: "CONFIG_RESTART_REQUIRED",
			ActionHint: "request_typed_runtime_restart",
		},
	}
	if configErr != nil {
		detail := fmt.Sprintf("Runtime derived data-root configuration failed after activation: %v", configErr)
		record.State = productControlStateRepairRequired
		record.DataRoot.Status = productDataRootStatusRepairRequired
		record.Repair = productRepairRecord{Required: true, Reason: stringPtr(detail)}
		if writeErr := writeProductControlRecord(path, record); writeErr != nil {
			detail += "; persist repair state: " + writeErr.Error()
		}
		projection.State = record.State
		projection.Record = record
		projection.Error = stringPtr(detail)
		projection.ConfigMutation = &productControlConfigMutation{
			Disposition: "repair_required", ReasonCode: "CONFIG_WRITE_FAILED",
			ActionHint: "repair_runtime_config",
		}
	}
	return productControlJSON(projection, nil)
}

func productControlPathsOverlap(left string, right string) bool {
	return productControlPathIsWithin(left, right) || productControlPathIsWithin(right, left)
}

func (s *Service) stopProductControlRootBoundWork(ctx context.Context) error {
	s.mu.Lock()
	cancel := s.jobLifetimeCancel
	s.jobLifetimeCancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	done := make(chan struct{})
	go func() {
		s.localEnvironmentJobWG.Wait()
		s.transferWorkerWG.Wait()
		close(done)
	}()
	select {
	case <-done:
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("drain Runtime root-bound work: %w", err)
		}
		s.mu.RLock()
		manager := s.engineMgr
		s.mu.RUnlock()
		if owner, ok := manager.(interface{ QuiesceDataRoot(context.Context) error }); ok {
			if err := owner.QuiesceDataRoot(ctx); err != nil {
				return fmt.Errorf("stop Runtime environment owner: %w", err)
			}
		}
		return nil
	case <-ctx.Done():
		return fmt.Errorf("drain Runtime root-bound work: %w", ctx.Err())
	}
}

func (s *Service) resumeProductControlRootBoundWork() {
	s.mu.Lock()
	if s.jobLifetimeCancel == nil {
		s.jobLifetimeCtx, s.jobLifetimeCancel = context.WithCancel(context.Background())
	}
	manager := s.engineMgr
	s.mu.Unlock()
	if owner, ok := manager.(interface{ ResumeDataRootAfterAbort() }); ok {
		owner.ResumeDataRootAfterAbort()
	}
}
