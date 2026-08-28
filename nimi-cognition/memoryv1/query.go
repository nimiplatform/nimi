package memoryv1

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type MemoryPageRequest struct {
	BankRef        string
	Limit          int
	AfterUpdatedAt string
	AfterMemoryRef string
}

type MemoryPage struct {
	Items   []Memory
	HasMore bool
}

func (c *Core) InspectStatus(ctx context.Context, bindingRef, bankRef string) (Status, error) {
	if !validOpaqueRef(bindingRef) || !validOpaqueRef(bankRef) {
		return Status{}, contractError(OutcomeInvalid, "bank_identity")
	}
	var storedBank, bankState, bindingState string
	if err := c.db.QueryRowContext(ctx, `SELECT b.bank_ref, b.state, x.state FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ?`, bindingRef).Scan(&storedBank, &bankState, &bindingState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Status{}, contractError(OutcomeInvalid, "unknown_bank")
		}
		return Status{}, fmt.Errorf("inspect memory status: inspect bank: %w", err)
	}
	if storedBank != bankRef || bankState != "active" || (bindingState != "active" && bindingState != "retired") {
		return Status{}, contractError(OutcomeConflict, "bank_binding")
	}
	result := Status{BankRef: bankRef}
	if err := c.db.QueryRowContext(ctx, `SELECT received_frontier, ready_frontier FROM memory_frontiers WHERE binding_ref = ?`, bindingRef).Scan(&result.Frontiers.Received, &result.Frontiers.Ready); err != nil {
		return Status{}, fmt.Errorf("inspect memory status: load frontiers: %w", err)
	}
	rows, err := c.db.QueryContext(ctx, `SELECT r.event_ref, r.operation_id, r.delivery_sequence, r.outcome, r.payload IS NOT NULL, COALESCE(rt.outcome = 'pending', 0) FROM memory_receipts r LEFT JOIN memory_operation_routes rt ON rt.operation_id = r.operation_id WHERE r.binding_ref = ? ORDER BY r.delivery_sequence`, bindingRef)
	if err != nil {
		return Status{}, fmt.Errorf("inspect memory status: list events: %w", err)
	}
	for rows.Next() {
		var event EventStatus
		if err := rows.Scan(&event.EventRef, &event.OperationID, &event.DeliverySequence, &event.Outcome, &event.PayloadPresent, &event.CompletionPending); err != nil {
			return Status{}, fmt.Errorf("inspect memory status: scan event: %w", err)
		}
		result.Events = append(result.Events, event)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return Status{}, fmt.Errorf("inspect memory status: iterate events: %w", err)
	}
	if err := rows.Close(); err != nil {
		return Status{}, fmt.Errorf("inspect memory status: close events: %w", err)
	}
	countRows, err := c.db.QueryContext(ctx, `SELECT lifecycle, COUNT(*) FROM memories WHERE bank_ref = ? GROUP BY lifecycle`, bankRef)
	if err != nil {
		return Status{}, fmt.Errorf("inspect memory status: count memories: %w", err)
	}
	defer countRows.Close()
	for countRows.Next() {
		var lifecycle Lifecycle
		var count int
		if err := countRows.Scan(&lifecycle, &count); err != nil {
			return Status{}, fmt.Errorf("inspect memory status: scan count: %w", err)
		}
		switch lifecycle {
		case LifecycleCurrent:
			result.Current = count
		case LifecycleSuperseded, LifecycleConflicted:
			result.Superseded += count
		case LifecycleForgotten:
			result.Forgotten = count
		}
	}
	return result, nil
}

