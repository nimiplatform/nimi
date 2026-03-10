import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectVoiceWorkflowProvidersFromSource,
  extractGoFunctionBody,
} from './check-runtime-provider-activation-alignment.mjs';

test('extractGoFunctionBody keeps nested braces inside Go functions', () => {
  const source = `
func SupportsVoiceWorkflowProvider(provider string) bool {
	p := strings.TrimSpace(strings.ToLower(provider))
	if p == "dashscope" || p == "elevenlabs" {
		return true
	}
	return false
}
`;

  const body = extractGoFunctionBody(source, 'func SupportsVoiceWorkflowProvider(');
  assert.match(body, /return true/);
  assert.match(body, /return false/);
});

test('voice workflow provider parser accepts direct equality checks in support function', () => {
  const source = `
func SupportsVoiceWorkflowProvider(provider string) bool {
	p := strings.TrimSpace(strings.ToLower(provider))
	if p == "dashscope" || p == "elevenlabs" || p == "fish_audio" || p == "stepfun" {
		return true
	}
	return false
}

func ExecuteVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	switch provider {
	case "dashscope":
		return VoiceWorkflowResult{}, nil
	}
	return VoiceWorkflowResult{}, nil
}
`;

  const providers = [...collectVoiceWorkflowProvidersFromSource(source)].sort();
  assert.deepEqual(providers, ['dashscope', 'elevenlabs', 'fish_audio', 'stepfun']);
});

test('voice workflow provider parser unions support and dispatch facts', () => {
  const source = `
func SupportsVoiceWorkflowProvider(provider string) bool {
	switch provider {
	case "dashscope":
		return true
	default:
		return false
	}
}

func ExecuteVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	switch provider {
	case "elevenlabs":
		return VoiceWorkflowResult{}, nil
	case "fish_audio", "stepfun":
		return VoiceWorkflowResult{}, nil
	default:
		return VoiceWorkflowResult{}, nil
	}
}
`;

  const providers = [...collectVoiceWorkflowProvidersFromSource(source)].sort();
  assert.deepEqual(providers, ['dashscope', 'elevenlabs', 'fish_audio', 'stepfun']);
});
