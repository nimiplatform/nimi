// Package cognitionmemory adapts Runtime-owned bindings, committed-event
// delivery and execution-copy lifecycle to the Cognition Memory owner.
package cognitionmemory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
)

var (
	ErrMemoryDisabled = errors.New("cognition memory is disabled")
	ErrMemoryUnbound  = errors.New("cognition memory bank is not ensured")
	ErrConflict       = errors.New("cognition memory outbox conflict")
)

type Store struct {
	embeddingCaptures     sync.Map
	disposeEmbedding      EmbeddingDisposer
	disposeAgentEmbedding func(context.Context, string) error
	backend               *runtimepersistence.Backend
	now                   func() time.Time
}

type Binding struct {
	LocalAgentRef      string
	AccountSubjectRef  string
	BindingRef         string
	BindingOperationID string
	BankRef            string
	LifecycleRef       string
	Enabled            bool
	AdoptionRequired   bool
	State              string
	NextSequence       uint64
	DeliveryFrontier   uint64
	StreamState        string
}

type OutboxItem struct {
	OperationID      string
	BindingRef       string
	BankRef          string
	LifecycleRef     string
	EventRef         string
	DeliverySequence uint64
	State            string
	Outcome          string
	PayloadPresent   bool
	Envelope         *runtimev1.CognitionMemoryCommittedEventEnvelope
}

const cognitionMemoryRootActivationMetaKey = "cognition_memory_root_activation_id"

func deletedSessionMetaKey(localAgentRef, workSessionRef string) string {
	return "cognition_deleted_session:" + strings.TrimSpace(localAgentRef) + ":" + strings.TrimSpace(workSessionRef)
}

// IsDeletedSessionCutoff reports whether workSessionRef was fenced for localAgentRef.
func (s *Store) IsDeletedSessionCutoff(ctx context.Context, localAgentRef, workSessionRef string) (bool, error) {
	if s == nil || s.backend == nil || !validRef(localAgentRef) || !validRef(workSessionRef) {
		return false, nil
	}
	var value string
	err := s.backend.DB().QueryRowContext(ctx, `SELECT value FROM runtime_local_agent_meta WHERE key = ?`, deletedSessionMetaKey(localAgentRef, workSessionRef)).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// FenceRootActivationJobs makes Runtime AI Jobs explicitly non-portable while
// preserving canonical Memory bindings and the committed-event outbox. The
// single owner-private activation marker distinguishes an ordinary restart
// from a copied/reselected root activation without creating run history.
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007e
func (s *Store) FenceRootActivationJobs(ctx context.Context, rootActivationID string) (bool, error) {
	if s == nil || s.backend == nil || strings.TrimSpace(rootActivationID) == "" || strings.TrimSpace(rootActivationID) != rootActivationID {
		return false, fmt.Errorf("cognition memory root activation is invalid")
	}
	changed := false
	err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var current string
		err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, cognitionMemoryRootActivationMetaKey).Scan(&current)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil && current == rootActivationID {
			return nil
		}
		now := s.now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job
			SET status = 'failed', result_json = NULL, failure_code = 'root_activation_changed', updated_at = ?
			WHERE status IN ('pending', 'running', 'ready')`, now); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES(?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`, cognitionMemoryRootActivationMetaKey, rootActivationID); err != nil {
			return err
		}
		changed = true
		return nil
	})
	return changed, err
}

func NewStore(backend *runtimepersistence.Backend) *Store {
	return &Store{backend: backend, now: time.Now}
}

// @nimi-authority: rule.nimi.runtime.memory-world.r021
// @nimi-authority: rule.nimi.runtime.memory-world.r023
func (s *Store) CreateAgentBindingTx(tx *sql.Tx, localAgentRef, accountSubjectRef string, newAgent bool) (Binding, error) {
	if tx == nil || !validRef(localAgentRef) || !validRef(accountSubjectRef) {
		return Binding{}, fmt.Errorf("create cognition memory binding: invalid input")
	}
	if existing, err := loadBindingForAgentTx(tx, localAgentRef); err == nil {
		if existing.AccountSubjectRef != accountSubjectRef {
			return Binding{}, ErrConflict
		}
		return existing, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Binding{}, fmt.Errorf("create cognition memory binding: inspect existing: %w", err)
	}
	bindingRef := "cmb_" + ulid.Make().String()
	bindingOperationID := "cmop_" + ulid.Make().String()
	enabled := newAgent
	adoptionRequired := !newAgent
	now := s.now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`INSERT INTO runtime_cognition_memory_agent(local_agent_ref, account_subject_ref, current_binding_ref, enabled, adoption_required, state, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 'active', ?, ?)`, localAgentRef, accountSubjectRef, bindingRef, boolInt(enabled), boolInt(adoptionRequired), now, now); err != nil {
		return Binding{}, fmt.Errorf("create cognition memory binding: save agent state: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO runtime_cognition_memory_stream(binding_ref, local_agent_ref, binding_operation_id, next_delivery_sequence, delivery_frontier, state, created_at) VALUES(?, ?, ?, 1, 0, 'active', ?)`, bindingRef, localAgentRef, bindingOperationID, now); err != nil {
		return Binding{}, fmt.Errorf("create cognition memory binding: save stream: %w", err)
	}
	return Binding{LocalAgentRef: localAgentRef, AccountSubjectRef: accountSubjectRef, BindingRef: bindingRef, BindingOperationID: bindingOperationID, Enabled: enabled, AdoptionRequired: adoptionRequired, State: "active", NextSequence: 1, StreamState: "active"}, nil
}

func (s *Store) BindingForAgent(ctx context.Context, localAgentRef string) (Binding, error) {
	if s == nil || s.backend == nil || !validRef(localAgentRef) {
		return Binding{}, fmt.Errorf("load cognition memory binding: invalid input")
	}
	return loadBindingForAgentDB(ctx, s.backend.DB(), localAgentRef)
}

