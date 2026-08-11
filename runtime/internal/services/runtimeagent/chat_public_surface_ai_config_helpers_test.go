package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// upsertPublicChatTestAgentAIConfig now installs an explicit machine execution
// binding fixture. Shared AIConfig itself carries no model, target, revision,
// or readiness truth.
func upsertPublicChatTestAgentAIConfig(t *testing.T, svc *Service, extra ...publicChatExecutionBinding) {
	t.Helper()
	upsertPublicChatTestAgentAIConfigForContext(t, svc, publicChatTestAIConfigContext(t, svc), extra...)
}

func ensurePublicChatTestAgentAIConfig(t *testing.T, svc *Service) {
	t.Helper()
	upsertPublicChatTestAgentAIConfig(t, svc)
}

func upsertPublicChatTestAgentAIConfigForContext(t *testing.T, svc *Service, requestContext *runtimev1.AgentRequestContext, extra ...publicChatExecutionBinding) {
	t.Helper()
	if svc == nil || requestContext == nil {
		t.Fatal("service and request context are required")
	}
	accountNamespace := strings.TrimSpace(requestContext.GetOwnerUserId())
	bindings := publicChatExecutionBindings{
		runtimeAgentAIConfigCapabilityTextGenerate: {
			ModelID: "local/default", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef: publicChatTestLocalRuntimeTargetRef("test_runtime_readiness:v2:default-text"),
		},
		runtimeAgentAIConfigCapabilityTextEmbed: {
			ModelID: runtimeAgentAIConfigTestEmbedModel, RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef: publicChatTestLocalRuntimeTargetRef("test_runtime_readiness:v2:default-embed"),
		},
	}
	for _, binding := range extra {
		if strings.TrimSpace(binding.ModelID) == "" {
			continue
		}
		capability := runtimeAgentAIConfigCapabilityTextGenerate
		switch {
		case binding.SelectedParams != nil && binding.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED:
			capability = runtimeAgentAIConfigCapabilityImageGenerate
		case strings.Contains(strings.ToLower(binding.ModelID), "speech"), strings.Contains(strings.ToLower(binding.ModelID), "tts"), strings.Contains(strings.ToLower(binding.ModelID), "voice"):
			capability = runtimeAgentAIConfigCapabilityAudioSynthesize
		case strings.Contains(strings.ToLower(binding.ModelID), "image"):
			capability = runtimeAgentAIConfigCapabilityImageGenerate
		}
		bindings[capability] = binding
	}
	frozen := clonePublicChatExecutionBindings(bindings)
	svc.setMachineExecutionBindingResolver(machineExecutionBindingResolverFunc(func(_ context.Context, requestedAccount string, capabilityContracts []string) (publicChatExecutionBindings, error) {
		if strings.TrimSpace(requestedAccount) != accountNamespace {
			return nil, unresolvedSharedAIConfigExecutionBindingError()
		}
		if len(capabilityContracts) == 0 {
			return clonePublicChatExecutionBindings(frozen), nil
		}
		filtered := make(publicChatExecutionBindings, len(capabilityContracts))
		for _, capabilityContract := range capabilityContracts {
			if binding, ok := frozen[capabilityContract]; ok {
				filtered[capabilityContract] = binding
			}
		}
		return filtered, nil
	}))
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
		t.Fatal("expected initialized Runtime LocalAgent before machine binding setup")
	}
	return &runtimev1.AgentRequestContext{
		AppId: "desktop.app", SubjectUserId: selected.GetOwnerUserId(), OwnerUserId: selected.GetOwnerUserId(),
		RuntimeSourceRef: selected.GetRuntimeSourceRef(), LocalAgentRef: selected.GetLocalAgentRef(),
	}
}
