package localservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

const (
	productControlCheckSyncObligationFile = "check-sync.json"
	productControlCheckSyncRequired       = "required"
	productControlCheckSyncCompleted      = "completed"
)

type ProductControlCheckSyncInput struct {
	RootActivationID  string
	DataRoot          string
	AccountGeneration uint64
}

type ProductControlCheckSyncResourceResult struct {
	Kind       string  `json:"kind"`
	Reference  *string `json:"reference,omitempty"`
	Locator    *string `json:"locator,omitempty"`
	Status     string  `json:"status"`
	Change     *string `json:"change,omitempty"`
	Reason     string  `json:"reason"`
	NextAction *string `json:"nextAction,omitempty"`
}

type ProductControlCheckSyncOwnerResult struct {
	OwnerID   string                                  `json:"ownerId"`
	State     string                                  `json:"state"`
	Resources []ProductControlCheckSyncResourceResult `json:"resources"`
}

type ProductControlCheckSyncOwner func(context.Context, ProductControlCheckSyncInput) ProductControlCheckSyncOwnerResult

// ProductControlCheckSyncRuntimeOwners is the fixed Runtime composition. It
// is deliberately not a registry: each field names one current canonical
// owner seam and all fields must be present before Check & Sync can start.
type productControlCheckSyncRuntimeOwners struct {
	RuntimeAgent      ProductControlCheckSyncOwner
	RegisteredApps    ProductControlCheckSyncOwner
	Cognition         ProductControlCheckSyncOwner
	ManagedAppStorage ProductControlCheckSyncOwner
	AccountGeneration func(context.Context) (uint64, bool)
}

type ProductControlCheckSyncRuntimeOwners struct {
	RuntimeAgent      ProductControlCheckSyncOwner
	RegisteredApps    ProductControlCheckSyncOwner
	Cognition         ProductControlCheckSyncOwner
	ManagedAppStorage ProductControlCheckSyncOwner
	AccountGeneration func(context.Context) (uint64, bool)
}

type productControlCheckSyncObligation struct {
	RootActivationID string `json:"rootActivationId"`
	State            string `json:"state"`
}

type productControlCheckSyncUnclaimed struct {
	Locator string `json:"locator"`
	Status  string `json:"status"`
	Reason  string `json:"reason"`
}

type productControlCheckSyncRun struct {
	RunID             string                               `json:"runId"`
	RootActivationID  string                               `json:"rootActivationId"`
	Trigger           string                               `json:"trigger"`
	State             string                               `json:"state"`
	StartedAt         string                               `json:"startedAt"`
	CompletedAt       *string                              `json:"completedAt,omitempty"`
	Owners            []ProductControlCheckSyncOwnerResult `json:"owners"`
	Unclaimed         []productControlCheckSyncUnclaimed   `json:"unclaimed"`
	cancel            context.CancelFunc
	done              chan struct{}
	accountGeneration uint64
}

type productControlCheckSyncProjection struct {
	Run        *productControlCheckSyncRun        `json:"run"`
	Obligation *productControlCheckSyncObligation `json:"obligation"`
	Error      *string                            `json:"error"`
}

