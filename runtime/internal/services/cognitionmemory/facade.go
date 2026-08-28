package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type CapabilityProvider func(context.Context, Binding) (memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort, error)

type Facade struct {
	store        *Store
	owner        OwnerPort
	bridge       *Bridge
	authorize    DrainAuthorizer
	capabilities CapabilityProvider
	embeddingMu  sync.Mutex
}

type RecallIntent struct {
	LocalAgentRef string
	OperationID   string
	Query         string
	Limit         int
}

type InspectIntent struct {
	LocalAgentRef string
	Limit         int
	PageToken     string
}

type RecallOutcome struct {
	Outcome     memoryv1.Outcome
	OperationID string
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
	NextPageToken    string
}

type MutationOutcome struct {
	Outcome            memoryv1.Outcome
	AffectedMemoryRefs []string
	Projection         Projection
}

func NewFacade(store *Store, owner OwnerPort, bridge *Bridge, authorize DrainAuthorizer, capabilities CapabilityProvider) *Facade {
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
	return f.owner.ExecuteRemember(ctx, operationID)
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
	result, err := f.owner.Recall(ctx, &runtimev1.CognitionMemoryRecallRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef},
		Bank:            &runtimev1.CognitionMemoryBankRef{Value: binding.BankRef},
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: operationID},
		Query:           intent.Query,
		SubjectScope:    []*runtimev1.CognitionMemorySubjectRef{{Kind: "account_subject", Value: binding.AccountSubjectRef}},
		Limit:           uint32(limit),
		Capabilities:    ownerProtoCapabilitySnapshot(snapshot),
	}, port)
	outcome := ownerMemoryOutcome(result.GetOutcome())
	mapped := make([]memoryv1.Memory, 0, len(result.GetHits()))
	for _, hit := range result.GetHits() {
		item, mapErr := ownerMemoryFromProto(hit)
		if mapErr != nil {
			return RecallOutcome{Outcome: memoryv1.OutcomeFailed, OperationID: operationID}, mapErr
		}
		mapped = append(mapped, item)
	}
	return RecallOutcome{Outcome: outcome, OperationID: operationID, Hits: mapped}, err
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
	pending, err := f.owner.ListPendingEvents(ctx, binding.BindingRef, binding.BankRef)
	if err != nil {
		return err
	}
	for _, event := range pending {
		if _, err := f.ProcessRemember(ctx, localAgentRef, event.OperationID); err != nil {
			return err
		}
	}
	return f.rebuildEmbeddingIfNeeded(ctx, binding)
}

func (f *Facade) rebuildEmbeddingIfNeeded(ctx context.Context, binding Binding) error {
	if f == nil {
		return nil
	}
	f.embeddingMu.Lock()
	defer f.embeddingMu.Unlock()
	if f.owner == nil || f.capabilities == nil || binding.BankRef == "" {
		return nil
	}
	snapshot, port, err := f.capabilities(ctx, binding)
	if err != nil || port == nil {
		return err
	}
	pending, err := f.owner.PendingEmbeddingRebuilds(ctx, binding.BankRef)
	if err != nil {
		return err
	}
	for _, interrupted := range pending {
		outcome, rebuildErr := f.owner.RebuildEmbedding(ctx, interrupted.OperationID, binding.BankRef, interrupted.Snapshot, port)
		if rebuildErr != nil {
			if interrupted.Stale && outcome == memoryv1.OutcomeConflict && memoryv1.IsOutcome(rebuildErr, memoryv1.OutcomeConflict) {
				continue
			}
			return rebuildErr
		}
	}
	needsRebuild, err := f.owner.NeedsEmbeddingRebuild(ctx, binding.BankRef, snapshot)
	if err != nil || !needsRebuild {
		return err
	}
	_, err = f.owner.RebuildEmbedding(ctx, "cmindex_"+ulid.Make().String(), binding.BankRef, snapshot, port)
	return err
}

