package memoryv1

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

type ForgetRequest struct {
	OperationID      string
	BindingRef       string
	BankRef          string
	LifecycleRef     string
	TargetMemoryRefs []string
	Confirmed        bool
}

type ForgetResult struct {
	Outcome            Outcome
	AffectedMemoryRefs []string
}

// @nimi-authority: rule.nimi.cognition.memory.r008
func (c *Core) ForgetExact(ctx context.Context, request ForgetRequest) (ForgetResult, error) {
	if !validOpaqueRef(request.OperationID) || !validOpaqueRef(request.BindingRef) || !validOpaqueRef(request.BankRef) || !validOpaqueRef(request.LifecycleRef) || !request.Confirmed || len(request.TargetMemoryRefs) == 0 {
		return ForgetResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "forget_request")
	}
	targets := append([]string(nil), request.TargetMemoryRefs...)
	sort.Strings(targets)
	for index, target := range targets {
		if !validOpaqueRef(target) || (index > 0 && target == targets[index-1]) {
			return ForgetResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "forget_targets")
		}
	}
	request.TargetMemoryRefs = targets
	if _, err := c.bindRoute(ctx, routeBindingRequest{OperationID: request.OperationID, OperationKind: "forget", BankRef: request.BankRef, Pipeline: PipelineForgetExact, AlgorithmRevision: "exact-1", Snapshot: CapabilitySnapshot{Available: []Capability{}}}); err != nil {
		return ForgetResult{Outcome: errorOutcome(err)}, err
	}
	requestKey, err := canonicalRequestKey(request)
	if err != nil {
		return ForgetResult{Outcome: OutcomeFailed}, err
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if operation, err := loadOperationTx(tx, request.OperationID); err == nil {
		if operation.Kind != "forget" || operation.BindingRef != request.BindingRef || !operation.BankRef.Valid || operation.BankRef.String != request.BankRef || operation.RequestKey != requestKey {
			return ForgetResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "forget_retry")
		}
		var result ForgetResult
		if len(operation.ResultJSON) == 0 || json.Unmarshal(operation.ResultJSON, &result) != nil {
			return ForgetResult{Outcome: OutcomeFailed}, contractError(OutcomeFailed, "stored_result")
		}
		return result, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: inspect operation: %w", err)
	}
	var currentLifecycle, bankState, bindingState string
	if err := tx.QueryRowContext(ctx, `SELECT b.lifecycle_ref, b.state, x.state FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ? AND b.bank_ref = ?`, request.BindingRef, request.BankRef).Scan(&currentLifecycle, &bankState, &bindingState); err != nil {
		return ForgetResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "unknown_bank")
	}
	if bankState != "active" || bindingState != "active" || currentLifecycle != request.LifecycleRef {
		return ForgetResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "forget_binding")
	}
	result := ForgetResult{Outcome: OutcomeForgotten}
	for _, target := range targets {
		var lifecycle Lifecycle
		if err := tx.QueryRowContext(ctx, `SELECT lifecycle FROM memories WHERE memory_ref = ? AND bank_ref = ?`, target, request.BankRef).Scan(&lifecycle); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ForgetResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "forget_target")
			}
			return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: inspect target: %w", err)
		}
		if lifecycle == LifecycleForgotten {
			continue
		}
		if lifecycle != LifecycleCurrent && lifecycle != LifecycleSuperseded && lifecycle != LifecycleConflicted {
			return ForgetResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "forget_target_lifecycle")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memories SET lifecycle = ?, updated_at = ? WHERE memory_ref = ? AND bank_ref = ?`, LifecycleForgotten, formatTime(c.now()), target, request.BankRef); err != nil {
			return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: commit barrier: %w", err)
		}
		result.AffectedMemoryRefs = append(result.AffectedMemoryRefs, target)
	}
	if len(result.AffectedMemoryRefs) == 0 {
		result.Outcome = OutcomeNoEffect
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE memory_banks SET canonical_version = canonical_version + 1, updated_at = ? WHERE bank_ref = ?`, formatTime(c.now()), request.BankRef); err != nil {
			return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: advance canonical version: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET status = 'building', updated_at = ? WHERE bank_ref = ?`, formatTime(c.now()), request.BankRef); err != nil {
			return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: invalidate generations: %w", err)
		}
		for _, target := range result.AffectedMemoryRefs {
			if _, err := tx.ExecContext(ctx, `DELETE FROM memory_fts WHERE memory_ref = ? AND bank_ref = ?`, target, request.BankRef); err != nil {
				return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: clean fts: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM memory_vector_items WHERE memory_ref = ?`, target); err != nil {
				return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: clean vector: %w", err)
			}
		}
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return ForgetResult{Outcome: OutcomeFailed}, err
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_operations(operation_id, operation_kind, binding_ref, bank_ref, request_key, outcome, result_json, created_at, updated_at) VALUES(?, 'forget', ?, ?, ?, ?, ?, ?, ?)`, request.OperationID, request.BindingRef, request.BankRef, requestKey, result.Outcome, resultJSON, now, now); err != nil {
		return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: save owner result: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ForgetResult{Outcome: OutcomeUnavailable}, fmt.Errorf("forget exact: commit: %w", err)
	}
	if err := c.completeRoute(ctx, request.OperationID, result.Outcome); err != nil {
		return result, err
	}
	return result, nil
}
