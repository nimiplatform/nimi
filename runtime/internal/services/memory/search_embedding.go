package memory

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func buildSearchDocument(record *runtimev1.MemoryRecord) (string, string) {
	content := strings.TrimSpace(recordContent(record))
	context := strings.TrimSpace(recordContext(record))
	raw := strings.TrimSpace(strings.Join([]string{content, context}, " "))
	return raw, buildSearchTokens(raw)
}

func buildSearchTokens(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parts := make([]string, 0)
	var latinBuilder strings.Builder
	flushLatin := func() {
		if latinBuilder.Len() == 0 {
			return
		}
		token := strings.TrimSpace(strings.ToLower(latinBuilder.String()))
		if token != "" {
			parts = append(parts, token)
		}
		latinBuilder.Reset()
	}
	for _, r := range trimmed {
		switch {
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			if isCJKRune(r) {
				flushLatin()
				parts = append(parts, bigramTokens(string(r))...)
				continue
			}
			latinBuilder.WriteRune(unicode.ToLower(r))
		default:
			flushLatin()
		}
	}
	flushLatin()
	parts = append(parts, bigramTokensForString(trimmed)...)
	return strings.Join(dedupeStrings(parts), " ")
}

func buildFTSQuery(raw string) string {
	tokens := buildSearchTokens(raw)
	if tokens == "" {
		return ""
	}
	items := strings.Fields(tokens)
	for idx, token := range items {
		items[idx] = fmt.Sprintf(`"%s"`, strings.ReplaceAll(token, `"`, `""`))
	}
	return strings.Join(items, " OR ")
}

func computeEmbeddingVectorForRecord(record *runtimev1.MemoryRecord, dimension int32) []float64 {
	return computeEmbeddingVector(strings.TrimSpace(strings.Join([]string{recordContent(record), recordContext(record)}, " ")), dimension)
}

func computeEmbeddingVector(raw string, dimension int32) []float64 {
	if dimension <= 0 {
		return nil
	}
	vector := make([]float64, dimension)
	tokens := strings.Fields(buildSearchTokens(raw))
	if len(tokens) == 0 {
		return vector
	}
	for _, token := range tokens {
		sum := sha256.Sum256([]byte(token))
		for idx := range vector {
			vector[idx] += float64(sum[idx%len(sum)])
		}
	}
	var norm float64
	for _, value := range vector {
		norm += value * value
	}
	if norm == 0 {
		return vector
	}
	norm = math.Sqrt(norm)
	for idx := range vector {
		vector[idx] = vector[idx] / norm
	}
	return vector
}

func cosineSimilarity(left []float64, right []float64) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return 0
	}
	var dot float64
	for idx := range left {
		dot += left[idx] * right[idx]
	}
	return dot
}

func marshalFloatVector(vector []float64) string {
	raw, err := json.Marshal(vector)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func unmarshalFloatVector(raw string) []float64 {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var values []float64
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil
	}
	return values
}

func deleteMissingEmbeddings(tx *sql.Tx, liveRecordIDs map[string]struct{}) error {
	rows, err := tx.Query(`SELECT memory_id FROM memory_record_embedding`)
	if err != nil {
		return fmt.Errorf("list memory_record_embedding: %w", err)
	}
	defer rows.Close()
	stale := make([]string, 0)
	for rows.Next() {
		var memoryID string
		if err := rows.Scan(&memoryID); err != nil {
			return fmt.Errorf("scan memory_record_embedding: %w", err)
		}
		if _, ok := liveRecordIDs[memoryID]; !ok {
			stale = append(stale, memoryID)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, memoryID := range stale {
		if _, err := tx.Exec(`DELETE FROM memory_record_embedding WHERE memory_id = ?`, memoryID); err != nil {
			return fmt.Errorf("delete stale embedding %s: %w", memoryID, err)
		}
	}
	return nil
}

func (s *Service) embeddingAvailableForProfile(profile *runtimev1.MemoryEmbeddingProfile) bool {
	if profile == nil {
		return false
	}
	s.mu.RLock()
	managed := cloneEmbeddingProfile(s.managedEmbeddingProfile)
	s.mu.RUnlock()
	return embeddingProfilesMatch(managed, profile)
}

func embeddingProfilesMatch(managed *runtimev1.MemoryEmbeddingProfile, profile *runtimev1.MemoryEmbeddingProfile) bool {
	if managed == nil || profile == nil {
		return false
	}
	return managed.GetProvider() == profile.GetProvider() &&
		managed.GetModelId() == profile.GetModelId() &&
		managed.GetDimension() == profile.GetDimension() &&
		managed.GetDistanceMetric() == profile.GetDistanceMetric() &&
		managed.GetVersion() == profile.GetVersion() &&
		managed.GetMigrationPolicy() == profile.GetMigrationPolicy()
}

func boolToInt(input bool) int {
	if input {
		return 1
	}
	return 0
}

func timestampString(input *timestamppb.Timestamp) string {
	if input == nil {
		return ""
	}
	return input.AsTime().UTC().Format(time.RFC3339Nano)
}

func encodeSequenceValue(input uint64) string {
	return fmt.Sprintf("%d", input)
}

func decodeSequenceValue(raw string) (uint64, error) {
	var value uint64
	_, err := fmt.Sscanf(strings.TrimSpace(raw), "%d", &value)
	if err != nil {
		return 0, fmt.Errorf("decode sequence: %w", err)
	}
	return value, nil
}

func locatorKeyFromPersistedBacklog(input persistedReplicationBacklogItem) string {
	var locator runtimev1.MemoryBankLocator
	if err := protojson.Unmarshal(input.Locator, &locator); err != nil {
		return ""
	}
	return locatorKey(&locator)
}

func isCJKRune(r rune) bool {
	return unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul)
}

func bigramTokensForString(raw string) []string {
	runes := make([]rune, 0, utf8.RuneCountInString(raw))
	for _, r := range raw {
		if isCJKRune(r) {
			runes = append(runes, r)
		}
	}
	if len(runes) < 2 {
		if len(runes) == 1 {
			return []string{string(runes[0])}
		}
		return nil
	}
	out := make([]string, 0, len(runes)-1)
	for idx := 0; idx < len(runes)-1; idx++ {
		out = append(out, string([]rune{runes[idx], runes[idx+1]}))
	}
	return out
}

func bigramTokens(raw string) []string {
	return bigramTokensForString(raw)
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
