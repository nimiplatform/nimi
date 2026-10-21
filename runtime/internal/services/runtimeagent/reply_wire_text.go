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
		if next, ok := replyCodeEnd(raw, i); ok {
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

func replyCodeEnd(raw string, start int) (int, bool) {
	width := replyCodeDelimiterWidth(raw, start)
	if width == 0 {
		return start, false
	}
	mark := raw[start]
	for i := start + width; i < len(raw); i++ {
		if raw[i] != mark {
			continue
		}
		run := 1
		for i+run < len(raw) && raw[i+run] == mark {
			run++
		}
		if run == width || width >= 3 && run >= width {
			return i + run, true
		}
		i += run - 1
	}
	// An unmatched delimiter is not a completed literal code span. While
	// streaming, reserved markers inside it remain withheld until a closing
	// delimiter establishes that they really are a public code example.
	return start, false
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
		close := "</" + name + ">"
		last := strings.Index(raw[end:], close)
		if last < 0 {
			break
		}
		raw = raw[end+last+len(close):]
	}
	return text.String(), private
}
