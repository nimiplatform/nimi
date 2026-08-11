package memory

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type memoryEmbeddingProjectionInput struct {
	ID  string
	Raw string
}

type pendingMemoryEmbeddingProjectionSnapshot struct {
	Locator             *runtimev1.MemoryBankLocator
	LocatorKey          string
	Bank                *runtimev1.MemoryBank
	CurrentGenerationID string
	Pending             *pendingEmbeddingCutoverState
	Records             []memoryEmbeddingProjectionInput
	Narratives          []memoryEmbeddingProjectionInput
}

type materializedMemoryEmbeddingProjection struct {
	Records    [][]float64
	Narratives [][]float64
}

func (s *Service) commitCanonicalBankEmbeddingCutover(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*runtimev1.MemoryBank, error) {
	snapshot, err := s.capturePendingMemoryEmbeddingProjection(locator)
	if err != nil {
		return nil, err
	}
	projection, err := s.materializePendingMemoryEmbeddingProjection(ctx, snapshot)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return s.commitPendingMemoryEmbeddingProjection(snapshot, projection)
}

func (s *Service) capturePendingMemoryEmbeddingProjection(locator *runtimev1.MemoryBankLocator) (*pendingMemoryEmbeddingProjectionSnapshot, error) {
	state, err := s.bankForLocator(locator)
	if err != nil {
		return nil, err
	}
	if !state.Bank.GetCanonicalAgentScope() {
		return nil, status.Error(codes.FailedPrecondition, "embedding profile cutover is canonical-bank only")
	}
	if state.PendingEmbeddingCutover == nil || state.PendingEmbeddingCutover.TargetProfile == nil {
		return nil, status.Error(codes.FailedPrecondition, "embedding profile cutover target is required")
	}
	records := make([]memoryEmbeddingProjectionInput, 0, len(state.Order))
	for _, recordID := range state.Order {
		record := state.Records[recordID]
		if record == nil {
			return nil, memoryEmbeddingCutoverConflictError()
		}
		records = append(records, memoryEmbeddingProjectionInput{
			ID:  recordID,
			Raw: memoryRecordEmbeddingInput(record),
		})
	}
	narratives, err := s.loadActiveNarrativeEmbeddingInputs(locatorKey(locator))
	if err != nil {
		return nil, err
	}
	return &pendingMemoryEmbeddingProjectionSnapshot{
		Locator:             cloneLocator(locator),
		LocatorKey:          locatorKey(locator),
		Bank:                cloneBank(state.Bank),
		CurrentGenerationID: currentEmbeddingGenerationID(state.Bank),
		Pending:             clonePendingEmbeddingCutoverState(state.PendingEmbeddingCutover),
		Records:             records,
		Narratives:          narratives,
	}, nil
}

func (s *Service) materializePendingMemoryEmbeddingProjection(ctx context.Context, snapshot *pendingMemoryEmbeddingProjectionSnapshot) (*materializedMemoryEmbeddingProjection, error) {
	if snapshot == nil || snapshot.Pending == nil || snapshot.Pending.TargetProfile == nil {
		return nil, status.Error(codes.FailedPrecondition, "embedding profile cutover target is required")
	}
	raws := make([]string, 0, len(snapshot.Records)+len(snapshot.Narratives))
	for _, input := range snapshot.Records {
		raws = append(raws, input.Raw)
	}
	for _, input := range snapshot.Narratives {
		raws = append(raws, input.Raw)
	}
	vectors, err := s.embeddingVectors(ctx, snapshot.Pending.TargetProfile, raws)
	if err != nil {
		return nil, err
	}
	if len(vectors) != len(raws) {
		return nil, memoryEmbeddingOutputInvalidError()
	}
	recordCount := len(snapshot.Records)
	return &materializedMemoryEmbeddingProjection{
		Records:    cloneMemoryEmbeddingVectors(vectors[:recordCount]),
		Narratives: cloneMemoryEmbeddingVectors(vectors[recordCount:]),
	}, nil
}

