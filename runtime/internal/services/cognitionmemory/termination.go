package cognitionmemory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

type TerminationOwner interface {
	DeleteBank(context.Context, memoryv1.DeleteBankRequest) (memoryv1.DeleteBankResult, error)
}

type TerminationService struct {
	store *Store
	owner TerminationOwner
	now   func() time.Time
}

type TerminationResult struct {
	Outcome memoryv1.Outcome
	Phase   string
}

func NewTerminationService(store *Store, owner TerminationOwner) *TerminationService {
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
		binding, err := s.store.BindingForAgent(ctx, localAgentRef)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return TerminationResult{Outcome: memoryv1.OutcomeAlreadyAbsent, Phase: "completed"}, nil
			}
			return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
		}
		if binding.BankRef == "" || binding.LifecycleRef == "" {
			if err := s.deleteUnboundRuntimeState(ctx, localAgentRef); err != nil {
				return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, err
			}
			return TerminationResult{Outcome: memoryv1.OutcomeDeleted, Phase: "completed"}, nil
		}
		row = terminationRow{OperationID: operationID, LocalAgentRef: localAgentRef, BindingRef: binding.BindingRef, BankRef: binding.BankRef, LifecycleRef: binding.LifecycleRef, Reason: string(reason), Phase: "fenced"}
		if err := s.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			now := s.now().UTC().Format(time.RFC3339Nano)
			updated, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET state = 'terminating', enabled = 0, updated_at = ? WHERE local_agent_ref = ? AND state = 'active'`, now, localAgentRef)
			if err != nil {
				return err
			}
			count, err := updated.RowsAffected()
			if err != nil || count != 1 {
				return ErrConflict
			}
			if _, err := tx.Exec(`UPDATE runtime_cognition_memory_stream SET state = 'terminated', retired_at = COALESCE(retired_at, ?) WHERE local_agent_ref = ? AND state = 'active'`, now, localAgentRef); err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE runtime_cognition_memory_outbox SET state = 'terminated', outcome = 'no_effect', payload = NULL WHERE binding_ref IN (SELECT binding_ref FROM runtime_cognition_memory_stream WHERE local_agent_ref = ?) AND state = 'pending'`, localAgentRef); err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'failed', result_json = NULL, failure_code = 'agent_termination', updated_at = ? WHERE local_agent_ref = ? AND status IN ('pending', 'running', 'ready')`, now, localAgentRef); err != nil {
				return err
			}
			_, err = tx.Exec(`INSERT INTO runtime_cognition_memory_termination(operation_id, local_agent_ref, binding_ref, bank_ref, lifecycle_ref, reason, phase, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, 'fenced', ?, ?)`, operationID, localAgentRef, binding.BindingRef, binding.BankRef, binding.LifecycleRef, reason, now, now)
			return err
		}); err != nil {
			return TerminationResult{Outcome: memoryv1.OutcomeUnavailable}, fmt.Errorf("terminate cognition memory: establish fence: %w", err)
		}
	}
	if row.Phase == "fenced" {
		deleted, err := s.owner.DeleteBank(ctx, memoryv1.DeleteBankRequest{OperationID: operationID, BindingRef: row.BindingRef, BankRef: row.BankRef, LifecycleRef: row.LifecycleRef, Reason: reason})
		if err != nil {
			return TerminationResult{Outcome: deleted.Outcome, Phase: "fenced"}, fmt.Errorf("terminate cognition memory: delete owner bank: %w", err)
		}
		if deleted.Outcome != memoryv1.OutcomeDeleted && deleted.Outcome != memoryv1.OutcomeAlreadyAbsent {
			return TerminationResult{Outcome: deleted.Outcome, Phase: "fenced"}, fmt.Errorf("terminate cognition memory: owner bank deletion is not terminal")
		}
		if err := s.updateTerminationPhase(ctx, operationID, "cognition_deleted", string(deleted.Outcome)); err != nil {
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

func (s *TerminationService) deleteUnboundRuntimeState(ctx context.Context, localAgentRef string) error {
	return s.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
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
		return nil
	})
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

func (s *TerminationService) updateTerminationPhase(ctx context.Context, operationID, phase, outcome string) error {
	return s.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_termination SET phase = ?, outcome = ?, updated_at = ? WHERE operation_id = ?`, phase, outcome, s.now().UTC().Format(time.RFC3339Nano), operationID)
		return err
	})
}
