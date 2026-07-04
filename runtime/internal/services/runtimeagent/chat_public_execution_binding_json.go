package runtimeagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

type publicChatExecutionBindingJSON struct {
	ModelID     string                `json:"ModelID,omitempty"`
	RoutePolicy runtimev1.RoutePolicy `json:"RoutePolicy,omitempty"`
	ConnectorID string                `json:"ConnectorID,omitempty"`
	TargetRef   json.RawMessage       `json:"TargetRef,omitempty"`
}

func (b publicChatExecutionBinding) MarshalJSON() ([]byte, error) {
	out := publicChatExecutionBindingJSON{
		ModelID:     b.ModelID,
		RoutePolicy: b.RoutePolicy,
		ConnectorID: b.ConnectorID,
	}
	if b.TargetRef != nil && b.TargetRef.GetTarget() != nil {
		raw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(b.TargetRef)
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

func decodePublicChatBindingTargetRef(raw json.RawMessage) (*runtimev1.RuntimeDurableTargetRef, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}
	var targetRef runtimev1.RuntimeDurableTargetRef
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(trimmed, &targetRef); err == nil && targetRef.GetTarget() != nil {
		return &targetRef, nil
	}
	legacy, err := decodePublicChatLegacyGoStructTargetRef(trimmed)
	if err != nil {
		return nil, err
	}
	return legacy, nil
}

func decodePublicChatLegacyGoStructTargetRef(raw []byte) (*runtimev1.RuntimeDurableTargetRef, error) {
	var legacy struct {
		Target *struct {
			LocalRuntime *struct {
				Version string `json:"version"`
				Ref     *struct {
					ProfileBindingID string `json:"ProfileBindingId"`
					ReadinessRef     string `json:"ReadinessRef"`
				} `json:"Ref"`
			} `json:"LocalRuntime"`
			Cloud *struct {
				Version              string `json:"version"`
				ConnectorID          string `json:"connector_id"`
				RemoteModelCatalogID string `json:"remote_model_catalog_id"`
				ProviderModelID      string `json:"provider_model_id"`
				Provider             string `json:"provider"`
			} `json:"Cloud"`
		} `json:"Target"`
	}
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return nil, fmt.Errorf("parse public chat execution binding target_ref: %w", err)
	}
	if legacy.Target == nil {
		return nil, fmt.Errorf("parse public chat execution binding target_ref: missing Target")
	}
	if local := legacy.Target.LocalRuntime; local != nil {
		out := &runtimev1.RuntimeDurableLocalTargetRef{
			Version: strings.TrimSpace(local.Version),
		}
		if local.Ref != nil {
			if profileBindingID := strings.TrimSpace(local.Ref.ProfileBindingID); profileBindingID != "" {
				out.Ref = &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: profileBindingID}
			} else if readinessRef := strings.TrimSpace(local.Ref.ReadinessRef); readinessRef != "" {
				out.Ref = &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{ReadinessRef: readinessRef}
			}
		}
		return &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: out},
		}, nil
	}
	if cloud := legacy.Target.Cloud; cloud != nil {
		return &runtimev1.RuntimeDurableTargetRef{
			Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
				Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
					Version:              strings.TrimSpace(cloud.Version),
					ConnectorId:          strings.TrimSpace(cloud.ConnectorID),
					RemoteModelCatalogId: strings.TrimSpace(cloud.RemoteModelCatalogID),
					ProviderModelId:      strings.TrimSpace(cloud.ProviderModelID),
					Provider:             strings.TrimSpace(cloud.Provider),
				},
			},
		}, nil
	}
	return nil, fmt.Errorf("parse public chat execution binding target_ref: missing target")
}