func (c *Core) ListMemories(ctx context.Context, bankRef string, includeHistory bool) ([]Memory, error) {
	if !validOpaqueRef(bankRef) {
		return nil, contractError(OutcomeInvalid, "bank_ref")
	}
	var bankState string
	if err := c.db.QueryRowContext(ctx, `SELECT state FROM memory_banks WHERE bank_ref = ?`, bankRef).Scan(&bankState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, contractError(OutcomeInvalid, "unknown_bank")
		}
		return nil, fmt.Errorf("list memories: inspect bank: %w", err)
	}
	if bankState != "active" {
		return nil, contractError(OutcomeConflict, "bank_deleted")
	}
	query := `SELECT memory_ref, bank_ref, content, epistemic_status, lifecycle, occurred_at, updated_at, source_explanation, event_ref FROM memories WHERE bank_ref = ?`
	if includeHistory {
		query += ` AND lifecycle <> 'forgotten'`
	} else {
		query += ` AND lifecycle = 'current'`
	}
	query += ` ORDER BY updated_at DESC, memory_ref`
	rows, err := c.db.QueryContext(ctx, query, bankRef)
	if err != nil {
		return nil, fmt.Errorf("list memories: query: %w", err)
	}
	var result []Memory
	for rows.Next() {
		var item Memory
		var occurredAt, updatedAt string
		if err := rows.Scan(&item.MemoryRef, &item.BankRef, &item.Content, &item.EpistemicStatus, &item.Lifecycle, &occurredAt, &updatedAt, &item.SourceExplanation, &item.EventRef); err != nil {
			return nil, fmt.Errorf("list memories: scan: %w", err)
		}
		item.OccurredAt, err = parseTime(occurredAt)
		if err != nil {
			return nil, err
		}
		item.UpdatedAt, err = parseTime(updatedAt)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("list memories: iterate: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("list memories: close: %w", err)
	}
	for index := range result {
		result[index].Subjects, err = c.loadLineage(ctx, result[index].MemoryRef, "subject")
		if err != nil {
			return nil, err
		}
		result[index].Sources, err = c.loadLineage(ctx, result[index].MemoryRef, "source")
		if err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (c *Core) ListMemoriesPage(ctx context.Context, request MemoryPageRequest) (MemoryPage, error) {
	if !validOpaqueRef(request.BankRef) || request.Limit < 1 || request.Limit > 100 ||
		(request.AfterUpdatedAt == "") != (request.AfterMemoryRef == "") {
		return MemoryPage{}, contractError(OutcomeInvalid, "memory_page")
	}
	if request.AfterUpdatedAt != "" {
		parsed, err := time.Parse(time.RFC3339Nano, request.AfterUpdatedAt)
		if err != nil || formatTime(parsed) != request.AfterUpdatedAt || !validOpaqueRef(request.AfterMemoryRef) {
			return MemoryPage{}, contractError(OutcomeInvalid, "memory_page_cursor")
		}
	}
	var bankState string
	if err := c.db.QueryRowContext(ctx, `SELECT state FROM memory_banks WHERE bank_ref = ?`, request.BankRef).Scan(&bankState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return MemoryPage{}, contractError(OutcomeInvalid, "unknown_bank")
		}
		return MemoryPage{}, fmt.Errorf("list memory page: inspect bank: %w", err)
	}
	if bankState != "active" {
		return MemoryPage{}, contractError(OutcomeConflict, "bank_deleted")
	}
	query := `SELECT memory_ref, bank_ref, content, epistemic_status, lifecycle, occurred_at, updated_at, source_explanation, event_ref FROM memories WHERE bank_ref = ? AND lifecycle <> 'forgotten'`
	args := []any{request.BankRef}
	if request.AfterUpdatedAt != "" {
		query += ` AND (updated_at < ? OR (updated_at = ? AND memory_ref > ?))`
		args = append(args, request.AfterUpdatedAt, request.AfterUpdatedAt, request.AfterMemoryRef)
	}
	query += ` ORDER BY updated_at DESC, memory_ref LIMIT ?`
	args = append(args, request.Limit+1)
	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return MemoryPage{}, fmt.Errorf("list memory page: query: %w", err)
	}
	var items []Memory
	for rows.Next() {
		var item Memory
		var occurredAt, updatedAt string
		if err := rows.Scan(&item.MemoryRef, &item.BankRef, &item.Content, &item.EpistemicStatus, &item.Lifecycle, &occurredAt, &updatedAt, &item.SourceExplanation, &item.EventRef); err != nil {
			_ = rows.Close()
			return MemoryPage{}, fmt.Errorf("list memory page: scan: %w", err)
		}
		item.OccurredAt, err = parseTime(occurredAt)
		if err != nil {
			_ = rows.Close()
			return MemoryPage{}, err
		}
		item.UpdatedAt, err = parseTime(updatedAt)
		if err != nil {
			_ = rows.Close()
			return MemoryPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return MemoryPage{}, fmt.Errorf("list memory page: iterate: %w", err)
	}
	if err := rows.Close(); err != nil {
		return MemoryPage{}, fmt.Errorf("list memory page: close: %w", err)
	}
	hasMore := len(items) > request.Limit
	if hasMore {
		items = items[:request.Limit]
	}
	for index := range items {
		items[index].Subjects, err = c.loadLineage(ctx, items[index].MemoryRef, "subject")
		if err != nil {
			return MemoryPage{}, err
		}
		items[index].Sources, err = c.loadLineage(ctx, items[index].MemoryRef, "source")
		if err != nil {
			return MemoryPage{}, err
		}
	}
	return MemoryPage{Items: items, HasMore: hasMore}, nil
}

func (c *Core) loadLineage(ctx context.Context, memoryRef, refType string) ([]TypedRef, error) {
	rows, err := c.db.QueryContext(ctx, `SELECT ref_kind, ref_value FROM memory_lineage WHERE memory_ref = ? AND ref_type = ? ORDER BY ref_kind, ref_value`, memoryRef, refType)
	if err != nil {
		return nil, fmt.Errorf("load memory lineage: query: %w", err)
	}
	defer rows.Close()
	var result []TypedRef
	for rows.Next() {
		var ref TypedRef
		if err := rows.Scan(&ref.Kind, &ref.Value); err != nil {
			return nil, fmt.Errorf("load memory lineage: scan: %w", err)
		}
		result = append(result, ref)
	}
	return result, rows.Err()
}
