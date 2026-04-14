package memory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
	"google.golang.org/protobuf/encoding/protojson"
)

const (
	recallFeedbackTargetRecord    = "record"
	recallFeedbackTargetNarrative = "narrative"
	recallFeedbackHelpful         = "helpful"
	recallFeedbackUnhelpful       = "unhelpful"
	relationConfidenceFloor       = 0.80
	relationCreatedBy             = "canonical_review.relation"
	relationExpansionLimit        = 8
	relationExpansionWeight       = 0.35
	feedbackHelpfulWeight         = 0.06
	feedbackUnhelpfulWeight       = 0.09
	feedbackBiasMin               = -0.30
	feedbackBiasMax               = 0.18
)

type RecallFeedback struct {
	FeedbackID   string
	Bank         *runtimev1.MemoryBankLocator
	TargetKind   string
	TargetID     string
	Polarity     string
	QueryText    string
	SourceSystem string
}

type recallFeedbackSummary struct {
	HelpfulCount   int
	UnhelpfulCount int
}

type narrativeRecallCandidate struct {
	NarrativeID     string
	Topic           string
	Content         string
	Status          string
	SourceMemoryIDs []string
}

type relationExpansion struct {
	SourceID     string
	TargetID     string
	RelationType string
	Confidence   float64
}