func (s *Store) BindingForOwner(ctx context.Context, bindingRef string) (Binding, error) {
	if s == nil || s.backend == nil || !validRef(bindingRef) {
		return Binding{}, fmt.Errorf("load cognition memory owner binding: invalid input")
	}
	return scanBinding(s.backend.DB().QueryRowContext(ctx, `SELECT a.local_agent_ref, a.account_subject_ref, s.binding_ref, s.binding_operation_id, COALESCE(s.bank_ref, ''), COALESCE(s.lifecycle_ref, ''), a.enabled, a.adoption_required, a.state, s.next_delivery_sequence, s.delivery_frontier, s.state FROM runtime_cognition_memory_stream s JOIN runtime_cognition_memory_agent a ON a.local_agent_ref = s.local_agent_ref WHERE s.binding_ref = ?`, bindingRef))
}

func (s *Store) BindEnsuredBank(ctx context.Context, bindingRef, bankRef, lifecycleRef string) error {
	if s == nil || s.backend == nil || !validRef(bindingRef) || !validRef(bankRef) || !validRef(lifecycleRef) {
		return fmt.Errorf("bind ensured cognition memory bank: invalid input")
	}
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var localAgentRef, streamState string
		var existingBank, existingLifecycle sql.NullString
		if err := tx.QueryRow(`SELECT local_agent_ref, bank_ref, lifecycle_ref, state FROM runtime_cognition_memory_stream WHERE binding_ref = ?`, bindingRef).Scan(&localAgentRef, &existingBank, &existingLifecycle, &streamState); err != nil {
			return fmt.Errorf("bind ensured cognition memory bank: load stream: %w", err)
		}
		if streamState != "active" {
			return ErrConflict
		}
		if existingBank.Valid && (existingBank.String != bankRef || !existingLifecycle.Valid || existingLifecycle.String != lifecycleRef) {
			return ErrConflict
		}
		if _, err := tx.Exec(`UPDATE runtime_cognition_memory_stream SET bank_ref = ?, lifecycle_ref = ? WHERE binding_ref = ?`, bankRef, lifecycleRef, bindingRef); err != nil {
			return fmt.Errorf("bind ensured cognition memory bank: update stream: %w", err)
		}
		if _, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET bank_ref = ?, lifecycle_ref = ?, updated_at = ? WHERE local_agent_ref = ? AND current_binding_ref = ?`, bankRef, lifecycleRef, s.now().UTC().Format(time.RFC3339Nano), localAgentRef, bindingRef); err != nil {
			return fmt.Errorf("bind ensured cognition memory bank: update agent: %w", err)
		}
		return nil
	})
}

// @nimi-authority: rule.nimi.runtime.memory-world.r021
// EnqueueCommittedEventTx allocates one binding-local sequence and stores the
// complete committed fact inside the caller's owner transaction. It never
// accepts a Memory candidate, admission judgment, or canonical record.
func (s *Store) EnqueueCommittedEventTx(tx *sql.Tx, localAgentRef string, envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) (OutboxItem, error) {
	if tx == nil || envelope == nil || !validRef(localAgentRef) {
		return OutboxItem{}, fmt.Errorf("enqueue cognition memory event: invalid input")
	}
	binding, err := loadBindingForAgentTx(tx, localAgentRef)
	if err != nil {
		return OutboxItem{}, fmt.Errorf("enqueue cognition memory event: load binding: %w", err)
	}
	if binding.State != "active" || binding.StreamState != "active" {
		return OutboxItem{}, ErrConflict
	}
	if !binding.Enabled || binding.AdoptionRequired {
		return OutboxItem{}, ErrMemoryDisabled
	}
	cloned := proto.Clone(envelope).(*runtimev1.CognitionMemoryCommittedEventEnvelope)
	cloned.ContractVersion = 1
	cloned.BankBinding = &runtimev1.CognitionMemoryBankBindingRef{Value: binding.BindingRef}
	cloned.DeliverySequence = binding.NextSequence
	if binding.BankRef != "" {
		cloned.Bank = &runtimev1.CognitionMemoryBankRef{Value: binding.BankRef}
	}
	if err := validateCommittedEnvelope(cloned, binding.BankRef != ""); err != nil {
		return OutboxItem{}, err
	}
	// Test all session provenance in the same transaction that allocates the sequence.
	sessionRefs := make(map[string]bool)
	for _, source := range cloned.GetSources() {
		if source.GetKind() == "session" {
			sessionRefs[source.GetValue()] = true
		}
	}
	if ref := cloned.GetSessionPointerCommitted().GetWorkSessionRef(); ref != "" {
		sessionRefs[ref] = true
	}
	for ref := range sessionRefs {
		var deleted bool
		if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM runtime_local_agent_meta WHERE key = ?)", deletedSessionMetaKey(localAgentRef, ref)).Scan(&deleted); err != nil {
			return OutboxItem{}, err
		}
		if deleted {
			return OutboxItem{}, ErrConflict
		}
	}
	if target := cloned.GetCorrectionCommitted().GetTargetMemory().GetValue(); target != "" {
		var cut bool
		if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM runtime_local_agent_meta WHERE key=?)", deletedMemoryKey(localAgentRef, target)).Scan(&cut); err != nil {
			return OutboxItem{}, err
		}
		if cut {
			return OutboxItem{}, ErrConflict
		}
	}
	payload, requestKey, err := marshalEnvelope(cloned)
	if err != nil {
		return OutboxItem{}, err
	}
	eventKind := committedEventKind(cloned)
	now := s.now().UTC().Format(time.RFC3339Nano)
	sourceKind := cloned.GetSources()[0].GetKind()
	sourceRef := cloned.GetSources()[0].GetValue()
	if _, err := tx.Exec(`INSERT INTO runtime_cognition_memory_committed_event(event_ref, local_agent_ref, event_kind, source_kind, source_ref, committed_at) VALUES(?, ?, ?, ?, ?, ?)`, cloned.GetEvent().GetValue(), localAgentRef, eventKind, sourceKind, sourceRef, cloned.GetCommittedAt().AsTime().UTC().Format(time.RFC3339Nano)); err != nil {
		return OutboxItem{}, fmt.Errorf("enqueue cognition memory event: save owner event identity: %w", err)
	}
	if correction := cloned.GetCorrectionCommitted(); correction != nil {
		accountSubjectRef, err := validateCommittedCorrectionOwnerContext(cloned)
		if err != nil {
			return OutboxItem{}, err
		}
		// Correction has no independent Conversation/activity owner row. Persist
		// only its complete typed owner fact beside the existing committed-event
		// identity; the delivery outbox remains separately compactable custody.
		if _, err := tx.Exec(`INSERT INTO runtime_cognition_memory_committed_correction(event_ref, operation_id, account_subject_ref, target_memory_ref, corrected_content) VALUES(?, ?, ?, ?, ?)`, cloned.GetEvent().GetValue(), cloned.GetOperation().GetValue(), accountSubjectRef, correction.GetTargetMemory().GetValue(), correction.GetCorrectedContent()); err != nil {
			return OutboxItem{}, fmt.Errorf("enqueue cognition memory event: save committed correction fact: %w", err)
		}
	}
	if _, err := tx.Exec(`INSERT INTO runtime_cognition_memory_outbox(operation_id, binding_ref, event_ref, delivery_sequence, lifecycle_ref, event_kind, request_key, payload, state, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`, cloned.GetOperation().GetValue(), binding.BindingRef, cloned.GetEvent().GetValue(), binding.NextSequence, binding.LifecycleRef, eventKind, requestKey, payload, now); err != nil {
		return OutboxItem{}, fmt.Errorf("enqueue cognition memory event: save outbox: %w", err)
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_stream SET next_delivery_sequence = ? WHERE binding_ref = ?`, binding.NextSequence+1, binding.BindingRef); err != nil {
		return OutboxItem{}, fmt.Errorf("enqueue cognition memory event: advance sequence: %w", err)
	}
	return OutboxItem{OperationID: cloned.GetOperation().GetValue(), BindingRef: binding.BindingRef, BankRef: binding.BankRef, LifecycleRef: binding.LifecycleRef, EventRef: cloned.GetEvent().GetValue(), DeliverySequence: binding.NextSequence, State: "pending", PayloadPresent: true, Envelope: cloned}, nil
}

