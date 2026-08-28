package memoryv1

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

type routeBindingRequest struct {
	OperationID       string
	OperationKind     string
	BankRef           string
	Pipeline          PipelineName
	AlgorithmRevision string
	Snapshot          CapabilitySnapshot
	OperationRequest  any `json:",omitempty"`
}

type routeBinding struct {
	Pipeline          PipelineName
	AlgorithmRevision string
	ConfigRevision    uint64
}

func (c *Core) bindRoute(ctx context.Context, request routeBindingRequest) (routeBinding, error) {
	if !validOpaqueRef(request.OperationID) || !validOpaqueRef(request.BankRef) || request.OperationKind == "" || request.Pipeline == "" || request.AlgorithmRevision == "" || !validCapabilitySnapshot(request.Snapshot) || ((request.OperationKind == "recall" || request.OperationKind == "forget") && request.OperationRequest == nil) {
		return routeBinding{}, contractError(OutcomeInvalid, "route_binding")
	}
	request.Snapshot.Available = canonicalCapabilities(request.Snapshot)
	requestKey, err := canonicalRequestKey(request)
	if err != nil {
		return routeBinding{}, err
	}
	capabilitiesJSON, err := json.Marshal(request.Snapshot)
	if err != nil {
		return routeBinding{}, fmt.Errorf("bind memory route: encode capabilities: %w", err)
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return routeBinding{}, fmt.Errorf("bind memory route: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var existing routeBinding
	var existingKind, existingBank, existingRequestKey string
	err = tx.QueryRowContext(ctx, `SELECT operation_kind, bank_ref, request_key, pipeline, algorithm_revision, config_revision FROM memory_operation_routes WHERE operation_id = ?`, request.OperationID).Scan(&existingKind, &existingBank, &existingRequestKey, &existing.Pipeline, &existing.AlgorithmRevision, &existing.ConfigRevision)
	if err == nil {
		if existingKind != request.OperationKind || existingBank != request.BankRef || existingRequestKey != requestKey {
			return routeBinding{}, contractError(OutcomeConflict, "route_retry")
		}
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return routeBinding{}, fmt.Errorf("bind memory route: inspect existing: %w", err)
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_operation_routes(operation_id, operation_kind, bank_ref, request_key, pipeline, algorithm_revision, config_revision, capabilities_json, outcome, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, request.OperationID, request.OperationKind, request.BankRef, requestKey, request.Pipeline, request.AlgorithmRevision, request.Snapshot.ConfigRevision, capabilitiesJSON, now, now); err != nil {
		return routeBinding{}, fmt.Errorf("bind memory route: save: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return routeBinding{}, fmt.Errorf("bind memory route: commit: %w", err)
	}
	return routeBinding{Pipeline: request.Pipeline, AlgorithmRevision: request.AlgorithmRevision, ConfigRevision: request.Snapshot.ConfigRevision}, nil
}

func (c *Core) completeRoute(ctx context.Context, operationID string, outcome Outcome) error {
	updated, err := c.db.ExecContext(ctx, `UPDATE memory_operation_routes SET outcome = ?, updated_at = ? WHERE operation_id = ?`, outcome, formatTime(c.now()), operationID)
	if err != nil {
		return fmt.Errorf("complete memory route: %w", err)
	}
	count, err := updated.RowsAffected()
	if err != nil || count != 1 {
		return contractError(OutcomeConflict, "route_completion")
	}
	return nil
}

func (c *Core) completeRouteIfPresent(ctx context.Context, operationID string, outcome Outcome) error {
	updated, err := c.db.ExecContext(ctx, `UPDATE memory_operation_routes SET outcome = ?, updated_at = ? WHERE operation_id = ?`, outcome, formatTime(c.now()), operationID)
	if err != nil {
		return fmt.Errorf("complete optional memory route: %w", err)
	}
	if _, err := updated.RowsAffected(); err != nil {
		return fmt.Errorf("complete optional memory route: inspect update: %w", err)
	}
	return nil
}