func (f *Facade) Inspect(ctx context.Context, intent InspectIntent) (Projection, error) {
	if f == nil || f.store == nil || f.owner == nil || f.authorize == nil || !validRef(intent.LocalAgentRef) {
		return Projection{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("inspect cognition memory: invalid input")
	}
	binding, err := f.store.BindingForAgent(ctx, intent.LocalAgentRef)
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
	statusResponse, err := f.owner.InspectStatusSummary(ctx, binding.BindingRef, binding.BankRef)
	if err != nil {
		return Projection{Outcome: memoryv1.OutcomeUnavailable, Enabled: binding.Enabled, AdoptionRequired: binding.AdoptionRequired}, err
	}
	limit := intent.Limit
	if limit <= 0 {
		limit = 100
	}
	inspectResponse, err := f.owner.Inspect(ctx, &runtimev1.CognitionMemoryInspectRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef},
		Bank:            &runtimev1.CognitionMemoryBankRef{Value: binding.BankRef},
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: "cminspect_" + ulid.Make().String()},
		Limit:           uint32(limit),
		PageToken:       intent.PageToken,
	})
	if err != nil {
		return Projection{Outcome: memoryv1.OutcomeUnavailable, Enabled: binding.Enabled, AdoptionRequired: binding.AdoptionRequired}, err
	}
	for _, hit := range inspectResponse.GetMemories() {
		item, mapErr := ownerMemoryFromProto(hit)
		if mapErr != nil {
			return Projection{Outcome: memoryv1.OutcomeFailed, Enabled: binding.Enabled, AdoptionRequired: binding.AdoptionRequired}, mapErr
		}
		projection.Items = append(projection.Items, item)
	}
	projection.CurrentCount = statusResponse.Current
	projection.SupersededCount = statusResponse.Superseded
	projection.ForgottenCount = statusResponse.Forgotten
	projection.NextPageToken = inspectResponse.GetNextPageToken()
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
			if err != nil && !decision.Outcome.TerminalRemember() {
				return MutationOutcome{Outcome: decision.Outcome}, err
			}
			break
		}
		decision, err = f.ProcessRemember(ctx, localAgentRef, drained.OperationID)
		if err != nil && !decision.Outcome.TerminalRemember() {
			return MutationOutcome{Outcome: decision.Outcome}, err
		}
		if drained.OperationID == operationID {
			break
		}
	}
	if err := f.ResumePending(ctx, localAgentRef); err != nil && !decision.Outcome.TerminalRemember() {
		return MutationOutcome{Outcome: decision.Outcome, AffectedMemoryRefs: decision.AffectedMemoryRefs}, err
	}
	projection, inspectErr := f.Inspect(ctx, InspectIntent{LocalAgentRef: localAgentRef, Limit: 100})
	if inspectErr != nil && decision.Outcome.TerminalRemember() {
		projection = Projection{Outcome: memoryv1.OutcomeUnavailable, Enabled: binding.Enabled, AdoptionRequired: binding.AdoptionRequired}
		inspectErr = nil
	}
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
	request := &runtimev1.CognitionMemoryForgetRequest{
		ContractVersion: memoryv1.ContractVersion,
		BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef},
		Bank:            &runtimev1.CognitionMemoryBankRef{Value: binding.BankRef},
		Operation:       &runtimev1.CognitionMemoryOperationRef{Value: "cmforget_" + ulid.Make().String()},
		Confirmed:       true,
	}
	for _, ref := range memoryRefs {
		request.Targets = append(request.Targets, &runtimev1.CognitionMemoryRef{Value: ref})
	}
	result, err := f.owner.Forget(ctx, request)
	if err != nil {
		return MutationOutcome{Outcome: ownerMemoryOutcome(result.GetOutcome())}, err
	}
	affected := make([]string, 0, len(result.GetAffectedMemories()))
	for _, ref := range result.GetAffectedMemories() {
		affected = append(affected, ref.GetValue())
	}
	if err := f.rebuildEmbeddingIfNeeded(ctx, binding); err != nil {
		return MutationOutcome{Outcome: ownerMemoryOutcome(result.GetOutcome()), AffectedMemoryRefs: affected}, err
	}
	projection, inspectErr := f.Inspect(ctx, InspectIntent{LocalAgentRef: localAgentRef, Limit: 100})
	return MutationOutcome{Outcome: ownerMemoryOutcome(result.GetOutcome()), AffectedMemoryRefs: affected, Projection: projection}, inspectErr
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
		if _, found, pendingErr := f.pendingCutoff(ctx, localAgentRef); pendingErr != nil {
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, pendingErr
		} else if found {
			return MutationOutcome{Outcome: memoryv1.OutcomeConflict}, ErrConflict
		}
		if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error { return f.store.SetEnabledTx(tx, localAgentRef, true) }); err != nil {
			if errors.Is(err, ErrConflict) {
				return MutationOutcome{Outcome: memoryv1.OutcomeConflict}, err
			}
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
		}
		projection, err := f.Inspect(ctx, InspectIntent{LocalAgentRef: localAgentRef, Limit: 100})
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

