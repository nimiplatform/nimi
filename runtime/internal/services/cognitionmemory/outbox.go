// Package cognitionmemory contains the Runtime-owned, unregistered Memory
// binding and committed-event outbox seam used by direct integration tests
// before the single active cutover.
package cognitionmemory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

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
	backend *runtimepersistence.Backend
	now     func() time.Time
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

func NewStore(backend *runtimepersistence.Backend) *Store {
	return &Store{backend: backend, now: time.Now}
}

// @nimi-authority: rule.nimi.runtime.memory-world.r019
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

// @nimi-authority: rule.nimi.runtime.memory-world.r018
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
	err := s.backend.DB().QueryRowContext(ctx, `SELECT o.operation_id, o.event_ref, o.delivery_sequence, o.state, COALESCE(o.outcome, ''), o.payload IS NOT NULL, o.payload, s.bank_ref, s.lifecycle_ref FROM runtime_cognition_memory_outbox o JOIN runtime_cognition_memory_stream s ON s.binding_ref = o.binding_ref WHERE o.binding_ref = ? AND o.state = 'pending' ORDER BY o.delivery_sequence LIMIT 1`, bindingRef).Scan(&item.OperationID, &item.EventRef, &item.DeliverySequence, &item.State, &item.Outcome, &item.PayloadPresent, &payload, &bankRef, &lifecycleRef)
	if err != nil {
		return OutboxItem{}, err
	}
	if !bankRef.Valid || !lifecycleRef.Valid || !validRef(bankRef.String) || !validRef(lifecycleRef.String) {
		return OutboxItem{}, ErrMemoryUnbound
	}
	envelope := &runtimev1.CognitionMemoryCommittedEventEnvelope{}
	if err := proto.Unmarshal(payload, envelope); err != nil {
		return OutboxItem{}, fmt.Errorf("load pending cognition memory event: decode payload: %w", err)
	}
	envelope.Bank = &runtimev1.CognitionMemoryBankRef{Value: bankRef.String}
	item.BindingRef = bindingRef
	item.BankRef = bankRef.String
	item.LifecycleRef = lifecycleRef.String
	item.Envelope = envelope
	return item, nil
}

// @nimi-authority: rule.nimi.runtime.memory-world.r019
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
	if _, err := tx.Exec(`UPDATE runtime_cognition_memory_agent SET enabled = ?, adoption_required = 0, updated_at = ? WHERE local_agent_ref = ?`, boolInt(enabled), s.now().UTC().Format(time.RFC3339Nano), localAgentRef); err != nil {
		return fmt.Errorf("set cognition memory enabled: update: %w", err)
	}
	return nil
}

func (s *Store) ListOutbox(ctx context.Context, bindingRef string) ([]OutboxItem, error) {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT operation_id, binding_ref, event_ref, delivery_sequence, state, COALESCE(outcome, ''), payload IS NOT NULL FROM runtime_cognition_memory_outbox WHERE binding_ref = ? ORDER BY delivery_sequence`, bindingRef)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
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

func (s *Store) ActiveBindings(ctx context.Context) ([]Binding, error) {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT a.local_agent_ref, a.account_subject_ref, a.current_binding_ref, s.binding_operation_id, COALESCE(a.bank_ref, ''), COALESCE(a.lifecycle_ref, ''), a.enabled, a.adoption_required, a.state, s.next_delivery_sequence, s.delivery_frontier, s.state FROM runtime_cognition_memory_agent a JOIN runtime_cognition_memory_stream s ON s.binding_ref = a.current_binding_ref WHERE a.state = 'active' AND s.state = 'active' ORDER BY a.local_agent_ref`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
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
	for _, ref := range envelope.GetSubjects() {
		if !validRef(ref.GetKind()) || !validRef(ref.GetValue()) {
			return fmt.Errorf("enqueue cognition memory event: invalid subject ref")
		}
	}
	for _, ref := range envelope.GetSources() {
		if !validRef(ref.GetKind()) || !validRef(ref.GetValue()) {
			return fmt.Errorf("enqueue cognition memory event: invalid source ref")
		}
	}
	return nil
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
	default:
		return ""
	}
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
		err := tx.QueryRow(`SELECT state FROM runtime_cognition_memory_outbox WHERE binding_ref = ? AND delivery_sequence = ?`, bindingRef, frontier+1).Scan(&state)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				break
			}
			return fmt.Errorf("advance cognition memory delivery frontier: inspect sequence: %w", err)
		}
		if state != "received" {
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
	return value != "" && strings.TrimSpace(value) == value && len(value) <= 512
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
