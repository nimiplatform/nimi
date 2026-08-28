package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type TerminationService struct {
	store *Store
	owner OwnerPort
	now   func() time.Time
}

type TerminationResult struct {
	Outcome memoryv1.Outcome
	Phase   string
}

type AgentTerminationState struct {
	OperationID   string
	LocalAgentRef string
	Phase         string
	Reason        memoryv1.DeleteReason
}

func NewTerminationService(store *Store, owner OwnerPort) *TerminationService {
	return &TerminationService{store: store, owner: owner, now: time.Now}
}

// @nimi-authority: rule.nimi.runtime.memory-world.r024
func (s *TerminationService) TerminateAgentMemory(ctx context.Context, localAgentRef, operationID string, reason memoryv1.DeleteReason) (TerminationResult, error) {
	if s == nil || s.store == nil || s.store.backend == nil || s.owner == nil || !validRef(localAgentRef) || !validRef(operationID) || (reason != memoryv1.DeleteReasonAgentTermination && reason != memoryv1.DeleteReasonAccountTermination) {
		return TerminationResult{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("terminate cognition memory: invalid input")
	}
	row, found, err := s.loadTermination(ctx, operationID)
	if err != nil {
		return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if found {
		if row.LocalAgentRef != localAgentRef || row.Reason != string(reason) {
			return TerminationResult{Outcome: memoryv1.OutcomeConflict}, ErrConflict
		}
		if row.Phase == "completed" {
			return TerminationResult{Outcome: memoryv1.OutcomeDeleted, Phase: row.Phase}, nil
		}
	} else {
		prepared := TerminationResult{}
		if err := s.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			var prepareErr error
			prepared, prepareErr = s.PrepareAgentTerminationTx(tx, localAgentRef, operationID, reason)
			return prepareErr
		}); err != nil {
			return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("terminate cognition memory: establish fence: %w", err)
		}
		if prepared.Phase == "completed" {
			return prepared, nil
		}
		row, found, err = s.loadTermination(ctx, operationID)
		if err != nil || !found {
			if err == nil {
				err = fmt.Errorf("durable termination fence is absent")
			}
			return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
		}
	}
	if row.Phase == "fenced" {
		deleted, err := s.owner.DeleteBank(ctx, &runtimev1.CognitionMemoryDeleteBankRequest{
			ContractVersion: memoryv1.ContractVersion,
			BankBinding:     &runtimev1.CognitionMemoryBankBindingRef{Value: row.BindingRef},
			Bank:            &runtimev1.CognitionMemoryBankRef{Value: row.BankRef},
			Operation:       &runtimev1.CognitionMemoryOperationRef{Value: operationID},
			Reason:          ownerProtoDeleteReason(reason),
			Cutoff:          &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: row.LifecycleRef},
		})
		outcome := ownerMemoryOutcome(deleted.GetOutcome())
		if err != nil {
			return TerminationResult{Outcome: outcome, Phase: "fenced"}, fmt.Errorf("terminate cognition memory: delete owner bank: %w", err)
		}
		if outcome != memoryv1.OutcomeDeleted && outcome != memoryv1.OutcomeAlreadyAbsent {
			return TerminationResult{Outcome: outcome, Phase: "fenced"}, fmt.Errorf("terminate cognition memory: owner bank deletion is not terminal")
		}
		if err := s.updateTerminationPhase(ctx, operationID, "cognition_deleted", string(outcome)); err != nil {
			return TerminationResult{Outcome: memoryv1.OutcomeUnavailable, Phase: "fenced"}, err
		}
		row.Phase = "cognition_deleted"
	}
	if row.Phase == "cognition_deleted" {
		if err := s.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_outbox WHERE binding_ref IN (SELECT binding_ref FROM runtime_cognition_memory_stream WHERE local_agent_ref = ?)`, localAgentRef); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_ai_job WHERE local_agent_ref = ?`, localAgentRef); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_committed_event WHERE local_agent_ref = ?`, localAgentRef); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_stream WHERE local_agent_ref = ?`, localAgentRef); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_agent WHERE local_agent_ref = ?`, localAgentRef); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE runtime_cognition_memory_termination SET phase = 'completed', outcome = 'deleted', updated_at = ? WHERE operation_id = ?`, s.now().UTC().Format(time.RFC3339Nano), operationID)
			return err
		}); err != nil {
			return TerminationResult{Outcome: memoryv1.OutcomeUnavailable, Phase: "cognition_deleted"}, fmt.Errorf("terminate cognition memory: complete Runtime phase: %w", err)
		}
	}
	return TerminationResult{Outcome: memoryv1.OutcomeDeleted, Phase: "completed"}, nil
}