func (s *Service) SetProductControlCheckSyncRuntimeOwners(owners ProductControlCheckSyncRuntimeOwners) error {
	if s == nil {
		return errors.New("local service is nil")
	}
	if owners.RuntimeAgent == nil || owners.RegisteredApps == nil || owners.Cognition == nil || owners.ManagedAppStorage == nil {
		return errors.New("all fixed Runtime Check & Sync owners are required")
	}
	s.productControlCheckSyncMu.Lock()
	s.productControlCheckSyncOwners = productControlCheckSyncRuntimeOwners{
		RuntimeAgent: owners.RuntimeAgent, RegisteredApps: owners.RegisteredApps,
		Cognition: owners.Cognition, ManagedAppStorage: owners.ManagedAppStorage,
		AccountGeneration: owners.AccountGeneration,
	}
	s.productControlCheckSyncMu.Unlock()
	return nil
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007c
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007f
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007g
func (s *Service) StartProductControlCheckSync(_ context.Context, _ *runtimev1.StartProductControlCheckSyncRequest) (*runtimev1.CheckSyncProjectionJson, error) {
	projection, err := s.startProductControlCheckSync("manual", true)
	return productControlCheckSyncJSON(projection, err)
}

func (s *Service) GetProductControlCheckSync(ctx context.Context, _ *runtimev1.GetProductControlCheckSyncRequest) (*runtimev1.CheckSyncProjectionJson, error) {
	projection, err := s.readProductControlCheckSyncProjection()
	if err == nil && projection.Run != nil {
		s.productControlCheckSyncMu.RLock()
		provider := s.productControlCheckSyncOwners.AccountGeneration
		s.productControlCheckSyncMu.RUnlock()
		if provider != nil {
			generation, ok := provider(ctx)
			if !ok || generation == 0 || generation != projection.Run.accountGeneration {
				markProductControlCheckSyncManagedAppStorageStale(projection.Run)
			}
		}
	}
	return productControlCheckSyncJSON(projection, err)
}

// RecoverProductControlCheckSync is called once after the fixed owner
// composition is complete. A matching completed obligation is an ordinary
// restart no-op; absence, mismatch, or required state starts recovery.
func (s *Service) RecoverProductControlCheckSync() error {
	record, _, err := s.currentProductControlCheckSyncActivation()
	if err != nil {
		return err
	}
	if record == nil {
		return nil
	}
	obligation, err := s.readProductControlCheckSyncObligation()
	if err != nil {
		obligation = nil
	}
	if obligation != nil && obligation.RootActivationID == record.DataRoot.RootActivationID && obligation.State == productControlCheckSyncCompleted {
		return nil
	}
	trigger := "activation"
	if obligation != nil && obligation.RootActivationID == record.DataRoot.RootActivationID {
		trigger = "interrupted_recovery"
	}
	_, err = s.startProductControlCheckSync(trigger, false)
	return err
}

func (s *Service) StopProductControlCheckSync() {
	if s == nil {
		return
	}
	s.productControlCheckSyncStartMu.Lock()
	s.productControlCheckSyncMu.Lock()
	s.productControlCheckSyncClosed = true
	run := s.productControlCheckSyncRun
	running := run != nil && run.State == "running"
	s.productControlCheckSyncMu.Unlock()
	s.productControlCheckSyncStartMu.Unlock()
	if running && run.cancel != nil {
		run.cancel()
		if run.done != nil {
			<-run.done
		}
	}
}

func productControlCheckSyncJSON(value productControlCheckSyncProjection, err error) (*runtimev1.CheckSyncProjectionJson, error) {
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("serialize Check & Sync projection: %w", err)
	}
	return &runtimev1.CheckSyncProjectionJson{Json: string(payload)}, nil
}

