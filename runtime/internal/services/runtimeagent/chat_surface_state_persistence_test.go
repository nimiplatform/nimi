package runtimeagent

import (
	"encoding/json"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPublicChatSurfaceStateRoundTripsDurableTargetRef(t *testing.T) {
	targetRef := &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
					ProfileBindingId: "local-runtime:profile-1",
				},
			},
		},
	}
	state := persistedPublicChatSurfaceState{
		Version: 1,
		Anchors: []persistedPublicChatAnchor{{
			ConversationAnchorID: "agent_anchor_1",
			AgentID:              "local-agent:alpha",
			LocalAgentRef:        "local-agent:alpha",
			OwnerUserID:          "user-1",
			RuntimeSourceRef:     "alpha",
			CallerAppID:          "nimi.zhiyu",
			SubjectUserID:        "user-1",
			Binding: publicChatExecutionBinding{
				ModelID:     "local.chat.gemma",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				TargetRef:   targetRef,
			},
			Bindings: publicChatExecutionBindings{
				"text.generate": {
					ModelID:     "local.chat.gemma",
					RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					TargetRef:   targetRef,
				},
			},
		}},
	}

	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal public chat state: %v", err)
	}
	rawText := string(raw)
	if strings.Contains(rawText, `"Target"`) || strings.Contains(rawText, `"LocalRuntime"`) {
		t.Fatalf("public chat state must persist durable target refs as protojson, got %s", rawText)
	}
	if !strings.Contains(rawText, `"local_runtime"`) || !strings.Contains(rawText, `"profile_binding_id"`) {
		t.Fatalf("public chat state target ref must preserve local runtime profile binding in protojson, got %s", rawText)
	}
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal public chat state: %v\njson=%s", err, raw)
	}
	assertPublicChatBindingProfileTarget(t, restored.Anchors[0].Binding, "local-runtime:profile-1")
	assertPublicChatBindingProfileTarget(t, restored.Anchors[0].Bindings["text.generate"], "local-runtime:profile-1")
}

func TestPublicChatSurfaceStateRoundTripsDurableReadinessTargetRef(t *testing.T) {
	targetRef := &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref: &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{
					ReadinessRef: "local-runtime:readiness-1",
				},
			},
		},
	}
	state := persistedPublicChatSurfaceState{
		Version: 1,
		Anchors: []persistedPublicChatAnchor{{
			ConversationAnchorID: "agent_anchor_1",
			AgentID:              "local-agent:alpha",
			LocalAgentRef:        "local-agent:alpha",
			OwnerUserID:          "user-1",
			RuntimeSourceRef:     "alpha",
			CallerAppID:          "nimi.zhiyu",
			SubjectUserID:        "user-1",
			Binding: publicChatExecutionBinding{
				ModelID:     "local.chat.gemma",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				TargetRef:   targetRef,
			},
		}},
	}

	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal public chat state: %v", err)
	}
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal public chat state: %v\njson=%s", err, raw)
	}
	assertPublicChatBindingReadinessTarget(t, restored.Anchors[0].Binding, "local-runtime:readiness-1")
}

func TestPublicChatSurfaceStateRoundTripsCloudDurableTargetRef(t *testing.T) {
	targetRef := &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
			Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
				Version:              "v2",
				ConnectorId:          "connector-openai",
				RemoteModelCatalogId: "catalog-gpt",
				ProviderModelId:      "gpt-5-mini",
				Provider:             "openai",
			},
		},
	}
	state := persistedPublicChatSurfaceState{
		Version: 1,
		Anchors: []persistedPublicChatAnchor{{
			ConversationAnchorID: "agent_anchor_1",
			AgentID:              "local-agent:alpha",
			LocalAgentRef:        "local-agent:alpha",
			OwnerUserID:          "user-1",
			RuntimeSourceRef:     "alpha",
			CallerAppID:          "nimi.zhiyu",
			SubjectUserID:        "user-1",
			Binding: publicChatExecutionBinding{
				ModelID:     "cloud.chat.gpt",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorID: "connector-openai",
				TargetRef:   targetRef,
			},
		}},
	}

	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal public chat state: %v", err)
	}
	rawText := string(raw)
	if strings.Contains(rawText, `"Target"`) || strings.Contains(rawText, `"Cloud"`) {
		t.Fatalf("public chat state must persist cloud target refs as protojson, got %s", rawText)
	}
	if !strings.Contains(rawText, `"cloud"`) || !strings.Contains(rawText, `"connector_id"`) {
		t.Fatalf("public chat state target ref must preserve cloud target in protojson, got %s", rawText)
	}
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal public chat state: %v\njson=%s", err, raw)
	}
	assertPublicChatBindingCloudTarget(t, restored.Anchors[0].Binding, "connector-openai", "catalog-gpt", "gpt-5-mini", "openai")
}

