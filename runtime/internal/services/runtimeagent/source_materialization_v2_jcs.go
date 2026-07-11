package runtimeagent

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

func sha256HexBytes(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func hashSourceMaterializationDomainJCS(domain string, value any) (string, error) {
	if !strings.HasSuffix(domain, "\x00") {
		return "", fmt.Errorf("source materialization hash domain must end with NUL")
	}
	canonical, err := canonicalizeSourceMaterializationJCS(value)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	_, _ = hash.Write([]byte(domain))
	_, _ = hash.Write(canonical)
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func decodeSourceMaterializationJSON(raw []byte) (any, error) {
	if err := validateSourceMaterializationUnicodeEscapes(raw); err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := readSourceMaterializationJSONValue(decoder, "$", 0)
	if err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("source materialization JSON has trailing data")
		}
		return nil, fmt.Errorf("source materialization JSON trailing data: %w", err)
	}
	return value, nil
}

func readSourceMaterializationJSONValue(decoder *json.Decoder, path string, depth int) (any, error) {
	if depth > 256 {
		return nil, fmt.Errorf("decode %s exceeds JSON nesting limit", path)
	}
	token, err := decoder.Token()
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '{':
			result := map[string]any{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return nil, fmt.Errorf("decode %s object key: %w", path, err)
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, fmt.Errorf("decode %s object key is not a string", path)
				}
				if _, exists := result[key]; exists {
					return nil, fmt.Errorf("decode %s has duplicate field %q", path, key)
				}
				child, err := readSourceMaterializationJSONValue(decoder, path+"."+key, depth+1)
				if err != nil {
					return nil, err
				}
				result[key] = child
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim('}') {
				return nil, fmt.Errorf("decode %s object is unterminated", path)
			}
			return result, nil
		case '[':
			result := []any{}
			for decoder.More() {
				child, err := readSourceMaterializationJSONValue(decoder, fmt.Sprintf("%s[%d]", path, len(result)), depth+1)
				if err != nil {
					return nil, err
				}
				result = append(result, child)
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return nil, fmt.Errorf("decode %s array is unterminated", path)
			}
			return result, nil
		default:
			return nil, fmt.Errorf("decode %s has unexpected delimiter", path)
		}
	case string:
		if !utf8.ValidString(value) {
			return nil, fmt.Errorf("decode %s has invalid Unicode", path)
		}
		return value, nil
	case json.Number, bool, nil:
		return value, nil
	default:
		return nil, fmt.Errorf("decode %s has unsupported token %T", path, token)
	}
}

func validateSourceMaterializationUnicodeEscapes(raw []byte) error {
	if !utf8.Valid(raw) {
		return fmt.Errorf("source materialization JSON contains invalid UTF-8")
	}
	inString := false
	for index := 0; index < len(raw); index++ {
		current := raw[index]
		if !inString {
			if current == '"' {
				inString = true
			}
			continue
		}
		if current == '"' {
			inString = false
			continue
		}
		if current < 0x20 {
			return fmt.Errorf("source materialization JSON contains an unescaped control character")
		}
		if current != '\\' {
			continue
		}
		index++
		if index >= len(raw) {
			return fmt.Errorf("source materialization JSON contains a truncated escape")
		}
		if raw[index] != 'u' {
			continue
		}
		code, next, err := parseSourceMaterializationUnicodeEscape(raw, index)
		if err != nil {
			return err
		}
		index = next
		if code >= 0xdc00 && code <= 0xdfff {
			return fmt.Errorf("source materialization JSON contains an unpaired low surrogate")
		}
		if code < 0xd800 || code > 0xdbff {
			continue
		}
		if index+2 >= len(raw) || raw[index+1] != '\\' || raw[index+2] != 'u' {
			return fmt.Errorf("source materialization JSON contains an unpaired high surrogate")
		}
		low, lowEnd, err := parseSourceMaterializationUnicodeEscape(raw, index+2)
		if err != nil || low < 0xdc00 || low > 0xdfff {
			return fmt.Errorf("source materialization JSON contains an unpaired high surrogate")
		}
		index = lowEnd
	}
	return nil
}

