package memory

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func semanticRetainDedupKey(record *runtimev1.MemoryRecord) (string, bool) {
	if record == nil {
		return "", false
	}
	return semanticRetainDedupKeyFromParts(record.GetCanonicalClass(), record.GetSemantic())
}

func semanticRetainDedupKeyFromInput(input *runtimev1.MemoryRecordInput) (string, bool) {
	if input == nil {
		return "", false
	}
	return semanticRetainDedupKeyFromParts(input.GetCanonicalClass(), input.GetSemantic())
}

func semanticRetainDedupKeyFromParts(class runtimev1.MemoryCanonicalClass, semantic *runtimev1.SemanticMemoryRecord) (string, bool) {
	if semantic == nil {
		return "", false
	}
	subject := normalizeRetainDedupSemanticField(semantic.GetSubject())
	predicate := normalizeRetainDedupSemanticField(semantic.GetPredicate())
	object := normalizeRetainDedupSemanticField(semantic.GetObject())
	if subject == "" || predicate == "" || object == "" {
		return "", false
	}
	return strings.Join([]string{
		class.String(),
		subject,
		predicate,
		object,
	}, "|"), true
}

func normalizeRetainDedupSemanticField(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " "))
}

func recordEligibleForRetainDedup(record *runtimev1.MemoryRecord) bool {
	if record == nil || record.GetSemantic() == nil {
		return false
	}
	return replicationOutcome(record) != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED
}

func inputEligibleForRetainDedup(bank *runtimev1.MemoryBank, input *runtimev1.MemoryRecordInput) bool {
	if bank == nil || bank.GetEmbeddingProfile() == nil || input == nil {
		return false
	}
	return input.GetSemantic() != nil
}
