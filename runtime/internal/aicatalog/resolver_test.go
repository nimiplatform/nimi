package catalog

import (
	"strings"
	"testing"

	runtimecatalog "github.com/nimiplatform/nimi/runtime/catalog"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestResolveVoicesDashScopeModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("dashscope", "qwen3-tts-instruct-flash-2026-01-26")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty voices")
	}
	foundCherry := false
	for _, voice := range result.Voices {
		if voice.VoiceID == "cherry" {
			foundCherry = true
		}
		if voice.VoiceID == "Haruto" {
			t.Fatalf("dashscope catalog must not include Haruto")
		}
		if voice.VoiceID == voice.Name {
			t.Fatalf("expected canonical voice_id distinct from display name, got=%q", voice.VoiceID)
		}
	}
	if !foundCherry {
		t.Fatalf("expected cherry in built-in voice catalog")
	}
}

func TestParseProviderDocumentYAMLPreservesDashScopeCanonicalVoiceIDs(t *testing.T) {
	raw, err := runtimecatalog.DefaultProvidersFS.ReadFile("providers/dashscope.yaml")
	if err != nil {
		t.Fatalf("ReadFile(dashscope.yaml): %v", err)
	}

	doc, err := parseProviderDocumentYAML(raw, "dashscope.yaml")
	if err != nil {
		t.Fatalf("parseProviderDocumentYAML: %v", err)
	}

	foundArthur := false
	foundCherry := false
	for _, voice := range doc.Voices {
		switch voice.Name {
		case "Arthur":
			foundArthur = true
			if voice.VoiceID != "arthur" {
				t.Fatalf("expected Arthur voice_id=arthur, got=%q", voice.VoiceID)
			}
		case "Cherry":
			foundCherry = true
			if voice.VoiceID != "cherry" {
				t.Fatalf("expected Cherry voice_id=cherry, got=%q", voice.VoiceID)
			}
		}
	}
	if !foundArthur {
		t.Fatal("expected Arthur in dashscope provider document")
	}
	if !foundCherry {
		t.Fatal("expected Cherry in dashscope provider document")
	}
}

func TestParseProviderDocumentYAMLAllowsDynamicEndpointWithoutModels(t *testing.T) {
	raw := []byte(`version: 1
provider: openrouter
catalog_version: 2026-04-18-openrouter-dynamic-v1
inventory_mode: dynamic_endpoint
dynamic_inventory:
  discovery_transport: connector_list_models
  cache_ttl_sec: 300
  selection_mode: pass_through
  failure_policy: use_cache_then_fail_closed
  allowed_capabilities: [text.generate]
`)

	doc, err := parseProviderDocumentYAML(raw, "openrouter.yaml")
	if err != nil {
		t.Fatalf("parseProviderDocumentYAML: %v", err)
	}
	if doc.InventoryMode != "dynamic_endpoint" {
		t.Fatalf("expected dynamic_endpoint inventory_mode, got %q", doc.InventoryMode)
	}
	if doc.DynamicInventory == nil {
		t.Fatal("expected dynamic_inventory to be preserved")
	}
	if len(doc.Models) != 0 {
		t.Fatalf("expected dynamic provider to omit models, got %d rows", len(doc.Models))
	}
}

func TestResolveVoicesLocalModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("local", "qwen3-tts-local")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty local voices")
	}
	if result.Voices[0].VoiceID != "user-custom" {
		t.Fatalf("unexpected local voice id: %s", result.Voices[0].VoiceID)
	}
}

func TestResolveVoicesElevenLabsModel(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	result, err := resolver.ResolveVoices("elevenlabs", "eleven_multilingual_v2")
	if err != nil {
		t.Fatalf("ResolveVoices: %v", err)
	}
	if result.Source != SourceBuiltinSnapshot {
		t.Fatalf("unexpected source: %s", result.Source)
	}
	if len(result.Voices) == 0 {
		t.Fatalf("expected non-empty elevenlabs voices")
	}
	foundRachel := false
	for _, voice := range result.Voices {
		if voice.VoiceID == "21m00Tcm4TlvDq8ikWAM" {
			foundRachel = true
		}
	}
	if !foundRachel {
		t.Fatalf("expected Rachel in built-in elevenlabs voice catalog")
	}
}