// ResumeCutoff completes only a previously persisted cutoff saga. It creates
// no new lifecycle operation and is safe to call during startup replay.
func (f *Facade) ResumeCutoff(ctx context.Context, localAgentRef string) error {
	if f == nil || f.store == nil || f.owner == nil || f.authorize == nil || !validRef(localAgentRef) {
		return fmt.Errorf("resume cognition memory cutoff: invalid input")
	}
	row, found, err := f.pendingCutoff(ctx, localAgentRef)
	if err != nil || !found {
		return err
	}
	binding, err := f.store.BindingForAgent(ctx, localAgentRef)
	if err != nil {
		return err
	}
	if err := f.authorize(ctx, binding); err != nil {
		return err
	}
	_, err = f.applyCutoff(ctx, localAgentRef, row.DeleteAll, row.DesiredEnabled)
	return err
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
			row = cutoffRow{OperationID: "cmcut_" + ulid.Make().String(), LocalAgentRef: localAgentRef, OldBindingRef: binding.BindingRef, ReplacementBindingRef: "cmb_" + ulid.Make().String(), NewLifecycleRef: "cmop_" + ulid.Make().String(), Phase: "cognition_committed", DeleteAll: deleteAll, PreviousEnabled: binding.Enabled, DesiredEnabled: desiredEnabled}
			now := time.Now().UTC().Format(time.RFC3339Nano)
			if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
				updated, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET enabled = 0, updated_at = ? WHERE local_agent_ref = ? AND current_binding_ref = ?`, now, localAgentRef, binding.BindingRef)
				if err != nil {
					return err
				}
				if count, rowsErr := updated.RowsAffected(); rowsErr != nil || count != 1 {
					return ErrConflict
				}
				if err := insertCutoffTx(tx, row, now); err != nil {
					return err
				}
				if err := f.store.RotateUnboundCutoffTx(tx, localAgentRef, row.OldBindingRef, row.ReplacementBindingRef, row.NewLifecycleRef, row.DesiredEnabled); err != nil {
					return err
				}
				_, err = tx.Exec(`UPDATE runtime_cognition_memory_cutoff SET phase = 'completed', updated_at = ? WHERE operation_id = ?`, now, row.OperationID)
				return err
			}); err != nil {
				if errors.Is(err, ErrConflict) {
					return MutationOutcome{Outcome: memoryv1.OutcomeConflict}, err
				}
				return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
			}
			row.Phase = "completed"
		} else {
			row = cutoffRow{OperationID: "cmcut_" + ulid.Make().String(), LocalAgentRef: localAgentRef, OldBindingRef: binding.BindingRef, ReplacementBindingRef: "cmb_" + ulid.Make().String(), BankRef: binding.BankRef, OldLifecycleRef: binding.LifecycleRef, NewLifecycleRef: "cmcutref_" + ulid.Make().String(), Phase: "prepared", DeleteAll: deleteAll, PreviousEnabled: binding.Enabled, DesiredEnabled: desiredEnabled}
			now := time.Now().UTC().Format(time.RFC3339Nano)
			if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
				updated, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET enabled = 0, updated_at = ? WHERE local_agent_ref = ? AND current_binding_ref = ?`, now, localAgentRef, binding.BindingRef)
				if err != nil {
					return err
				}
				if count, rowsErr := updated.RowsAffected(); rowsErr != nil || count != 1 {
					return ErrConflict
				}
				return insertCutoffTx(tx, row, now)
			}); err != nil {
				if errors.Is(err, ErrConflict) {
					return MutationOutcome{Outcome: memoryv1.OutcomeConflict}, err
				}
				return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
			}
		}
	}
	if row.Phase == "prepared" {
		result, err := f.owner.ApplyCutoff(ctx, &runtimev1.CognitionMemoryApplyCutoffRequest{
			ContractVersion:        memoryv1.ContractVersion,
			BankBinding:            &runtimev1.CognitionMemoryBankBindingRef{Value: row.OldBindingRef},
			Bank:                   &runtimev1.CognitionMemoryBankRef{Value: row.BankRef},
			Operation:              &runtimev1.CognitionMemoryOperationRef{Value: row.OperationID},
			Cutoff:                 &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: row.NewLifecycleRef},
			DeleteAll:              row.DeleteAll,
			ReplacementBankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: row.ReplacementBindingRef},
		})
		outcome := ownerMemoryOutcome(result.GetOutcome())
		if err != nil || outcome != memoryv1.OutcomeCommitted || result.GetCutoff().GetValue() != row.NewLifecycleRef || result.GetReplacementBankBinding().GetValue() != row.ReplacementBindingRef {
			if err == nil {
				err = fmt.Errorf("apply Cognition Memory cutoff: invalid owner response")
			}
			return MutationOutcome{Outcome: outcome}, err
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
			if row.BankRef == "" {
				if err := f.store.RotateUnboundCutoffTx(tx, localAgentRef, row.OldBindingRef, row.ReplacementBindingRef, row.NewLifecycleRef, row.DesiredEnabled); err != nil {
					return err
				}
			} else {
				if err := f.store.RotateCutoffTx(tx, localAgentRef, row.OldBindingRef, row.ReplacementBindingRef, row.OperationID, row.BankRef, row.NewLifecycleRef, row.DesiredEnabled, row.DeleteAll); err != nil {
					return err
				}
			}
			_, err := tx.Exec(`UPDATE runtime_cognition_memory_cutoff SET phase = 'completed', updated_at = ? WHERE operation_id = ?`, time.Now().UTC().Format(time.RFC3339Nano), row.OperationID)
			return err
		}); err != nil {
			return MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}, err
		}
	}
	projection, err := f.Inspect(ctx, InspectIntent{LocalAgentRef: localAgentRef, Limit: 100})
	return MutationOutcome{Outcome: memoryv1.OutcomeCommitted, Projection: projection}, err
}

func insertCutoffTx(tx *sql.Tx, row cutoffRow, now string) error {
	result, err := tx.Exec(`INSERT INTO runtime_cognition_memory_cutoff(operation_id, local_agent_ref, old_binding_ref, replacement_binding_ref, bank_ref, old_lifecycle_ref, new_lifecycle_ref, delete_all, previous_enabled, desired_enabled, phase, created_at, updated_at)
		SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
		WHERE NOT EXISTS (SELECT 1 FROM runtime_cognition_memory_cutoff WHERE local_agent_ref = ? AND phase <> 'completed')`, row.OperationID, row.LocalAgentRef, row.OldBindingRef, row.ReplacementBindingRef, row.BankRef, row.OldLifecycleRef, row.NewLifecycleRef, boolInt(row.DeleteAll), boolInt(row.PreviousEnabled), boolInt(row.DesiredEnabled), row.Phase, now, now, row.LocalAgentRef)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		return ErrConflict
	}
	return nil
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
