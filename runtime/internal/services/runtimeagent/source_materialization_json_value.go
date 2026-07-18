package runtimeagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

type sourceMaterializationJSONKind uint8

const (
	sourceMaterializationJSONNull sourceMaterializationJSONKind = iota
	sourceMaterializationJSONBoolean
	sourceMaterializationJSONNumber
	sourceMaterializationJSONString
	sourceMaterializationJSONArray
	sourceMaterializationJSONObject
)

type sourceMaterializationJSONMember struct {
	Name  string
	Value sourceMaterializationJSONValue
}

// sourceMaterializationJSONValue is a tagged recursive value used only for the
// explicitly open JSON-value fields admitted by the Realm core schema (facts,
// attributes, parameters, and authoring extensions). It avoids map/RawMessage
// truth while preserving every admitted semantic value exactly.
type sourceMaterializationJSONValue struct {
	Present bool
	Kind    sourceMaterializationJSONKind
	Boolean bool
	Number  string
	String  string
	Array   []sourceMaterializationJSONValue
	Object  []sourceMaterializationJSONMember
}

func (value *sourceMaterializationJSONValue) UnmarshalJSON(raw []byte) error {
	decoded, err := decodeSourceMaterializationJSON(raw)
	if err != nil {
		return err
	}
	normalized, err := normalizeSourceMaterializationJSONValue(decoded)
	if err != nil {
		return err
	}
	*value = normalized
	return nil
}

func (value sourceMaterializationJSONValue) MarshalJSON() ([]byte, error) {
	return canonicalizeSourceMaterializationJCS(value.interfaceValue())
}

func normalizeSourceMaterializationJSONValue(value any) (sourceMaterializationJSONValue, error) {
	switch typed := value.(type) {
	case nil:
		return sourceMaterializationJSONValue{Present: true, Kind: sourceMaterializationJSONNull}, nil
	case bool:
		return sourceMaterializationJSONValue{Present: true, Kind: sourceMaterializationJSONBoolean, Boolean: typed}, nil
	case string:
		return sourceMaterializationJSONValue{Present: true, Kind: sourceMaterializationJSONString, String: typed}, nil
	case json.Number:
		formatted, err := formatSourceMaterializationJCSNumber(typed.String())
		if err != nil {
			return sourceMaterializationJSONValue{}, err
		}
		return sourceMaterializationJSONValue{Present: true, Kind: sourceMaterializationJSONNumber, Number: formatted}, nil
	case []any:
		result := sourceMaterializationJSONValue{Present: true, Kind: sourceMaterializationJSONArray, Array: make([]sourceMaterializationJSONValue, 0, len(typed))}
		for _, item := range typed {
			normalized, err := normalizeSourceMaterializationJSONValue(item)
			if err != nil {
				return sourceMaterializationJSONValue{}, err
			}
			result.Array = append(result.Array, normalized)
		}
		return result, nil
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool { return compareSourceMaterializationUTF16(keys[i], keys[j]) < 0 })
		result := sourceMaterializationJSONValue{Present: true, Kind: sourceMaterializationJSONObject, Object: make([]sourceMaterializationJSONMember, 0, len(keys))}
		for _, key := range keys {
			normalized, err := normalizeSourceMaterializationJSONValue(typed[key])
			if err != nil {
				return sourceMaterializationJSONValue{}, err
			}
			result.Object = append(result.Object, sourceMaterializationJSONMember{Name: key, Value: normalized})
		}
		return result, nil
	default:
		return sourceMaterializationJSONValue{}, fmt.Errorf("unsupported JSON value %T", value)
	}
}

func (value sourceMaterializationJSONValue) interfaceValue() any {
	switch value.Kind {
	case sourceMaterializationJSONNull:
		return nil
	case sourceMaterializationJSONBoolean:
		return value.Boolean
	case sourceMaterializationJSONNumber:
		return json.Number(value.Number)
	case sourceMaterializationJSONString:
		return value.String
	case sourceMaterializationJSONArray:
		result := make([]any, 0, len(value.Array))
		for _, item := range value.Array {
			result = append(result, item.interfaceValue())
		}
		return result
	case sourceMaterializationJSONObject:
		result := make(map[string]any, len(value.Object))
		for _, member := range value.Object {
			result[member.Name] = member.Value.interfaceValue()
		}
		return result
	default:
		return nil
	}
}

type sourceMaterializationNullableString struct {
	Present bool
	Value   *string
}

func (value *sourceMaterializationNullableString) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(raw, []byte("null")) {
		value.Value = nil
		return nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return err
	}
	value.Value = &text
	return nil
}

func (value sourceMaterializationNullableString) MarshalJSON() ([]byte, error) {
	if value.Value == nil {
		return []byte("null"), nil
	}
	return json.Marshal(*value.Value)
}