func (s *Service) startProductControlCheckSync(trigger string, manual bool) (productControlCheckSyncProjection, error) {
	s.productControlCheckSyncStartMu.Lock()
	defer s.productControlCheckSyncStartMu.Unlock()

	s.productControlCheckSyncMu.RLock()
	closed := s.productControlCheckSyncClosed
	current := cloneProductControlCheckSyncRun(s.productControlCheckSyncRun)
	owners := s.productControlCheckSyncOwners
	s.productControlCheckSyncMu.RUnlock()
	if closed {
		return productControlCheckSyncProjection{}, errors.New("Check & Sync admission is closed for root handoff")
	}
	record, root, err := s.currentProductControlCheckSyncActivation()
	if err != nil {
		return productControlCheckSyncProjection{}, err
	}
	if record == nil {
		return productControlCheckSyncProjection{}, errors.New("Check & Sync requires a current ready root activation")
	}
	activationID := record.DataRoot.RootActivationID
	if current != nil && current.RootActivationID == activationID && current.State == "running" {
		obligation, _ := s.readProductControlCheckSyncObligation()
		return productControlCheckSyncProjection{Run: current, Obligation: obligation}, nil
	}
	if !manual && current != nil && current.RootActivationID == activationID && current.State == "completed" {
		obligation, _ := s.readProductControlCheckSyncObligation()
		return productControlCheckSyncProjection{Run: current, Obligation: obligation}, nil
	}
	if owners.RuntimeAgent == nil || owners.RegisteredApps == nil || owners.Cognition == nil || owners.ManagedAppStorage == nil {
		return productControlCheckSyncProjection{}, errors.New("fixed Runtime Check & Sync owner composition is incomplete")
	}
	obligation := &productControlCheckSyncObligation{RootActivationID: activationID, State: productControlCheckSyncRequired}
	if err := s.writeProductControlCheckSyncObligation(obligation); err != nil {
		return productControlCheckSyncProjection{}, err
	}
	runCtx, cancel := context.WithCancel(context.Background())
	accountGeneration := uint64(0)
	if owners.AccountGeneration != nil {
		if generation, ok := owners.AccountGeneration(context.Background()); ok {
			accountGeneration = generation
		}
	}
	run := &productControlCheckSyncRun{
		RunID: "sync_" + strings.ToLower(ulid.Make().String()), RootActivationID: activationID,
		Trigger: trigger, State: "running", StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Owners: []ProductControlCheckSyncOwnerResult{
			{OwnerID: "model_assets_loadouts", State: "pending", Resources: []ProductControlCheckSyncResourceResult{}},
			{OwnerID: "dependencies_environments", State: "pending", Resources: []ProductControlCheckSyncResourceResult{}},
			{OwnerID: "runtime_agent", State: "pending", Resources: []ProductControlCheckSyncResourceResult{}},
			{OwnerID: "registered_apps", State: "pending", Resources: []ProductControlCheckSyncResourceResult{}},
			{OwnerID: "cognition", State: "pending", Resources: []ProductControlCheckSyncResourceResult{}},
			{OwnerID: "managed_app_storage", State: "pending", Resources: []ProductControlCheckSyncResourceResult{}},
		},
		Unclaimed: []productControlCheckSyncUnclaimed{}, cancel: cancel, done: make(chan struct{}), accountGeneration: accountGeneration,
	}
	s.productControlCheckSyncMu.Lock()
	if s.productControlCheckSyncClosed {
		s.productControlCheckSyncMu.Unlock()
		cancel()
		return productControlCheckSyncProjection{}, errors.New("Check & Sync admission closed before run installation")
	}
	s.productControlCheckSyncRun = run
	s.productControlCheckSyncError = ""
	projectionRun := cloneProductControlCheckSyncRun(run)
	s.productControlCheckSyncMu.Unlock()
	input := ProductControlCheckSyncInput{RootActivationID: activationID, DataRoot: root, AccountGeneration: accountGeneration}
	go s.executeProductControlCheckSync(runCtx, run, input, owners)
	return productControlCheckSyncProjection{Run: projectionRun, Obligation: obligation}, nil
}

func (s *Service) executeProductControlCheckSync(ctx context.Context, run *productControlCheckSyncRun, input ProductControlCheckSyncInput, owners productControlCheckSyncRuntimeOwners) {
	defer close(run.done)
	ownerCalls := []ProductControlCheckSyncOwner{
		s.reconcileProductControlCheckSyncModelAssets,
		s.reconcileProductControlCheckSyncEnvironments,
		owners.RuntimeAgent,
		owners.RegisteredApps,
		owners.Cognition,
		owners.ManagedAppStorage,
	}
	for index, owner := range ownerCalls {
		if ctx.Err() != nil {
			break
		}
		s.updateProductControlCheckSyncOwner(run, index, ProductControlCheckSyncOwnerResult{
			OwnerID: run.Owners[index].OwnerID, State: "running", Resources: []ProductControlCheckSyncResourceResult{},
		})
		result := owner(ctx, input)
		if result.OwnerID != run.Owners[index].OwnerID {
			result = failedProductControlCheckSyncOwner(run.Owners[index].OwnerID, "OWNER_RESULT_ID_MISMATCH")
		}
		if result.State != "completed" && result.State != "failed" {
			result = failedProductControlCheckSyncOwner(run.Owners[index].OwnerID, "OWNER_RESULT_STATE_INVALID")
		}
		s.updateProductControlCheckSyncOwner(run, index, result)
	}
	unclaimed := scanProductControlCheckSyncUnclaimed(input.DataRoot)
	completedAt := time.Now().UTC().Format(time.RFC3339Nano)
	s.productControlCheckSyncMu.Lock()
	if ctx.Err() != nil {
		run.State = "failed"
		for index := range run.Owners {
			if run.Owners[index].State == "pending" || run.Owners[index].State == "running" {
				run.Owners[index] = failedProductControlCheckSyncOwner(run.Owners[index].OwnerID, "RUN_INTERRUPTED")
			}
		}
	} else {
		run.State = "completed"
	}
	run.Unclaimed = unclaimed
	run.CompletedAt = &completedAt
	s.productControlCheckSyncMu.Unlock()
	if ctx.Err() == nil {
		s.completeProductControlCheckSyncObligation(run)
	}
}