func (s *Store) NextPending(ctx context.Context, bindingRef string) (OutboxItem, error) {
	if s == nil || s.backend == nil || !validRef(bindingRef) {
		return OutboxItem{}, fmt.Errorf("load pending cognition memory event: invalid input")
	}
	var item OutboxItem
	var payload []byte
	var bankRef, lifecycleRef sql.NullString
	err := s.backend.DB().QueryRowContext(ctx, `
		SELECT o.operation_id, o.event_ref, o.delivery_sequence, o.state, COALESCE(o.outcome, ''), o.payload IS NOT NULL, o.payload, s.bank_ref, s.lifecycle_ref
		FROM runtime_cognition_memory_outbox o
		JOIN runtime_cognition_memory_stream s ON s.binding_ref = o.binding_ref
		WHERE o.binding_ref = ?
		  AND (o.state = 'pending' OR (o.state = 'cutoff_non_effecting' AND o.received_at IS NULL))
		ORDER BY o.delivery_sequence
		LIMIT 1`,
		bindingRef,
	).Scan(&item.OperationID, &item.EventRef, &item.DeliverySequence, &item.State, &item.Outcome, &item.PayloadPresent, &payload, &bankRef, &lifecycleRef)
	if err != nil {
		return OutboxItem{}, err
	}
	if !bankRef.Valid || !lifecycleRef.Valid || !validRef(bankRef.String) || !validRef(lifecycleRef.String) {
		return OutboxItem{}, ErrMemoryUnbound
	}
	item.BindingRef = bindingRef
	item.BankRef = bankRef.String
	item.LifecycleRef = lifecycleRef.String
	if item.State == "cutoff_non_effecting" {
		// Neutralized session outbox rows carry zero payload and settle via ordered NoOpCutoff.
		item.PayloadPresent = false
		item.Envelope = nil
		return item, nil
	}
	envelope := &runtimev1.CognitionMemoryCommittedEventEnvelope{}
	if err := proto.Unmarshal(payload, envelope); err != nil {
		return OutboxItem{}, fmt.Errorf("load pending cognition memory event: decode payload: %w", err)
	}
	envelope.Bank = &runtimev1.CognitionMemoryBankRef{Value: bankRef.String}
	item.Envelope = envelope
	return item, nil
}

// AcknowledgeCutoffNoOp records that Cognition accepted an ordered zero-payload
// cutoff settlement for a neutralized session outbox row and advances delivery_frontier.
func (s *Store) AcknowledgeCutoffNoOp(ctx context.Context, operationID, eventRef string, deliverySequence uint64) error {
	if s == nil || s.backend == nil || !validRef(operationID) || !validRef(eventRef) || deliverySequence == 0 {
		return fmt.Errorf("acknowledge cognition memory cutoff noop: invalid input")
	}
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var bindingRef, storedEventRef, state string
		var sequence uint64
		var receivedAt sql.NullString
		if err := tx.QueryRow(`SELECT binding_ref, event_ref, delivery_sequence, state, received_at FROM runtime_cognition_memory_outbox WHERE operation_id = ?`, operationID).Scan(&bindingRef, &storedEventRef, &sequence, &state, &receivedAt); err != nil {
			return fmt.Errorf("acknowledge cognition memory cutoff noop: load outbox: %w", err)
		}
		if storedEventRef != eventRef || sequence != deliverySequence {
			return ErrConflict
		}
		if state == "cutoff_non_effecting" && receivedAt.Valid {
			return nil
		}
		if state != "cutoff_non_effecting" {
			return ErrConflict
		}
		now := s.now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.Exec(`UPDATE runtime_cognition_memory_outbox SET outcome = 'no_effect', payload = NULL, received_at = ? WHERE operation_id = ?`, now, operationID); err != nil {
			return fmt.Errorf("acknowledge cognition memory cutoff noop: update outbox: %w", err)
		}
		return advanceDeliveryFrontierTx(tx, bindingRef)
	})
}

