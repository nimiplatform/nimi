package runtimeagent

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Names are snapshot-bound identifiers, never a second source corpus.
type localAgentNamedSourceRefV1 struct {
	SourceRef agentTurnContextItemSourceRef
	Name      string
	Aliases   []string
}

type localAgentSourceReferenceMatchV1 struct {
	SourceRef agentTurnContextItemSourceRef
	Basis     string
	Term      string
}

type localAgentSourceReferenceAmbiguityV1 struct {
	Term string
	Refs []agentTurnContextItemSourceRef
}

type localAgentSourceReferenceMatchesV1 struct {
	Matches   []localAgentSourceReferenceMatchV1
	Ambiguous []localAgentSourceReferenceAmbiguityV1
	OverLimit bool
}

// @nimi-authority: rule.nimi.runtime.agent-service.r060
func matchLocalAgentSourceReferencesV1(text string, refs []agentTurnContextItemSourceRef, names []localAgentNamedSourceRefV1) localAgentSourceReferenceMatchesV1 {
	result := localAgentSourceReferenceMatchesV1{}
	byRef := make(map[string]localAgentSourceReferenceMatchV1)
	explicit := make(map[string]struct{})
	allowed := make(map[string]struct{}, len(refs))
	identifiers := make(map[string]map[string]agentTurnContextItemSourceRef)
	for _, ref := range refs {
		key := localAgentTurnSourceRefKeyV1(ref)
		allowed[key] = struct{}{}
		if sourceReferenceTermPresentV1(text, ref.RefID, true) {
			if identifiers[ref.RefID] == nil {
				identifiers[ref.RefID] = make(map[string]agentTurnContextItemSourceRef)
			}
			identifiers[ref.RefID][key] = ref
		}
	}
	for term, hits := range identifiers {
		if len(hits) != 1 {
			ambiguity := localAgentSourceReferenceAmbiguityV1{Term: term}
			for _, ref := range hits {
				ambiguity.Refs = append(ambiguity.Refs, ref)
			}
			result.Ambiguous = append(result.Ambiguous, ambiguity)
			continue
		}
		for key, ref := range hits {
			explicit[key] = struct{}{}
			byRef[key] = localAgentSourceReferenceMatchV1{SourceRef: ref, Basis: "source_ref", Term: term}
		}
	}
	type namedHit struct {
		ref   agentTurnContextItemSourceRef
		basis string
	}
	terms := make(map[string]map[string]namedHit)
	for _, named := range names {
		if _, present := allowed[localAgentTurnSourceRefKeyV1(named.SourceRef)]; !present {
			continue
		}
		for index, term := range append([]string{named.Name}, named.Aliases...) {
			if !sourceReferenceTermPresentV1(text, term, false) {
				continue
			}
			basis := "alias"
			if index == 0 {
				basis = "name"
			}
			if terms[term] == nil {
				terms[term] = make(map[string]namedHit)
			}
			key := localAgentTurnSourceRefKeyV1(named.SourceRef)
			if previous, exists := terms[term][key]; !exists || previous.basis == "alias" {
				terms[term][key] = namedHit{ref: named.SourceRef, basis: basis}
			}
		}
	}
	for term, hits := range terms {
		precise := make(map[string]namedHit)
		for key, hit := range hits {
			if _, present := explicit[key]; present {
				precise[key] = hit
			}
		}
		if len(precise) == 1 {
			hits = precise
		}
		if len(hits) != 1 {
			ambiguity := localAgentSourceReferenceAmbiguityV1{Term: term}
			for _, hit := range hits {
				ambiguity.Refs = append(ambiguity.Refs, hit.ref)
			}
			result.Ambiguous = append(result.Ambiguous, ambiguity)
			continue
		}
		for key, hit := range hits {
			previous, exists := byRef[key]
			if !exists || sourceReferenceBasisRankV1(hit.basis) > sourceReferenceBasisRankV1(previous.Basis) ||
				(hit.basis == previous.Basis && (len(term) > len(previous.Term) ||
					(len(term) == len(previous.Term) && term < previous.Term))) {
				byRef[key] = localAgentSourceReferenceMatchV1{SourceRef: hit.ref, Basis: hit.basis, Term: term}
			}
		}
	}
	for _, match := range byRef {
		result.Matches = append(result.Matches, match)
	}
	sort.Slice(result.Matches, func(i, j int) bool {
		return localAgentTurnSourceRefKeyV1(result.Matches[i].SourceRef) < localAgentTurnSourceRefKeyV1(result.Matches[j].SourceRef)
	})
	for index := range result.Ambiguous {
		refs := result.Ambiguous[index].Refs
		sort.Slice(refs, func(i, j int) bool {
			return localAgentTurnSourceRefKeyV1(refs[i]) < localAgentTurnSourceRefKeyV1(refs[j])
		})
	}
	sort.Slice(result.Ambiguous, func(i, j int) bool { return result.Ambiguous[i].Term < result.Ambiguous[j].Term })
	if len(result.Matches) > publicChatSourceCognitionSelectedLimit {
		result.Matches = nil
		result.OverLimit = true
	}
	return result
}

func sourceReferenceBasisRankV1(basis string) int {
	switch basis {
	case "source_ref":
		return 3
	case "name":
		return 2
	case "alias":
		return 1
	default:
		return 0
	}
}

func sourceReferenceTermPresentV1(text, term string, identifier bool) bool {
	if term == "" {
		return false
	}
	needsBoundary := identifier
	if !needsBoundary {
		needsBoundary = true
		for _, r := range term {
			if r > unicode.MaxASCII {
				needsBoundary = false
				break
			}
		}
	}
	for offset := 0; offset <= len(text)-len(term); {
		index := strings.Index(text[offset:], term)
		if index < 0 {
			return false
		}
		start, end := offset+index, offset+index+len(term)
		before, after := rune(0), rune(0)
		if start > 0 {
			before, _ = utf8.DecodeLastRuneInString(text[:start])
		}
		if end < len(text) {
			after, _ = utf8.DecodeRuneInString(text[end:])
		}
		if !needsBoundary || (!sourceReferenceIdentifierRuneV1(before) && !sourceReferenceIdentifierRuneV1(after)) {
			return true
		}
		offset = end
	}
	return false
}

func sourceReferenceIdentifierRuneV1(r rune) bool {
	return r <= unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsNumber(r) || strings.ContainsRune("_-:./", r))
}
