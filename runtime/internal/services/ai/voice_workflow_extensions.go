package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func resolveVoiceWorkflowExtensionPayload(req *runtimev1.SubmitScenarioJobRequest, provider string) (map[string]any, error) {
	if req == nil {
		return nil, nil
	}
	namespace := voiceWorkflowExtensionNamespace(req.GetScenarioType())
	if namespace == "" {
		return nil, nil
	}
	for _, ext := range req.GetExtensions() {
		if strings.TrimSpace(ext.GetNamespace()) != namespace {
			continue
		}
		return validateVoiceWorkflowExtensionPayload(provider, req.GetScenarioType(), nimillm.StructToMap(ext.GetPayload()))
	}
	return nil, nil
}

func voiceWorkflowExtensionNamespace(scenarioType runtimev1.ScenarioType) string {
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE {
		return "nimi.scenario.voice_create.request"
	}
	return ""
}

// Voice workflow extensions cannot carry endpoint, credential, header, model,
// or protocol selectors. Those facts belong exclusively to the exact private
// target and adapter contract.
func validateVoiceWorkflowExtensionPayload(_ string, scenarioType runtimev1.ScenarioType, payload map[string]any) (map[string]any, error) {
	if len(payload) == 0 {
		return nil, nil
	}
	return nil, unsupportedScenarioExtensionError(scenarioType)
}
