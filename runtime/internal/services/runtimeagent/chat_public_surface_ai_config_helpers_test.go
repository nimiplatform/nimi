package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// upsertPublicChatTestAgentAIConfig replaces the committed AI Config with the
// required text.generate/text.embed intents plus any extra capability intents.
func upsertPublicChatTestAgentAIConfig(t *testing.T, svc *Service, extra ...*runtimev1.RuntimeAgentAIConfigIntent) {
	t.Helper()
	upsertPublicChatTestAgentAIConfigForContext(t, svc, publicChatTestAIConfigContext(t, svc), extra...)
}

func upsertPublicChatTestAgentAIConfigForContext(t *testing.T, svc *Service, ctx *runtimev1.AgentRequestContext, extra ...*runtimev1.RuntimeAgentAIConfigIntent) {
	t.Helper()
	current, err := svc.GetRuntimeAgentAIConfig(context.Background(), &runtimev1.GetRuntimeAgentAIConfigRequest{
		Context: ctx,
	})
	if err != nil {
		t.Fatalf("GetRuntimeAgentAIConfig: %v", err)
	}
	intents := []*runtimev1.RuntimeAgentAIConfigIntent{
		{
			Capability:  runtimeAgentAIConfigCapabilityTextGenerate,
			ModelId:     "local/default",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
		{
			Capability:  runtimeAgentAIConfigCapabilityTextEmbed,
			ModelId:     runtimeAgentAIConfigDefaultEmbeddingModelID,
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
	}
	intents = append(intents, extra...)
	if _, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          ctx,
		ExpectedRevision: current.GetConfig().GetRevision(),
		Intents:          intents,
	}); err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig: %v", err)
	}
}

func publicChatTestAIConfigContext(t *testing.T, svc *Service) *runtimev1.AgentRequestContext {
	t.Helper()
	if svc == nil {
		t.Fatal("service is required")
	}
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	var selected *runtimev1.LocalAgentRecord
	preferred := testRuntimeAgentLocalRef("agent-alpha")
	if entry := svc.agents[preferred]; entry != nil {
		selected = entry.Agent
	} else {
		for _, entry := range svc.agents {
			if entry != nil && entry.Agent != nil {
				selected = entry.Agent
				break
			}
		}
	}
	if selected == nil {
		t.Fatal("expected initialized runtime local agent before AI Config mutation")
	}
	return &runtimev1.AgentRequestContext{
		AppId:            "desktop.app",
		SubjectUserId:    selected.GetOwnerUserId(),
		OwnerUserId:      selected.GetOwnerUserId(),
		RuntimeSourceRef: selected.GetRuntimeSourceRef(),
		LocalAgentRef:    selected.GetLocalAgentRef(),
	}
}
