package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type CapabilityProvider func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error)

type Facade struct {
	store        *Store
	owner        *memoryv1.Core
	bridge       *Bridge
	authorize    DrainAuthorizer
	capabilities CapabilityProvider
}

type RecallIntent struct {
	LocalAgentRef string
	OperationID   string
	Query         string
	Limit         int
}

type RecallOutcome struct {
	Outcome     memoryv1.Outcome
	OperationID string
	Pipeline    memoryv1.PipelineName
	Hits        []memoryv1.Memory
}

type Projection struct {
	Outcome          memoryv1.Outcome
	Enabled          bool
	AdoptionRequired bool
	Items            []memoryv1.Memory
	CurrentCount     int
	SupersededCount  int
	ForgottenCount   int
}

type MutationOutcome struct {
	Outcome            memoryv1.Outcome
	AffectedMemoryRefs []string
	Projection         Projection
}

func NewFacade(store *Store, owner *memoryv1.Core, bridge *Bridge, authorize DrainAuthorizer, capabilities CapabilityProvider) *Facade {
	return &Facade{store: store, owner: owner, bridge: bridge, authorize: authorize, capabilities: capabilities}
}

func (f *Facade) ProcessRemember(ctx context.Context, localAgentRef, operationID string) (memoryv1.DecisionResult, error) {
	if f == nil || f.store == nil || f.owner == nil || f.authorize == nil || !validRef(localAgentRef) || !validRef(operationID) {
		return memoryv1.DecisionResult{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("process cognition memory Remember: invalid input")
	}
	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return memoryv1.DecisionResult{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return memoryv1.DecisionResult{Outcome: memoryv1.OutcomeNoEffect}, ErrMemoryDisabled
	}
	if err := f.authorize(ctx, binding); err != nil {
		return memoryv1.DecisionResult{Outcome: memoryv1.OutcomeInvalid}, err
	}
	result, err := f.owner.ExecuteRemember(ctx, operationID)
	if err != nil || result.Outcome != memoryv1.OutcomeAdmitted || f.capabilities == nil {
		return result, err
	}
	snapshot, port, capabilityErr := f.capabilities(ctx, binding)
	if capabilityErr != nil || port == nil {
		// Canonical admission already committed. Derived Embedding remains typed
		// unavailable while the independent FTS generation stays usable.
		return result, nil
	}
	available := make(map[memoryv1.Capability]bool, len(snapshot.Available))
	for _, capability := range snapshot.Available {
		available[capability] = true
	}
	if !available[memoryv1.CapabilityTextEmbed] || !available[memoryv1.CapabilityVectorIndex] {
		return result, nil
	}
	_, _ = f.owner.RebuildEmbedding(ctx, "cmindex_"+ulid.Make().String(), binding.BankRef, snapshot, port)
	return result, nil
}

// @nimi-authority: rule.nimi.runtime.memory-world.r021
func (f *Facade) Recall(ctx context.Context, intent RecallIntent) (RecallOutcome, error) {
	if f == nil || f.store == nil || f.owner == nil || f.authorize == nil || f.capabilities == nil || !validRef(intent.LocalAgentRef) || intent.Query == "" {
		return RecallOutcome{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("recall cognition memory: invalid intent")
	}
	binding, err := f.store.BindingForAgent(ctx, intent.LocalAgentRef)
	if err != nil {
		return RecallOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return RecallOutcome{Outcome: memoryv1.OutcomeUnconfigured}, nil
	}
	if err := f.authorize(ctx, binding); err != nil {
		return RecallOutcome{Outcome: memoryv1.OutcomeInvalid}, err
	}
	snapshot, port, err := f.capabilities(ctx, binding)
	if err != nil {
		return RecallOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	operationID := intent.OperationID
	if operationID == "" {
		operationID = "cmrecall_" + ulid.Make().String()
	}
	limit := intent.Limit
	if limit <= 0 {
		limit = 8
	}
	result, err := f.owner.Recall(ctx, memoryv1.RecallRequest{OperationID: operationID, BankRef: binding.BankRef, Query: intent.Query, Limit: limit, Capabilities: snapshot}, port)
	return RecallOutcome{Outcome: result.Outcome, OperationID: operationID, Pipeline: result.Pipeline, Hits: append([]memoryv1.Memory(nil), result.Hits...)}, err
}

func (f *Facade) ResumePending(ctx context.Context, localAgentRef string) error {
	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return err
	}
	if !binding.Enabled || binding.AdoptionRequired || binding.BankRef == "" {
		return nil
	}
	if err := f.authorize(ctx, binding); err != nil {
		return err
	}
	status, err := f.owner.InspectStatus(ctx, binding.BindingRef, binding.BankRef)
	if err != nil {
		return err
	}
	for _, event := range status.Events {
		if event.Outcome != memoryv1.OutcomeReceived && event.Outcome != memoryv1.OutcomeProcessing {
			continue
		}
		if _, err := f.ProcessRemember(ctx, localAgentRef, event.OperationID); err != nil {
			return err
		}
	}
	return nil
}

func (f *Facade) Inspect(ctx context.Context, localAgentRef string) (Projection, error) {
	if f == nil || f.store == nil || f.owner == nil || f.authorize == nil || !validRef(localAgentRef) {
		return Projection{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("inspect cognition memory: invalid input")
	}
	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return Projection{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if err := f.authorize(ctx, binding); err != nil {
		return Projection{Outcome: memoryv1.OutcomeInvalid}, err
	}
	projection := Projection{Enabled: binding.Enabled, AdoptionRequired: binding.AdoptionRequired}
	if binding.BankRef == "" {
		projection.Outcome = memoryv1.OutcomeUnconfigured
		return projection, nil
	}
	items, err := f.owner.ListMemories(ctx, binding.BankRef, true)
	if err != nil {
		return Projection{Outcome: memoryv1.OutcomeUnavailable, Enabled: binding.Enabled, AdoptionRequired: binding.AdoptionRequired}, err
	}
	projection.Items = items
	for _, item := range items {
		switch item.Lifecycle {
		case memoryv1.LifecycleCurrent:
			projection.CurrentCount++
		case memoryv1.LifecycleSuperseded, memoryv1.LifecycleConflicted:
			projection.SupersededCount++
		case memoryv1.LifecycleForgotten:
			projection.ForgottenCount++
		}
	}
	if !binding.Enabled || binding.AdoptionRequired {
		projection.Outcome = memoryv1.OutcomeUnconfigured
	} else {
		projection.Outcome = memoryv1.OutcomeReady
	}
	return projection, nil
}

func (f *Facade) Correct(ctx context.Context, localAgentRef, memoryRef, correctedContent string) (MutationOutcome, error) {
	if f == nil || f.bridge == nil || !validRef(memoryRef) || strings.TrimSpace(correctedContent) == "" {
		return MutationOutcome{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("correct cognition memory: invalid intent")
	}
	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return MutationOutcome{Outcome: memoryv1.OutcomeUnconfigured}, ErrMemoryDisabled
	}
	if err := f.authorize(ctx, binding); err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeInvalid}, err
	}
	eventRef := "cmevt_" + ulid.Make().String()
	operationID := "cmop_" + ulid.Make().String()
	envelope := &runtimev1.CognitionMemoryCommittedEventEnvelope{
		Event: &runtimev1.CognitionMemoryEventRef{Value: eventRef}, Operation: &runtimev1.CognitionMemoryOperationRef{Value: operationID},
		Subjects:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Sources:     []*runtimev1.CognitionMemorySourceRef{{Kind: "agent_center_correction", Value: operationID}},
		CommittedAt: timestamppb.New(time.Now().UTC()),
		Fact:        &runtimev1.CognitionMemoryCommittedEventEnvelope_CorrectionCommitted{CorrectionCommitted: &runtimev1.CognitionMemoryCorrectionCommitted{TargetMemory: &runtimev1.CognitionMemoryRef{Value: memoryRef}, CorrectedContent: strings.TrimSpace(correctedContent)}},
	}
	if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := f.store.EnqueueCommittedEventTx(tx, localAgentRef, envelope)
		return err
	}); err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	var decision memoryv1.DecisionResult
	for {
		drained, err := f.bridge.DrainOne(ctx, localAgentRef)
		if err != nil {
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("correct cognition memory: custody transfer failed: %w", err)
		}
		if !drained.Drained {
			// A concurrent Runtime worker may already have transferred this exact
			// operation. ExecuteRemember is idempotent over owner custody/results.
			decision, err = f.ProcessRemember(ctx, localAgentRef, operationID)
			if err != nil {
				return MutationOutcome{Outcome: decision.Outcome}, err
			}
			break
		}
		decision, err = f.ProcessRemember(ctx, localAgentRef, drained.OperationID)
		if err != nil {
			return MutationOutcome{Outcome: decision.Outcome}, err
		}
		if drained.OperationID == operationID {
			break
		}
	}
	projection, inspectErr := f.Inspect(ctx, localAgentRef)
	return MutationOutcome{Outcome: decision.Outcome, AffectedMemoryRefs: decision.AffectedMemoryRefs, Projection: projection}, inspectErr
}

