package runtimeagent

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// @nimi-authority: rule.nimi.runtime.agent-service.r058
// The snapshot owns the original string. A passage is a complete, contiguous
// range in that string, addressed in UTF-8 bytes under its parent source ref.
func appendLocalAgentSourceProse(partition *localAgentSourcePartitionV1, paths map[string]localAgentCognitionSourceUnitV1, ids map[string]struct{}, base localAgentCognitionSourceUnitV1, heading, field, original string) error {
	render := func(s string) string {
		return agentTurnContextTypedContent(heading, agentTurnContextTextField{Name: field, Values: []string{s}})
	}
	estimate := func(s string) uint64 {
		// Encoding adds bytes. Avoid quoting an entire novel merely to reject it.
		if len(s) > int(agentTurnContextCognitionSourceBudgetMaximum) {
			return agentTurnContextCognitionSourceBudgetMaximum + 1
		}
		item := agentTurnContextItem{LaneID: agentTurnContextLaneCognitionSource, AuthorityOwner: agentTurnContextAuthorityCognitionSource, TrustClass: agentTurnContextTrustValidatedSource, Included: true, Segments: []agentTurnContextSegment{{Role: "system", Content: agentTurnCognitionContent(base.Category, "embedding", "", render(s))}}}
		tokens, err := estimateAgentTurnContextItemTokens(item)
		if err != nil {
			return agentTurnContextCognitionSourceBudgetMaximum + 1
		}
		return tokens
	}
	// Leave room for a second relevant source, e.g. a person and their World.
	const preferred = agentTurnContextCognitionSourceBudgetMaximum / 2
	if estimate(original) <= preferred {
		base.Text = render(original)
		return appendLocalAgentCognitionUnitV1(partition, paths, ids, base)
	}
	emit := func(start, end int) error {
		unit := base
		unit.StableID += fmt.Sprintf(".bytes.%08d-%08d", start, end)
		unit.SourcePath += fmt.Sprintf("#utf8[%d:%d]", start, end)
		passage := original[start:end]
		if estimate(passage) > agentTurnContextCognitionSourceBudgetMaximum {
			return appendLocalAgentCognitionOmissionV1(partition, ids, unit.StableID, unit.Category, unit.SourcePath, unit.SourceRef, "source_sentence_exceeds_turn_budget")
		}
		unit.Text = render(passage)
		return appendLocalAgentCognitionUnitV1(partition, paths, ids, unit)
	}
	for offset := 0; offset < len(original); {
		lineEnd := strings.IndexByte(original[offset:], '\n')
		if lineEnd < 0 {
			lineEnd = len(original)
		} else {
			lineEnd += offset
		}
		line := original[offset:lineEnd]
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			start := offset + strings.Index(line, trimmed)
			end := start + len(trimmed)
			if estimate(trimmed) <= preferred {
				if err := emit(start, end); err != nil {
					return err
				}
			} else {
				pending := -1
				last := start
				for cursor := start; cursor < end; {
					next := sourceProseSentenceEnd(original, cursor, end)
					part := strings.TrimSpace(original[cursor:next])
					if part != "" {
						left := cursor + strings.Index(original[cursor:next], part)
						right := left + len(part)
						if pending >= 0 && estimate(original[pending:right]) > preferred {
							if err := emit(pending, last); err != nil {
								return err
							}
							pending = -1
						}
						if pending < 0 {
							pending = left
						}
						last = right
					}
					cursor = next
				}
				if pending >= 0 {
					if err := emit(pending, last); err != nil {
						return err
					}
				}
			}
		}
		offset = lineEnd + 1
	}
	return nil
}

func sourceProseSentenceEnd(s string, start, end int) int {
	for pos := start; pos < end; {
		r, n := utf8.DecodeRuneInString(s[pos:end])
		pos += n
		switch r {
		case '.': // Decimal points, initials and dots inside words stay in the sentence.
			if pos < end {
				next, _ := utf8.DecodeRuneInString(s[pos:end])
				if !unicode.IsSpace(next) && !isSourceProseClosing(next) {
					continue
				}
			}
		case '。', '！', '？', '!', '?', '；', ';', '…':
		default:
			continue
		}
		for pos < end {
			next, size := utf8.DecodeRuneInString(s[pos:end])
			if !isSourceProseClosing(next) && !strings.ContainsRune("。！？!?….", next) {
				break
			}
			pos += size
		}
		return pos
	}
	return end
}

func isSourceProseClosing(r rune) bool { return strings.ContainsRune("’”」』】）)]\"'", r) }
