// Package musicscore admits bounded symbolic music content, without executing
// notation directives or taking ownership of the App's score editor.
package musicscore

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const MaxBytes = 1 << 20

// ValidateABC checks the transport's structural ABC subset, not the musical
// correctness of an arrangement. The App editor owns notation interpretation
// and loss reporting. Bytes are never repaired or rewritten here.
// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func ValidateABC(data []byte, melodyOnly bool) error {
	if len(data) == 0 || len(data) > MaxBytes || !utf8.Valid(data) {
		return fmt.Errorf("ABC score must be bounded UTF-8")
	}
	text := strings.TrimPrefix(string(data), "\ufeff")
	for _, ch := range text {
		if unicode.IsControl(ch) && ch != '\n' && ch != '\r' && ch != '\t' {
			return fmt.Errorf("ABC score contains control characters")
		}
	}
	hasTune, hasKey, hasMusic := false, false, false
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "%%abc-include") || strings.HasPrefix(lower, "%%include") || strings.HasPrefix(lower, "i:") || strings.HasPrefix(lower, "f:") {
			return fmt.Errorf("ABC external or executable directives are unsupported")
		}
		if strings.HasPrefix(line, "%") {
			continue
		}
		if len(line) >= 2 && line[1] == ':' {
			switch line[0] {
			case 'X':
				if strings.TrimSpace(line[2:]) == "" {
					return fmt.Errorf("ABC tune id is empty")
				}
				hasTune = true
			case 'K':
				if strings.TrimSpace(line[2:]) == "" {
					return fmt.Errorf("ABC key is empty")
				}
				hasKey = true
			}
			continue
		}
		if !hasKey {
			return fmt.Errorf("ABC music must follow its key header")
		}
		for i := 0; i < len(line); i++ {
			ch := line[i]
			if ch == '%' {
				break
			}
			if ch == '"' || ch == '!' || ch == '+' {
				end := i + 1
				for end < len(line) && line[end] != ch {
					if line[end] == '\\' {
						end++
					}
					end++
				}
				if end >= len(line) {
					return fmt.Errorf("ABC annotation is incomplete")
				}
				if ch == '"' && melodyOnly {
					annotation := strings.TrimSpace(line[i+1 : end])
					if annotation != "" && !strings.ContainsRune("^_<>@", rune(annotation[0])) {
						return fmt.Errorf("melody-only score contains a harmonic symbol")
					}
				}
				i = end
				continue
			}
			if ch == '[' && i+2 < len(line) && line[i+2] == ':' {
				end := strings.IndexByte(line[i+3:], ']')
				if end < 0 {
					return fmt.Errorf("ABC inline field is incomplete")
				}
				i += end + 3
				continue
			}
			if ch == '[' && i+1 < len(line) && line[i+1] != '|' && (line[i+1] < '0' || line[i+1] > '9') {
				end := strings.IndexByte(line[i+1:], ']')
				if end < 0 {
					return fmt.Errorf("ABC chord is incomplete")
				}
				if melodyOnly {
					return fmt.Errorf("melody-only score contains simultaneous notes")
				}
			}
			if strings.ContainsRune("ABCDEFGabcdefgzZxX", rune(ch)) {
				hasMusic = true
				continue
			}
			if ch > 127 || !strings.ContainsRune(" \t0123456789/.,'`^_=|:[](){}<>~-\\&*sHyY", rune(ch)) {
				return fmt.Errorf("ABC contains an unsupported music token")
			}
		}
	}
	if !hasTune || !hasKey || !hasMusic {
		return fmt.Errorf("ABC score requires tune, key and note/rest content")
	}
	return nil
}