func TestInferProviderFromModelLocalAndDashScope(t *testing.T) {
	cases := []struct {
		modelID  string
		expected string
	}{
		{modelID: "local/qwen3-tts-local", expected: "local"},
		{modelID: "qwen3-tts-local", expected: "local"},
		{modelID: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", expected: "local"},
		{modelID: "qwen3-tts-instruct-flash", expected: "dashscope"},
		{modelID: "elevenlabs/eleven_multilingual_v2", expected: "elevenlabs"},
		{modelID: "eleven_flash_v2_5", expected: "elevenlabs"},
	}
	for _, c := range cases {
		if got := inferProviderFromModel(c.modelID); got != c.expected {
			t.Fatalf("inferProviderFromModel(%q)=%q, want=%q", c.modelID, got, c.expected)
		}
	}
}

func TestResolveVoicesMissingModelReturnsErrModelNotFound(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	_, err = resolver.ResolveVoices("dashscope", "qwen3-tts-non-existent")
	if err == nil {
		t.Fatalf("expected ErrModelNotFound")
	}
	if err != ErrModelNotFound {
		t.Fatalf("expected ErrModelNotFound, got: %v", err)
	}
}

func TestResolveVoiceWorkflowDashScope(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("dashscope", "qwen3-tts-vc", "tts_v2v")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "dashscope" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "tts_v2v" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if strings.TrimSpace(resolved.WorkflowModelID) == "" {
		t.Fatalf("workflow model id must be set")
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "dashscope" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyID); got != "dashscope_provider_persistent_default" {
		t.Fatalf("handle policy mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyDeleteSemantics); got != "best_effort_provider_delete" {
		t.Fatalf("delete semantics mismatch: got=%q", got)
	}
	if !resolved.RuntimeReconciliationRequired {
		t.Fatalf("expected runtime reconciliation requirement")
	}
}

func TestResolveVoiceWorkflowElevenLabsClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("elevenlabs", "eleven_multilingual_sts_v2", "tts_v2v")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "elevenlabs" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "tts_v2v" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if resolved.WorkflowModelID != "elevenlabs-voice-clone" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "elevenlabs" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyID); got != "elevenlabs_provider_persistent_default" {
		t.Fatalf("handle policy mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowElevenLabsDesignUsesDedicatedModels(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("elevenlabs", "eleven_ttv_v3", "tts_t2v")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "elevenlabs" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "tts_t2v" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if resolved.WorkflowModelID != "elevenlabs-voice-design" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}

	_, err = resolver.ResolveVoiceWorkflow("elevenlabs", "eleven_multilingual_v2", "tts_t2v")
	if err == nil {
		t.Fatalf("expected ordinary ElevenLabs TTS model to reject tts_t2v")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowFishAudioClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("fish_audio", "s1", "tts_v2v")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "fish_audio" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "tts_v2v" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if resolved.WorkflowModelID != "fish-audio-create-model" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
}

func TestResolveVoiceWorkflowStepFunClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("stepfun", "step-tts-2", "tts_v2v")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "stepfun" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowType != "tts_v2v" {
		t.Fatalf("workflow type mismatch: got=%s", resolved.WorkflowType)
	}
	if resolved.WorkflowModelID != "stepfun-voice-clone" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
	if resolved.RequestOptions == nil {
		t.Fatalf("expected workflow request options")
	}
	if got := strings.TrimSpace(resolved.RequestOptions.TextPromptMode); got != "required" {
		t.Fatalf("text prompt mode mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowLocalQwenClone(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("local", "qwen3-tts-local", "tts_v2v")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "local" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowModelID != "qwen3-local-voice-clone" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "qwen3_tts" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyID); got != "local_runtime_session_ephemeral_default" {
		t.Fatalf("handle policy mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyPersistence); got != "session_ephemeral" {
		t.Fatalf("handle persistence mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(resolved.HandlePolicyDeleteSemantics); got != "runtime_authoritative_delete" {
		t.Fatalf("delete semantics mismatch: got=%q", got)
	}
	if resolved.RuntimeReconciliationRequired {
		t.Fatalf("local session-ephemeral workflow should not require runtime reconciliation")
	}
	if resolved.RequestOptions == nil {
		t.Fatalf("expected workflow request options")
	}
	if got := strings.TrimSpace(resolved.RequestOptions.TextPromptMode); got != "optional" {
		t.Fatalf("text prompt mode mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowLocalQwenDesign(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	resolved, err := resolver.ResolveVoiceWorkflow("local", "speech/qwen3tts", "tts_t2v")
	if err != nil {
		t.Fatalf("ResolveVoiceWorkflow: %v", err)
	}
	if resolved.Provider != "local" {
		t.Fatalf("provider mismatch: got=%s", resolved.Provider)
	}
	if resolved.WorkflowModelID != "qwen3-local-voice-design" {
		t.Fatalf("unexpected workflow model id: %s", resolved.WorkflowModelID)
	}
	if got := strings.TrimSpace(resolved.WorkflowFamily); got != "qwen3_tts" {
		t.Fatalf("workflow family mismatch: got=%q", got)
	}
	if resolved.RequestOptions == nil {
		t.Fatalf("expected workflow request options")
	}
	if got := strings.TrimSpace(resolved.RequestOptions.InstructionTextMode); got != "required" {
		t.Fatalf("instruction text mode mismatch: got=%q", got)
	}
}

func TestResolveVoiceWorkflowUnsupportedReturnsError(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("dashscope", "qwen3-tts-instruct-flash", "tts_v2v")
	if err == nil {
		t.Fatalf("expected voice workflow unsupported error")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowLocalUnsupportedReturnsError(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("local", "kokoro-local", "tts_v2v")
	if err == nil {
		t.Fatalf("expected local voice workflow unsupported error")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestResolveVoiceWorkflowLocalUnsupportedDesignReturnsError(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	_, err = resolver.ResolveVoiceWorkflow("local", "kokoro-local", "tts_t2v")
	if err == nil {
		t.Fatalf("expected local voice design unsupported error")
	}
	if err != ErrVoiceWorkflowUnsupported {
		t.Fatalf("expected ErrVoiceWorkflowUnsupported, got=%v", err)
	}
}

func TestSupportsScenarioVoiceWorkflowUsesBindings(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	supported, err := resolver.SupportsScenario("dashscope", "qwen3-tts-vd", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN)
	if err != nil {
		t.Fatalf("SupportsScenario voice design: %v", err)
	}
	if !supported {
		t.Fatalf("expected voice design to be supported for dashscope/qwen3-tts-vd")
	}

	supported, err = resolver.SupportsScenario("dashscope", "qwen3-tts-vd", runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE)
	if err != nil {
		t.Fatalf("SupportsScenario voice clone: %v", err)
	}
	if supported {
		t.Fatalf("expected voice clone to be unsupported for dashscope/qwen3-tts-vd")
	}
}

func TestSupportsScenarioSpeechTranscribeForAuditedSourceProviders(t *testing.T) {
	resolver, err := NewResolver(ResolverConfig{})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}

	cases := []struct {
		provider string
		modelID  string
	}{
		{provider: "openai", modelID: "gpt-4o-transcribe"},
		{provider: "gemini", modelID: "gemini-2.5-flash"},
		{provider: "dashscope", modelID: "qwen3-asr-flash"},
		{provider: "glm", modelID: "glm-asr-2512"},
	}

	for _, tc := range cases {
		supported, err := resolver.SupportsScenario(tc.provider, tc.modelID, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE)
		if err != nil {
			t.Fatalf("SupportsScenario(%s,%s): %v", tc.provider, tc.modelID, err)
		}
		if !supported {
			t.Fatalf("expected speech transcribe support for %s/%s", tc.provider, tc.modelID)
		}
	}
}