// @nimi-authority: rule.nimi.runtime.memory-world.r021
func (s *Store) AcknowledgeReceived(ctx context.Context, response *runtimev1.CognitionMemoryCommitResponse) error {
	if s == nil || s.backend == nil || response == nil || response.GetOutcome() != runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED || !validRef(response.GetOperation().GetValue()) || !validRef(response.GetEvent().GetValue()) || response.GetDeliverySequence() == 0 {
		return fmt.Errorf("acknowledge cognition memory custody: invalid response")
	}
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var bindingRef, eventRef, state string
		var sequence uint64
		if err := tx.QueryRow(`SELECT binding_ref, event_ref, delivery_sequence, state FROM runtime_cognition_memory_outbox WHERE operation_id = ?`, response.GetOperation().GetValue()).Scan(&bindingRef, &eventRef, &sequence, &state); err != nil {
			return fmt.Errorf("acknowledge cognition memory custody: load outbox: %w", err)
		}
		if eventRef != response.GetEvent().GetValue() || sequence != response.GetDeliverySequence() {
			return ErrConflict
		}
		if state == "received" {
			return nil
		}
		if state != "pending" {
			return ErrConflict
		}
		now := s.now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.Exec(`UPDATE runtime_cognition_memory_outbox SET state = 'received', outcome = 'received', payload = NULL, received_at = ? WHERE operation_id = ?`, now, response.GetOperation().GetValue()); err != nil {
			return fmt.Errorf("acknowledge cognition memory custody: update outbox: %w", err)
		}
		return advanceDeliveryFrontierTx(tx, bindingRef)
	})
}

func (s *Store) RotateCutoffTx(tx *sql.Tx, localAgentRef, oldBindingRef, replacementBindingRef, cutoffOperationID, bankRef, lifecycleRef string, enabled bool, deleteAll bool) error {
	if tx == nil || !validRef(localAgentRef) || !validRef(oldBindingRef) || !validRef(replacementBindingRef) || !validRef(cutoffOperationID) || !validRef(bankRef) || !validRef(lifecycleRef) || oldBindingRef == replacementBindingRef {
		return fmt.Errorf("rotate cognition memory cutoff: invalid input")
	}
	binding, err := loadBindingForAgentTx(tx, localAgentRef)
	if err != nil {
		return fmt.Errorf("rotate cognition memory cutoff: load binding: %w", err)
	}
	if binding.BindingRef != oldBindingRef || binding.BankRef != bankRef || binding.StreamState != "active" {
		return ErrConflict
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_stream SET state = 'retired', retired_at = ? WHERE binding_ref = ?`, now, oldBindingRef); err != nil {
		return fmt.Errorf("rotate cognition memory cutoff: retire stream: %w", err)
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_outbox SET state = 'cutoff_non_effecting', outcome = 'no_effect', payload = NULL WHERE binding_ref = ? AND state = 'pending'`, oldBindingRef); err != nil {
		return fmt.Errorf("rotate cognition memory cutoff: dispose pending outbox: %w", err)
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'failed', result_json = NULL, failure_code = 'lifecycle_cutoff', updated_at = ? WHERE local_agent_ref = ? AND status IN ('pending', 'running', 'ready')`, now, localAgentRef); err != nil {
		return fmt.Errorf("rotate cognition memory cutoff: fence Runtime AI jobs: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO runtime_cognition_memory_stream(binding_ref, local_agent_ref, binding_operation_id, bank_ref, lifecycle_ref, next_delivery_sequence, delivery_frontier, state, created_at) VALUES(?, ?, ?, ?, ?, 1, 0, 'active', ?)`, replacementBindingRef, localAgentRef, cutoffOperationID, bankRef, lifecycleRef, now); err != nil {
		return fmt.Errorf("rotate cognition memory cutoff: create stream: %w", err)
	}
	adoptionRequired := false
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET current_binding_ref = ?, bank_ref = ?, lifecycle_ref = ?, enabled = ?, adoption_required = ?, updated_at = ? WHERE local_agent_ref = ?`, replacementBindingRef, bankRef, lifecycleRef, boolInt(enabled), boolInt(adoptionRequired), now, localAgentRef); err != nil {
		return fmt.Errorf("rotate cognition memory cutoff: update agent: %w", err)
	}
	_ = deleteAll // Canonical deletion is committed by Cognition before this Runtime transaction.
	return nil
}

func (s *Store) RotateUnboundCutoffTx(tx *sql.Tx, localAgentRef, oldBindingRef, replacementBindingRef, replacementBindingOperationID string, enabled bool) error {
	if tx == nil || !validRef(localAgentRef) || !validRef(oldBindingRef) || !validRef(replacementBindingRef) || !validRef(replacementBindingOperationID) || oldBindingRef == replacementBindingRef {
		return fmt.Errorf("rotate unbound cognition memory cutoff: invalid input")
	}
	binding, err := loadBindingForAgentTx(tx, localAgentRef)
	if err != nil {
		return fmt.Errorf("rotate unbound cognition memory cutoff: load binding: %w", err)
	}
	if binding.BindingRef != oldBindingRef || binding.BankRef != "" || binding.LifecycleRef != "" || binding.StreamState != "active" {
		return ErrConflict
	}
	now := s.now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_stream SET state = 'retired', retired_at = ? WHERE binding_ref = ?`, now, oldBindingRef); err != nil {
		return fmt.Errorf("rotate unbound cognition memory cutoff: retire stream: %w", err)
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_outbox SET state = 'cutoff_non_effecting', outcome = 'no_effect', payload = NULL WHERE binding_ref = ? AND state = 'pending'`, oldBindingRef); err != nil {
		return fmt.Errorf("rotate unbound cognition memory cutoff: dispose pending outbox: %w", err)
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_ai_job SET status = 'failed', result_json = NULL, failure_code = 'lifecycle_cutoff', updated_at = ? WHERE local_agent_ref = ? AND status IN ('pending', 'running', 'ready')`, now, localAgentRef); err != nil {
		return fmt.Errorf("rotate unbound cognition memory cutoff: fence Runtime AI jobs: %w", err)
	}
	if _, err := tx.Exec(`INSERT INTO runtime_cognition_memory_stream(binding_ref, local_agent_ref, binding_operation_id, next_delivery_sequence, delivery_frontier, state, created_at) VALUES(?, ?, ?, 1, 0, 'active', ?)`, replacementBindingRef, localAgentRef, replacementBindingOperationID, now); err != nil {
		return fmt.Errorf("rotate unbound cognition memory cutoff: create stream: %w", err)
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET current_binding_ref = ?, bank_ref = NULL, lifecycle_ref = NULL, enabled = ?, adoption_required = 0, updated_at = ? WHERE local_agent_ref = ?`, replacementBindingRef, boolInt(enabled), now, localAgentRef); err != nil {
		return fmt.Errorf("rotate unbound cognition memory cutoff: update agent: %w", err)
	}
	return nil
}

func (s *Store) SetEnabledTx(tx *sql.Tx, localAgentRef string, enabled bool) error {
	if tx == nil || !validRef(localAgentRef) {
		return fmt.Errorf("set cognition memory enabled: invalid input")
	}
	binding, err := loadBindingForAgentTx(tx, localAgentRef)
	if err != nil {
		return fmt.Errorf("set cognition memory enabled: load binding: %w", err)
	}
	if binding.State != "active" || binding.StreamState != "active" {
		return ErrConflict
	}
	updated, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET enabled = ?, adoption_required = 0, updated_at = ? WHERE local_agent_ref = ? AND NOT EXISTS (SELECT 1 FROM runtime_cognition_memory_cutoff WHERE local_agent_ref = ? AND phase <> 'completed')`, boolInt(enabled), s.now().UTC().Format(time.RFC3339Nano), localAgentRef, localAgentRef)
	if err != nil {
		return fmt.Errorf("set cognition memory enabled: update: %w", err)
	}
	count, err := updated.RowsAffected()
	if err != nil {
		return fmt.Errorf("set cognition memory enabled: inspect update: %w", err)
	}
	if count != 1 {
		return ErrConflict
	}
	return nil
}

