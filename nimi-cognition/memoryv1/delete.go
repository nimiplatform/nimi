package memoryv1

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// @nimi-authority: rule.nimi.cognition.memory.r012
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r023
func (c *Core) DeleteBank(ctx context.Context, request DeleteBankRequest) (DeleteBankResult, error) {
	if !validOpaqueRef(request.OperationID) || !validOpaqueRef(request.BindingRef) || !validOpaqueRef(request.BankRef) || !validOpaqueRef(request.LifecycleRef) || (request.Reason != DeleteReasonAgentTermination && request.Reason != DeleteReasonAccountTermination) {
		return DeleteBankResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "delete_bank_request")
	}
	requestKey, err := canonicalRequestKey(request)
	if err != nil {
		return DeleteBankResult{Outcome: OutcomeFailed}, err
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if operation, err := loadOperationTx(tx, request.OperationID); err == nil {
		if operation.Kind != "delete_bank" || operation.BindingRef != request.BindingRef || !operation.BankRef.Valid || operation.BankRef.String != request.BankRef || operation.RequestKey != requestKey {
			return DeleteBankResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "delete_bank_retry")
		}
		var result DeleteBankResult
		if len(operation.ResultJSON) == 0 || json.Unmarshal(operation.ResultJSON, &result) != nil {
			return DeleteBankResult{Outcome: OutcomeFailed}, contractError(OutcomeFailed, "stored_result")
		}
		return result, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: inspect operation: %w", err)
	}
	var currentLifecycle, bankState, bindingState string
	if err := tx.QueryRowContext(ctx, `SELECT b.lifecycle_ref, b.state, x.state FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ? AND b.bank_ref = ?`, request.BindingRef, request.BankRef).Scan(&currentLifecycle, &bankState, &bindingState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DeleteBankResult{Outcome: OutcomeAlreadyAbsent, BankRef: request.BankRef}, contractError(OutcomeConflict, "unknown_bank")
		}
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: inspect bank: %w", err)
	}
	if bankState != "active" || bindingState != "active" || currentLifecycle != request.LifecycleRef {
		return DeleteBankResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "delete_bank_binding")
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `UPDATE memory_operation_routes SET outcome = ?, updated_at = ? WHERE bank_ref = ? AND outcome = 'pending'`, OutcomeConflict, now, request.BankRef); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: fence pending routes: %w", err)
	}
	rows, err := tx.QueryContext(ctx, `SELECT binding_ref FROM memory_bank_bindings WHERE bank_ref = ?`, request.BankRef)
	if err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: list bindings: %w", err)
	}
	var bindings []string
	for rows.Next() {
		var bindingRef string
		if err := rows.Scan(&bindingRef); err != nil {
			_ = rows.Close()
			return DeleteBankResult{Outcome: OutcomeUnavailable}, err
		}
		bindings = append(bindings, bindingRef)
	}
	if err := rows.Close(); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, err
	}
	pendingRows, err := tx.QueryContext(ctx, `SELECT operation_id FROM memory_receipts WHERE bank_ref = ? AND outcome IN (?, ?)`, request.BankRef, OutcomeReceived, OutcomeProcessing)
	if err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: list pending custody: %w", err)
	}
	var pending []string
	for pendingRows.Next() {
		var operationID string
		if err := pendingRows.Scan(&operationID); err != nil {
			_ = pendingRows.Close()
			return DeleteBankResult{Outcome: OutcomeUnavailable}, err
		}
		pending = append(pending, operationID)
	}
	if err := pendingRows.Close(); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, err
	}
	for _, operationID := range pending {
		resultJSON, err := json.Marshal(DecisionResult{Outcome: OutcomeNoEffect, OperationID: operationID})
		if err != nil {
			return DeleteBankResult{Outcome: OutcomeFailed}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_operations SET outcome = ?, result_json = ?, updated_at = ? WHERE operation_id = ?`, OutcomeNoEffect, resultJSON, now, operationID); err != nil {
			return DeleteBankResult{Outcome: OutcomeUnavailable}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_receipts SET outcome = ?, terminal_at = ?, payload = NULL WHERE operation_id = ?`, OutcomeNoEffect, now, operationID); err != nil {
			return DeleteBankResult{Outcome: OutcomeUnavailable}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_receipts SET payload = NULL WHERE bank_ref = ?`, request.BankRef); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: compact receipts: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memories WHERE bank_ref = ?`, request.BankRef); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: delete canonical Memory: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_fts WHERE bank_ref = ?`, request.BankRef); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: delete fts: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_vector_items WHERE generation_ref IN (SELECT generation_ref FROM memory_derived_generations WHERE bank_ref = ?)`, request.BankRef); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: delete vectors: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM memory_derived_generations WHERE bank_ref = ?`, request.BankRef); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: delete generations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_bank_bindings SET state = 'retired', retired_at = COALESCE(retired_at, ?) WHERE bank_ref = ?`, now, request.BankRef); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: retire bindings: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_banks SET state = 'deleted', canonical_version = canonical_version + 1, updated_at = ? WHERE bank_ref = ?`, now, request.BankRef); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: mark deleted: %w", err)
	}
	for _, bindingRef := range bindings {
		if err := advanceReadyFrontierTx(ctx, tx, bindingRef); err != nil {
			return DeleteBankResult{Outcome: OutcomeUnavailable}, err
		}
	}
	result := DeleteBankResult{Outcome: OutcomeDeleted, BankRef: request.BankRef}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return DeleteBankResult{Outcome: OutcomeFailed}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_operations(operation_id, operation_kind, binding_ref, bank_ref, request_key, outcome, result_json, created_at, updated_at) VALUES(?, 'delete_bank', ?, ?, ?, ?, ?, ?, ?)`, request.OperationID, request.BindingRef, request.BankRef, requestKey, result.Outcome, resultJSON, now, now); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: save owner result: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return DeleteBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("delete memory bank: commit: %w", err)
	}
	return result, nil
}
