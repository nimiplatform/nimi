package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

var commonVoiceWorkflowExtensionKeys = map[string]struct{}{
	"api_key_header": {},
	"base_url":       {},
	"headers":        {},
	"workflow_paths": {},
}

var voiceCloneExtensionKeys = map[string]struct{}{
	"clone_paths": {},
}

var voiceDesignExtensionKeys = map[string]struct{}{
	"design_paths": {},
}

var elevenLabsVoiceDesignExtensionKeys = map[string]struct{}{
	"create_paths":  {},
	"preview_paths": {},
}

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
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		return "nimi.scenario.voice_clone.request"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return "nimi.scenario.voice_design.request"
	default:
		return ""
	}
}

func validateVoiceWorkflowExtensionPayload(provider string, scenarioType runtimev1.ScenarioType, payload map[string]any) (map[string]any, error) {
	if len(payload) == 0 {
		return nil, nil
	}

	allowed := allowedVoiceWorkflowExtensionKeys(provider, scenarioType)
	if len(allowed) == 0 {
		return nil, unsupportedScenarioExtensionError(scenarioType)
	}

	out := make(map[string]any, len(payload))
	for key, value := range payload {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if _, ok := allowed[normalizedKey]; !ok {
			return nil, unsupportedScenarioExtensionError(scenarioType)
		}

		switch {
		case normalizedKey == "headers":
			headers, err := normalizeVoiceWorkflowHeaderMap(value)
			if err != nil {
				return nil, err
			}
			if len(headers) > 0 {
				out[normalizedKey] = headers
			}
		case isVoiceWorkflowStringListKey(normalizedKey):
			values, err := normalizeVoiceWorkflowStringSlice(value)
			if err != nil {
				return nil, err
			}
			out[normalizedKey] = stringSliceToAny(values)
		default:
			normalizedValue := strings.TrimSpace(nimillm.ValueAsString(value))
			if normalizedValue == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
			out[normalizedKey] = normalizedValue
		}
	}

	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

func allowedVoiceWorkflowExtensionKeys(provider string, scenarioType runtimev1.ScenarioType) map[string]struct{} {
	allowed := make(map[string]struct{}, len(commonVoiceWorkflowExtensionKeys)+4)
	mergeVoiceWorkflowExtensionKeys(allowed, commonVoiceWorkflowExtensionKeys)

	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		mergeVoiceWorkflowExtensionKeys(allowed, voiceCloneExtensionKeys)
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		mergeVoiceWorkflowExtensionKeys(allowed, voiceDesignExtensionKeys)
	default:
		return nil
	}

	switch strings.TrimSpace(strings.ToLower(provider)) {
	case "elevenlabs":
		if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN {
			mergeVoiceWorkflowExtensionKeys(allowed, elevenLabsVoiceDesignExtensionKeys)
		}
	}

	return allowed
}

func mergeVoiceWorkflowExtensionKeys(dst map[string]struct{}, src map[string]struct{}) {
	for key := range src {
		dst[key] = struct{}{}
	}
}

func isVoiceWorkflowStringListKey(key string) bool {
	switch key {
	case "clone_paths", "create_paths", "design_paths", "preview_paths", "workflow_paths":
		return true
	default:
		return false
	}
}

func normalizeVoiceWorkflowStringSlice(value any) ([]string, error) {
	items := make([]string, 0)
	switch typed := value.(type) {
	case []string:
		for _, item := range typed {
			normalized := strings.TrimSpace(item)
			if normalized == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
			items = append(items, normalized)
		}
	case []any:
		for _, item := range typed {
			normalized := strings.TrimSpace(nimillm.ValueAsString(item))
			if normalized == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
			items = append(items, normalized)
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if len(items) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	return items, nil
}

func normalizeVoiceWorkflowHeaderMap(value any) (map[string]any, error) {
	headers := make(map[string]any)
	switch typed := value.(type) {
	case map[string]string:
		for key, item := range typed {
			normalizedKey := strings.TrimSpace(key)
			normalizedValue := strings.TrimSpace(item)
			if normalizedKey == "" || normalizedValue == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
			headers[normalizedKey] = normalizedValue
		}
	case map[string]any:
		for key, item := range typed {
			normalizedKey := strings.TrimSpace(key)
			normalizedValue := strings.TrimSpace(nimillm.ValueAsString(item))
			if normalizedKey == "" || normalizedValue == "" {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
			headers[normalizedKey] = normalizedValue
		}
	default:
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if len(headers) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	return headers, nil
}