func (s *Store) ListOutbox(ctx context.Context, bindingRef string) (items []OutboxItem, resultErr error) {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT operation_id, binding_ref, event_ref, delivery_sequence, state, COALESCE(outcome, ''), payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE binding_ref = ? ORDER BY delivery_sequence`, bindingRef)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := rows.Close(); resultErr == nil && err != nil {
			items = nil
			resultErr = fmt.Errorf("list cognition memory outbox: close rows: %w", err)
		}
	}()
	var result []OutboxItem
	for rows.Next() {
		var item OutboxItem
		if err := rows.Scan(&item.OperationID, &item.BindingRef, &item.EventRef, &item.DeliverySequence, &item.State, &item.Outcome, &item.PayloadPresent); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) ActiveBindings(ctx context.Context) (bindings []Binding, resultErr error) {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT a.local_agent_ref, a.account_subject_ref, a.current_binding_ref, s.binding_operation_id, COALESCE(a.bank_ref, ''), COALESCE(a.lifecycle_ref, ''), a.enabled, a.adoption_required, a.state, s.next_delivery_sequence, s.delivery_frontier, s.state FROM runtime_cognition_memory_agent a JOIN runtime_cognition_memory_stream s ON s.binding_ref = a.current_binding_ref WHERE a.state = 'active' AND s.state = 'active' ORDER BY a.local_agent_ref`)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := rows.Close(); resultErr == nil && err != nil {
			bindings = nil
			resultErr = fmt.Errorf("list active cognition memory bindings: close rows: %w", err)
		}
	}()
	var result []Binding
	for rows.Next() {
		binding, err := scanBinding(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, binding)
	}
	return result, rows.Err()
}

func loadBindingForAgentTx(tx *sql.Tx, localAgentRef string) (Binding, error) {
	return scanBinding(tx.QueryRow(`SELECT a.local_agent_ref, a.account_subject_ref, a.current_binding_ref, s.binding_operation_id, COALESCE(a.bank_ref, ''), COALESCE(a.lifecycle_ref, ''), a.enabled, a.adoption_required, a.state, s.next_delivery_sequence, s.delivery_frontier, s.state FROM runtime_cognition_memory_agent a JOIN runtime_cognition_memory_stream s ON s.binding_ref = a.current_binding_ref WHERE a.local_agent_ref = ?`, localAgentRef))
}

func loadBindingForAgentDB(ctx context.Context, db *sql.DB, localAgentRef string) (Binding, error) {
	return scanBinding(db.QueryRowContext(ctx, `SELECT a.local_agent_ref, a.account_subject_ref, a.current_binding_ref, s.binding_operation_id, COALESCE(a.bank_ref, ''), COALESCE(a.lifecycle_ref, ''), a.enabled, a.adoption_required, a.state, s.next_delivery_sequence, s.delivery_frontier, s.state FROM runtime_cognition_memory_agent a JOIN runtime_cognition_memory_stream s ON s.binding_ref = a.current_binding_ref WHERE a.local_agent_ref = ?`, localAgentRef))
}

type rowScanner interface{ Scan(...any) error }

