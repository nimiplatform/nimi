package memoryengine

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

type ReviewInputProvider func(ctx context.Context, scope ScopeDescriptor, limit int) ([]*runtimev1.MemoryRecord, error)

type sqliteCanonicalReviewStore struct {
	backend       *runtimepersistence.Backend
	inputProvider ReviewInputProvider
}

func NewSQLiteCanonicalReviewStore(backend *runtimepersistence.Backend, inputProvider ReviewInputProvider) CanonicalReviewStore {
	if backend == nil {
		return nil
	}
	return sqliteCanonicalReviewStore{
		backend:       backend,
		inputProvider: inputProvider,
	}
}

func (s sqliteCanonicalReviewStore) ListAdmittedTruths(ctx context.Context, scope ScopeDescriptor) ([]TruthRecord, error) {
	locatorKeyValue, err := LocatorKey(scope)
	if err != nil {
		return nil, err
	}
	rows, err := s.backend.DB().QueryContext(ctx, `
		SELECT truth_json
		FROM agent_truth
		WHERE bank_locator_key = ? AND status = 'admitted'
		ORDER BY updated_at DESC, truth_id
	`, locatorKeyValue)
	if err != nil {
		return nil, fmt.Errorf("list admitted truths: %w", err)
	}
	defer rows.Close()
	out := make([]TruthRecord, 0)
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var truth TruthRecord
		if err := json.Unmarshal([]byte(raw), &truth); err != nil {
			return nil, err
		}
		out = append(out, truth)
	}
	return out, rows.Err()
}

func (s sqliteCanonicalReviewStore) ListNarrativeContext(ctx context.Context, scope ScopeDescriptor, query string, limit int) ([]*runtimev1.NarrativeRecallHit, error) {
	if limit <= 0 {
		limit = 10
	}
	locatorKeyValue, err := LocatorKey(scope)
	if err != nil {
		return nil, err
	}
	rows, err := s.backend.DB().QueryContext(ctx, `
		SELECT narrative_id, topic, content, status
		FROM memory_narrative
		WHERE bank_locator_key = ?
	`, locatorKeyValue)
	if err != nil {
		return nil, fmt.Errorf("query narratives: %w", err)
	}
	defer rows.Close()
	queryTokens := strings.Fields(buildReviewSearchTokens(query))
	type candidate struct {
		hit   *runtimev1.NarrativeRecallHit
		score float64
	}
	items := make([]candidate, 0)
	for rows.Next() {
		var narrativeID string
		var topic string
		var content string
		var status string
		if err := rows.Scan(&narrativeID, &topic, &content, &status); err != nil {
			return nil, err
		}
		score := narrativeMatchScore(strings.Join([]string{topic, content}, " "), queryTokens)
		if score <= 0 {
			continue
		}
		sourceIDs, err := s.listNarrativeSourceIDs(ctx, narrativeID)
		if err != nil {
			return nil, err
		}
		items = append(items, candidate{
			hit: &runtimev1.NarrativeRecallHit{
				NarrativeId:     narrativeID,
				Topic:           topic,
				Content:         content,
				SourceMemoryIds: sourceIDs,
				IsStale:         status == "stale",
				RelevanceScore:  score,
			},
			score: score,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].score == items[j].score {
			return items[i].hit.GetNarrativeId() < items[j].hit.GetNarrativeId()
		}
		return items[i].score > items[j].score
	})
	out := make([]*runtimev1.NarrativeRecallHit, 0, minInt(limit, len(items)))
	for _, item := range items {
		out = append(out, item.hit)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s sqliteCanonicalReviewStore) ListCanonicalReviewInputs(ctx context.Context, scope ScopeDescriptor, checkpoint string, limit int) ([]*runtimev1.MemoryRecord, error) {
	if s.inputProvider == nil {
		return nil, nil
	}
	records, err := s.inputProvider(ctx, scope, limit)
	if err != nil {
		return nil, err
	}
	return FilterCanonicalReviewInputs(records, checkpoint), nil
}

func (s sqliteCanonicalReviewStore) GetReviewCheckpoint(ctx context.Context, scope ScopeDescriptor) (*ReviewCheckpoint, error) {
	locatorKeyValue, err := LocatorKey(scope)
	if err != nil {
		return nil, err
	}
	var raw string
	err = s.backend.DB().QueryRowContext(ctx, `
		SELECT checkpoint_json
		FROM memory_review_checkpoint
		WHERE bank_locator_key = ?
	`, locatorKeyValue).Scan(&raw)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get review checkpoint: %w", err)
	}
	var checkpoint ReviewCheckpoint
	if err := json.Unmarshal([]byte(raw), &checkpoint); err != nil {
		return nil, err
	}
	return &checkpoint, nil
}

