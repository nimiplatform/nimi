package cognitionmemory

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

// @nimi-authority: rule.nimi.runtime.memory-world.r010
// Target deletion keeps its exact owner request until both local owners have
// confirmed. The record contains opaque targets, never their Memory content.
func (f *Facade) prepareForget(ctx context.Context, binding Binding, targets []string) error {
	targets = slices.Clone(targets)
	slices.Sort(targets)
	targets = slices.Compact(targets)
	for _, target := range targets {
		if !validRef(target) {
			return ErrConflict
		}
	}
	raw, err := json.Marshal(targets)
	if err != nil {
		return err
	}
	return f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var old []byte
		err := tx.QueryRow(`SELECT targets_json FROM runtime_cognition_memory_forget WHERE local_agent_ref = ? AND phase <> 'completed'`, binding.LocalAgentRef).Scan(&old)
		if err == nil {
			if string(old) != string(raw) {
				return ErrConflict
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err := fenceAgentEmbeddingPayloadsTx(tx, binding.LocalAgentRef); err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO runtime_cognition_memory_forget(operation_id, local_agent_ref, binding_ref, bank_ref, targets_json, phase, created_at) VALUES(?, ?, ?, ?, ?, 'prepared', ?)`, "cmforget_"+ulid.Make().String(), binding.LocalAgentRef, binding.BindingRef, binding.BankRef, raw, time.Now().UTC().Format(time.RFC3339Nano))
		return err
	})
}

func (f *Facade) resumeForget(ctx context.Context, agent string) (MutationOutcome, bool, error) {
	var operation, binding, bank, phase string
	var targetsRaw, resultRaw []byte
	err := f.store.backend.DB().QueryRowContext(ctx, `SELECT operation_id, binding_ref, bank_ref, targets_json, phase, result_json FROM runtime_cognition_memory_forget WHERE local_agent_ref = ? AND phase <> 'completed'`, agent).Scan(&operation, &binding, &bank, &targetsRaw, &phase, &resultRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return MutationOutcome{}, false, nil
	}
	unavailable := MutationOutcome{Outcome: memoryv1.OutcomeUnavailable}
	if err != nil {
		return unavailable, true, err
	}
	var targets []string
	if err := json.Unmarshal(targetsRaw, &targets); err != nil {
		return unavailable, true, err
	}
	var result MutationOutcome
	if phase == "prepared" {
		request := &runtimev1.CognitionMemoryForgetRequest{ContractVersion: memoryv1.ContractVersion, BankBinding: &runtimev1.CognitionMemoryBankBindingRef{Value: binding}, Bank: &runtimev1.CognitionMemoryBankRef{Value: bank}, Operation: &runtimev1.CognitionMemoryOperationRef{Value: operation}, Confirmed: true}
		for _, target := range targets {
			request.Targets = append(request.Targets, &runtimev1.CognitionMemoryRef{Value: target})
		}
		response, err := f.owner.Forget(ctx, request)
		if err != nil {
			outcome := ownerMemoryOutcome(response.GetOutcome())
			if outcome == memoryv1.OutcomeConflict || outcome == memoryv1.OutcomeInvalid || outcome == memoryv1.OutcomeUnsupported {
				// A definite owner rejection did not authorize deletion. End
				// this request's fence; abandoned copies keep their independent
				// durable cleanup state without disabling future Memory work.
				closeErr := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
					_, updateErr := tx.Exec(`UPDATE runtime_cognition_memory_forget SET phase = 'completed' WHERE operation_id = ? AND phase = 'prepared'`, operation)
					return updateErr
				})
				if closeErr != nil {
					return unavailable, true, errors.Join(err, closeErr)
				}
				cleanupErr := f.store.DisposeAgentEmbeddingPayloads(context.WithoutCancel(ctx), agent, false)
				return MutationOutcome{Outcome: outcome}, true, errors.Join(err, cleanupErr)
			}
			return unavailable, true, err
		}
		result.Outcome = ownerMemoryOutcome(response.GetOutcome())
		if result.Outcome != memoryv1.OutcomeForgotten && result.Outcome != memoryv1.OutcomeNoEffect {
			return unavailable, true, fmt.Errorf("target forget did not commit: %s", result.Outcome)
		}
		for _, ref := range response.GetAffectedMemories() {
			result.AffectedMemoryRefs = append(result.AffectedMemoryRefs, ref.GetValue())
		}
		resultRaw, err = json.Marshal(result)
		if err != nil {
			return unavailable, true, err
		}
		if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE runtime_cognition_memory_forget SET phase = 'cognition_committed', result_json = ? WHERE operation_id = ?`, resultRaw, operation)
			return err
		}); err != nil {
			return unavailable, true, err
		}
	} else if err := json.Unmarshal(resultRaw, &result); err != nil {
		return unavailable, true, err
	}
	if err := f.store.DisposeAgentEmbeddingPayloads(ctx, agent, true); err != nil {
		return unavailable, true, err
	}
	if err := f.store.disposeSettledOutboxCopies(ctx, agent); err != nil {
		return unavailable, true, err
	}
	if err := f.owner.ResumeEmbeddingDispositions(ctx, bank, f.store.EmbeddingDispositionPort(agent)); err != nil {
		return unavailable, true, err
	}
	if err := f.store.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_cognition_memory_forget SET phase = 'completed' WHERE operation_id = ?`, operation)
		return err
	}); err != nil {
		return unavailable, true, err
	}
	return result, true, nil
}