func scanBinding(row rowScanner) (Binding, error) {
	var result Binding
	var enabled, adoptionRequired int
	err := row.Scan(&result.LocalAgentRef, &result.AccountSubjectRef, &result.BindingRef, &result.BindingOperationID, &result.BankRef, &result.LifecycleRef, &enabled, &adoptionRequired, &result.State, &result.NextSequence, &result.DeliveryFrontier, &result.StreamState)
	result.Enabled = enabled == 1
	result.AdoptionRequired = adoptionRequired == 1
	return result, err
}

func validateCommittedEnvelope(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope, requireBank bool) error {
	if envelope.GetContractVersion() != 1 || !validRef(envelope.GetBankBinding().GetValue()) || !validRef(envelope.GetEvent().GetValue()) || !validRef(envelope.GetOperation().GetValue()) || envelope.GetDeliverySequence() == 0 || envelope.GetCommittedAt() == nil || !envelope.GetCommittedAt().IsValid() || committedEventKind(envelope) == "" {
		return fmt.Errorf("enqueue cognition memory event: invalid envelope")
	}
	if requireBank && !validRef(envelope.GetBank().GetValue()) {
		return fmt.Errorf("enqueue cognition memory event: unresolved owner binding")
	}
	if len(envelope.GetSubjects()) == 0 || len(envelope.GetSources()) == 0 {
		return fmt.Errorf("enqueue cognition memory event: committed provenance is required")
	}
	seenSubjects := make(map[string]struct{}, len(envelope.GetSubjects()))
	for _, ref := range envelope.GetSubjects() {
		if !validRef(ref.GetKind()) || !validRef(ref.GetValue()) {
			return fmt.Errorf("enqueue cognition memory event: invalid subject ref")
		}
		key := ref.GetKind() + "\x00" + ref.GetValue()
		if _, duplicate := seenSubjects[key]; duplicate {
			return fmt.Errorf("enqueue cognition memory event: duplicate subject ref")
		}
		seenSubjects[key] = struct{}{}
	}
	seenSources := make(map[string]struct{}, len(envelope.GetSources()))
	for _, ref := range envelope.GetSources() {
		if !validRef(ref.GetKind()) || !validRef(ref.GetValue()) {
			return fmt.Errorf("enqueue cognition memory event: invalid source ref")
		}
		key := ref.GetKind() + "\x00" + ref.GetValue()
		if _, duplicate := seenSources[key]; duplicate {
			return fmt.Errorf("enqueue cognition memory event: duplicate source ref")
		}
		seenSources[key] = struct{}{}
	}
	if err := validateCommittedEnvelopeFact(envelope); err != nil {
		return err
	}
	return nil
}

func validateCommittedEnvelopeFact(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) error {
	switch {
	case envelope.GetMessageCommitted() != nil:
		message := envelope.GetMessageCommitted()
		if !validCommittedActor(message.GetActor()) || !validSourceRef(message.GetConversation()) || !validSourceRef(message.GetMessage()) || len(message.GetParts()) == 0 {
			return fmt.Errorf("enqueue cognition memory event: invalid message fact")
		}
		for _, part := range message.GetParts() {
			if part == nil || !validSourceRef(part.GetPart()) {
				return fmt.Errorf("enqueue cognition memory event: invalid message part ref")
			}
			switch {
			case part.GetText() != nil:
				if !validCommittedContent(part.GetText().GetText()) {
					return fmt.Errorf("enqueue cognition memory event: invalid message text part")
				}
			case part.GetTranscription() != nil:
				if !validCommittedContent(part.GetTranscription().GetText()) || !validSourceRef(part.GetTranscription().GetTranscription()) {
					return fmt.Errorf("enqueue cognition memory event: invalid message transcription part")
				}
			case part.GetArtifact() != nil:
				if !validSourceRef(part.GetArtifact().GetArtifact()) {
					return fmt.Errorf("enqueue cognition memory event: invalid message artifact part")
				}
			default:
				return fmt.Errorf("enqueue cognition memory event: unsupported message part")
			}
		}
	case envelope.GetTurnTerminal() != nil:
		fact := envelope.GetTurnTerminal()
		if !validSourceRef(fact.GetConversation()) || !validSourceRef(fact.GetTurn()) || !validCommittedTerminalState(fact.GetState()) {
			return fmt.Errorf("enqueue cognition memory event: invalid turn terminal fact")
		}
	case envelope.GetActivityTerminal() != nil:
		fact := envelope.GetActivityTerminal()
		if !validSourceRef(fact.GetActivity()) || !validRef(fact.GetActivityKind()) || !validLifeActivityCarrier(fact) || (fact.GetBoundedOutcome() != "" && !validCommittedContent(fact.GetBoundedOutcome())) {
			return fmt.Errorf("enqueue cognition memory event: invalid activity terminal fact")
		}
		if fact.GetOccurredStart() == nil || !fact.GetOccurredStart().IsValid() || fact.GetOccurredEnd() == nil || !fact.GetOccurredEnd().IsValid() || fact.GetOccurredEnd().AsTime().Before(fact.GetOccurredStart().AsTime()) || fact.GetOccurredEnd().AsTime().After(envelope.GetCommittedAt().AsTime()) {
			return fmt.Errorf("enqueue cognition memory event: invalid activity occurrence interval")
		}
		if ownerActivityChange(fact.GetChange()) == "" || (fact.GetChange() == runtimev1.CognitionMemoryActivityChange_COGNITION_MEMORY_ACTIVITY_CHANGE_PROJECT_COMPLETED && fact.GetActivityState() != "completed") {
			return fmt.Errorf("enqueue cognition memory event: invalid activity change")
		}
		found := false
		for _, source := range envelope.GetSources() {
			found = found || (source.GetKind() == fact.GetActivity().GetKind() && source.GetValue() == fact.GetActivity().GetValue())
		}
		changeFound := false
		for _, source := range envelope.GetSources() {
			changeFound = changeFound || (source.GetKind() == fact.GetChangeRef().GetKind() && source.GetValue() == fact.GetChangeRef().GetValue())
		}
		if !found || !changeFound {
			return fmt.Errorf("enqueue cognition memory event: activity source missing from provenance")
		}
	case envelope.GetCorrectionCommitted() != nil:
		fact := envelope.GetCorrectionCommitted()
		if !validRef(fact.GetTargetMemory().GetValue()) || !validCommittedContent(fact.GetCorrectedContent()) {
			return fmt.Errorf("enqueue cognition memory event: invalid correction fact")
		}
	case envelope.GetRelationshipCommitted() != nil:
		fact := envelope.GetRelationshipCommitted()
		if !validRef(fact.GetRelationshipKind()) || !validCommittedContent(fact.GetBoundedFact()) {
			return fmt.Errorf("enqueue cognition memory event: invalid relationship fact")
		}
	case envelope.GetSessionPointerCommitted() != nil:
		fact := envelope.GetSessionPointerCommitted()
		if !validRef(fact.GetWorkSessionRef()) || !validCommittedContent(fact.GetTopicSummary()) {
			return fmt.Errorf("enqueue cognition memory event: invalid session pointer fact")
		}
		if scopeTag := strings.TrimSpace(fact.GetScopeTag()); scopeTag != "" && scopeTag != memoryv1.ScopeTagSessionPointer {
			return fmt.Errorf("enqueue cognition memory event: invalid session pointer scope tag")
		}
		if slotKey := fact.GetSlotKey(); slotKey != "" && !validRef(slotKey) {
			return fmt.Errorf("enqueue cognition memory event: invalid session pointer slot key")
		}
		if bodyKind := fact.GetBodyKind(); bodyKind != "" && (!utf8.ValidString(bodyKind) || len(bodyKind) > 128 || isTaintedSessionPointerSource(bodyKind)) {
			return fmt.Errorf("enqueue cognition memory event: invalid session pointer body kind")
		}
	default:
		return fmt.Errorf("enqueue cognition memory event: unsupported fact")
	}
	return nil
}