func TestPublicChatSurfaceStateReadsPersistedGoStructDurableTargetRef(t *testing.T) {
	raw := []byte(`{
		"version": 1,
		"anchors": [{
			"conversationAnchorId": "agent_anchor_1",
			"agentId": "local-agent:alpha",
			"localAgentRef": "local-agent:alpha",
			"ownerUserId": "user-1",
			"runtimeSourceRef": "alpha",
			"callerAppId": "nimi.zhiyu",
			"subjectUserId": "user-1",
			"binding": {
				"ModelID": "local.chat.gemma",
				"RoutePolicy": 1,
				"ConnectorID": "",
				"TargetRef": {
					"Target": {
						"LocalRuntime": {
							"version": "v2",
							"Ref": {
								"ProfileBindingId": "local-runtime:profile-1"
							}
						}
					}
				}
			},
			"bindings": {
				"text.generate": {
					"ModelID": "local.chat.gemma",
					"RoutePolicy": 1,
					"ConnectorID": "",
					"TargetRef": {
						"Target": {
							"LocalRuntime": {
								"version": "v2",
								"Ref": {
									"ProfileBindingId": "local-runtime:profile-1"
								}
							}
						}
					}
				}
			},
			"transcript": []
		}],
		"followUps": [],
		"avatarLiveInstances": []
	}`)
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal persisted public chat state: %v", err)
	}
	assertPublicChatBindingProfileTarget(t, restored.Anchors[0].Binding, "local-runtime:profile-1")
	assertPublicChatBindingProfileTarget(t, restored.Anchors[0].Bindings["text.generate"], "local-runtime:profile-1")
}

func TestPublicChatSurfaceStateReadsPersistedGoStructReadinessTargetRef(t *testing.T) {
	raw := []byte(`{
		"version": 1,
		"anchors": [{
			"conversationAnchorId": "agent_anchor_1",
			"agentId": "local-agent:alpha",
			"localAgentRef": "local-agent:alpha",
			"ownerUserId": "user-1",
			"runtimeSourceRef": "alpha",
			"callerAppId": "nimi.zhiyu",
			"subjectUserId": "user-1",
			"binding": {
				"ModelID": "local.chat.gemma",
				"RoutePolicy": 1,
				"ConnectorID": "",
				"TargetRef": {
					"Target": {
						"LocalRuntime": {
							"version": "v2",
							"Ref": {
								"ReadinessRef": "local-runtime:readiness-1"
							}
						}
					}
				}
			},
			"transcript": []
		}],
		"followUps": [],
		"avatarLiveInstances": []
	}`)
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal persisted public chat state: %v", err)
	}
	assertPublicChatBindingReadinessTarget(t, restored.Anchors[0].Binding, "local-runtime:readiness-1")
}

func TestPublicChatSurfaceStateReadsPersistedGoStructCloudDurableTargetRef(t *testing.T) {
	raw := []byte(`{
		"version": 1,
		"anchors": [{
			"conversationAnchorId": "agent_anchor_1",
			"agentId": "local-agent:alpha",
			"localAgentRef": "local-agent:alpha",
			"ownerUserId": "user-1",
			"runtimeSourceRef": "alpha",
			"callerAppId": "nimi.zhiyu",
			"subjectUserId": "user-1",
			"binding": {
				"ModelID": "cloud.chat.gpt",
				"RoutePolicy": 2,
				"ConnectorID": "connector-openai",
				"TargetRef": {
					"Target": {
						"Cloud": {
							"version": "v2",
							"connector_id": "connector-openai",
							"remote_model_catalog_id": "catalog-gpt",
							"provider_model_id": "gpt-5-mini",
							"provider": "openai"
						}
					}
				}
			},
			"transcript": []
		}],
		"followUps": [],
		"avatarLiveInstances": []
	}`)
	var restored persistedPublicChatSurfaceState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatalf("unmarshal persisted public chat state: %v", err)
	}
	assertPublicChatBindingCloudTarget(t, restored.Anchors[0].Binding, "connector-openai", "catalog-gpt", "gpt-5-mini", "openai")
}

func assertPublicChatBindingProfileTarget(t *testing.T, binding publicChatExecutionBinding, want string) {
	t.Helper()
	if got := binding.TargetRef.GetLocalRuntime().GetProfileBindingId(); got != want {
		t.Fatalf("expected local runtime profile target %q, got %q", want, got)
	}
}

func assertPublicChatBindingReadinessTarget(t *testing.T, binding publicChatExecutionBinding, want string) {
	t.Helper()
	if got := binding.TargetRef.GetLocalRuntime().GetReadinessRef(); got != want {
		t.Fatalf("expected local runtime readiness target %q, got %q", want, got)
	}
}

func assertPublicChatBindingCloudTarget(t *testing.T, binding publicChatExecutionBinding, connectorID string, catalogID string, providerModelID string, provider string) {
	t.Helper()
	cloud := binding.TargetRef.GetCloud()
	if cloud == nil {
		t.Fatal("expected cloud target ref")
	}
	if cloud.GetConnectorId() != connectorID || cloud.GetRemoteModelCatalogId() != catalogID || cloud.GetProviderModelId() != providerModelID || cloud.GetProvider() != provider {
		t.Fatalf(
			"expected cloud target %q/%q/%q/%q, got %q/%q/%q/%q",
			connectorID,
			catalogID,
			providerModelID,
			provider,
			cloud.GetConnectorId(),
			cloud.GetRemoteModelCatalogId(),
			cloud.GetProviderModelId(),
			cloud.GetProvider(),
		)
	}
}
