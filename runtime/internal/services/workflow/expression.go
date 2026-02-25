package workflow

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"google.golang.org/protobuf/types/known/structpb"
)

var (
	branchConditionPattern = regexp.MustCompile(`^\s*(\$[\w\.\[\]]*)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$`)
	templateTokenPattern   = regexp.MustCompile(`\{\{\s*([\w\.-]+)\s*\}\}`)
)

func evaluateBranchCondition(condition string, inputs map[string]*structpb.Struct) (bool, error) {
	trimmed := strings.TrimSpace(condition)
	if trimmed == "" {
		return false, fmt.Errorf("condition is empty")
	}

	matches := branchConditionPattern.FindStringSubmatch(trimmed)
	if len(matches) == 4 {
		pathExpr := matches[1]
		op := matches[2]
		rawRight := strings.TrimSpace(matches[3])

		left, ok := extractConditionValue(pathExpr, inputs)
		if !ok {
			return false, nil
		}
		right := parseLiteral(rawRight)
		return compareCondition(left, op, right)
	}

	left, ok := extractConditionValue(trimmed, inputs)
	if !ok {
		return false, nil
	}
	return truthy(left), nil
}

func extractConditionValue(pathExpr string, inputs map[string]*structpb.Struct) (any, bool) {
	root := map[string]any{}
	if value, exists := inputs["data"]; exists && value != nil {
		root = value.AsMap()
	} else if value, exists := inputs["input"]; exists && value != nil {
		root = value.AsMap()
	} else if len(inputs) == 1 {
		for _, value := range inputs {
			if value != nil {
				root = value.AsMap()
			}
		}
	}
	return extractJSONPath(root, pathExpr)
}

func compareCondition(left any, op string, right any) (bool, error) {
	switch op {
	case "==":
		return valuesEqual(left, right), nil
	case "!=":
		return !valuesEqual(left, right), nil
	case ">", ">=", "<", "<=":
		leftNum, leftOK := asFloat(left)
		rightNum, rightOK := asFloat(right)
		if !leftOK || !rightOK {
			return false, fmt.Errorf("numeric comparison requires numbers")
		}
		switch op {
		case ">":
			return leftNum > rightNum, nil
		case ">=":
			return leftNum >= rightNum, nil
		case "<":
			return leftNum < rightNum, nil
		case "<=":
			return leftNum <= rightNum, nil
		}
	}
	return false, fmt.Errorf("unsupported operator %q", op)
}

func renderTemplateString(raw string, inputs map[string]*structpb.Struct) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	return templateTokenPattern.ReplaceAllStringFunc(raw, func(token string) string {
		match := templateTokenPattern.FindStringSubmatch(token)
		if len(match) != 2 {
			return ""
		}
		value, ok := resolveTemplateValue(match[1], inputs)
		if !ok {
			return ""
		}
		return stringifyValue(value)
	})
}

func resolveTemplateValue(selector string, inputs map[string]*structpb.Struct) (any, bool) {
	selector = strings.TrimSpace(selector)
	if selector == "" {
		return nil, false
	}

	parts := strings.Split(selector, ".")
	slot := parts[0]
	root, exists := inputs[slot]
	if !exists || root == nil {
		return nil, false
	}
	if len(parts) == 1 {
		if text := coerceString(root); text != "" {
			return text, true
		}
		return root.AsMap(), true
	}
	return extractJSONPath(root.AsMap(), "$."+strings.Join(parts[1:], "."))
}

func extractJSONPath(root map[string]any, expr string) (any, bool) {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "$" {
		return root, true
	}
	if !strings.HasPrefix(trimmed, "$") {
		return nil, false
	}
	path := strings.TrimPrefix(trimmed, "$")
	path = strings.TrimPrefix(path, ".")
	if path == "" {
		return root, true
	}

	segments := splitPathSegments(path)
	current := any(root)
	for _, segment := range segments {
		next, ok := stepSegment(current, segment)
		if !ok {
			return nil, false
		}
		current = next
	}
	return current, true
}

func splitPathSegments(path string) []string {
	segments := make([]string, 0, 4)
	var builder strings.Builder
	bracketDepth := 0
	for _, ch := range path {
		switch ch {
		case '.':
			if bracketDepth == 0 {
				if builder.Len() > 0 {
					segments = append(segments, builder.String())
					builder.Reset()
				}
				continue
			}
		case '[':
			bracketDepth++
		case ']':
			if bracketDepth > 0 {
				bracketDepth--
			}
		}
		builder.WriteRune(ch)
	}
	if builder.Len() > 0 {
		segments = append(segments, builder.String())
	}
	return segments
}

func stepSegment(current any, segment string) (any, bool) {
	segment = strings.TrimSpace(segment)
	if segment == "" {
		return current, true
	}
	name := segment
	index := -1
	if strings.HasSuffix(segment, "]") {
		open := strings.LastIndex(segment, "[")
		if open > 0 {
			name = segment[:open]
			parsed, err := strconv.Atoi(strings.TrimSpace(segment[open+1 : len(segment)-1]))
			if err != nil {
				return nil, false
			}
			index = parsed
		}
	}

	if name != "" {
		mapped, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		next, exists := mapped[name]
		if !exists {
			return nil, false
		}
		current = next
	}

	if index >= 0 {
		list, ok := current.([]any)
		if !ok || index < 0 || index >= len(list) {
			return nil, false
		}
		current = list[index]
	}

	return current, true
}

func parseLiteral(raw string) any {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.EqualFold(trimmed, "null") {
		return nil
	}
	if strings.EqualFold(trimmed, "true") {
		return true
	}
	if strings.EqualFold(trimmed, "false") {
		return false
	}
	if quoted := unquote(trimmed); quoted != trimmed {
		return quoted
	}
	if number, err := strconv.ParseFloat(trimmed, 64); err == nil {
		return number
	}
	return trimmed
}

func unquote(raw string) string {
	if len(raw) < 2 {
		return raw
	}
	start := raw[0]
	end := raw[len(raw)-1]
	if (start == '\'' || start == '"') && start == end {
		return raw[1 : len(raw)-1]
	}
	return raw
}

func valuesEqual(left any, right any) bool {
	if left == nil || right == nil {
		return left == right
	}
	if leftNum, ok := asFloat(left); ok {
		if rightNum, rightOK := asFloat(right); rightOK {
			return leftNum == rightNum
		}
	}
	return stringifyValue(left) == stringifyValue(right)
}

func asFloat(value any) (float64, bool) {
	switch cast := value.(type) {
	case float64:
		return cast, true
	case float32:
		return float64(cast), true
	case int:
		return float64(cast), true
	case int32:
		return float64(cast), true
	case int64:
		return float64(cast), true
	case uint:
		return float64(cast), true
	case uint32:
		return float64(cast), true
	case uint64:
		return float64(cast), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(cast), 64)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func stringifyValue(value any) string {
	if value == nil {
		return ""
	}
	switch cast := value.(type) {
	case string:
		return cast
	case bool:
		if cast {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", cast)
	}
}

func truthy(value any) bool {
	if value == nil {
		return false
	}
	switch cast := value.(type) {
	case bool:
		return cast
	case string:
		return strings.TrimSpace(cast) != ""
	case float64:
		return cast != 0
	case int:
		return cast != 0
	case []any:
		return len(cast) > 0
	case map[string]any:
		return len(cast) > 0
	default:
		text := fmt.Sprintf("%v", cast)
		return strings.TrimFunc(text, unicode.IsSpace) != ""
	}
}