func (f *Facade) Forget(ctx context.Context, localAgentRef string, memoryRefs []string, confirmed bool) (MutationOutcome, error) {
	if !confirmed || len(memoryRefs) == 0 {
		return MutationOutcome{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("forget cognition memory: exact confirmed targets are required")
	}
	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if err := f.authorize(ctx, binding); err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeInvalid}, err
	}
	result, err := f.owner.ForgetExact(ctx, memoryv1.ForgetRequest{OperationID: "cmforget_" + ulid.Make().String(), BindingRef: binding.BindingRef, BankRef: binding.BankRef, LifecycleRef: binding.LifecycleRef, TargetMemoryRefs: append([]string(nil), memoryRefs...), Confirmed: true})
	if err != nil {
		return MutationOutcome{Outcome: result.Outcome}, err
	}
	projection, inspectErr := f.Inspect(ctx, localAgentRef)
	return MutationOutcome{Outcome: result.Outcome, AffectedMemoryRefs: result.AffectedMemoryRefs, Projection: projection}, inspectErr
}

func (f *Facade) SetEnabled(ctx context.Context, localAgentRef string, enabled bool) (MutationOutcome, error) {
	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if err := f.authorize(ctx, binding); err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeInvalid}, err
	}
	if enabled {
		if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error { return f.store.SetEnabledTx(tx, localAgentRef, true) }); err != nil {
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
		}
		projection, err := f.Inspect(ctx, localAgentRef)
		return MutationOutcome{Outcome: memoryv1.OutcomeCommitted, Projection: projection}, err
	}
	return f.applyCutoff(ctx, localAgentRef, false, false)
}

