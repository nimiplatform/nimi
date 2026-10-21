package runtimeagent

import (
	"encoding/json"
	"sort"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// Encode the already admitted planning window in generation constraints. The
// owner still validates identities, pauses, chronology and progress on commit.
func lifeFrameResponseFormat(view *agentTurnLifeContextInput) (*runtimev1.ResponseFormat, uint64, error) {
	var core struct {
		PastWindow  *struct{} `json:"past_window"`
		FutureSlots *int      `json:"future_slots"`
	}
	if err := json.Unmarshal([]byte(view.Core), &core); err != nil {
		return nil, 0, err
	}
	object := func(props map[string]any) map[string]any {
		keys := make([]string, 0, len(props))
		for key := range props {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		required := make([]any, len(keys))
		for i, key := range keys {
			required[i] = key
		}
		return map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}
	}
	segment := func(past bool) map[string]any {
		props := map[string]any{
			"description":        map[string]any{"anyOf": []any{map[string]any{"type": "null"}, object(map[string]any{"action": map[string]any{"type": "string", "enum": []any{"create", "practice", "explore", "reflect"}}, "object": map[string]any{"type": "string", "maxLength": 80}, "result": map[string]any{"type": "string", "enum": []any{"completed", "key_result"}}, "outcome": map[string]any{"type": "string", "minLength": 1, "maxLength": 160}})}},
			"activity_ref":       map[string]any{"type": []any{"string", "null"}, "maxLength": 160},
			"title":              map[string]any{"type": "string", "minLength": 1, "maxLength": 160},
			"kind":               map[string]any{"type": "string", "enum": []any{"routine", "project"}},
			"end_progress":       map[string]any{"type": "integer", "minimum": 0, "maximum": 100},
			"completes_activity": map[string]any{"type": "boolean"},
		}
		if past {
			props["start_fraction"] = map[string]any{"type": "number", "minimum": 0, "maximum": 1}
			props["end_fraction"] = map[string]any{"type": "number", "minimum": 0, "maximum": 1}
		} else {
			props["duration_minutes"] = map[string]any{"type": "number", "minimum": 1, "maximum": 1440}
		}
		return object(props)
	}
	pastSlots, futureSlots := 0, 3
	if core.PastWindow != nil {
		pastSlots = 3
	}
	if core.FutureSlots != nil {
		futureSlots = min(3, max(0, *core.FutureSlots))
	}
	schema := object(map[string]any{
		"self_intention": map[string]any{"anyOf": []any{map[string]any{"type": "null"}, object(map[string]any{
			"action":       map[string]any{"type": "string", "enum": []any{"change", "abandon"}},
			"activity_ref": map[string]any{"type": "string", "minLength": 1, "maxLength": 160},
			"title":        map[string]any{"type": "string", "maxLength": 160},
			"experience": object(map[string]any{
				"action":  map[string]any{"type": "string", "enum": []any{"create", "practice", "explore", "reflect"}},
				"object":  map[string]any{"type": "string", "minLength": 1, "maxLength": 80},
				"result":  map[string]any{"type": "string", "enum": []any{"direction_changed", "abandoned"}},
				"outcome": map[string]any{"type": "string", "maxLength": 160},
			}),
		})}},
		"past":               map[string]any{"type": "array", "maxItems": pastSlots, "items": segment(true)},
		"future":             map[string]any{"type": "array", "maxItems": futureSlots, "items": segment(false)},
		"explanation":        map[string]any{"type": "string", "maxLength": 600},
		"contact":            map[string]any{"type": []any{"string", "null"}, "maxLength": 160},
		"next_check_minutes": map[string]any{"type": "integer", "minimum": 15, "maximum": 1440},
	})
	doc, err := structpb.NewStruct(schema)
	if err != nil {
		return nil, 0, err
	}
	raw, err := json.Marshal(schema)
	if err != nil {
		return nil, 0, err
	}
	return &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: doc, SchemaName: "life_frames", Strict: true}, uint64(len(raw)), nil
}