func (s *Service) updateProductControlCheckSyncOwner(run *productControlCheckSyncRun, index int, result ProductControlCheckSyncOwnerResult) {
	s.productControlCheckSyncMu.Lock()
	defer s.productControlCheckSyncMu.Unlock()
	if run == nil || index < 0 || index >= len(run.Owners) {
		return
	}
	run.Owners[index] = result
}

func failedProductControlCheckSyncOwner(ownerID string, reason string) ProductControlCheckSyncOwnerResult {
	return ProductControlCheckSyncOwnerResult{
		OwnerID: ownerID, State: "failed",
		Resources: []ProductControlCheckSyncResourceResult{{
			Kind: "owner", Status: "failed", Reason: reason,
		}},
	}
}

func (s *Service) completeProductControlCheckSyncObligation(run *productControlCheckSyncRun) {
	s.productControlCheckSyncStartMu.Lock()
	defer s.productControlCheckSyncStartMu.Unlock()
	s.productControlCheckSyncMu.RLock()
	closed := s.productControlCheckSyncClosed
	current := s.productControlCheckSyncRun
	runState := run.State
	s.productControlCheckSyncMu.RUnlock()
	if closed || current != run || runState != "completed" {
		return
	}
	record, _, err := s.currentProductControlCheckSyncActivation()
	if err != nil || record == nil || record.DataRoot.RootActivationID != run.RootActivationID {
		s.productControlCheckSyncMu.Lock()
		if current == run {
			run.State = "superseded"
		}
		s.productControlCheckSyncMu.Unlock()
		return
	}
	if err := s.writeProductControlCheckSyncObligation(&productControlCheckSyncObligation{
		RootActivationID: run.RootActivationID, State: productControlCheckSyncCompleted,
	}); err != nil {
		s.productControlCheckSyncMu.Lock()
		if s.productControlCheckSyncRun == run {
			run.State = "failed"
			s.productControlCheckSyncError = "CHECK_SYNC_OBLIGATION_WRITE_FAILED: " + err.Error()
		}
		s.productControlCheckSyncMu.Unlock()
	}
}

func (s *Service) currentProductControlCheckSyncActivation() (*productControlRecord, string, error) {
	path, err := s.productControlRecordPath()
	if err != nil {
		return nil, "", err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return nil, "", err
	}
	if record == nil || record.DataRoot == nil {
		return nil, "", nil
	}
	if record.SchemaVersion == productControlLegacySchemaVersion {
		return nil, "", errors.New("product-control root activation must be initialized before Check & Sync")
	}
	if record.State != productControlStateReadyForUse || record.DataRoot.Status != productDataRootStatusReady || strings.TrimSpace(record.DataRoot.RootActivationID) == "" {
		return nil, "", nil
	}
	return record, selectedProductDataRootPath(record), nil
}