func (s *Service) commitPendingMemoryEmbeddingProjection(snapshot *pendingMemoryEmbeddingProjectionSnapshot, projection *materializedMemoryEmbeddingProjection) (*runtimev1.MemoryBank, error) {
	if snapshot == nil || snapshot.Pending == nil || snapshot.Pending.TargetProfile == nil || projection == nil {
		return nil, status.Error(codes.FailedPrecondition, "embedding profile cutover projection is required")
	}
	if len(snapshot.Records) != len(projection.Records) || len(snapshot.Narratives) != len(projection.Narratives) {
		return nil, memoryEmbeddingOutputInvalidError()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.banks[snapshot.LocatorKey]
	if !pendingMemoryEmbeddingSnapshotMatchesState(snapshot, state) {
		return nil, memoryEmbeddingCutoverConflictError()
	}

	nextBank := cloneBank(state.Bank)
	nextBank.EmbeddingProfile = cloneEmbeddingProfile(snapshot.Pending.TargetProfile)
	setCurrentEmbeddingGenerationID(nextBank, snapshot.Pending.GenerationID)
	nextBank.UpdatedAt = timestamppb.New(s.now().UTC())
	bankRaw, err := protojson.Marshal(nextBank)
	if err != nil {
		return nil, fmt.Errorf("marshal cutover memory bank: %w", err)
	}
	profileRaw, err := protojson.Marshal(snapshot.Pending.TargetProfile)
	if err != nil {
		return nil, fmt.Errorf("marshal cutover embedding profile: %w", err)
	}
	embeddingUpdatedAt := s.now().UTC().Format("2006-01-02T15:04:05.999999999Z07:00")

	err = s.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		currentNarratives, err := loadActiveNarrativeEmbeddingInputsTx(tx, snapshot.LocatorKey)
		if err != nil {
			return err
		}
		if !memoryEmbeddingProjectionInputsEqual(currentNarratives, snapshot.Narratives) {
			return memoryEmbeddingCutoverConflictError()
		}
		result, err := tx.Exec(`
			UPDATE memory_bank
			SET updated_at = ?, embedding_bound = 1, bank_json = ?
			WHERE locator_key = ?
		`, timestampString(nextBank.GetUpdatedAt()), string(bankRaw), snapshot.LocatorKey)
		if err != nil {
			return fmt.Errorf("update cutover memory bank: %w", err)
		}
		rowsAffected, err := result.RowsAffected()
		if err != nil || rowsAffected != 1 {
			return memoryEmbeddingCutoverConflictError()
		}
		if _, err := tx.Exec(`DELETE FROM memory_record_embedding WHERE locator_key = ?`, snapshot.LocatorKey); err != nil {
			return fmt.Errorf("clear cutover record embeddings: %w", err)
		}
		for index, input := range snapshot.Records {
			if _, err := tx.Exec(`
				INSERT INTO memory_record_embedding(memory_id, locator_key, dimension, vector_json, updated_at)
				VALUES (?, ?, ?, ?, ?)
			`, input.ID, snapshot.LocatorKey, int(snapshot.Pending.TargetProfile.GetDimension()), marshalFloatVector(projection.Records[index]), embeddingUpdatedAt); err != nil {
				return fmt.Errorf("insert cutover record embedding %s: %w", input.ID, err)
			}
		}
		if _, err := tx.Exec(`DELETE FROM memory_narrative_embedding WHERE locator_key = ?`, snapshot.LocatorKey); err != nil {
			return fmt.Errorf("clear cutover narrative embeddings: %w", err)
		}
		for index, input := range snapshot.Narratives {
			if _, err := tx.Exec(`
				INSERT INTO memory_narrative_embedding(locator_key, narrative_id, embedding_profile_json, vector_json, updated_at)
				VALUES (?, ?, ?, ?, ?)
			`, snapshot.LocatorKey, input.ID, string(profileRaw), marshalFloatVector(projection.Narratives[index]), embeddingUpdatedAt); err != nil {
				return fmt.Errorf("insert cutover narrative embedding %s: %w", input.ID, err)
			}
		}
		if _, err := tx.Exec(`DELETE FROM memory_meta WHERE key = ?`, pendingEmbeddingCutoverMetaKey(snapshot.LocatorKey)); err != nil {
			return fmt.Errorf("clear cutover pending state: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	state.Bank = nextBank
	state.PendingEmbeddingCutover = nil
	return cloneBank(nextBank), nil
}

func (s *Service) loadActiveNarrativeEmbeddingInputs(locatorKeyValue string) ([]memoryEmbeddingProjectionInput, error) {
	if s == nil || s.backend == nil {
		return nil, nil
	}
	rows, err := s.backend.DB().Query(`
		SELECT narrative_id, topic, content
		FROM memory_narrative
		WHERE bank_locator_key = ? AND lower(trim(status)) = 'active'
		ORDER BY narrative_id
	`, locatorKeyValue)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanActiveNarrativeEmbeddingInputs(rows)
}

func loadActiveNarrativeEmbeddingInputsTx(tx *sql.Tx, locatorKeyValue string) ([]memoryEmbeddingProjectionInput, error) {
	rows, err := tx.Query(`
		SELECT narrative_id, topic, content
		FROM memory_narrative
		WHERE bank_locator_key = ? AND lower(trim(status)) = 'active'
		ORDER BY narrative_id
	`, locatorKeyValue)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanActiveNarrativeEmbeddingInputs(rows)
}

type memoryEmbeddingProjectionRows interface {
	Next() bool
	Scan(...any) error
	Err() error
}

func scanActiveNarrativeEmbeddingInputs(rows memoryEmbeddingProjectionRows) ([]memoryEmbeddingProjectionInput, error) {
	out := make([]memoryEmbeddingProjectionInput, 0)
	for rows.Next() {
		var id, topic, content string
		if err := rows.Scan(&id, &topic, &content); err != nil {
			return nil, err
		}
		out = append(out, memoryEmbeddingProjectionInput{
			ID:  strings.TrimSpace(id),
			Raw: strings.TrimSpace(strings.Join([]string{topic, content}, " ")),
		})
	}
	return out, rows.Err()
}

func pendingMemoryEmbeddingSnapshotMatchesState(snapshot *pendingMemoryEmbeddingProjectionSnapshot, state *bankState) bool {
	if snapshot == nil || state == nil || state.Bank == nil || state.PendingEmbeddingCutover == nil {
		return false
	}
	if !proto.Equal(snapshot.Bank, state.Bank) ||
		currentEmbeddingGenerationID(state.Bank) != snapshot.CurrentGenerationID ||
		state.PendingEmbeddingCutover.GenerationID != snapshot.Pending.GenerationID ||
		strings.TrimSpace(state.PendingEmbeddingCutover.RevisionToken) != strings.TrimSpace(snapshot.Pending.RevisionToken) ||
		!embeddingProfilesMatch(state.PendingEmbeddingCutover.TargetProfile, snapshot.Pending.TargetProfile) ||
		len(state.Order) != len(snapshot.Records) {
		return false
	}
	for index, input := range snapshot.Records {
		if state.Order[index] != input.ID {
			return false
		}
		record := state.Records[input.ID]
		if record == nil || memoryRecordEmbeddingInput(record) != input.Raw {
			return false
		}
	}
	return true
}

func memoryEmbeddingProjectionInputsEqual(left, right []memoryEmbeddingProjectionInput) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func memoryRecordEmbeddingInput(record *runtimev1.MemoryRecord) string {
	return strings.TrimSpace(strings.Join([]string{recordContent(record), recordContext(record)}, " "))
}

func cloneMemoryEmbeddingVectors(input [][]float64) [][]float64 {
	out := make([][]float64, 0, len(input))
	for _, vector := range input {
		out = append(out, append([]float64(nil), vector...))
	}
	return out
}

func memoryEmbeddingCutoverConflictError() error {
	return grpcerr.WithReasonCode(codes.Aborted, runtimev1.ReasonCode_AI_MEMORY_EMBEDDING_TARGET_REF_INVALID)
}
