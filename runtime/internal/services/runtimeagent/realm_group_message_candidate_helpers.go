package runtimeagent

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"time"
)

func cloneRealmGroupMessageCandidateRecord(input *realmGroupMessageCandidateEvidenceRecord) *realmGroupMessageCandidateEvidenceRecord {
	if input == nil {
		return nil
	}
	cloned := *input
	cloned.ContextBlockRefs = append([]string(nil), input.ContextBlockRefs...)
	return &cloned
}

func realmGroupCandidateContextBlockRefs(refs map[string]string) []string {
	keys := make([]string, 0, len(refs))
	for key, value := range refs {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		result = append(result, strings.TrimSpace(refs[key]))
	}
	return result
}

func normalizedRealmGroupCandidateContextBlockRefs(refs []string) []string {
	if len(refs) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(refs))
	for _, ref := range refs {
		trimmed := strings.TrimSpace(ref)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	sort.Strings(result)
	return result
}

func newRealmGroupMessageCandidateID(scope string, createdAt time.Time) string {
	sum := sha256.Sum256([]byte(scope + "|" + canonicalRealmGroupCandidateTime(createdAt)))
	return "rgmc_" + hex.EncodeToString(sum[:16])
}

func canonicalRealmGroupCandidateTime(value time.Time) string {
	return value.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
}

func parseRealmGroupCandidateTimestamp(value string) time.Time {
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", strings.TrimSpace(value))
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