// CurrentProductControlRootActivationID exposes only the active owner-private
// activation token needed to fence non-portable Runtime jobs during startup.
// It does not expose Product Control storage or create Check & Sync history.
func (s *Service) CurrentProductControlRootActivationID() (string, bool, error) {
	path, err := s.productControlRecordPath()
	if err != nil {
		return "", false, err
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		return "", false, err
	}
	if record == nil || record.DataRoot == nil || record.SchemaVersion == productControlLegacySchemaVersion ||
		record.State != productControlStateReadyForUse || record.DataRoot.Status != productDataRootStatusReady ||
		strings.TrimSpace(record.DataRoot.RootActivationID) == "" {
		return "", false, nil
	}
	selectedRoot := selectedProductDataRootPath(record)
	s.mu.RLock()
	runtimeRoot := s.runtimeDataRoot
	s.mu.RUnlock()
	if strings.TrimSpace(runtimeRoot) == "" || !productControlPathsEqual(runtimeRoot, selectedRoot) {
		return "", false, errors.New("product-control root activation is not bound to the current Runtime root")
	}
	return record.DataRoot.RootActivationID, true, nil
}

func (s *Service) readProductControlCheckSyncProjection() (productControlCheckSyncProjection, error) {
	s.productControlCheckSyncStartMu.Lock()
	defer s.productControlCheckSyncStartMu.Unlock()
	obligation, err := s.readProductControlCheckSyncObligation()
	if err != nil {
		return productControlCheckSyncProjection{}, err
	}
	s.productControlCheckSyncMu.RLock()
	run := cloneProductControlCheckSyncRun(s.productControlCheckSyncRun)
	runError := strings.TrimSpace(s.productControlCheckSyncError)
	s.productControlCheckSyncMu.RUnlock()
	// Completion is observable only after the matching durable obligation is
	// committed. Keep the projection non-terminal across the narrow file-write
	// window so callers never observe a completed run with required custody.
	if run != nil && run.State == "completed" &&
		(obligation == nil || obligation.RootActivationID != run.RootActivationID || obligation.State != productControlCheckSyncCompleted) {
		run.State = "running"
		run.CompletedAt = nil
	}
	return productControlCheckSyncProjection{Run: run, Obligation: obligation, Error: optionalProductControlCheckSyncText(runError)}, nil
}

func (s *Service) productControlCheckSyncObligationPath() (string, error) {
	recordPath, err := s.productControlRecordPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(recordPath), productControlCheckSyncObligationFile), nil
}

