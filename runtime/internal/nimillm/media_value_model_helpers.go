package nimillm

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	maxInt32Value = int64(^uint32(0) >> 1)
	minInt32Value = -maxInt32Value - 1
)

// ---------------------------------------------------------------------------
// Value conversion
// ---------------------------------------------------------------------------

// ValueAsString converts a generic value to a string. Returns empty string
// for nil or unsupported types.
func ValueAsString(value any) string {
	switch item := value.(type) {
	case string:
		return item
	case fmt.Stringer:
		return item.String()
	default:
		return ""
	}
}

// ValueAsBool converts a generic value to a boolean. Supports bool, string
// ("true"/"1"/"yes"), and float64.
func ValueAsBool(value any) bool {
	switch item := value.(type) {
	case bool:
		return item
	case string:
		lower := strings.ToLower(strings.TrimSpace(item))
		return lower == "true" || lower == "1" || lower == "yes"
	case float64:
		return item != 0
	default:
		return false
	}
}

// ValueAsInt64 converts a generic value to an int64. Supports int, int32,
// int64, float32, float64, and string.
func ValueAsInt64(value any) int64 {
	switch item := value.(type) {
	case int:
		return int64(item)
	case int32:
		return int64(item)
	case int64:
		return item
	case float32:
		return int64(item)
	case float64:
		return int64(item)
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(item), 10, 64)
		if err == nil {
			return parsed
		}
		parsedFloat, floatErr := strconv.ParseFloat(strings.TrimSpace(item), 64)
		if floatErr == nil {
			return int64(parsedFloat)
		}
	}
	return 0
}

// ValueAsPositiveInt32 converts a generic value to an int32 via int64.
// Returns 0 for negative values or overflow.
func ValueAsPositiveInt32(value any) int32 {
	parsed := ValueAsInt64(value)
	if parsed <= 0 {
		return 0
	}
	if parsed > int64(^uint32(0)>>1) {
		return 0
	}
	return int32(parsed)
}

func ValueAsInt32(value any) int32 {
	parsed := ValueAsInt64(value)
	if parsed < minInt32Value || parsed > maxInt32Value {
		return 0
	}
	return int32(parsed)
}

// MapField returns the value of a key from a map[string]any, or nil if the
// value is not a map.
func MapField(value any, key string) any {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return object[key]
}

// FirstNonNil returns the first non-nil value from the arguments.
func FirstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

// StripProviderModelPrefix removes a known provider prefix (e.g. "kimi/")
// from a model ID, returning the bare model name.
func StripProviderModelPrefix(modelID string, prefixes ...string) string {
	trimmed := strings.TrimSpace(modelID)
	if trimmed == "" {
		return trimmed
	}
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) != 2 {
		return trimmed
	}
	prefix := strings.ToLower(strings.TrimSpace(parts[0]))
	rest := strings.TrimSpace(parts[1])
	if rest == "" {
		return trimmed
	}
	for _, candidate := range prefixes {
		if prefix == strings.ToLower(strings.TrimSpace(candidate)) {
			return rest
		}
	}
	return trimmed
}
