package runtimeagent

import "strings"

const invalidReplyWireNames = "invoke function tool_call think response private-output"
const privateReplyWireNames = invalidReplyWireNames + " action activity_ref title kind experience self-intention intention-confirmation time-hook event-hook query emotion activity life-turn"

// Find only reserved wire markers outside Markdown code. An incomplete marker
// at the streaming edge is held until the next fragment disambiguates it.
// This is lexical projection, never an effect parser or a semantic classifier.
func nextReplyWireMarker(raw, names string) (start, end int, name string, closing, partial bool) {
	return nextReplyWireMarkerMode(raw, names, true)
}

func nextReplyWireMarkerMode(raw, names string, final bool) (start, end int, name string, closing, partial bool) {
	for i := 0; i < len(raw); i++ {
		if raw[i] == '\\' && i+1 < len(raw) {
			i++
			continue
		}
		if next, ok := replyCodeEnd(raw, i, final); ok {
			i = next - 1
			continue
		}
		if !final && replyCodeDelimiterWidth(raw, i) > 0 {
			// A code span is still undecided. Emit its ordinary prefix, but do
			// not remove a marker and resume after it, or permanently mute audio.
			for j := i + replyCodeDelimiterWidth(raw, i); j < len(raw); j++ {
				if raw[j] != '<' {
					continue
				}
				if a, b, n, c, _ := replyWireMarkerAt(raw, names, j); a >= 0 {
					return a, b, n, c, true
				}
			}
			return -1, -1, "", false, false
		}
		if raw[i] != '<' {
			continue
		}
		if a, b, n, c, p := replyWireMarkerAt(raw, names, i); a >= 0 {
			return a, b, n, c, p
		}
	}
	return -1, -1, "", false, false
}

func replyWireMarkerAt(raw, names string, i int) (start, end int, name string, closing, partial bool) {
	tail := raw[i:]
	for _, candidate := range strings.Fields(names) {
		for _, close := range []bool{false, true} {
			prefix := "<" + candidate
			if close {
				prefix = "</" + candidate
			}
			if strings.HasPrefix(prefix, tail) {
				return i, len(raw), candidate, close, true
			}
			if !strings.HasPrefix(tail, prefix) || !strings.ContainsRune(" \t\r\n/>=", rune(tail[len(prefix)])) {
				continue
			}
			end := strings.IndexByte(tail, '>')
			if end < 0 {
				return i, len(raw), candidate, close, false
			}
			return i, i + end + 1, candidate, close, false
		}
	}
	return -1, -1, "", false, false
}

func replyCodeDelimiterWidth(raw string, start int) int {
	mark := raw[start]
	if mark != '`' && mark != '~' {
		return 0
	}
	width := 1
	for start+width < len(raw) && raw[start+width] == mark {
		width++
	}
	if mark == '~' && width < 3 {
		return 0
	}
	return width
}

func replyCodeEnd(raw string, start int, final bool) (int, bool) {
	width := replyCodeDelimiterWidth(raw, start)
	if width == 0 {
		return start, false
	}
	mark := raw[start]
	lineStart := strings.LastIndexByte(raw[:start], '\n') + 1
	if width >= 3 && start-lineStart <= 3 && strings.Trim(raw[lineStart:start], " ") == "" {
		lineEnd := strings.IndexByte(raw[start+width:], '\n')
		if lineEnd < 0 {
			if final && (mark != '`' || !strings.ContainsRune(raw[start+width:], '`')) {
				return len(raw), true
			}
			return start, false
		}
		lineEnd += start + width
		if mark != '`' || !strings.ContainsRune(raw[start+width:lineEnd], '`') {
			for line := lineEnd + 1; line < len(raw); {
				next := strings.IndexByte(raw[line:], '\n')
				if next < 0 {
					next = len(raw)
				} else {
					next += line
				}
				at := line
				for at < next && raw[at] == ' ' && at-line < 4 {
					at++
				}
				if at < next && at-line <= 3 && raw[at] == mark {
					run := replyCodeDelimiterWidth(raw, at)
					if run >= width {
						if strings.TrimSpace(raw[at+run:next]) == "" {
							return next, true
						}
						// The reply carrier permits an optional wire tail directly
						// after the public body, including its closing code fence.
						tail := at + run
						for tail < next && (raw[tail] == ' ' || raw[tail] == '\t') {
							tail++
						}
						if found, _, _, _, _ := replyWireMarkerAt(raw, "message apml:message "+privateReplyWireNames, tail); found >= 0 {
							return at + run, true
						}
					}
				}
				line = next + 1
			}
			// Once the opening line establishes a fenced block, its contents
			// remain literal through the end of the body/document (including EOF).
			return len(raw), true
		}
	}
	if mark != '`' {
		return start, false
	}
	for i := start + width; i < len(raw); i++ {
		if raw[i] != mark {
			continue
		}
		run := 1
		for i+run < len(raw) && raw[i+run] == mark {
			run++
		}
		if run == width {
			return i + run, true
		}
		i += run - 1
	}
	// An unmatched delimiter is not a completed literal code span. While
	// streaming, reserved markers inside it remain withheld until a closing
	// delimiter establishes that they really are a public code example.
	return start, false
}

// Skip one complete wire element, including nested instances of its own tag.
// The private payload is never interpreted as Markdown or rewritten as text.
func replyWireElementEnd(raw string, afterOpen int, name string) int {
	depth := 1
	for at := afterOpen; at < len(raw); {
		next := strings.IndexByte(raw[at:], '<')
		if next < 0 {
			break
		}
		at += next
		start, end, _, closing, partial := replyWireMarkerAt(raw, name, at)
		if start < 0 {
			at++
			continue
		}
		if partial {
			break
		}
		if closing {
			depth--
			if depth == 0 {
				return end
			}
		} else if !strings.HasSuffix(raw[start:end], "/>") {
			depth++
		}
		at = end
	}
	return len(raw)
}

func projectReplyWireFragments(raw, names string) (string, bool) {
	return projectReplyWireFragmentsMode(raw, names, true)
}

func projectReplyWireFragmentsMode(raw, names string, final bool) (string, bool) {
	var text strings.Builder
	private := false
	for raw != "" {
		start, end, name, closing, partial := nextReplyWireMarkerMode(raw, names, final)
		if start < 0 {
			text.WriteString(raw)
			break
		}
		text.WriteString(raw[:start])
		if partial {
			break
		}
		private = true
		if closing || name == "message" || name == "apml:message" || strings.HasSuffix(raw[start:end], "/>") {
			raw = raw[end:]
			continue
		}
		raw = raw[replyWireElementEnd(raw, end, name):]
	}
	return text.String(), private
}
