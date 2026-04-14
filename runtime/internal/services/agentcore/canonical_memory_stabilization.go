package agentcore

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
)

type semanticCandidateConflict struct {
	first  *runtimev1.CanonicalMemoryCandidate
	second *runtimev1.CanonicalMemoryCandidate
}

func validateCanonicalMemoryCandidateBatch(candidates []*runtimev1.CanonicalMemoryCandidate) error {
	if len(candidates) < 2 {
		return nil
	}
	seen := make(map[string]*runtimev1.CanonicalMemoryCandidate, len(candidates))
	for _, candidate := range candidates {
		if candidate == nil || candidate.GetRecord() == nil {
			continue
		}
		key, objectValue, ok := semanticCandidateConflictKey(candidate)
		if !ok {
			continue
		}
		if prior := seen[key]; prior != nil {
			priorObject := normalizedSemanticObject(prior.GetRecord().GetSemantic())
			if priorObject != objectValue {
				conflict := semanticCandidateConflict{first: prior, second: candidate}
				return fmt.Errorf("canonical memory candidates contain unresolved same-batch semantic contradiction: %s", conflict.description())
			}
			continue
		}
		seen[key] = candidate
	}
	return nil
}

func semanticCandidateConflictKey(candidate *runtimev1.CanonicalMemoryCandidate) (string, string, bool) {
	if candidate == nil || candidate.GetRecord() == nil {
		return "", "", false
	}
	semantic := candidate.GetRecord().GetSemantic()
	if semantic == nil {
		return "", "", false
	}
	locator := candidate.GetTargetBank()
	if locator == nil {
		return "", "", false
	}
	subject := normalizedSemanticField(semantic.GetSubject())
	predicate := normalizedSemanticField(semantic.GetPredicate())
	objectValue := normalizedSemanticObject(semantic)
	if subject == "" || predicate == "" || objectValue == "" {
		return "", "", false
	}
	return strings.Join([]string{
		memoryservice.LocatorKey(locator),
		candidate.GetCanonicalClass().String(),
		subject,
		predicate,
	}, "|"), objectValue, true
}

func normalizedSemanticField(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " "))
}

func normalizedSemanticObject(record *runtimev1.SemanticMemoryRecord) string {
	if record == nil {
		return ""
	}
	return normalizedSemanticField(record.GetObject())
}

func (c semanticCandidateConflict) description() string {
	if c.first == nil || c.second == nil {
		return "invalid semantic candidate batch"
	}
	firstSemantic := c.first.GetRecord().GetSemantic()
	return fmt.Sprintf("%s/%s in %s (%q vs %q)",
		normalizedSemanticField(firstSemantic.GetSubject()),
		normalizedSemanticField(firstSemantic.GetPredicate()),
		memoryservice.LocatorKey(c.first.GetTargetBank()),
		normalizedSemanticObject(c.first.GetRecord().GetSemantic()),
		normalizedSemanticObject(c.second.GetRecord().GetSemantic()),
	)
}
