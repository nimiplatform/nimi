package memoryv1

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

type operationRow struct {
	Kind       string
	BindingRef string
	BankRef    sql.NullString
	EventRef   sql.NullString
	Sequence   sql.NullInt64
	RequestKey string
	Outcome    Outcome
	ResultJSON []byte
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r018
func (c *Core) EnsureBank(ctx context.Context, request EnsureBankRequest) (EnsureBankResult, error) {
	if request.ContractVersion != ContractVersion {
		return EnsureBankResult{Outcome: OutcomeUnsupported}, contractError(OutcomeUnsupported, "contract_version")
	}
	if !validOpaqueRef(request.BindingRef) || !validOpaqueRef(request.OperationID) {
		return EnsureBankResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "ensure_identity")
	}
	requestKey, err := canonicalRequestKey(request)
	if err != nil {
		return EnsureBankResult{Outcome: OutcomeFailed}, err
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return EnsureBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("ensure bank: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if operation, err := loadOperationTx(tx, request.OperationID); err == nil {
		if operation.Kind != "ensure" || operation.BindingRef != request.BindingRef || operation.RequestKey != requestKey {
			return EnsureBankResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "operation_binding")
		}
		var result EnsureBankResult
		if len(operation.ResultJSON) == 0 || json.Unmarshal(operation.ResultJSON, &result) != nil {
			return EnsureBankResult{Outcome: OutcomeFailed}, contractError(OutcomeFailed, "stored_result")
		}
		return result, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return EnsureBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("ensure bank: inspect operation: %w", err)
	}

	var bankRef, lifecycleRef, bindingState, bankState string
	err = tx.QueryRowContext(ctx, `SELECT b.bank_ref, b.lifecycle_ref, b.state, x.state FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ?`, request.BindingRef).Scan(&bankRef, &lifecycleRef, &bankState, &bindingState)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return EnsureBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("ensure bank: inspect binding: %w", err)
	}
	if errors.Is(err, sql.ErrNoRows) {
		bankRef, err = c.newRef("bank")
		if err != nil {
			return EnsureBankResult{Outcome: OutcomeFailed}, err
		}
		lifecycleRef, err = c.newRef("cut")
		if err != nil {
			return EnsureBankResult{Outcome: OutcomeFailed}, err
		}
		now := formatTime(c.now())
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_banks(bank_ref, lifecycle_ref, state, created_at, updated_at) VALUES(?, ?, 'active', ?, ?)`, bankRef, lifecycleRef, now, now); err != nil {
			return EnsureBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("ensure bank: create bank: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_bank_bindings(binding_ref, bank_ref, state, created_at) VALUES(?, ?, 'active', ?)`, request.BindingRef, bankRef, now); err != nil {
			return EnsureBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("ensure bank: create binding: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO memory_frontiers(binding_ref, received_frontier, ready_frontier) VALUES(?, 0, 0)`, request.BindingRef); err != nil {
			return EnsureBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("ensure bank: create frontiers: %w", err)
		}
	} else if bankState != "active" || bindingState != "active" {
		return EnsureBankResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "binding_deleted")
	}
	result := EnsureBankResult{Outcome: OutcomeCommitted, BindingRef: request.BindingRef, BankRef: bankRef, LifecycleRef: lifecycleRef}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return EnsureBankResult{Outcome: OutcomeFailed}, fmt.Errorf("ensure bank: encode result: %w", err)
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_operations(operation_id, operation_kind, binding_ref, bank_ref, request_key, outcome, result_json, created_at, updated_at) VALUES(?, 'ensure', ?, ?, ?, ?, ?, ?, ?)`, request.OperationID, request.BindingRef, bankRef, requestKey, result.Outcome, resultJSON, now, now); err != nil {
		return EnsureBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("ensure bank: save operation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return EnsureBankResult{Outcome: OutcomeUnavailable}, fmt.Errorf("ensure bank: commit: %w", err)
	}
	return result, nil
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r019
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r020
func (c *Core) ReceiveCommittedEvent(ctx context.Context, request CommitRequest) (CommitResult, error) {
	if err := validateCommitRequest(request); err != nil {
		return CommitResult{Outcome: errorOutcome(err)}, err
	}
	requestKey, err := canonicalRequestKey(request)
	if err != nil {
		return CommitResult{Outcome: OutcomeFailed}, err
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return CommitResult{Outcome: OutcomeFailed}, fmt.Errorf("receive committed event: encode payload: %w", err)
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if operation, err := loadOperationTx(tx, request.OperationID); err == nil {
		if operation.Kind != "commit" || operation.BindingRef != request.BindingRef || !operation.BankRef.Valid || operation.BankRef.String != request.BankRef ||
			!operation.EventRef.Valid || operation.EventRef.String != request.EventRef || !operation.Sequence.Valid || uint64(operation.Sequence.Int64) != request.DeliverySequence || operation.RequestKey != requestKey {
			return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "operation_request")
		}
		frontiers, loadErr := loadFrontiersTx(ctx, tx, request.BindingRef)
		if loadErr != nil {
			return CommitResult{Outcome: OutcomeUnavailable}, loadErr
		}
		return CommitResult{Outcome: operation.Outcome, BankRef: request.BankRef, EventRef: request.EventRef, OperationID: request.OperationID, DeliverySequence: request.DeliverySequence, ReceivedFrontier: frontiers.Received}, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: inspect operation: %w", err)
	}

	var bankRef, lifecycleRef, bankState, bindingState string
	if err := tx.QueryRowContext(ctx, `SELECT b.bank_ref, b.lifecycle_ref, b.state, x.state FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ?`, request.BindingRef).Scan(&bankRef, &lifecycleRef, &bankState, &bindingState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CommitResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "unknown_binding")
		}
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: inspect bank: %w", err)
	}
	if bankState != "active" || bindingState != "active" || bankRef != request.BankRef {
		return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "bank_binding")
	}
	if lifecycleRef != request.LifecycleRef {
		return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "lifecycle_cutoff")
	}

	var existingOperation, existingEvent, existingRequest string
	err = tx.QueryRowContext(ctx, `SELECT operation_id, event_ref, request_key FROM memory_receipts WHERE binding_ref = ? AND delivery_sequence = ?`, request.BindingRef, request.DeliverySequence).Scan(&existingOperation, &existingEvent, &existingRequest)
	if err == nil {
		return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "delivery_sequence")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: inspect sequence: %w", err)
	}
	var existingSequence uint64
	err = tx.QueryRowContext(ctx, `SELECT operation_id, delivery_sequence FROM memory_receipts WHERE bank_ref = ? AND event_ref = ?`, request.BankRef, request.EventRef).Scan(&existingOperation, &existingSequence)
	if err == nil {
		return CommitResult{Outcome: OutcomeDuplicate}, contractError(OutcomeDuplicate, "bank_event")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: inspect event: %w", err)
	}
	frontiers, err := loadFrontiersTx(ctx, tx, request.BindingRef)
	if err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, err
	}
	if request.DeliverySequence != frontiers.Received+1 {
		return CommitResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "delivery_gap")
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_operations(operation_id, operation_kind, binding_ref, bank_ref, event_ref, delivery_sequence, request_key, outcome, created_at, updated_at) VALUES(?, 'commit', ?, ?, ?, ?, ?, ?, ?, ?)`, request.OperationID, request.BindingRef, request.BankRef, request.EventRef, request.DeliverySequence, requestKey, OutcomeReceived, now, now); err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: save operation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO memory_receipts(operation_id, binding_ref, bank_ref, event_ref, delivery_sequence, request_key, lifecycle_ref, outcome, payload, committed_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, request.OperationID, request.BindingRef, request.BankRef, request.EventRef, request.DeliverySequence, requestKey, request.LifecycleRef, OutcomeReceived, payload, formatTime(request.CommittedAt)); err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: save custody: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_frontiers SET received_frontier = ? WHERE binding_ref = ?`, request.DeliverySequence, request.BindingRef); err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: advance received frontier: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("receive committed event: commit custody: %w", err)
	}
	return CommitResult{Outcome: OutcomeReceived, BankRef: request.BankRef, EventRef: request.EventRef, OperationID: request.OperationID, DeliverySequence: request.DeliverySequence, ReceivedFrontier: request.DeliverySequence}, nil
}

func validateCommitRequest(request CommitRequest) error {
	if request.ContractVersion != ContractVersion {
		return contractError(OutcomeUnsupported, "contract_version")
	}
	if !validOpaqueRef(request.BindingRef) || !validOpaqueRef(request.BankRef) || !validOpaqueRef(request.EventRef) || !validOpaqueRef(request.OperationID) || !validOpaqueRef(request.LifecycleRef) || request.DeliverySequence == 0 || request.CommittedAt.IsZero() {
		return contractError(OutcomeInvalid, "commit_identity")
	}
	if !validateTypedRefs(request.Subjects) || !validateTypedRefs(request.Sources) {
		return contractError(OutcomeInvalid, "provenance_refs")
	}
	if err := validateCommittedFact(request.Fact); err != nil {
		return err
	}
	return nil
}

func validateCommittedFact(fact CommittedFact) error {
	count := 0
	for _, present := range []bool{fact.Message != nil, fact.Turn != nil, fact.Activity != nil, fact.Correction != nil, fact.Relationship != nil} {
		if present {
			count++
		}
	}
	if count != 1 {
		return contractError(OutcomeInvalid, "event_fact_count")
	}
	switch fact.Kind {
	case EventKindMessage:
		if fact.Message == nil || (fact.Message.Actor != ActorUser && fact.Message.Actor != ActorAssistant && fact.Message.Actor != ActorTool) || !validTypedRef(fact.Message.Conversation) || !validTypedRef(fact.Message.Message) || len(fact.Message.Parts) == 0 {
			return contractError(OutcomeInvalid, "message_fact")
		}
		for _, part := range fact.Message.Parts {
			if !validTypedRef(part.PartRef) {
				return contractError(OutcomeInvalid, "message_part_ref")
			}
			switch part.Kind {
			case "text":
				if !validContent(part.Text) || validTypedRef(part.ArtifactRef) || validTypedRef(part.Transcription) {
					return contractError(OutcomeInvalid, "message_text_part")
				}
			case "transcription":
				if !validContent(part.Text) || !validTypedRef(part.Transcription) || validTypedRef(part.ArtifactRef) {
					return contractError(OutcomeInvalid, "message_transcription_part")
				}
			case "artifact":
				if !validTypedRef(part.ArtifactRef) || part.Text != "" || validTypedRef(part.Transcription) {
					return contractError(OutcomeInvalid, "message_artifact_part")
				}
			default:
				return contractError(OutcomeUnsupported, "message_part_kind")
			}
		}
	case EventKindTurnTerminal:
		if fact.Turn == nil || !validTypedRef(fact.Turn.Conversation) || !validTypedRef(fact.Turn.Turn) || !validTerminalState(fact.Turn.State) {
			return contractError(OutcomeInvalid, "turn_fact")
		}
	case EventKindActivity:
		if fact.Activity == nil || !validTypedRef(fact.Activity.Activity) || !validOpaqueRef(fact.Activity.ActivityKind) || !validTerminalState(fact.Activity.State) || (fact.Activity.BoundedOutcome != "" && !validContent(fact.Activity.BoundedOutcome)) {
			return contractError(OutcomeInvalid, "activity_fact")
		}
	case EventKindCorrection:
		if fact.Correction == nil || !validOpaqueRef(fact.Correction.TargetMemoryRef) || !validContent(fact.Correction.CorrectedContent) {
			return contractError(OutcomeInvalid, "correction_fact")
		}
	case EventKindRelationship:
		if fact.Relationship == nil || !validOpaqueRef(fact.Relationship.RelationshipKind) || !validContent(fact.Relationship.BoundedFact) {
			return contractError(OutcomeInvalid, "relationship_fact")
		}
	default:
		return contractError(OutcomeUnsupported, "event_kind")
	}
	return nil
}

func validTerminalState(state TerminalState) bool {
	switch state {
	case TerminalCompleted, TerminalFailed, TerminalInterrupted, TerminalCanceled:
		return true
	default:
		return false
	}
}

func loadOperationTx(tx *sql.Tx, operationID string) (operationRow, error) {
	var row operationRow
	err := tx.QueryRow(`SELECT operation_kind, binding_ref, bank_ref, event_ref, delivery_sequence, request_key, outcome, result_json FROM memory_operations WHERE operation_id = ?`, operationID).Scan(&row.Kind, &row.BindingRef, &row.BankRef, &row.EventRef, &row.Sequence, &row.RequestKey, &row.Outcome, &row.ResultJSON)
	return row, err
}

func loadFrontiersTx(ctx context.Context, tx *sql.Tx, bindingRef string) (Frontiers, error) {
	var result Frontiers
	if err := tx.QueryRowContext(ctx, `SELECT received_frontier, ready_frontier FROM memory_frontiers WHERE binding_ref = ?`, bindingRef).Scan(&result.Received, &result.Ready); err != nil {
		return Frontiers{}, fmt.Errorf("memory core: load frontiers: %w", err)
	}
	return result, nil
}

func errorOutcome(err error) Outcome {
	var contractErr *ContractError
	if errors.As(err, &contractErr) {
		return contractErr.Outcome
	}
	return OutcomeFailed
}
