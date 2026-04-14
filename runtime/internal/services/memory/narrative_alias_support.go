package memory

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
)

const (
	narrativeAliasStatusCandidate  = "candidate"
	narrativeAliasStatusActive     = "active"
	narrativeAliasStatusSuppressed = "suppressed"
	narrativeAliasHelpfulThreshold = 3
	narrativeAliasHelpfulLead      = 2
	narrativeAliasBonusBase        = 0.08
	narrativeAliasBonusStep        = 0.02
	narrativeAliasBonusMax         = 0.18
)

func normalizeNarrativeAlias(raw string) (string, bool) {
	normalized := strings.TrimSpace(memoryengine.BuildReviewSearchTokens(raw))
	if normalized == "" {
		return "", false
	}
	if length := utf8.RuneCountInString(normalized); length < 2 || length > 32 {
		return "", false
	}
	if tokenCount := len(strings.Fields(normalized)); tokenCount == 0 || tokenCount > 4 {
		return "", false
	}
	return normalized, true
}

func narrativeAliasStatus(helpfulCount int, unhelpfulCount int) string {
	if unhelpfulCount >= helpfulCount {
		return narrativeAliasStatusSuppressed
	}
	if helpfulCount >= narrativeAliasHelpfulThreshold && helpfulCount >= unhelpfulCount+narrativeAliasHelpfulLead {
		return narrativeAliasStatusActive
	}
	return narrativeAliasStatusCandidate
}

func narrativeAliasBonus(helpfulCount int) float64 {
	bonus := narrativeAliasBonusBase + narrativeAliasBonusStep*float64(helpfulCount)
	if bonus > narrativeAliasBonusMax {
		return narrativeAliasBonusMax
	}
	return bonus
}

func (s *Service) recordNarrativeAliasEvidence(ctx context.Context, tx *sql.Tx, bankLocatorKey string, narrativeID string, polarity string, queryText string, now string) error {
	if tx == nil || bankLocatorKey == "" || strings.TrimSpace(narrativeID) == "" || strings.TrimSpace(queryText) == "" {
		return nil
	}
	aliasNorm, ok := normalizeNarrativeAlias(queryText)
	if !ok {
		return nil
	}
	var topic string
	var content string
	err := tx.QueryRowContext(ctx, `
		SELECT topic, content
		FROM memory_narrative
		WHERE narrative_id = ? AND bank_locator_key = ?
	`, strings.TrimSpace(narrativeID), bankLocatorKey).Scan(&topic, &content)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	if polarity == recallFeedbackHelpful && lexicalNarrativeScore(topic, content, queryText) > 0 {
		return nil
	}
	var helpfulCount int
	var unhelpfulCount int
	var existingStatus string
	err = tx.QueryRowContext(ctx, `
		SELECT helpful_count, unhelpful_count, status
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, bankLocatorKey, strings.TrimSpace(narrativeID), aliasNorm).Scan(&helpfulCount, &unhelpfulCount, &existingStatus)
	switch {
	case err == sql.ErrNoRows:
		if polarity != recallFeedbackHelpful {
			return nil
		}
		helpfulCount = 0
		unhelpfulCount = 0
	case err != nil:
		return err
	}
	if polarity == recallFeedbackHelpful {
		helpfulCount++
	} else {
		unhelpfulCount++
	}
	statusValue := narrativeAliasStatus(helpfulCount, unhelpfulCount)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(bank_locator_key, narrative_id, alias_norm) DO UPDATE SET
			alias_display = excluded.alias_display,
			helpful_count = excluded.helpful_count,
			unhelpful_count = excluded.unhelpful_count,
			status = excluded.status,
			updated_at = excluded.updated_at
	`, bankLocatorKey, strings.TrimSpace(narrativeID), aliasNorm, strings.TrimSpace(queryText), helpfulCount, unhelpfulCount, statusValue, now)
	return err
}

func (s *Service) narrativeAliasBonuses(bankLocatorKey string, query string, narrativeIDs []string) map[string]float64 {
	if s == nil || s.backend == nil || bankLocatorKey == "" || len(narrativeIDs) == 0 {
		return nil
	}
	aliasNorm, ok := normalizeNarrativeAlias(query)
	if !ok {
		return nil
	}
	ids := uniqueTrimmedStrings(narrativeIDs)
	if len(ids) == 0 {
		return nil
	}
	args := make([]any, 0, len(ids)+3)
	args = append(args, bankLocatorKey, aliasNorm, narrativeAliasStatusActive)
	for _, id := range ids {
		args = append(args, id)
	}
	querySQL := fmt.Sprintf(`
		SELECT narrative_id, helpful_count
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND alias_norm = ? AND status = ? AND narrative_id IN (%s)
	`, sqlPlaceholders(len(ids)))
	rows, err := s.backend.DB().Query(querySQL, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make(map[string]float64, len(ids))
	for rows.Next() {
		var narrativeID string
		var helpfulCount int
		if err := rows.Scan(&narrativeID, &helpfulCount); err != nil {
			return nil
		}
		out[narrativeID] = narrativeAliasBonus(helpfulCount)
	}
	return out
}