func (s sqliteCanonicalReviewStore) CommitCanonicalReview(ctx context.Context, req CommitCanonicalReviewRequest) error {
	if strings.TrimSpace(req.ReviewRunID) == "" {
		return fmt.Errorf("review_run_id is required")
	}
	locatorKeyValue, err := LocatorKey(req.Scope)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(req.Outcomes)
	if err != nil {
		return fmt.Errorf("marshal review outcomes: %w", err)
	}
	hash := sha256.Sum256(payload)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var existingHash string
		err := tx.QueryRowContext(ctx, `SELECT outcome_hash FROM memory_review_commit WHERE review_run_id = ?`, req.ReviewRunID).Scan(&existingHash)
		switch {
		case err == nil:
			if existingHash != fmt.Sprintf("%x", hash[:]) {
				return fmt.Errorf("review_run_id %s already committed with different outcome hash", req.ReviewRunID)
			}
			return nil
		case err != sql.ErrNoRows:
			return err
		}
		for _, narrative := range req.Outcomes.Narratives {
			if _, err := tx.ExecContext(ctx, `
				INSERT OR REPLACE INTO memory_narrative(narrative_id, bank_locator_key, topic, content, source_version, status, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM memory_narrative WHERE narrative_id = ?), ?), ?)
			`, narrative.NarrativeID, locatorKeyValue, narrative.Topic, narrative.Content, narrative.SourceVersion, firstNonEmpty(narrative.Status, "active"), narrative.NarrativeID, now, now); err != nil {
				return err
			}
			for _, memoryID := range narrative.SourceMemoryIDs {
				if _, err := tx.ExecContext(ctx, `
					INSERT OR REPLACE INTO narrative_source(narrative_id, memory_id, bank_locator_key, absorbed_at, is_active, deactivated_at)
					VALUES (?, ?, ?, ?, 1, NULL)
				`, narrative.NarrativeID, memoryID, locatorKeyValue, now); err != nil {
					return err
				}
			}
		}
		for _, truth := range req.Outcomes.Truths {
			raw, err := json.Marshal(truth)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT OR REPLACE INTO agent_truth(truth_id, bank_locator_key, dimension, normalized_key, statement, confidence, review_count, first_review_at, last_review_at, status, supersedes_truth_id, created_at, updated_at, truth_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM agent_truth WHERE truth_id = ?), ?), ?, ?)
			`, truth.TruthID, locatorKeyValue, truth.Dimension, truth.NormalizedKey, truth.Statement, truth.Confidence, truth.ReviewCount, truth.FirstReviewAt, truth.LastReviewAt, firstNonEmpty(truth.Status, "candidate"), truth.SupersedesTruthID, truth.TruthID, now, now, string(raw)); err != nil {
				return err
			}
			for _, memoryID := range truth.SourceMemoryIDs {
				if _, err := tx.ExecContext(ctx, `
					INSERT OR REPLACE INTO truth_source(truth_id, memory_id, bank_locator_key, observed_at, is_active, deactivated_at)
					VALUES (?, ?, ?, ?, 1, NULL)
				`, truth.TruthID, memoryID, locatorKeyValue, now); err != nil {
					return err
				}
			}
		}
		for _, relation := range req.Outcomes.Relations {
			if _, err := tx.ExecContext(ctx, `
				INSERT OR REPLACE INTO memory_relation(relation_id, bank_locator_key, source_id, target_id, relation_type, confidence, created_by, is_active, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, 1, COALESCE((SELECT created_at FROM memory_relation WHERE relation_id = ?), ?))
			`, relation.RelationID, locatorKeyValue, relation.SourceID, relation.TargetID, relation.RelationType, relation.Confidence, relation.CreatedBy, relation.RelationID, now); err != nil {
				return err
			}
		}
		checkpoint := ReviewCheckpoint{
			BankLocatorKey: locatorKeyValue,
			LastReviewRun:  req.ReviewRunID,
			Checkpoint:     req.CheckpointBasis,
			UpdatedAt:      now,
		}
		checkpointRaw, err := json.Marshal(checkpoint)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT OR REPLACE INTO memory_review_checkpoint(bank_locator_key, checkpoint_json, updated_at)
			VALUES (?, ?, ?)
		`, locatorKeyValue, string(checkpointRaw), now); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO memory_review_commit(review_run_id, bank_locator_key, checkpoint_basis, outcome_hash, committed_at, outcomes_json)
			VALUES (?, ?, ?, ?, ?, ?)
		`, req.ReviewRunID, locatorKeyValue, req.CheckpointBasis, fmt.Sprintf("%x", hash[:]), now, string(payload)); err != nil {
			return err
		}
		return nil
	})
}

func FilterCanonicalReviewInputs(records []*runtimev1.MemoryRecord, checkpoint string) []*runtimev1.MemoryRecord {
	if strings.TrimSpace(checkpoint) == "" {
		return records
	}
	filtered := make([]*runtimev1.MemoryRecord, 0, len(records))
	for _, record := range records {
		if strings.Compare(record.GetMemoryId(), checkpoint) > 0 {
			filtered = append(filtered, record)
		}
	}
	return filtered
}

func (s sqliteCanonicalReviewStore) listNarrativeSourceIDs(ctx context.Context, narrativeID string) ([]string, error) {
	sourceRows, err := s.backend.DB().QueryContext(ctx, `
		SELECT memory_id
		FROM narrative_source
		WHERE narrative_id = ? AND is_active = 1
		ORDER BY memory_id
	`, narrativeID)
	if err != nil {
		return nil, err
	}
	defer sourceRows.Close()
	sourceIDs := make([]string, 0)
	for sourceRows.Next() {
		var memoryID string
		if err := sourceRows.Scan(&memoryID); err != nil {
			return nil, err
		}
		sourceIDs = append(sourceIDs, memoryID)
	}
	return sourceIDs, sourceRows.Err()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
