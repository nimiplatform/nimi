package localservice

import "strings"

func slugifyLocalModelID(input string) string {
	var builder strings.Builder
	builder.Grow(len(input))
	for _, ch := range input {
		switch {
		case ch >= 'A' && ch <= 'Z':
			builder.WriteRune(ch + ('a' - 'A'))
		case ch >= 'a' && ch <= 'z', ch >= '0' && ch <= '9':
			builder.WriteRune(ch)
		case ch == '-', ch == '_', ch == '/', ch == ':', ch == '.', ch == ' ', ch == '\t', ch == '\n', ch == '\r':
			builder.WriteByte('-')
		}
	}
	parts := strings.FieldsFunc(builder.String(), func(r rune) bool { return r == '-' })
	if len(parts) == 0 {
		return "local-model"
	}
	return strings.Join(parts, "-")
}