func parseSourceMaterializationUnicodeEscape(raw []byte, uIndex int) (uint16, int, error) {
	if uIndex+4 >= len(raw) {
		return 0, uIndex, fmt.Errorf("source materialization JSON contains a truncated Unicode escape")
	}
	var value uint16
	for offset := 1; offset <= 4; offset++ {
		character := raw[uIndex+offset]
		var digit byte
		switch {
		case character >= '0' && character <= '9':
			digit = character - '0'
		case character >= 'a' && character <= 'f':
			digit = character - 'a' + 10
		case character >= 'A' && character <= 'F':
			digit = character - 'A' + 10
		default:
			return 0, uIndex, fmt.Errorf("source materialization JSON contains an invalid Unicode escape")
		}
		value = value*16 + uint16(digit)
	}
	return value, uIndex + 4, nil
}

func strictDecodeSourceMaterializationJSON(raw []byte, target any) error {
	if _, err := decodeSourceMaterializationJSON(raw); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("JSON has trailing data")
		}
		return err
	}
	return nil
}

func canonicalizeSourceMaterializationJCS(value any) ([]byte, error) {
	var normalized any
	switch typed := value.(type) {
	case []byte:
		decoded, err := decodeSourceMaterializationJSON(typed)
		if err != nil {
			return nil, err
		}
		normalized = decoded
	case json.RawMessage:
		decoded, err := decodeSourceMaterializationJSON(typed)
		if err != nil {
			return nil, err
		}
		normalized = decoded
	case map[string]any, []any, string, bool, nil, json.Number, float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		normalized = typed
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		decoded, err := decodeSourceMaterializationJSON(encoded)
		if err != nil {
			return nil, err
		}
		normalized = decoded
	}
	buffer := &bytes.Buffer{}
	if err := appendSourceMaterializationJCS(buffer, normalized, "$", 0); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func appendSourceMaterializationJCS(buffer *bytes.Buffer, value any, path string, depth int) error {
	if depth > 256 {
		return fmt.Errorf("%s exceeds JCS nesting limit", path)
	}
	switch typed := value.(type) {
	case nil:
		buffer.WriteString("null")
	case bool:
		if typed {
			buffer.WriteString("true")
		} else {
			buffer.WriteString("false")
		}
	case string:
		return appendSourceMaterializationJCSString(buffer, typed, path)
	case json.Number:
		formatted, err := formatSourceMaterializationJCSNumber(typed.String())
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		buffer.WriteString(formatted)
	case float64:
		formatted, err := formatSourceMaterializationJCSFloat(typed)
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		buffer.WriteString(formatted)
	case float32:
		formatted, err := formatSourceMaterializationJCSFloat(float64(typed))
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		buffer.WriteString(formatted)
	case int:
		if int64(typed) > 1<<53-1 || int64(typed) < -(1<<53-1) {
			return fmt.Errorf("%s integer exceeds interoperable JSON range", path)
		}
		buffer.WriteString(strconv.FormatInt(int64(typed), 10))
	case int8:
		buffer.WriteString(strconv.FormatInt(int64(typed), 10))
	case int16:
		buffer.WriteString(strconv.FormatInt(int64(typed), 10))
	case int32:
		buffer.WriteString(strconv.FormatInt(int64(typed), 10))
	case int64:
		if typed > 1<<53-1 || typed < -(1<<53-1) {
			return fmt.Errorf("%s integer exceeds interoperable JSON range", path)
		}
		buffer.WriteString(strconv.FormatInt(typed, 10))
	case uint:
		return appendSourceMaterializationJCS(buffer, uint64(typed), path, depth)
	case uint8:
		return appendSourceMaterializationJCS(buffer, uint64(typed), path, depth)
	case uint16:
		return appendSourceMaterializationJCS(buffer, uint64(typed), path, depth)
	case uint32:
		return appendSourceMaterializationJCS(buffer, uint64(typed), path, depth)
	case uint64:
		if typed > 1<<53-1 {
			return fmt.Errorf("%s integer exceeds interoperable JSON range", path)
		}
		buffer.WriteString(strconv.FormatUint(typed, 10))
	case []any:
		buffer.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				buffer.WriteByte(',')
			}
			if err := appendSourceMaterializationJCS(buffer, item, fmt.Sprintf("%s[%d]", path, index), depth+1); err != nil {
				return err
			}
		}
		buffer.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			if !utf8.ValidString(key) {
				return fmt.Errorf("%s has invalid Unicode object key", path)
			}
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return compareSourceMaterializationUTF16(keys[i], keys[j]) < 0 })
		buffer.WriteByte('{')
		for index, key := range keys {
			if index > 0 {
				buffer.WriteByte(',')
			}
			if err := appendSourceMaterializationJCSString(buffer, key, path+" key"); err != nil {
				return err
			}
			buffer.WriteByte(':')
			if err := appendSourceMaterializationJCS(buffer, typed[key], path+"."+key, depth+1); err != nil {
				return err
			}
		}
		buffer.WriteByte('}')
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("%s contains unsupported value %T", path, value)
		}
		decoded, err := decodeSourceMaterializationJSON(encoded)
		if err != nil {
			return err
		}
		return appendSourceMaterializationJCS(buffer, decoded, path, depth+1)
	}
	return nil
}

