package memoryv1

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// @nimi-authority: rule.nimi.cognition.memory.r015
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r025
func (c *Core) ApplyCutoff(ctx context.Context, request CutoffRequest) (CutoffResult, error) {
	if request.ContractVersion != ContractVersion {
		return CutoffResult{Outcome: OutcomeUnsupported}, contractError(OutcomeUnsupported, "contract_version")
	}
	if !validOpaqueRef(request.BindingRef) || !validOpaqueRef(request.BankRef) || !validOpaqueRef(request.OperationID) || !validOpaqueRef(request.CurrentLifecycleRef) || !validOpaqueRef(request.NewLifecycleRef) || !validOpaqueRef(request.ReplacementBindingRef) || request.BindingRef == request.ReplacementBindingRef || request.CurrentLifecycleRef == request.NewLifecycleRef {
		return CutoffResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "cutoff_identity")
	}
	requestKey, err := canonicalRequestKey(request)
	if err != nil {
		return CutoffResult{Outcome: OutcomeFailed}, err
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if operation, err := loadOperationTx(tx, request.OperationID); err == nil {
		if operation.Kind != "cutoff" || operation.BindingRef != request.BindingRef || !operation.BankRef.Valid || operation.BankRef.String != request.BankRef || operation.RequestKey != requestKey {
			return CutoffResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "operation_request")
		}
		var result CutoffResult
		if len(operation.ResultJSON) == 0 || json.Unmarshal(operation.ResultJSON, &result) != nil {
			return CutoffResult{Outcome: OutcomeFailed}, contractError(OutcomeFailed, "stored_result")
		}
		return result, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: inspect operation: %w", err)
	}
	var lifecycleRef, bankState, bindingState string
	if err := tx.QueryRowContext(ctx, `SELECT b.lifecycle_ref, b.state, x.state FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ? AND b.bank_ref = ?`, request.BindingRef, request.BankRef).Scan(&lifecycleRef, &bankState, &bindingState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CutoffResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "unknown_bank")
		}
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: inspect bank: %w", err)
	}
	if bankState != "active" || bindingState != "active" || lifecycleRef != request.CurrentLifecycleRef {
		return CutoffResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "lifecycle_cutoff")
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `UPDATE memory_banks SET lifecycle_ref = ?, updated_at = ? WHERE bank_ref = ?`, request.NewLifecycleRef, now, request.BankRef); err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: update bank: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_bank_bindings SET state = 'retired', retired_at = ? WHERE binding_ref = ?`, now, request.BindingRef); err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: retire binding: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_bank_bindings(binding_ref, bank_ref, state, created_at) VALUES(?, ?, 'active', ?)`, request.ReplacementBindingRef, request.BankRef, now); err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: create replacement binding: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_frontiers(binding_ref, received_frontier, ready_frontier) VALUES(?, 0, 0)`, request.ReplacementBindingRef); err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: create replacement frontiers: %w", err)
	}
	rows, err := tx.QueryContext(ctx, `SELECT operation_id FROM memory_receipts WHERE binding_ref = ? AND outcome IN (?, ?)`, request.BindingRef, OutcomeReceived, OutcomeProcessing)
	if err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: list pending custody: %w", err)
	}
	var pending []string
	for rows.Next() {
		var operationID string
		if err := rows.Scan(&operationID); err != nil {
			_ = rows.Close()
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: scan pending custody: %w", err)
		}
		pending = append(pending, operationID)
	}
	if err := rows.Close(); err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: close pending custody: %w", err)
	}
	for _, operationID := range pending {
		resultJSON, err := json.Marshal(DecisionResult{Outcome: OutcomeNoEffect, OperationID: operationID})
		if err != nil {
			return CutoffResult{Outcome: OutcomeFailed}, fmt.Errorf("apply cutoff: encode terminal result: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_operations SET outcome = ?, result_json = ?, updated_at = ? WHERE operation_id = ?`, OutcomeNoEffect, resultJSON, now, operationID); err != nil {
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: terminalize operation: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_receipts SET outcome = ?, terminal_at = ?, payload = NULL WHERE operation_id = ?`, OutcomeNoEffect, now, operationID); err != nil {
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: terminalize custody: %w", err)
		}
	}
	if request.DeleteAll {
		if _, err := tx.ExecContext(ctx, `DELETE FROM memories WHERE bank_ref = ?`, request.BankRef); err != nil {
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: delete canonical memories: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM memory_derived_generations WHERE bank_ref = ?`, request.BankRef); err != nil {
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: delete derived generations: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM memory_fts WHERE bank_ref = ?`, request.BankRef); err != nil {
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: delete fts data: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM memory_vector_items WHERE generation_ref NOT IN (SELECT generation_ref FROM memory_derived_generations)`); err != nil {
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: delete vector data: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_banks SET canonical_version = canonical_version + 1, updated_at = ? WHERE bank_ref = ?`, now, request.BankRef); err != nil {
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: advance canonical version: %w", err)
		}
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET lifecycle_ref = ?, updated_at = ? WHERE bank_ref = ? AND status = 'ready'`, request.NewLifecycleRef, now, request.BankRef); err != nil {
			return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: carry ready generations into replacement lifecycle: %w", err)
		}
	}
	result := CutoffResult{Outcome: OutcomeCommitted, LifecycleRef: request.NewLifecycleRef, ReplacementBindingRef: request.ReplacementBindingRef}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return CutoffResult{Outcome: OutcomeFailed}, fmt.Errorf("apply cutoff: encode result: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_operations(operation_id, operation_kind, binding_ref, bank_ref, request_key, outcome, result_json, created_at, updated_at) VALUES(?, 'cutoff', ?, ?, ?, ?, ?, ?, ?)`, request.OperationID, request.BindingRef, request.BankRef, requestKey, OutcomeCommitted, resultJSON, now, now); err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: save operation: %w", err)
	}
	if err := advanceReadyFrontierTx(ctx, tx, request.BindingRef); err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, err
	}
	if err := tx.Commit(); err != nil {
		return CutoffResult{Outcome: OutcomeUnavailable}, fmt.Errorf("apply cutoff: commit: %w", err)
	}
	return result, nil
}