func (s *Service) readProductControlCheckSyncObligation() (*productControlCheckSyncObligation, error) {
	path, err := s.productControlCheckSyncObligationPath()
	if err != nil {
		return nil, err
	}
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read Check & Sync obligation: %w", err)
	}
	if len(payload) == 0 || len(payload) > 4096 {
		return nil, errors.New("Check & Sync obligation is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var obligation productControlCheckSyncObligation
	if err := decoder.Decode(&obligation); err != nil {
		return nil, fmt.Errorf("decode Check & Sync obligation: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errors.New("Check & Sync obligation has trailing JSON")
	}
	if strings.TrimSpace(obligation.RootActivationID) == "" || (obligation.State != productControlCheckSyncRequired && obligation.State != productControlCheckSyncCompleted) {
		return nil, errors.New("Check & Sync obligation fields are invalid")
	}
	return &obligation, nil
}

func (s *Service) writeProductControlCheckSyncObligation(obligation *productControlCheckSyncObligation) error {
	if obligation == nil || strings.TrimSpace(obligation.RootActivationID) == "" || (obligation.State != productControlCheckSyncRequired && obligation.State != productControlCheckSyncCompleted) {
		return errors.New("Check & Sync obligation fields are invalid")
	}
	path, err := s.productControlCheckSyncObligationPath()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(obligation)
	if err != nil {
		return fmt.Errorf("serialize Check & Sync obligation: %w", err)
	}
	if err := writeFileAtomically(path, payload, 0o600); err != nil {
		return fmt.Errorf("write Check & Sync obligation: %w", err)
	}
	return nil
}

func cloneProductControlCheckSyncRun(run *productControlCheckSyncRun) *productControlCheckSyncRun {
	if run == nil {
		return nil
	}
	clone := *run
	clone.cancel = nil
	clone.done = nil
	clone.Owners = make([]ProductControlCheckSyncOwnerResult, len(run.Owners))
	for index, owner := range run.Owners {
		clone.Owners[index] = owner
		clone.Owners[index].Resources = make([]ProductControlCheckSyncResourceResult, len(owner.Resources))
		copy(clone.Owners[index].Resources, owner.Resources)
	}
	clone.Unclaimed = make([]productControlCheckSyncUnclaimed, len(run.Unclaimed))
	copy(clone.Unclaimed, run.Unclaimed)
	return &clone
}

func markProductControlCheckSyncManagedAppStorageStale(run *productControlCheckSyncRun) {
	if run == nil {
		return
	}
	for index := range run.Owners {
		switch run.Owners[index].OwnerID {
		case "runtime_agent":
			run.Owners[index] = ProductControlCheckSyncOwnerResult{
				OwnerID: "runtime_agent", State: "completed",
				Resources: []ProductControlCheckSyncResourceResult{{
					Kind: "runtime_owner_account", Status: "unavailable", Reason: "RUNTIME_OWNER_ACCOUNT_CONTEXT_CHANGED",
				}},
			}
		case "managed_app_storage":
			run.Owners[index] = ProductControlCheckSyncOwnerResult{
				OwnerID: "managed_app_storage", State: "completed",
				Resources: []ProductControlCheckSyncResourceResult{{
					Kind: "managed_app_storage", Status: "unavailable", Reason: "APP_STORAGE_ACCOUNT_CONTEXT_CHANGED",
				}},
			}
		}
	}
}

func scanProductControlCheckSyncUnclaimed(root string) []productControlCheckSyncUnclaimed {
	entries, err := os.ReadDir(root)
	if err != nil {
		return []productControlCheckSyncUnclaimed{}
	}
	known := map[string]struct{}{
		"models": {}, "dependencies": {}, "environments": {}, "apps": {},
		"accounts": {}, "logs": {}, "audit": {}, "managed-app-storage": {},
	}
	result := make([]productControlCheckSyncUnclaimed, 0)
	for _, entry := range entries {
		if _, ok := known[entry.Name()]; ok {
			continue
		}
		result = append(result, productControlCheckSyncUnclaimed{
			Locator: filepath.ToSlash(entry.Name()), Status: "unknown", Reason: "UNCLAIMED_ROOT_ENTRY",
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Locator < result[j].Locator })
	return result
}

func (s *Service) closeProductControlCheckSyncAdmission(ctx context.Context) error {
	s.productControlCheckSyncStartMu.Lock()
	s.productControlCheckSyncMu.Lock()
	if s.productControlCheckSyncClosed {
		s.productControlCheckSyncMu.Unlock()
		s.productControlCheckSyncStartMu.Unlock()
		return errors.New("Check & Sync admission is already closed")
	}
	s.productControlCheckSyncClosed = true
	run := s.productControlCheckSyncRun
	running := run != nil && run.State == "running"
	s.productControlCheckSyncMu.Unlock()
	s.productControlCheckSyncStartMu.Unlock()
	if !running || run.cancel == nil {
		return nil
	}
	run.cancel()
	select {
	case <-run.done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("stop current Check & Sync run: %w", ctx.Err())
	}
}

func (s *Service) abortProductControlCheckSyncHandoff() {
	s.productControlCheckSyncMu.Lock()
	s.productControlCheckSyncClosed = false
	s.productControlCheckSyncMu.Unlock()
	go func() {
		_, _ = s.startProductControlCheckSync("interrupted_recovery", false)
	}()
}

func (s *Service) commitProductControlCheckSyncHandoff(previousActivationID string) {
	s.productControlCheckSyncMu.Lock()
	if run := s.productControlCheckSyncRun; run != nil && run.RootActivationID == previousActivationID {
		run.State = "superseded"
		if run.CompletedAt == nil {
			completedAt := time.Now().UTC().Format(time.RFC3339Nano)
			run.CompletedAt = &completedAt
		}
	}
	s.productControlCheckSyncMu.Unlock()
}
