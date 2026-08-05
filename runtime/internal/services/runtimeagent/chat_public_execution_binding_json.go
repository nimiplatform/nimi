package runtimeagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/protobuf/types/known/structpb"
)

type publicChatExecutionBindingJSON struct {
	BindingAlias   string                `json:"BindingAlias,omitempty"`
	ModelID        string                `json:"ModelID,omitempty"`
	RoutePolicy    runtimev1.RoutePolicy `json:"RoutePolicy,omitempty"`
	ConnectorID    string                `json:"ConnectorID,omitempty"`
	TargetRef      json.RawMessage       `json:"TargetRef,omitempty"`
	SelectedParams map[string]any        `json:"SelectedParams,omitempty"`
}

func (b publicChatExecutionBinding) MarshalJSON() ([]byte, error) {
	out := publicChatExecutionBindingJSON{
		BindingAlias: b.BindingAlias,
		ModelID:      b.ModelID,
		RoutePolicy:  b.RoutePolicy,
		ConnectorID:  b.ConnectorID,
	}
	if b.SelectedParams != nil && len(b.SelectedParams.GetFields()) > 0 {
		out.SelectedParams = b.SelectedParams.AsMap()
	}
	if b.TargetRef != nil && b.TargetRef.Valid() {
		raw, err := json.Marshal(b.TargetRef)
		if err != nil {
			return nil, fmt.Errorf("marshal public chat execution binding target_ref: %w", err)
		}
		out.TargetRef = append(json.RawMessage(nil), raw...)
	}
	return json.Marshal(out)
}

func (b *publicChatExecutionBinding) UnmarshalJSON(raw []byte) error {
	if b == nil {
		return nil
	}
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	var out publicChatExecutionBinding
	out.BindingAlias = decodePublicChatBindingString(fields, "BindingAlias", "bindingAlias", "binding_alias")
	out.ModelID = decodePublicChatBindingString(fields, "ModelID", "modelID", "modelId", "model_id")
	out.ConnectorID = decodePublicChatBindingString(fields, "ConnectorID", "connectorID", "connectorId", "connector_id")
	route, err := decodePublicChatBindingRoutePolicy(firstPublicChatBindingRaw(fields, "RoutePolicy", "routePolicy", "route_policy", "route"))
	if err != nil {
		return err
	}
	out.RoutePolicy = route
	if targetRaw := firstPublicChatBindingRaw(fields, "TargetRef", "targetRef", "target_ref"); len(bytes.TrimSpace(targetRaw)) > 0 {
		targetRef, err := decodePublicChatBindingTargetRef(targetRaw)
		if err != nil {
			return err
		}
		out.TargetRef = targetRef
	}
	if paramsRaw := firstPublicChatBindingRaw(fields, "SelectedParams", "selectedParams", "selected_params"); len(bytes.TrimSpace(paramsRaw)) > 0 {
		var params map[string]any
		if err := json.Unmarshal(paramsRaw, &params); err != nil {
			return fmt.Errorf("parse public chat execution binding selected params: %w", err)
		}
		if len(params) > 0 {
			selectedParams, err := structpb.NewStruct(params)
			if err != nil {
				return fmt.Errorf("parse public chat execution binding selected params: %w", err)
			}
			out.SelectedParams = selectedParams
		}
	}
	*b = out
	return nil
}

func firstPublicChatBindingRaw(fields map[string]json.RawMessage, keys ...string) json.RawMessage {
	for _, key := range keys {
		if raw, ok := fields[key]; ok {
			return raw
		}
	}
	return nil
}

func decodePublicChatBindingString(fields map[string]json.RawMessage, keys ...string) string {
	raw := firstPublicChatBindingRaw(fields, keys...)
	if len(bytes.TrimSpace(raw)) == 0 {
		return ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return strings.TrimSpace(value)
	}
	return ""
}

func decodePublicChatBindingRoutePolicy(raw json.RawMessage) (runtimev1.RoutePolicy, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, nil
	}
	var number int32
	if err := json.Unmarshal(trimmed, &number); err == nil {
		return runtimev1.RoutePolicy(number), nil
	}
	var label string
	if err := json.Unmarshal(trimmed, &label); err != nil {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, fmt.Errorf("parse public chat execution binding route policy: %w", err)
	}
	label = strings.TrimSpace(label)
	if label == "" {
		return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED, nil
	}
	if parsed, err := strconv.Atoi(label); err == nil {
		return runtimev1.RoutePolicy(parsed), nil
	}
	if value, ok := runtimev1.RoutePolicy_value[strings.ToUpper(label)]; ok {
		return runtimev1.RoutePolicy(value), nil
	}
	return parseOptionalPublicChatRoutePolicy(label)
}

func decodePublicChatBindingTargetRef(raw json.RawMessage) (*runtimeidentity.Target, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	var targetRef runtimeidentity.Target
	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&targetRef); err != nil {
		return nil, fmt.Errorf("parse public chat execution binding target_ref: %w", err)
	}
	if !targetRef.Valid() {
		return nil, fmt.Errorf("parse public chat execution binding target_ref: invalid target")
	}
	return &targetRef, nil
}
