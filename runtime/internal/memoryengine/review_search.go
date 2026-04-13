package memoryengine

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

func buildReviewSearchTokens(raw string) string {
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

func narrativeMatchScore(content string, queryTokens []string) float64 {
	if len(queryTokens) == 0 {
		return 0
	}
	searchable := strings.ToLower(strings.TrimSpace(content))
	if searchable == "" {
		return 0
	}
	var hits float64
	for _, token := range queryTokens {
		if strings.Contains(searchable, strings.ToLower(token)) {
			hits++
		}
	}
	if hits == 0 {
		return 0
	}
	return hits / float64(len(queryTokens))
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