func (s *Service) RecordRecallFeedback(ctx context.Context, feedback RecallFeedback) error {
	if s == nil || s.backend == nil {
		return nil
	}
	feedbackID := strings.TrimSpace(feedback.FeedbackID)
	targetKind := strings.ToLower(strings.TrimSpace(feedback.TargetKind))
	targetID := strings.TrimSpace(feedback.TargetID)
	polarity := strings.ToLower(strings.TrimSpace(feedback.Polarity))
	if feedbackID == "" || feedback.Bank == nil || targetID == "" {
		return fmt.Errorf("feedback_id, bank, and target_id are required")
	}
	if targetKind != recallFeedbackTargetRecord && targetKind != recallFeedbackTargetNarrative {
		return fmt.Errorf("target_kind must be record or narrative")
	}
	if polarity != recallFeedbackHelpful && polarity != recallFeedbackUnhelpful {
		return fmt.Errorf("polarity must be helpful or unhelpful")
	}
	bankLocatorKey := locatorKey(feedback.Bank)
	queryText := strings.TrimSpace(feedback.QueryText)
	sourceSystem := strings.TrimSpace(feedback.SourceSystem)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var existing struct {
			BankLocatorKey string
			TargetKind     string
			TargetID       string
			Polarity       string
			QueryText      string
			SourceSystem   string
		}
		err := tx.QueryRowContext(ctx, `
			SELECT bank_locator_key, target_kind, target_id, polarity, query_text, source_system
			FROM memory_recall_feedback_event
			WHERE feedback_id = ?
		`, feedbackID).Scan(&existing.BankLocatorKey, &existing.TargetKind, &existing.TargetID, &existing.Polarity, &existing.QueryText, &existing.SourceSystem)
		switch {
		case err == nil:
			if existing.BankLocatorKey == bankLocatorKey &&
				existing.TargetKind == targetKind &&
				existing.TargetID == targetID &&
				existing.Polarity == polarity &&
				existing.QueryText == queryText &&
				existing.SourceSystem == sourceSystem {
				return nil
			}
			return fmt.Errorf("feedback_id %s already recorded with different payload", feedbackID)
		case err != sql.ErrNoRows:
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO memory_recall_feedback_event(feedback_id, bank_locator_key, target_kind, target_id, polarity, query_text, source_system, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, feedbackID, bankLocatorKey, targetKind, targetID, polarity, queryText, sourceSystem, now); err != nil {
			return err
		}
		helpfulDelta := 0
		unhelpfulDelta := 0
		if polarity == recallFeedbackHelpful {
			helpfulDelta = 1
		} else {
			unhelpfulDelta = 1
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(bank_locator_key, target_kind, target_id) DO UPDATE SET
				helpful_count = memory_recall_feedback_summary.helpful_count + excluded.helpful_count,
				unhelpful_count = memory_recall_feedback_summary.unhelpful_count + excluded.unhelpful_count,
				last_feedback_at = excluded.last_feedback_at
		`, bankLocatorKey, targetKind, targetID, helpfulDelta, unhelpfulDelta, now)
		if err != nil {
			return err
		}
		if targetKind == recallFeedbackTargetNarrative && strings.TrimSpace(queryText) != "" {
			if err := s.recordNarrativeAliasEvidence(ctx, tx, bankLocatorKey, targetID, polarity, queryText, now); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return err
	}
	s.maybeRunAcceleratorCleanup(ctx)
	return nil
}

func (s *Service) upsertNarrativeEmbeddings(ctx context.Context, locator *runtimev1.MemoryBankLocator, narratives []NarrativeCandidate) error {
	if s == nil || s.backend == nil || locator == nil || len(narratives) == 0 {
		return nil
	}
	bankState, err := s.bankForLocator(locator)
	if err != nil {
		return err
	}
	profile := bankState.Bank.GetEmbeddingProfile()
	if profile == nil || !s.embeddingAvailableForProfile(profile) {
		return nil
	}
	profileRaw, err := protojson.Marshal(profile)
	if err != nil {
		return err
	}
	locatorKeyValue := locatorKey(locator)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		for _, narrative := range narratives {
			narrativeID := strings.TrimSpace(narrative.NarrativeID)
			if narrativeID == "" {
				continue
			}
			if strings.ToLower(strings.TrimSpace(narrative.Status)) != "active" {
				if _, err := tx.ExecContext(ctx, `
					DELETE FROM memory_narrative_embedding
					WHERE locator_key = ? AND narrative_id = ?
				`, locatorKeyValue, narrativeID); err != nil {
					return err
				}
				continue
			}
			vector := computeEmbeddingVector(strings.TrimSpace(strings.Join([]string{narrative.Topic, narrative.Content}, " ")), profile.GetDimension())
			if _, err := tx.ExecContext(ctx, `
				INSERT OR REPLACE INTO memory_narrative_embedding(locator_key, narrative_id, embedding_profile_json, vector_json, updated_at)
				VALUES (?, ?, ?, ?, ?)
			`, locatorKeyValue, narrativeID, string(profileRaw), marshalFloatVector(vector), now); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) narrativeEmbeddingRecallScores(bank *runtimev1.MemoryBank, query string) map[string]float64 {
	if s == nil || s.backend == nil || bank == nil || bank.GetEmbeddingProfile() == nil || !s.embeddingAvailableForProfile(bank.GetEmbeddingProfile()) {
		return nil
	}
	queryVector := computeEmbeddingVector(query, bank.GetEmbeddingProfile().GetDimension())
	if len(queryVector) == 0 {
		return nil
	}
	rows, err := s.backend.DB().Query(`
		SELECT narrative_id, vector_json
		FROM memory_narrative_embedding
		WHERE locator_key = ?
	`, locatorKey(bank.GetLocator()))
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var narrativeID string
		var vectorRaw string
		if err := rows.Scan(&narrativeID, &vectorRaw); err != nil {
			return nil
		}
		out[narrativeID] = cosineSimilarity(queryVector, unmarshalFloatVector(vectorRaw))
	}
	return out
}

func (s *Service) recallFeedbackBiases(bankLocatorKey string, targetKind string, targetIDs []string) map[string]float64 {
	if s == nil || s.backend == nil || bankLocatorKey == "" || targetKind == "" || len(targetIDs) == 0 {
		return nil
	}
	ids := uniqueTrimmedStrings(targetIDs)
	if len(ids) == 0 {
		return nil
	}
	args := make([]any, 0, len(ids)+2)
	args = append(args, bankLocatorKey, targetKind)
	for _, id := range ids {
		args = append(args, id)
	}
	query := fmt.Sprintf(`
		SELECT target_id, helpful_count, unhelpful_count
		FROM memory_recall_feedback_summary
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id IN (%s)
	`, sqlPlaceholders(len(ids)))
	rows, err := s.backend.DB().Query(query, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make(map[string]float64, len(ids))
	for rows.Next() {
		var targetID string
		var summary recallFeedbackSummary
		if err := rows.Scan(&targetID, &summary.HelpfulCount, &summary.UnhelpfulCount); err != nil {
			return nil
		}
		out[targetID] = recallFeedbackBias(summary)
	}
	return out
}

func recallFeedbackBias(summary recallFeedbackSummary) float64 {
	bias := feedbackHelpfulWeight*float64(summary.HelpfulCount) - feedbackUnhelpfulWeight*float64(summary.UnhelpfulCount)
	if bias < feedbackBiasMin {
		return feedbackBiasMin
	}
	if bias > feedbackBiasMax {
		return feedbackBiasMax
	}
	return bias
}

func (s *Service) loadNarrativeRecallCandidates(locator *runtimev1.MemoryBankLocator) ([]narrativeRecallCandidate, error) {
	if s == nil || s.backend == nil || locator == nil {
		return nil, nil
	}
	locatorKeyValue := locatorKey(locator)
	rows, err := s.backend.DB().Query(`
		SELECT narrative_id, topic, content, status
		FROM memory_narrative
		WHERE bank_locator_key = ?
	`, locatorKeyValue)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	candidates := make([]narrativeRecallCandidate, 0)
	for rows.Next() {
		var item narrativeRecallCandidate
		if err := rows.Scan(&item.NarrativeID, &item.Topic, &item.Content, &item.Status); err != nil {
			return nil, err
		}
		if strings.ToLower(strings.TrimSpace(item.Status)) == "invalidated" {
			continue
		}
		sourceIDs, err := s.loadNarrativeSourceIDs(item.NarrativeID)
		if err != nil {
			return nil, err
		}
		item.SourceMemoryIDs = sourceIDs
		candidates = append(candidates, item)
	}
	return candidates, rows.Err()
}

func (s *Service) loadNarrativeSourceIDs(narrativeID string) ([]string, error) {
	rows, err := s.backend.DB().Query(`
		SELECT memory_id
		FROM narrative_source
		WHERE narrative_id = ? AND is_active = 1
		ORDER BY memory_id
	`, narrativeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var memoryID string
		if err := rows.Scan(&memoryID); err != nil {
			return nil, err
		}
		out = append(out, memoryID)
	}
	return out, rows.Err()
}

func (s *Service) relationExpansions(bankLocatorKey string, sourceIDs []string) []relationExpansion {
	if s == nil || s.backend == nil || bankLocatorKey == "" || len(sourceIDs) == 0 {
		return nil
	}
	ids := uniqueTrimmedStrings(sourceIDs)
	if len(ids) == 0 {
		return nil
	}
	args := make([]any, 0, len(ids)+1+len(relationTypes))
	args = append(args, bankLocatorKey)
	for _, id := range ids {
		args = append(args, id)
	}
	for _, relationType := range relationTypes {
		args = append(args, relationType)
	}
	query := fmt.Sprintf(`
		SELECT source_id, target_id, relation_type, confidence
		FROM memory_relation
		WHERE bank_locator_key = ?
			AND is_active = 1
			AND source_id IN (%s)
			AND relation_type IN (%s)
	`, sqlPlaceholders(len(ids)), sqlPlaceholders(len(relationTypes)))
	rows, err := s.backend.DB().Query(query, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]relationExpansion, 0)
	for rows.Next() {
		var item relationExpansion
		if err := rows.Scan(&item.SourceID, &item.TargetID, &item.RelationType, &item.Confidence); err != nil {
			return nil
		}
		out = append(out, item)
	}
	return out
}

func uniqueTrimmedStrings(input []string) []string {
	if len(input) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(input))
	out := make([]string, 0, len(input))
	for _, item := range input {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func sqlPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	items := make([]string, count)
	for idx := range items {
		items[idx] = "?"
	}
	return strings.Join(items, ",")
}

func canonicalReviewRelationID(locatorKeyValue string, sourceID string, targetID string, relationType string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(locatorKeyValue),
		strings.TrimSpace(sourceID),
		strings.TrimSpace(targetID),
		strings.ToLower(strings.TrimSpace(relationType)),
	}, "|")))
	return fmt.Sprintf("rel_%x", sum[:8])
}

func normalizeCanonicalReviewRelations(locator *runtimev1.MemoryBankLocator, input []RelationCandidate) []RelationCandidate {
	if locator == nil || len(input) == 0 {
		return nil
	}
	locatorKeyValue := locatorKey(locator)
	out := make([]RelationCandidate, 0, len(input))
	seen := make(map[string]struct{}, len(input))
	for _, relation := range input {
		sourceID := strings.TrimSpace(relation.SourceID)
		targetID := strings.TrimSpace(relation.TargetID)
		relationType := strings.ToLower(strings.TrimSpace(relation.RelationType))
		if sourceID == "" || targetID == "" || sourceID == targetID {
			continue
		}
		if relation.Confidence < relationConfidenceFloor {
			continue
		}
		if _, ok := allowedRelationTypes[relationType]; !ok {
			continue
		}
		relationID := canonicalReviewRelationID(locatorKeyValue, sourceID, targetID, relationType)
		if _, ok := seen[relationID]; ok {
			continue
		}
		seen[relationID] = struct{}{}
		out = append(out, RelationCandidate{
			RelationID:   relationID,
			SourceID:     sourceID,
			TargetID:     targetID,
			RelationType: relationType,
			Confidence:   relation.Confidence,
			CreatedBy:    relationCreatedBy,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RelationID == out[j].RelationID {
			return false
		}
		return out[i].RelationID < out[j].RelationID
	})
	return out
}

func NormalizeCanonicalReviewRelations(locator *runtimev1.MemoryBankLocator, input []RelationCandidate) []RelationCandidate {
	return normalizeCanonicalReviewRelations(locator, input)
}

var relationTypes = []string{"causal", "emotional", "thematic"}

var allowedRelationTypes = map[string]struct{}{
	"causal":    {},
	"emotional": {},
	"thematic":  {},
}

func lexicalNarrativeScore(topic string, content string, query string) float64 {
	queryTokens := strings.Fields(memoryengine.BuildReviewSearchTokens(query))
	return memoryengine.NarrativeMatchScore(strings.TrimSpace(strings.Join([]string{topic, content}, " ")), queryTokens)
}

func CanonicalReviewRelationID(locatorKeyValue string, sourceID string, targetID string, relationType string) string {
	return canonicalReviewRelationID(locatorKeyValue, sourceID, targetID, relationType)
}

func CanonicalReviewRelationCreatedBy() string {
	return relationCreatedBy
}

func CanonicalReviewRelationConfidenceFloor() float64 {
	return relationConfidenceFloor
}
