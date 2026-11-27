package memoryv1

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
)

// DamagedHandoff contains only the original coordinates and digest, never
// bytes from the damaged copy.
type DamagedHandoff struct {
	BindingRef, BankRef, LifecycleRef, EventRef, OperationID, PayloadSHA256 string
	DeliverySequence                                                        uint64
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.damaged-handoff
func (c *Core) RejectDamagedHandoff(ctx context.Context, h DamagedHandoff) (CommitResult, error) {
	digest, err := hex.DecodeString(h.PayloadSHA256)
	if err != nil || len(digest) != 32 || !validOpaqueRef(h.BindingRef) || !validOpaqueRef(h.BankRef) || !validOpaqueRef(h.LifecycleRef) || !validOpaqueRef(h.EventRef) || !validOpaqueRef(h.OperationID) || h.DeliverySequence == 0 {
		return CommitResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "damaged_handoff_identity")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("settle damaged handoff: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var frontier uint64
	err = tx.QueryRowContext(ctx, `SELECT f.received_frontier FROM memory_frontiers f JOIN memory_bank_bindings x ON x.binding_ref=f.binding_ref JOIN memory_banks b ON b.bank_ref=x.bank_ref WHERE x.binding_ref=? AND b.bank_ref=? AND b.lifecycle_ref=? AND x.state='active' AND b.state='active'`, h.BindingRef, h.BankRef, h.LifecycleRef).Scan(&frontier)
	if errors.Is(err, sql.ErrNoRows) {
		return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "damaged_handoff_binding")
	}
	if err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, fmt.Errorf("read damaged handoff frontier: %w", err)
	}
	result := CommitResult{BankRef: h.BankRef, EventRef: h.EventRef, OperationID: h.OperationID, DeliverySequence: h.DeliverySequence, ReceivedFrontier: frontier, Outcome: OutcomeRejected}
	op, err := loadOperationTx(tx, h.OperationID)
	if err == nil {
		if op.BindingRef != h.BindingRef || op.BankRef.String != h.BankRef || op.EventRef.String != h.EventRef || uint64(op.Sequence.Int64) != h.DeliverySequence || h.DeliverySequence > frontier {
			return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "damaged_handoff_operation")
		}
		switch op.Kind {
		case "rejected_handoff":
			if op.RequestKey != h.PayloadSHA256 || op.Outcome != OutcomeRejected {
				return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "damaged_handoff_digest")
			}
		case "commit", "cutoff_noop":
			// The original delivery succeeded and its acknowledgement was lost.
			// Return the real custody/decision without altering it.
			if op.Outcome == OutcomeReceived || op.Outcome == OutcomeProcessing {
				result.Outcome = OutcomeReceived
			} else if op.Outcome.TerminalRemember() {
				result.Outcome = op.Outcome
			} else {
				return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "damaged_handoff_outcome")
			}
		default:
			return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "damaged_handoff_operation")
		}
		return result, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CommitResult{Outcome: OutcomeUnavailable}, err
	}
	if h.DeliverySequence != frontier+1 {
		return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "damaged_handoff_gap")
	}
	var alreadyUsed bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM memory_receipts WHERE bank_ref=? AND event_ref=?)", h.BankRef, h.EventRef).Scan(&alreadyUsed); err != nil {
		return CommitResult{Outcome: OutcomeUnavailable}, err
	}
	if alreadyUsed {
		return CommitResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "damaged_handoff_event")
	}
	return c.commitEmptyReceipt(ctx, tx, h.BindingRef, h.LifecycleRef, "rejected_handoff", h.PayloadSHA256, result)
}