func (f *Facade) DeleteAll(ctx context.Context, localAgentRef string, confirmed bool) (MutationOutcome, error) {
	if !confirmed {
		return MutationOutcome{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("delete all cognition memory: confirmation is required")
	}
	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	return f.applyCutoff(ctx, localAgentRef, true, binding.Enabled)
}

type cutoffRow struct {
	OperationID, LocalAgentRef, OldBindingRef, ReplacementBindingRef, BankRef, OldLifecycleRef, NewLifecycleRef, Phase string
	DeleteAll, PreviousEnabled, DesiredEnabled                                                                         bool
}

func (f *Facade) applyCutoff(ctx context.Context, localAgentRef string, deleteAll, desiredEnabled bool) (MutationOutcome, error) {
	row, found, err := f.pendingCutoff(ctx, localAgentRef)
	if err != nil {
		return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if found && (row.DeleteAll != deleteAll || row.DesiredEnabled != desiredEnabled) {
		return MutationOutcome{Outcome: memoryv1.OutcomeConflict}, ErrConflict
	}
	if !found {
		binding, err := f.store.BindingForAgent(ctx, localAgentRef)
		if err != nil {
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
		}
		if binding.BankRef == "" || binding.LifecycleRef == "" {
			if !deleteAll {
				if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
					return f.store.SetEnabledTx(tx, localAgentRef, desiredEnabled)
				}); err != nil {
					return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
				}
			}
			projection, err := f.Inspect(ctx, localAgentRef)
			return MutationOutcome{Outcome: memoryv1.OutcomeCommitted, Projection: projection}, err
		}
		row = cutoffRow{OperationID: "cmcut_" + ulid.Make().String(), LocalAgentRef: localAgentRef, OldBindingRef: binding.BindingRef, ReplacementBindingRef: "cmb_" + ulid.Make().String(), BankRef: binding.BankRef, OldLifecycleRef: binding.LifecycleRef, NewLifecycleRef: "cmcutref_" + ulid.Make().String(), Phase: "prepared", DeleteAll: deleteAll, PreviousEnabled: binding.Enabled, DesiredEnabled: desiredEnabled}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET enabled = 0, updated_at = ? WHERE local_agent_ref = ? AND current_binding_ref = ?`, now, localAgentRef, binding.BindingRef); err != nil {
				return err
			}
			_, err := tx.Exec(`INSERT INTO runtime_cognition_memory_cutoff(operation_id, local_agent_ref, old_binding_ref, replacement_binding_ref, bank_ref, old_lifecycle_ref, new_lifecycle_ref, delete_all, previous_enabled, desired_enabled, phase, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`, row.OperationID, localAgentRef, row.OldBindingRef, row.ReplacementBindingRef, row.BankRef, row.OldLifecycleRef, row.NewLifecycleRef, boolInt(deleteAll), boolInt(row.PreviousEnabled), boolInt(desiredEnabled), now, now)
			return err
		}); err != nil {
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
		}
	}
	if row.Phase == "prepared" {
		result, err := f.owner.ApplyCutoff(ctx, memoryv1.CutoffRequest{ContractVersion: memoryv1.ContractVersion, BindingRef: row.OldBindingRef, BankRef: row.BankRef, OperationID: row.OperationID, CurrentLifecycleRef: row.OldLifecycleRef, NewLifecycleRef: row.NewLifecycleRef, ReplacementBindingRef: row.ReplacementBindingRef, DeleteAll: row.DeleteAll})
		if err != nil || result.Outcome != memoryv1.OutcomeCommitted {
			return MutationOutcome{Outcome: result.Outcome}, err
		}
		if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE runtime_cognition_memory_cutoff SET phase = 'cognition_committed', updated_at = ? WHERE operation_id = ?`, time.Now().UTC().Format(time.RFC3339Nano), row.OperationID)
			return err
		}); err != nil {
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
		}
		row.Phase = "cognition_committed"
	}
	if row.Phase == "cognition_committed" {
		if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			if err := f.store.RotateCutoffTx(tx, localAgentRef, row.OldBindingRef, row.ReplacementBindingRef, row.OperationID, row.BankRef, row.NewLifecycleRef, row.DesiredEnabled, row.DeleteAll); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE runtime_cognition_memory_cutoff SET phase = 'completed', updated_at = ? WHERE operation_id = ?`, time.Now().UTC().Format(time.RFC3339Nano), row.OperationID)
			return err
		}); err != nil {
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
		}
	}
	projection, err := f.Inspect(ctx, localAgentRef)
	return MutationOutcome{Outcome: memoryv1.OutcomeCommitted, Projection: projection}, err
}

func (f *Facade) pendingCutoff(ctx context.Context, localAgentRef string) (cutoffRow, bool, error) {
	var row cutoffRow
	var deleteAll, previousEnabled, desiredEnabled int
	err := f.store.backend.DB().QueryRowContext(ctx, `SELECT operation_id, local_agent_ref, old_binding_ref, replacement_binding_ref, bank_ref, old_lifecycle_ref, new_lifecycle_ref, delete_all, previous_enabled, desired_enabled, phase FROM runtime_cognition_memory_cutoff WHERE local_agent_ref = ? AND phase <> 'completed' ORDER BY created_at LIMIT 1`, localAgentRef).Scan(&row.OperationID, &row.LocalAgentRef, &row.OldBindingRef, &row.ReplacementBindingRef, &row.BankRef, &row.OldLifecycleRef, &row.NewLifecycleRef, &deleteAll, &previousEnabled, &desiredEnabled, &row.Phase)
	if errors.Is(err, sql.ErrNoRows) {
		return cutoffRow{}, false, nil
	}
	if err != nil {
		return cutoffRow{}, false, err
	}
	row.DeleteAll, row.PreviousEnabled, row.DesiredEnabled = deleteAll == 1, previousEnabled == 1, desiredEnabled == 1
	return row, true, nil
}