func validateCommittedCorrectionOwnerContext(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) (string, error) {
	if len(envelope.GetSubjects()) != 1 || envelope.GetSubjects()[0].GetKind() != "account_subject" || !validRef(envelope.GetSubjects()[0].GetValue()) {
		return "", fmt.Errorf("enqueue cognition memory event: correction account subject is invalid")
	}
	if len(envelope.GetSources()) != 1 || envelope.GetSources()[0].GetKind() != "agent_center_correction" || envelope.GetSources()[0].GetValue() != envelope.GetOperation().GetValue() {
		return "", fmt.Errorf("enqueue cognition memory event: correction source is invalid")
	}
	return envelope.GetSubjects()[0].GetValue(), nil
}

func validSourceRef(ref *runtimev1.CognitionMemorySourceRef) bool {
	return ref != nil && validRef(ref.GetKind()) && validRef(ref.GetValue())
}

func validCommittedActor(actor runtimev1.CognitionMemoryActorRole) bool {
	switch actor {
	case runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER,
		runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_ASSISTANT,
		runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_TOOL:
		return true
	default:
		return false
	}
}

func validCommittedTerminalState(state runtimev1.CognitionMemoryTerminalState) bool {
	switch state {
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_COMPLETED,
		runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_FAILED,
		runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_INTERRUPTED,
		runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_CANCELED:
		return true
	default:
		return false
	}
}

func validCommittedContent(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && len([]byte(value)) <= 16*1024 && utf8.ValidString(value)
}

func committedEventKind(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) string {
	switch {
	case envelope.GetMessageCommitted() != nil:
		return "message_committed"
	case envelope.GetTurnTerminal() != nil:
		return "turn_terminal"
	case envelope.GetActivityTerminal() != nil:
		return "activity_terminal"
	case envelope.GetCorrectionCommitted() != nil:
		return "correction_committed"
	case envelope.GetRelationshipCommitted() != nil:
		return "relationship_committed"
	case envelope.GetSessionPointerCommitted() != nil:
		return "session_pointer_committed"
	default:
		return ""
	}
}