// PrepareAgentTerminationTx establishes the complete Runtime-owned Memory
// barrier without invoking Cognition. Account termination uses it for every
// exact owner-matched child in the same transaction that custodies the Realm
// fact, so no later child remains replayable while fan-out is partial.
// @nimi-authority: rule.nimi.runtime.memory-world.r024
func (s *TerminationService) PrepareAgentTerminationTx(tx *sql.Tx, localAgentRef, operationID string, reason memoryv1.DeleteReason) (TerminationResult, error) {
	if s == nil || s.store == nil || s.store.backend == nil || tx == nil || !validRef(localAgentRef) || !validRef(operationID) || (reason != memoryv1.DeleteReasonAgentTermination && reason != memoryv1.DeleteReasonAccountTermination) {
		return TerminationResult{Outcome: memoryv1.OutcomeInvalid}, fmt.Errorf("prepare cognition memory termination: invalid input")
	}
	if existing, found, err := loadTerminationTx(tx, operationID); err != nil {
		return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
	} else if found {
		if existing.LocalAgentRef != localAgentRef || existing.Reason != string(reason) {
			return TerminationResult{Outcome: memoryv1.OutcomeConflict}, ErrConflict
		}
		outcome := memoryv1.OutcomePending
		if existing.Phase == "completed" {
			outcome = memoryv1.OutcomeDeleted
		}
		return TerminationResult{Outcome: outcome, Phase: existing.Phase}, nil
	}
	binding, err := loadBindingForAgentTx(tx, localAgentRef)
	if errors.Is(err, sql.ErrNoRows) {
		now := s.now().UTC().Format(time.RFC3339Nano)
		if _, insertErr := tx.Exec(`INSERT INTO runtime_cognition_memory_termination(operation_id, local_agent_ref, binding_ref, bank_ref, lifecycle_ref, reason, phase, outcome, created_at, updated_at) VALUES(?, ?, '', '', '', ?, 'completed', 'already_absent', ?, ?)`, operationID, localAgentRef, reason, now, now); insertErr != nil {
			return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, insertErr
		}
		return TerminationResult{Outcome: memoryv1.OutcomeAlreadyAbsent, Phase: "completed"}, nil
	}
	if err != nil {
		return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if binding.BankRef == "" || binding.LifecycleRef == "" {
		if err := s.deleteUnboundRuntimeStateTx(tx, localAgentRef, operationID, reason); err != nil {
			return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
		}
		return TerminationResult{Outcome: memoryv1.OutcomeDeleted, Phase: "completed"}, nil
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	updated, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET state = 'terminating', enabled = 0, updated_at = ? WHERE local_agent_ref = ? AND state = 'active'`, now, localAgentRef)
	if err != nil {
		return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	count, err := updated.RowsAffected()
	if err != nil || count != 1 {
		return TerminationResult{Outcome: memoryv1.OutcomeConflict}, ErrConflict
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_stream SET state = 'terminated', retired_at = COALESCE(retired_at, ?) WHERE local_agent_ref = ? AND state = 'active'`, now, localAgentRef); err != nil {
		return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_outbox SET state = 'terminated', outcome = 'no_effect', payload = NULL WHERE binding_ref IN (SELECT binding_ref FROM runtime_cognition_memory_stream WHERE local_agent_ref = ?) AND state = 'pending'`, localAgentRef); err != nil {
		return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'failed', result_json = NULL, failure_code = ?, updated_at = ? WHERE local_agent_ref = ? AND status IN ('pending', 'running', 'ready')`, reason, now, localAgentRef); err != nil {
		return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	if _, err := tx.Exec(`INSERT INTO runtime_cognition_memory_termination(operation_id, local_agent_ref, binding_ref, bank_ref, lifecycle_ref, reason, phase, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 'fenced', ?, ?)`, operationID, localAgentRef, binding.BindingRef, binding.BankRef, binding.LifecycleRef, reason, now, now); err != nil {
		return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
	}
	return TerminationResult{Outcome: memoryv1.OutcomePending, Phase: "fenced"}, nil
}

func (s *TerminationService) deleteUnboundRuntimeStateTx(tx *sql.Tx, localAgentRef, operationID string, reason memoryv1.DeleteReason) error {
	if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_outbox WHERE binding_ref IN (SELECT binding_ref FROM runtime_cognition_memory_stream WHERE local_agent_ref = ?)`, localAgentRef); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_ai_job WHERE local_agent_ref = ?`, localAgentRef); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_committed_event WHERE local_agent_ref = ?`, localAgentRef); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_stream WHERE local_agent_ref = ?`, localAgentRef); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM runtime_cognition_memory_agent WHERE local_agent_ref = ?`, localAgentRef); err != nil {
		return err
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	_, err := tx.Exec(`INSERT INTO runtime_cognition_memory_termination(operation_id, local_agent_ref, binding_ref, bank_ref, lifecycle_ref, reason, phase, outcome, created_at, updated_at) VALUES(?, ?, '', '', '', ?, 'completed', 'deleted', ?, ?)`, operationID, localAgentRef, reason, now, now)
	return err
}

func (s *TerminationService) AgentTerminationStates(ctx context.Context) ([]AgentTerminationState, error) {
	if s == nil || s.store == nil || s.store.backend == nil {
		return nil, fmt.Errorf("list cognition memory terminations: service unavailable")
	}
	rows, err := s.store.backend.DB().QueryContext(ctx, `SELECT operation_id, local_agent_ref, phase, reason FROM runtime_cognition_memory_termination ORDER BY created_at, operation_id`)
	if err != nil {
		return nil, fmt.Errorf("list cognition memory terminations: %w", err)
	}
	defer rows.Close()
	var result []AgentTerminationState
	for rows.Next() {
		var item AgentTerminationState
		var reason string
		if err := rows.Scan(&item.OperationID, &item.LocalAgentRef, &item.Phase, &reason); err != nil {
			return nil, fmt.Errorf("list cognition memory terminations: scan: %w", err)
		}
		item.Reason = memoryv1.DeleteReason(reason)
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list cognition memory terminations: iterate: %w", err)
	}
	return result, nil
}

type terminationRow struct {
	OperationID   string
	LocalAgentRef string
	BindingRef    string
	BankRef       string
	LifecycleRef  string
	Reason        string
	Phase         string
}

func (s *TerminationService) loadTermination(ctx context.Context, operationID string) (terminationRow, bool, error) {
	var row terminationRow
	err := s.store.backend.DB().QueryRowContext(ctx, `SELECT operation_id, local_agent_ref, binding_ref, bank_ref, lifecycle_ref, reason, phase FROM runtime_cognition_memory_termination WHERE operation_id = ?`, operationID).Scan(&row.OperationID, &row.LocalAgentRef, &row.BindingRef, &row.BankRef, &row.LifecycleRef, &row.Reason, &row.Phase)
	if errors.Is(err, sql.ErrNoRows) {
		return terminationRow{}, false, nil
	}
	if err != nil {
		return terminationRow{}, false, fmt.Errorf("terminate cognition memory: load phase: %w", err)
	}
	return row, true, nil
}

func loadTerminationTx(tx *sql.Tx, operationID string) (terminationRow, bool, error) {
	var row terminationRow
	err := tx.QueryRow(`SELECT operation_id, local_agent_ref, binding_ref, bank_ref, lifecycle_ref, reason, phase FROM runtime_cognition_memory_termination WHERE operation_id = ?`, operationID).Scan(&row.OperationID, &row.LocalAgentRef, &row.BindingRef, &row.BankRef, &row.LifecycleRef, &row.Reason, &row.Phase)
	if errors.Is(err, sql.ErrNoRows) {
		return terminationRow{}, false, nil
	}
	if err != nil {
		return terminationRow{}, false, fmt.Errorf("prepare cognition memory termination: load phase: %w", err)
	}
	return row, true, nil
}

func (s *TerminationService) updateTerminationPhase(ctx context.Context, operationID, phase, outcome string) error {
	return s.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_termination SET phase = ?, outcome = ?, updated_at = ? WHERE operation_id = ?`, phase, outcome, s.now().UTC().Format(time.RFC3339Nano), operationID)
		return err
	})
}