func appendSourceMaterializationJCSString(buffer *bytes.Buffer, value string, path string) error {
	if !utf8.ValidString(value) {
		return fmt.Errorf("%s contains invalid Unicode", path)
	}
	buffer.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"', '\\':
			buffer.WriteByte('\\')
			buffer.WriteRune(r)
		case '\b':
			buffer.WriteString("\\b")
		case '\t':
			buffer.WriteString("\\t")
		case '\n':
			buffer.WriteString("\\n")
		case '\f':
			buffer.WriteString("\\f")
		case '\r':
			buffer.WriteString("\\r")
		default:
			if r < 0x20 {
				buffer.WriteString(fmt.Sprintf("\\u%04x", r))
			} else {
				buffer.WriteRune(r)
			}
		}
	}
	buffer.WriteByte('"')
	return nil
}

func compareSourceMaterializationUTF16(left string, right string) int {
	a := utf16.Encode([]rune(left))
	b := utf16.Encode([]rune(right))
	for index := 0; index < len(a) && index < len(b); index++ {
		if a[index] < b[index] {
			return -1
		}
		if a[index] > b[index] {
			return 1
		}
	}
	if len(a) < len(b) {
		return -1
	}
	if len(a) > len(b) {
		return 1
	}
	return 0
}

func formatSourceMaterializationJCSNumber(raw string) (string, error) {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return "", fmt.Errorf("invalid JSON number")
	}
	return formatSourceMaterializationJCSFloat(value)
}

func formatSourceMaterializationJCSFloat(value float64) (string, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return "", fmt.Errorf("non-finite JSON number")
	}
	if value == 0 {
		return "0", nil
	}
	absolute := math.Abs(value)
	if absolute >= 1e-6 && absolute < 1e21 {
		return strconv.FormatFloat(value, 'f', -1, 64), nil
	}
	formatted := strconv.FormatFloat(value, 'e', -1, 64)
	parts := strings.SplitN(formatted, "e", 2)
	if len(parts) != 2 {
		return formatted, nil
	}
	exponent := parts[1]
	sign := ""
	if strings.HasPrefix(exponent, "+") || strings.HasPrefix(exponent, "-") {
		sign = exponent[:1]
		exponent = exponent[1:]
	}
	exponent = strings.TrimLeft(exponent, "0")
	if exponent == "" {
		exponent = "0"
	}
	return parts[0] + "e" + sign + exponent, nil
}

func decodeSourceMaterializationBase64URL(value string, field string) ([]byte, error) {
	if value == "" || strings.Contains(value, "=") {
		return nil, sourceMaterializationInvalid("%s must be unpadded base64url", field)
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil {
		return nil, sourceMaterializationInvalid("%s must be canonical base64url", field)
	}
	if base64.RawURLEncoding.EncodeToString(decoded) != value {
		return nil, sourceMaterializationInvalid("%s is not canonical base64url", field)
	}
	return decoded, nil
}