// NeutralizeSessionOutbox marks any pending Cognition outbox items whose
// committed-event provenance belongs to (source_kind='session', source_ref=workSessionRef)
// as cutoff_non_effecting with payload=NULL so asynchronous outbox drain can
// NEVER resurrect memories of a deleted session.
// @nimi-authority: rule.nimi.cognition.runtime-bridge.session-pointer-and-delete-session
func (s *Store) NeutralizeSessionOutbox(ctx context.Context, localAgentRef, workSessionRef string) (int64, error) {
	if s == nil || s.backend == nil || !validRef(localAgentRef) || !validRef(workSessionRef) {
		return 0, fmt.Errorf("neutralize session cognition outbox: invalid input")
	}
	var neutralized int64
	err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "INSERT INTO runtime_local_agent_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING", deletedSessionMetaKey(localAgentRef, workSessionRef), s.now().UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE runtime_cognition_memory_outbox
			SET state = 'cutoff_non_effecting', outcome = 'no_effect', payload = NULL
			WHERE state = 'pending'
			  AND event_ref IN (
				SELECT event_ref FROM runtime_cognition_memory_committed_event
				WHERE local_agent_ref = ? AND source_kind = 'session' AND source_ref = ?
			  )`,
			localAgentRef, workSessionRef,
		)
		if err != nil {
			return fmt.Errorf("neutralize session cognition outbox: %w", err)
		}
		n, _ := res.RowsAffected()
		neutralized = n

		// Also inspect remaining pending envelopes for this agent so multi-source
		// rows where ("session", workSessionRef) is not Sources[0] (or carried on
		// SessionPointerCommitted) are equally neutralized.
		rows, err := tx.QueryContext(ctx, `
			SELECT o.operation_id, o.payload
			FROM runtime_cognition_memory_outbox o
			JOIN runtime_cognition_memory_stream s ON s.binding_ref = o.binding_ref
			WHERE s.local_agent_ref = ? AND o.state = 'pending' AND o.payload IS NOT NULL`,
			localAgentRef,
		)
		if err != nil {
			return fmt.Errorf("neutralize session cognition outbox: scan pending: %w", err)
		}
		var extraOps []string
		for rows.Next() {
			var opID string
			var payload []byte
			if scanErr := rows.Scan(&opID, &payload); scanErr != nil {
				_ = rows.Close()
				return fmt.Errorf("neutralize session cognition outbox: scan row: %w", scanErr)
			}
			var env runtimev1.CognitionMemoryCommittedEventEnvelope
			if err := proto.Unmarshal(payload, &env); err != nil {
				_ = rows.Close()
				return fmt.Errorf("decode pending cognition envelope: %w", err)
			}
			matched := env.GetSessionPointerCommitted() != nil && env.GetSessionPointerCommitted().GetWorkSessionRef() == workSessionRef
			if !matched {
				for _, src := range env.GetSources() {
					if src.GetKind() == "session" && src.GetValue() == workSessionRef {
						matched = true
						break
					}
				}
			}
			if matched {
				extraOps = append(extraOps, opID)
			}
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return err
		}
		if closeErr := rows.Close(); closeErr != nil {
			return fmt.Errorf("neutralize session cognition outbox: close scan: %w", closeErr)
		}
		for _, opID := range extraOps {
			extraRes, execErr := tx.ExecContext(ctx, `
				UPDATE runtime_cognition_memory_outbox
				SET state = 'cutoff_non_effecting', outcome = 'no_effect', payload = NULL
				WHERE operation_id = ? AND state = 'pending'`,
				opID,
			)
			if execErr != nil {
				return fmt.Errorf("neutralize session cognition outbox: update multi-source row: %w", execErr)
			}
			added, _ := extraRes.RowsAffected()
			neutralized += added
		}
		return nil
	})
	return neutralized, err
}

func deletedMemoryKey(agent, ref string) string {
	return "cognition_deleted_memory:" + agent + ":" + ref
}

func (s *Store) neutralizeSessionCorrections(ctx context.Context, agent string, refs []string) (int64, error) {
	var total int64
	err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		for _, ref := range refs {
			if _, err := tx.ExecContext(ctx, "INSERT INTO runtime_local_agent_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING", deletedMemoryKey(agent, ref), ref); err != nil {
				return err
			}
			res, err := tx.ExecContext(ctx, "UPDATE runtime_cognition_memory_outbox SET state='cutoff_non_effecting',outcome='no_effect',payload=NULL WHERE state='pending' AND event_ref IN (SELECT c.event_ref FROM runtime_cognition_memory_committed_correction c JOIN runtime_cognition_memory_committed_event e ON e.event_ref=c.event_ref WHERE e.local_agent_ref=? AND c.target_memory_ref=?)", agent, ref)
			if err != nil {
				return err
			}
			n, err := res.RowsAffected()
			if err != nil {
				return err
			}
			total += n
		}
		return nil
	})
	return total, err
}

func marshalEnvelope(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) ([]byte, string, error) {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(envelope)
	if err != nil {
		return nil, "", fmt.Errorf("encode cognition memory event: %w", err)
	}
	digest := sha256.Sum256(payload)
	return payload, hex.EncodeToString(digest[:]), nil
}

func advanceDeliveryFrontierTx(tx *sql.Tx, bindingRef string) error {
	var frontier, nextSequence uint64
	if err := tx.QueryRow(`SELECT delivery_frontier, next_delivery_sequence FROM runtime_cognition_memory_stream WHERE binding_ref = ?`, bindingRef).Scan(&frontier, &nextSequence); err != nil {
		return fmt.Errorf("advance cognition memory delivery frontier: load stream: %w", err)
	}
	for frontier+1 < nextSequence {
		var state string
		var receivedAt sql.NullString
		err := tx.QueryRow(`SELECT state, received_at FROM runtime_cognition_memory_outbox WHERE binding_ref = ? AND delivery_sequence = ?`, bindingRef, frontier+1).Scan(&state, &receivedAt)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				break
			}
			return fmt.Errorf("advance cognition memory delivery frontier: inspect sequence: %w", err)
		}
		if state != "received" && !(state == "cutoff_non_effecting" && receivedAt.Valid) {
			break
		}
		frontier++
	}
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_stream SET delivery_frontier = ? WHERE binding_ref = ?`, frontier, bindingRef); err != nil {
		return fmt.Errorf("advance cognition memory delivery frontier: update stream: %w", err)
	}
	return nil
}

func validRef(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && len(value) <= 512 && utf8.ValidString(value)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

// Copy disposal follows the handoff owner's actual terminal state. A target
// forget must never convert an unrelated live pending event into a cutoff.
func (s *Store) disposeSettledOutboxCopies(ctx context.Context, agent string) error {
	return s.backend.DisposeRecoveryPayloads(ctx, agent, func(tx *sql.Tx) (bool, bool, error) {
		result, err := tx.ExecContext(ctx, `UPDATE main.runtime_cognition_memory_outbox AS copy
   SET payload=NULL, state=settled.state, outcome=settled.outcome
   FROM live.runtime_cognition_memory_outbox AS settled, main.runtime_cognition_memory_stream AS stream
   WHERE copy.binding_ref=stream.binding_ref AND stream.local_agent_ref=?
   AND (copy.payload IS NOT NULL OR copy.state='pending')
   AND settled.operation_id=copy.operation_id AND settled.binding_ref=copy.binding_ref AND settled.state<>'pending'`, agent)
		if err != nil {
			return false, false, err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return false, false, err
		}
		var pending bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM main.runtime_cognition_memory_outbox o
    JOIN main.runtime_cognition_memory_stream s ON s.binding_ref=o.binding_ref
    WHERE s.local_agent_ref=? AND (o.payload IS NOT NULL OR o.state='pending'))`, agent).Scan(&pending)
		return !pending, changed > 0, err
	})
}
